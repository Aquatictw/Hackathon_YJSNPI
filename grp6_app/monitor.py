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
    def __init__(self, artifacts, actions, data_types, to_site, evidence, feature_wait_seconds=0.2,
                 exporter=None, to_head=None, mode='live'):
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
        self.exporter, self.to_head, self.mode = exporter, to_head, str(mode)
        self.sequences = Counter()
        self.device_measurements = {}
        self.device_quality = {}
        self.evidence = Path(evidence)
        self.evidence.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.evidence.open('a', encoding='utf-8', buffering=1)
        self.reporter = ThreadPoolExecutor(max_workers=1)
        self.report_future = None
        self.log('monitor_start',team='grp6',measurement_export='first_12_samples_plus_targets_and_alert_windows',
                 sparse_burst_status=self.models.sparse_burst_status,
                 sparse_burst_sha256=self.models.sparse_burst.sha256 if self.models.sparse_burst else None)

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
        if self.exporter is not None:
            self.exporter.close()

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
                         sequence=self.sequence, source_mode=self.mode, time=now,
                         timestamp=datetime.fromtimestamp(now, timezone.utc).isoformat(),
                         model_sha256=self.model_sha256, kind=kind)
            event.update(fields)
            record = json.dumps(event, allow_nan=False)
            self.stream.write(record+'\n')
            print('GRP6_EVIDENCE '+record, flush=True)
            if kind in ('prediction_actual', 'action_message', 'production_action_response'):
                exported = self.event(tester, kind, **{k: v for k, v in event.items()
                    if k not in ('kind', 'tester', 'schema_version', 'sequence', 'timestamp')})
                self.export(exported)
            return event_id

    @staticmethod
    def safe(data, name, *args):
        try:
            method = getattr(data, name)
            return method(*args)
        except Exception:
            return None

    def event(self, tester, event_type, **payload):
        if self.exporter is None:
            return {}
        tester = str(tester)
        self.sequences[tester] += 1
        lot, wafer = self.identity.get(tester, ('', ''))
        event = dict(
            schema_version='1', event_id=str(uuid.uuid4()),
            sequence=self.sequences[tester], mode=self.mode,
            event_type=event_type, timestamp=time.time(), tester_id=tester,
            run_id=self.tester_runs.get(tester, self.run_id), lot_id=lot or None,
            wafer_id=wafer or None, model_sha256=self.model_sha256)
        event.update(payload)
        return event

    def export(self, event):
        if self.exporter is None:
            return
        try:
            if self.exporter.submit(event):
                return
            reason = 'memory_queue_full'
        except Exception as exc:
            reason = 'exporter_submit_error: ' + str(exc)
        if reason:
            self.counts['export_dropped'] += 1
            self.log('export_drop', dropped_event_id=event.get('event_id'),
                     event_type=event.get('event_type'), reason=reason)

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
            self.export(self.event(tester, 'alert', event_id=alert_id, alert=alert, final=bool(final)))
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
            self.detectors[tester]=self.models.detector()
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
                    self.sequences[tester] = 0
                    self.state.reset(tester, lot=lot)
                    self.detectors.pop(tester, None)
                    self.test_context.pop(tester, None)
                    self.pending_predictions.pop(tester, None)
                    self.metadata.pop(tester, None)
                    self.pending_messages.pop(tester, None)
                    self.log('lot_start', tester=tester, lot=lot)
                    artifact = self.models.artifact
                    self.export(self.event(
                        tester, 'detector_baseline_artifact',
                        artifact_version=artifact.get('version'),
                        artifact_sha256=self.model_sha256,
                        created_at=None,
                        baseline_location_semantics='median_stored_in_legacy_mean_field',
                        threshold_semantics={
                            'site_imbalance': 'difference_between_site_means_divided_by_baseline_sd',
                            'mean_drift': 'absolute_first_vs_last_window_mean_change_divided_by_baseline_sd',
                            'spread': 'absolute_log(last_window_sd/first_window_sd)',
                            'family_order': ['site_imbalance', 'mean_drift', 'spread_up', 'spread_down'],
                        },
                        baselines=artifact.get('baselines', {}),
                        family_thresholds=artifact.get('family_thresholds', {}),
                        baseline_wafers=artifact.get('baseline_wafers', []),
                        calibration=artifact.get('detector_calibration', {}),
                        sparse_burst_status=self.models.sparse_burst_status,
                        sparse_burst_calibration=(self.models.sparse_burst.summary()
                                                  if self.models.sparse_burst else None),
                        unit_status='unit_unverified',
                        known_gaps=['per-test sample_count unavailable',
                                    'per-test missing_rate unavailable',
                                    'artifact build timestamp unavailable']))
                    self.export(self.event(tester, 'lot_start',
                                           source_timestamp_us=self.safe(data, 'get_TimeStamp')))
                elif is_type('DATA_TYP_PRODUCTION_WAFERSTART'):
                    lot = self.identity.get(tester, ('',''))[0]
                    wafer = str(data.get_WaferId())
                    self.identity[tester] = (lot, wafer)
                    self.state.reset(tester,lot,wafer)
                    self.test_context.pop(tester, None)
                    self.pending_predictions.pop(tester, None)
                    self.detectors[tester] = self.models.detector()
                    self.log('wafer_start',tester=tester,lot=lot,wafer=wafer)
                    self.export(self.event(tester, 'wafer_start',
                                           source_timestamp_us=self.safe(data, 'get_TimeStamp')))
                elif is_type('DATA_TYP_PRODUCTION_TESTSTART'):
                    sites = [self.to_site(data.query_HeadSite(i)) for i in range(data.get_ResultCount())]
                    if len(sites) != len(set(sites)):
                        self.state.end(tester)
                        raise ValueError('Multiple heads share site IDs; refusing ambiguous device scope')
                    td = self.state.start(tester, sites)
                    self.test_context[tester] = uuid.uuid4().hex
                    self.pending_predictions[tester] = {}
                    self.metadata[tester] = {}
                    self.device_measurements[tester] = {str(site): {} for site in sites}
                    self.device_quality[tester] = {
                        str(site): {'runtime_unmapped': [], 'invalid': []} for site in sites}
                    if tester not in self.detectors:
                        self.detectors[tester] = self.models.detector()
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
                            if self.exporter is not None:
                                canonical = feature or ('{}_{}{}'.format(
                                    number, suite, '#'+str(pin) if pin is not None else ''))
                                measurement = {
                                    'canonical_feature': canonical,
                                    'test_number': number, 'suite': suite, 'pin': pin,
                                    'raw_value': value,
                                    'unit': self.safe(data, 'query_Unit', i),
                                    'result_scaling': self.safe(data, 'query_ResultScaling', i),
                                    'low_limit': self.safe(data, 'query_LowLimit', i),
                                    'high_limit': self.safe(data, 'query_HighLimit', i),
                                    'low_limit_scaling': self.safe(data, 'query_LowLimitScaling', i),
                                    'high_limit_scaling': self.safe(data, 'query_HighLimitScaling', i),
                                    'test_flag': self.safe(data, 'query_TestFlag', i),
                                    'param_flag': self.safe(data, 'query_ParamFlag', i),
                                }
                                self.device_measurements.setdefault(tester, {}).setdefault(str(site), {})[canonical] = measurement
                            if feature and self.state.record(tester,site,feature,value):
                                self.counts['measurements'] += 1
                                if self.counts['measurements']<=12:
                                    self.log('measurement',tester=tester,site=site,feature=feature,value=float(value),
                                             test_flag=str(data.query_TestFlag(i)) if hasattr(data,"query_TestFlag") else None,
                                             unit=str(data.query_Unit(i)) if hasattr(data,'query_Unit') else None,
                                             scaling=str(data.query_ResultScaling(i)) if hasattr(data,'query_ResultScaling') else None)
                            else:
                                self.counts['unmapped_or_rejected'] += 1
                                if self.exporter is not None:
                                    quality = self.device_quality.setdefault(tester, {}).setdefault(
                                        str(site), {'runtime_unmapped': [], 'invalid': []})
                                    key = 'runtime_unmapped' if not feature else 'invalid'
                                    quality[key].append(canonical)
                                if self.counts['unmapped_or_rejected']<=12:
                                    self.log('unmapped_measurement',tester=tester,number=number,suite=suite,pin=pin)
                elif is_type('DATA_TYP_PRODUCTION_TESTEND'):
                    snapshots = self.state.snapshot(tester)
                    detector = self.detectors.get(tester)
                    ended = []
                    for i in range(data.get_ResultCount()):
                        packed_head_site = data.query_HeadSite(i)
                        site = str(self.to_site(packed_head_site))
                        ended.append(site)
                        flag = str(data.query_PartFlag(i))
                        # Verified supplied common/DefineBins.java: bin 1 passes,
                        # bins 2..32 fail. Preserve raw flag for audit.
                        sbin = int(data.query_SBinResult(i))
                        if detector and site in snapshots and 1 <= sbin <= 32:
                            detector.add(site,snapshots[site],sbin == 1,self.device_id(tester, site))
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
                        if self.exporter is not None:
                            measurements = list(self.device_measurements.get(tester, {}).get(site, {}).values())
                            measurements.sort(key=lambda item: (item['test_number'], item['canonical_feature']))
                            quality = self.device_quality.get(tester, {}).get(
                                site, {'runtime_unmapped': [], 'invalid': []})
                            expected = len(self.models.artifact.get('columns', []))
                            hbin = self.safe(data, 'query_HBinResult', i)
                            part = str(data.query_PartId(i))
                            state = self.state.testers.get(tester)
                            bundle = self.event(
                                tester, 'device_completed', bundle_type='DeviceCompletedBundle',
                                source_timestamp_us=self.safe(data, 'get_TimeStamp'),
                                touchdown=state.touchdown if state else None,
                                device_id=self.device_id(tester, site), part_id=part, attempt=None,
                                attempt_status='unverified_sdk_field', site=site,
                                head=self.to_head(packed_head_site) if self.to_head else None,
                                raw_head_site=packed_head_site,
                                x=self.safe(data, 'query_XCoord', i),
                                y=self.safe(data, 'query_YCoord', i),
                                test_time_us=self.safe(data, 'query_TestTime', i),
                                sbin=sbin, hbin=hbin, part_flag=flag, passed=(sbin == 1),
                                measurements=measurements,
                                expected_count=expected, received_count=len(measurements),
                                missing_count=max(0, expected-len(measurements)),
                                runtime_unmapped=quality['runtime_unmapped'],
                                invalid=quality['invalid'],
                                data_quality='complete' if len(measurements) >= expected and not quality['invalid'] else 'incomplete')
                            self.export(bundle)
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
                    boundary = 'wafer_end' if is_type('DATA_TYP_PRODUCTION_WAFEREND') else 'lot_end'
                    self.export(self.event(tester, boundary,
                                           source_timestamp_us=self.safe(data, 'get_TimeStamp')))
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

    @staticmethod
    def normalize_production_response(response):
        """Escape native string controls only; reject all other JSON defects."""
        def reject_constant(value):
            raise ValueError('Invalid JSON constant: ' + value)

        def unique_object(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError('Cannot normalize duplicate JSON key: ' + key)
                result[key] = value
            return result

        if not isinstance(response, str):
            raise TypeError('Production action response must be a JSON string')
        try:
            json.loads(response, parse_constant=reject_constant)
        except json.JSONDecodeError as exc:
            if not exc.msg.startswith('Invalid control character'):
                raise
            # The native SDK joins queued reasons with literal LF inside JSON.
            # Do not repair syntax, drop duplicate fields, or rewrite reason text.
            parsed = json.loads(response, strict=False, parse_constant=reject_constant,
                                object_pairs_hook=unique_object)
            return json.dumps(parsed, allow_nan=False)
        return response

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
                    request_event_id = self.log('prediction_request',tester=str(tester),stage=stage,status=status,
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
                    self.export(self.event(tester, 'prediction_request', stage=stage, status=status,
                                           event_id=request_event_id, run_id=initial_run,
                                           lot_id=initial_lot, wafer_id=initial_wafer,
                                           request_id=request_id, prediction_ids=prediction_ids,
                                           device_ids={s:self.device_id(tester,s) for s in sites},
                                           predictions=predictions, coverage=coverage,
                                           feature_counts={s:len(v) for s,v in sites.items()},
                                           latency_ms=(time.perf_counter()-started)*1000))
                    return response
                if obj.get('key')=='prod_action':
                    raw_response = self.actions.get_prod(tester)
                    candidate_ids = self.pending_messages.pop(str(tester), [])
                    try:
                        response = self.normalize_production_response(raw_response)
                    except (ValueError, TypeError) as exc:
                        # get_prod may already have drained the native queue. Keep
                        # its candidates in failure evidence, not a later response.
                        self.log('request_error', tester=str(tester), operation='prod_action',
                                 error=str(exc), raw_response=str(raw_response),
                                 candidate_message_ids=candidate_ids, status='rejected_invalid_json')
                        return ''
                    normalization = {}
                    if response != raw_response:
                        normalization = dict(normalization='escaped_control_characters',
                                             raw_response=raw_response)
                    self.log('production_action_response',tester=str(tester),response=str(response),
                             candidate_message_ids=candidate_ids,
                             status='returned_to_callback_unconfirmed', **normalization)
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
    from oneapi import Monitor, DataType, toSite, toHead
    from libACSAction import ActionManager
    from .exporter import HttpsOutboxExporter
    class Grp6Monitor(Monitor):
        def __init__(self):
            Monitor.__init__(self)
            self.core = MonitorCore(artifacts,ActionManager,DataType,toSite,evidence,
                                    exporter=HttpsOutboxExporter.from_env(), to_head=toHead)
        def consumeData(self,tc,data):
            return self.core.consumeData(tc,data)
        def consumeTPRequest(self,tc,request):
            return self.core.consumeTPRequest(tc,request)
        def consumeTPSend(self,tc,data):
            return self.core.consumeTPSend(tc,data)
    return Grp6Monitor()
