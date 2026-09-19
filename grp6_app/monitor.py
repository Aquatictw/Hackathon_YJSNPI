"""Actual ONEAPI SDK wrapper, preserving supplied ActionManager protocol."""
import json
import logging
import time
import hashlib
from concurrent.futures import ThreadPoolExecutor
from collections import Counter
from pathlib import Path
from threading import RLock
from .runtime import RuntimeModels, WaferDetector
from .state import LiveState


class MonitorCore:
    def __init__(self, artifacts, actions, data_types, to_site, evidence):
        self.models = RuntimeModels(artifacts)
        self.actions, self.types, self.to_site = actions, data_types, to_site
        self.state = LiveState()
        self.detectors = {}
        self.identity = {}
        self.counts = Counter()
        self.lock = RLock()
        self.evidence = Path(evidence)
        self.evidence.parent.mkdir(parents=True, exist_ok=True)
        self.stream = self.evidence.open('a', encoding='utf-8', buffering=1)
        self.reporter = ThreadPoolExecutor(max_workers=1)
        self.report_future = None
        self.log('monitor_start',model_sha256=hashlib.sha256(Path(artifacts).read_bytes()).hexdigest(),team='grp6')

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
        record = json.dumps(dict(time=time.time(), kind=kind, **fields), allow_nan=False)
        self.stream.write(record+'\n')
        print('GRP6_EVIDENCE '+record, flush=True)

    def send_message(self, tester, message):
        try:
            result = self.actions.set_message(tester, message)
            if result is False:
                raise RuntimeError('ActionManager rejected message')
            self.log('action_message', tester=str(tester), message=message,
                     api_return=str(result), status='queued_unconfirmed')
        except Exception as exc:
            self.counts['action_errors'] += 1
            self.log('action_error', tester=str(tester), error=str(exc))

    def emit_alerts(self, tester, final=False):
        detector = self.detectors.get(str(tester))
        if detector is None:
            return
        for alert in detector.analyze(final):
            lot, wafer = self.identity.get(str(tester), ('',''))
            self.log('alert', tester=str(tester), lot=lot, wafer=wafer, alert=alert)
            self.send_message(tester, 'grp6 wafer {}: {}'.format(wafer,alert['message']))

    def consumeData(self, tc, data):
        with self.lock:
            try:
                dtype = data.getType()
                tester = str(tc.testerId)
                self.counts['callbacks'] += 1
                is_type = lambda name: dtype == getattr(self.types, name)
                if is_type('DATA_TYP_PRODUCTION_LOTSTART'):
                    lot = str(data.get_LotId())
                    self.identity[tester] = (lot, '')
                    self.state.reset(tester, lot=lot)
                    self.detectors.pop(tester, None)
                    self.log('lot_start', tester=tester, lot=lot)
                elif is_type('DATA_TYP_PRODUCTION_WAFERSTART'):
                    lot = self.identity.get(tester, ('',''))[0]
                    wafer = str(data.get_WaferId())
                    self.identity[tester] = (lot, wafer)
                    self.state.reset(tester,lot,wafer)
                    self.detectors[tester] = WaferDetector(self.models.artifact['baselines'],self.models.artifact.get('family_thresholds'))
                    self.log('wafer_start',tester=tester,lot=lot,wafer=wafer)
                elif is_type('DATA_TYP_PRODUCTION_TESTSTART'):
                    sites = [self.to_site(data.query_HeadSite(i)) for i in range(data.get_ResultCount())]
                    td = self.state.start(tester, sites)
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
                            feature = self.models.feature(number,suite,pin)
                            if feature and self.state.record(tester,site,feature,value):
                                self.counts['measurements'] += 1
                                if self.counts['measurements']<=12:
                                    self.log('measurement',tester=tester,site=site,feature=feature,value=float(value),
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
                        self.log('device_end',tester=tester,site=site,part=str(data.query_PartId(i)),
                                 part_flag=flag,sbin=int(data.query_SBinResult(i)),features=len(snapshots.get(site,{})))
                    self.state.end(tester,ended)
                    self.emit_alerts(tc.testerId)
                    if detector and detector.completed%32==0:
                        self.log('progress',tester=tester,devices=detector.completed,counts=dict(self.counts))
                        logging.info('grp6 devices=%s measurements=%s errors=%s',detector.completed,self.counts['measurements'],self.counts['callback_errors'])
                        self.update_report()
                elif is_type('DATA_TYP_PRODUCTION_WAFEREND') or is_type('DATA_TYP_PRODUCTION_LOTEND'):
                    self.emit_alerts(tc.testerId,True)
                    self.state.end(tester)
                    self.log('boundary_end',tester=tester,counts=dict(self.counts))
                    self.update_report()
            except Exception as exc:
                self.counts['callback_errors'] += 1
                self.log('callback_error', tester=str(tc.testerId), error=str(exc))
                logging.exception('ONEAPI callback failed')

    def consumeTPRequest(self, tc, request):
        started = time.perf_counter()
        with self.lock:
            tester = tc.testerId
            try:
                obj = json.loads(request)
                if obj.get('key') == 'predict':
                    stage = obj.get('data')
                    if type(stage) is not int or stage not in range(1,7):
                        raise ValueError('Invalid prediction stage')
                    sites = self.state.snapshot(tester)
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
                    self.log('prediction_request',tester=str(tester),stage=stage,status=status,
                             predictions=predictions,coverage=coverage,response=str(response),
                             feature_counts={s:len(v) for s,v in sites.items()},
                             latency_ms=(time.perf_counter()-started)*1000)
                    return response
                if obj.get('key')=='prod_action':
                    response = self.actions.get_prod(tester)
                    self.log('production_action_response',tester=str(tester),response=str(response),
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
