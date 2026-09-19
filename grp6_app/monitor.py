"""Actual ONEAPI SDK wrapper, preserving supplied ActionManager protocol."""
import json
import logging
import time
import hashlib
import uuid
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from pathlib import Path
from threading import RLock, Condition
from .runtime import RuntimeModels, WaferDetector
from .state import LiveState
from .data import TARGETS
from .metadata import decode_ascii, metadata_field


class MonitorCore:
    def __init__(self, artifacts, actions, data_types, to_site, evidence, feature_wait_seconds=0.2):
        self.models = RuntimeModels(artifacts)
        self.actions, self.types, self.to_site = actions, data_types, to_site
        self.state = LiveState()
        self.detectors = {}
        self.identity = {}
        self.counts = Counter()
        self.lock = RLock()
        self.data_ready = Condition(self.lock)
        self.feature_wait_seconds = max(0., float(feature_wait_seconds))
        self.run_id = uuid.uuid4().hex
        self.tester_runs = {}
        self.sequence = 0
        self.log_lock = RLock()
        self.test_context = {}
        self.pending_predictions = {}
        self.pending_messages = {}
        self.metadata = {}
        self.model_sha256 = hashlib.sha256(Path(artifacts).read_bytes()).hexdigest()
        self.evidence = Path(evidence)
        self.evidence.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.evidence.open('a', encoding='utf-8', buffering=1)
        self.reporter = ThreadPoolExecutor(max_workers=1)
        self.report_future = None
        self.log('monitor_start',team='grp6',measurement_export='first_12_samples_plus_targets_and_alert_windows')

    def update_report(self):
        if self.report_future is None or self.report_future.done():
            if self.report_future is not None:
                try:
                    self.report_future.result()
                except Exception as exc:
                    self.log('report_error', error=str(exc))
            from .report import from_log
            self.report_future=self.reporter.submit(from_log,self.evidence,self.evidence.with_suffix('.html'))

    def close(self):
        self.reporter.shutdown(wait=True)
        from .report import from_log
        try:
            from_log(self.evidence,self.evidence.with_suffix('.html'))
        except Exception as exc:
            self.log('report_error',error=str(exc))
        self.stream.close()

    def log(self, kind, **fields):
        with self.log_lock:
            self.sequence += 1
            now = time.time()
            tester = str(fields.get('tester', ''))
            state = self.state.testers.get(tester)
            lot, wafer = self.identity.get(tester, ('', ''))
            scope = dict(lot=lot, wafer=wafer, touchdown=state.touchdown if state else None,
                         test_id=self.test_context.get(tester))
            event_id = uuid.uuid4().hex
            event = dict(scope, schema_version=1, run_id=self.tester_runs.get(tester, self.run_id), event_id=event_id,
                         sequence=self.sequence, source_mode='live', time=now,
                         timestamp=datetime.fromtimestamp(now, timezone.utc).isoformat(),
                         model_sha256=self.model_sha256, kind=kind)
            event.update(fields)
            record = json.dumps(event, allow_nan=False)
            self.stream.write(record+'\n')
            print('GRP6_EVIDENCE '+record, flush=True)
            return event_id

    def send_message(self, tester, message, alert_id=None):
        try:
            result = self.actions.set_message(tester, message)
            if result is False:
                raise RuntimeError('ActionManager rejected message')
            event_id = self.log('action_message', tester=str(tester), message=message,
                     alert_id=alert_id, api_return=str(result), status='queued_unconfirmed')
            self.pending_messages.setdefault(str(tester), []).append(event_id)
        except Exception as exc:
            self.counts['action_errors'] += 1
            self.log('action_error', tester=str(tester), error=str(exc))

    def emit_alerts(self, tester, final=False):
        detector = self.detectors.get(str(tester))
        if detector is None:
            return
        for alert in detector.analyze(final):
            lot, wafer = self.identity.get(str(tester), ('',''))
            alert_id = self.log('alert', tester=str(tester), lot=lot, wafer=wafer, alert=alert)
            self.send_message(tester, 'grp6 [{}] wafer {}: {}'.format(alert_id[:12],wafer,alert['message']), alert_id)

    def record_metadata(self, tester, site, field, value):
        active=self.state.snapshot(tester)
        if str(site) not in active:
            return
        metadata=self.metadata.setdefault(tester,{})
        metadata.setdefault(str(site),{})[field]=decode_ascii(value)
        if not all(all(k in metadata.get(s,{}) for k in ("lot_upper","lot_lower","wafer")) for s in active):
            return
        scopes={(metadata[s]["lot_upper"]+metadata[s]["lot_lower"],metadata[s]["wafer"]) for s in active}
        if len(scopes)!=1:
            self.state.end(tester)
            raise ValueError("Mixed metadata scopes within touchdown; refusing cross-wafer aggregation")
        scope=scopes.pop()
        if scope!=self.identity.get(tester):
            self.emit_alerts(tester,True)
            self.identity[tester]=scope
            self.detectors[tester]=WaferDetector(self.models.artifact["baselines"],self.models.artifact.get("family_thresholds"))
            self.state.testers[tester].lot,self.state.testers[tester].wafer=scope
            self.log("metadata_scope",tester=tester,metadata_source="StringTest_20_21_25",sites=sorted(active))

    def consumeData(self, tc, data):
        with self.lock:
            try:
                dtype = data.getType()
                tester = str(tc.testerId)
                self.counts['callbacks'] += 1
                is_type = lambda name: dtype == getattr(self.types, name)
                if is_type('DATA_TYP_PRODUCTION_LOTSTART'):
                    self.tester_runs[tester] = uuid.uuid4().hex
                    lot = str(data.get_LotId())
                    self.identity[tester] = (lot, '')
                    self.state.reset(tester, lot=lot)
                    self.detectors.pop(tester, None)
                    self.test_context.pop(tester, None)
                    self.pending_predictions.pop(tester, None)
                    self.metadata.pop(tester, None)
                    self.pending_messages.pop(tester, None)
                    self.log('lot_start', tester=tester, lot=lot)
                elif is_type('DATA_TYP_PRODUCTION_WAFERSTART'):
                    lot = self.identity.get(tester, ('',''))[0]
                    wafer = str(data.get_WaferId())
                    self.identity[tester] = (lot, wafer)
                    self.state.reset(tester,lot,wafer)
                    self.test_context.pop(tester, None)
                    self.pending_predictions.pop(tester, None)
                    self.detectors[tester] = WaferDetector(self.models.artifact['baselines'],self.models.artifact.get('family_thresholds'))
                    self.log('wafer_start',tester=tester,lot=lot,wafer=wafer)
                elif is_type('DATA_TYP_PRODUCTION_TESTSTART'):
                    sites = [self.to_site(data.query_HeadSite(i)) for i in range(data.get_ResultCount())]
                    if len(sites) != len(set(sites)):
                        self.state.end(tester)
                        raise ValueError('Multiple heads share site IDs; refusing ambiguous device scope')
                    td = self.state.start(tester, sites)
                    self.test_context[tester] = uuid.uuid4().hex
                    self.pending_predictions[tester] = {}
                    self.metadata[tester] = {}
                    self.detectors.setdefault(tester, WaferDetector(self.models.artifact['baselines'],self.models.artifact.get('family_thresholds')))
                    self.log('test_start',tester=tester,touchdown=td,sites=sites)
                elif is_type('DATA_TYP_MEASURED_PARAMETRIC') or is_type('DATA_TYP_MEASURED_MULTI_PARAM'):
                    multi = is_type('DATA_TYP_MEASURED_MULTI_PARAM')
                    for i in range(data.get_ResultCount()):
                        site = self.to_site(data.query_HeadSite(i))
                        number, suite = int(data.query_TestNumber(i)), str(data.query_TestSuite(i))
                        if multi:
                            values = list(data.query_Results(i))
                            pins = [str(data.query_PinName(p)) for p in data.query_PinResults(i)]
                            if len(pins)!=len(values):
                                raise ValueError('Multi-parametric pin/result count differs')
                        else:
                            values, pins = [float(data.query_Result(i))], [None]
                        for value,pin in zip(values,pins):
                            field=metadata_field(number,suite)
                            if field:
                                self.record_metadata(tester,site,field,value)
                                self.counts["metadata_measurements"]+=1
                                continue
                            feature = self.models.feature(number,suite,pin)
                            if feature and self.state.record(tester,site,feature,value):
                                self.counts['measurements'] += 1
                                if self.counts['measurements']<=12:
                                    self.log('measurement',tester=tester,site=site,feature=feature,value=float(value),
                                             test_flag=str(data.query_TestFlag(i)) if hasattr(data,"query_TestFlag") else None,
                                             unit=str(data.query_Unit(i)) if hasattr(data,'query_Unit') else None,
                                             scaling=str(data.query_ResultScaling(i)) if hasattr(data,'query_ResultScaling') else None)
                            else:
                                self.counts['unmapped_or_rejected'] += 1
                                if self.counts['unmapped_or_rejected']<=12:
                                    self.log('unmapped_measurement',tester=tester,number=number,suite=suite,pin=pin)
                elif is_type('DATA_TYP_PRODUCTION_TESTEND'):
                    snapshots = self.state.snapshot(tester)
                    detector = self.detectors.get(tester)
                    ended = []
                    for i in range(data.get_ResultCount()):
                        site = str(self.to_site(data.query_HeadSite(i)))
                        ended.append(site)
                        flag = str(data.query_PartFlag(i))
                        # Verified supplied common/DefineBins.java: bin 1 passes,
                        # bins 2..32 fail. Preserve raw flag for audit.
                        sbin = int(data.query_SBinResult(i))
                        if detector and site in snapshots and 1 <= sbin <= 32:
                            detector.add(site,snapshots[site],sbin == 1)
                        for prediction in self.pending_predictions.get(tester, {}).get(site, []):
                            stage = prediction["stage"]
                            actual = snapshots.get(site, {}).get(TARGETS[int(stage)])
                            self.log('prediction_actual', tester=tester, site=site, stage=int(stage),
                                     request_id=prediction['request_id'], prediction_id=prediction['prediction_id'],
                                     device_id=prediction['device_id'], part=str(data.query_PartId(i)),
                                     predicted=prediction['value'], actual=actual,
                                     prediction_status=prediction["status"],
                                     absolute_error=abs(prediction['value']-actual) if actual is not None else None,
                                     unit=None, quality='observed_csv_units_unverified' if actual is not None else 'target_missing')
                        self.log('device_end',tester=tester,site=site,part=str(data.query_PartId(i)),
                                 device_id=self.device_id(tester, site),
                                 part_flag=flag,sbin=int(data.query_SBinResult(i)),features=len(snapshots.get(site,{})))
                        self.pending_predictions.get(tester, {}).pop(site, None)
                    self.state.end(tester,ended)
                    self.emit_alerts(tc.testerId)
                    if detector:
                        self.log('run_summary',tester=tester,completed_devices=detector.completed,
                                 good_devices=detector.good, yield_fraction=detector.good/max(detector.completed,1))
                    if detector and detector.completed%32==0:
                        self.log('progress',tester=tester,devices=detector.completed,counts=dict(self.counts))
                        logging.info('grp6 devices=%s measurements=%s errors=%s',detector.completed,self.counts['measurements'],self.counts['callback_errors'])
                        self.update_report()
                elif is_type('DATA_TYP_PRODUCTION_WAFEREND') or is_type('DATA_TYP_PRODUCTION_LOTEND'):
                    self.emit_alerts(tc.testerId,True)
                    self.state.end(tester)
                    self.pending_predictions.pop(tester, None)
                    self.log('boundary_end',tester=tester,counts=dict(self.counts))
                    self.update_report()
            except Exception as exc:
                self.counts['callback_errors'] += 1
                self.log('callback_error', tester=str(tc.testerId), error=str(exc))
                logging.exception('ONEAPI callback failed')
            finally:
                self.data_ready.notify_all()

    def device_id(self, tester, site):
        test_id = self.test_context.get(str(tester))
        return test_id + ':site:' + str(site) if test_id else None

    def consumeTPRequest(self, tc, request):
        started = time.perf_counter()
        with self.lock:
            tester = tc.testerId
            try:
                obj = json.loads(request)
                if obj.get('key') == 'predict':
                    request_id = uuid.uuid4().hex
                    requested_at = datetime.now(timezone.utc).isoformat()
                    initial_test_id = self.test_context.get(str(tester))
                    initial_lot, initial_wafer = self.identity.get(str(tester), ("", ""))
                    initial_run = self.tester_runs.get(str(tester), self.run_id)
                    stage = obj.get('data')
                    if type(stage) is not int or stage not in range(1,7):
                        raise ValueError('Invalid prediction stage')
                    sites = self.state.snapshot(tester)
                    initial_state = self.state.testers.get(str(tester))
                    initial_touchdown = initial_state.touchdown if initial_state else None
                    initial_sites = set(sites)
                    deadline = started + self.feature_wait_seconds
                    waited = False
                    lifecycle_changed = False
                    # The command and measurement channels can arrive out of order.
                    # Release the callback lock while waiting for already-executed
                    # features; never cross a touchdown or wafer boundary.
                    required = self.models.models[str(stage)]['features']
                    while sites and any(any(n not in v for n in required) for v in sites.values()):
                        remaining = deadline - time.perf_counter()
                        if remaining <= 0:
                            break
                        waited = True
                        self.data_ready.wait(remaining)
                        current = self.state.testers.get(str(tester))
                        sites = self.state.snapshot(tester)
                        if (current is not initial_state or current.touchdown != initial_touchdown
                                or self.identity.get(str(tester),("","")) != (initial_lot,initial_wafer)
                                or set(sites) != initial_sites):
                            lifecycle_changed = True
                            sites = {}
                            break
                    predictions, coverage = {}, {}
                    for site, values in sites.items():
                        value, fraction = self.models.predict(stage,values)
                        coverage[site] = fraction
                        if value is not None:
                            predictions[site] = value
                    if sites and len(predictions)==len(sites):
                        message = 'prediction {}:'.format(stage) + ''.join(' ({},{:.8g})'.format(s,v) for s,v in predictions.items())
                        if self.actions.set_wait(tester,10,message) is False:
                            raise RuntimeError('ActionManager rejected prediction')
                        status = 'response_queued'
                    else:
                        self.send_message(tester,'grp6 prediction {} unavailable: current-device features incomplete'.format(stage))
                        status = 'insufficient_current_data'
                    response = self.actions.get(tester)
                    prediction_ids = {}
                    for site, value in predictions.items():
                        prediction_id = request_id + ':site:' + site
                        prediction_ids[site] = prediction_id
                        self.pending_predictions.setdefault(str(tester), {}).setdefault(site, []).append(dict(
                            request_id=request_id, prediction_id=prediction_id, value=value,
                            device_id=self.device_id(tester, site), stage=stage, status=status))
                    self.log('prediction_request',tester=str(tester),stage=stage,status=status,
                             run_id=initial_run,lot=initial_lot,wafer=initial_wafer,
                             touchdown=initial_touchdown,test_id=initial_test_id,
                             request_id=request_id, prediction_ids=prediction_ids,
                             device_ids={s:self.device_id(tester,s) for s in sites}, requested_at=requested_at,
                             cutoff_policy='stage_execution_allowlist_with_bounded_arrival_wait', unit=None,
                             waited_for_measurements=waited,lifecycle_changed=lifecycle_changed,
                             missing_features={s:[n for n in required if n not in v] for s,v in sites.items()},
                             predictions=predictions,coverage=coverage,response=str(response),
                             feature_counts={s:len(v) for s,v in sites.items()},
                             latency_ms=(time.perf_counter()-started)*1000)
                    return response
                if obj.get('key')=='prod_action':
                    response = self.actions.get_prod(tester)
                    self.log('production_action_response',tester=str(tester),response=str(response),
                             candidate_message_ids=self.pending_messages.pop(str(tester), []),
                             status='returned_to_callback_unconfirmed')
                    return response
                if obj.get('action')=='list':
                    return self.actions.get(tester)
                if obj.get('key')=='health':
                    return 'ok'
                if 'tp_info' in obj:
                    self.log('tp_info',tester=str(tester),info=obj['tp_info'])
                    return 'Ack: Recieve test program'
                if obj.get('key')=='reset_td':
                    self.state.end(tester)
                    self.pending_predictions.pop(str(tester), None)
                    self.log("reset_td",tester=str(tester))
                    return ''
                return 'unsupported'
            except Exception as exc:
                self.log('request_error',tester=str(tester),error=str(exc))
                return ''

    def consumeTPSend(self, tc, data):
        with self.lock:
            self.log('tp_send',tester=str(tc.testerId),data=str(data))


def create_monitor(artifacts, evidence):
    from oneapi import Monitor, DataType, toSite
    from libACSAction import ActionManager
    class Grp6Monitor(Monitor):
        def __init__(self):
            Monitor.__init__(self)
            self.core = MonitorCore(artifacts,ActionManager,DataType,toSite,evidence)
        def consumeData(self,tc,data):
            return self.core.consumeData(tc,data)
        def consumeTPRequest(self,tc,request):
            return self.core.consumeTPRequest(tc,request)
        def consumeTPSend(self,tc,data):
            return self.core.consumeTPSend(tc,data)
    return Grp6Monitor()
