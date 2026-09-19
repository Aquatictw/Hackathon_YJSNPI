import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from grp6_app.monitor import MonitorCore

NAMES=['PRODUCTION_LOTSTART','PRODUCTION_WAFERSTART','PRODUCTION_TESTSTART','MEASURED_PARAMETRIC','MEASURED_MULTI_PARAM','PRODUCTION_TESTEND','PRODUCTION_WAFEREND','PRODUCTION_LOTEND']
TYPES=SimpleNamespace(**{'DATA_TYP_'+n:n for n in NAMES})

class Event:
    def __init__(self,kind,**fields): self.kind,self.fields=kind,fields
    def getType(self): return self.kind
    def __getattr__(self,name):
        if name not in self.fields: raise AttributeError(name)
        value=self.fields[name]
        return lambda *args: value[args[0]] if args else value

class Actions:
    def __init__(self): self.calls=[]; self.queue=[]; self.production=[]
    def set_wait(self,*args): self.calls.append(('wait',args));self.queue.append(args[-1])
    def set_message(self,*args): self.calls.append(('message',args));self.production.append(args[-1])
    def get(self,tester):
        self.calls.append(('get',tester));result=json.dumps(self.queue);self.queue=[];return result
    def get_prod(self,tester):
        self.calls.append(('get_prod',tester));result=json.dumps(self.production);self.production=[];return result

class Exporter:
    def __init__(self): self.events=[];self.closed=False
    def submit(self,event): self.events.append(event);return True
    def close(self): self.closed=True

class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.actions=Actions();self.exporter=Exporter()
        self.core=MonitorCore(Path(__file__).parents[1]/'artifacts/runtime.json',self.actions,TYPES,lambda packed:packed&0xffff,Path(self.tmp.name)/'evidence.jsonl',exporter=self.exporter,to_head=lambda packed:packed>>16)
        self.tc=SimpleNamespace(testerId='grp6-test')
        self.core.consumeData(self.tc,Event('PRODUCTION_LOTSTART',get_LotId='L'))
        self.core.consumeData(self.tc,Event('PRODUCTION_WAFERSTART',get_WaferId='W'))
        self.start()
    def tearDown(self): self.core.close();self.tmp.cleanup()
    def start(self):
        self.core.consumeData(self.tc,Event('PRODUCTION_TESTSTART',get_ResultCount=2,query_HeadSite=[65537,65538]))
    def test_six_stage_multisite_contract_and_latency(self):
        for stage in range(1,7):
            model=self.core.models.models[str(stage)]
            for site in ['1','2']:
                for name,value in zip(model['features'],model['mean']):self.core.state.record(self.tc.testerId,site,name,value)
            response=self.core.consumeTPRequest(self.tc,json.dumps({'key':'predict','data':stage}))
            self.assertIn('prediction {}: (1,'.format(stage),response);self.assertIn(' (2,',response)
            self.assertEqual(self.actions.calls[-2][0],'wait');self.assertEqual(self.actions.calls[-1][0],'get')
        self.assertEqual(self.core.counts['callback_errors'],0)
    def test_missing_current_features_no_fabricated_prediction(self):
        result=self.core.consumeTPRequest(self.tc,'{"key":"predict","data":1}')
        self.assertNotIn('prediction 1:',result)
        self.assertIn('unavailable',self.core.consumeTPRequest(self.tc,'{"key":"prod_action"}'))
        self.assertFalse(any(c[0]=='wait' for c in self.actions.calls))
    def test_scalar_and_multi_pin_mapping(self):
        self.core.consumeData(self.tc,Event('MEASURED_PARAMETRIC',get_ResultCount=1,query_HeadSite=[65537],query_TestNumber=[220],query_TestSuite=['Main.Suite1'],query_Result=[.2]))
        self.core.consumeData(self.tc,Event('MEASURED_MULTI_PARAM',get_ResultCount=1,query_HeadSite=[65538],query_TestNumber=[560],query_TestSuite=['Main.Suite14'],query_Results=[[.3,.4]],query_PinResults=[[10,11]],query_PinName={10:'CP',11:'MR'}))
        snap=self.core.state.snapshot(self.tc.testerId)
        self.assertEqual(snap['1']['220_Main.Suite1#CP'],.2)
        self.assertEqual(snap['2']['560_Main.Suite14#MR'],.4)
        self.start();self.assertEqual(self.core.state.snapshot(self.tc.testerId),{'1':{},'2':{}})

    def test_device_bundle_contains_sdk_measurement_and_completion_fields(self):
        self.core.consumeData(self.tc,Event(
            'MEASURED_PARAMETRIC',get_ResultCount=1,query_HeadSite=[65537],
            query_TestNumber=[220],query_TestSuite=['Main.Suite1'],query_Result=[1.25],
            query_Unit=['V'],query_ResultScaling=['milli'],query_LowLimit=[1.0],
            query_HighLimit=[1.5],query_LowLimitScaling=['none'],
            query_HighLimitScaling=['none'],query_TestFlag=['pass'],query_ParamFlag=['valid']))
        self.core.consumeData(self.tc,Event(
            'PRODUCTION_TESTEND',get_ResultCount=1,get_TimeStamp=123456,
            query_HeadSite=[65537],query_PartFlag=['0x0'],query_SBinResult=[1],
            query_HBinResult=[7],query_XCoord=[10],query_YCoord=[20],
            query_TestTime=[900],query_PartId=['device-1']))
        bundle=[e for e in self.exporter.events if e['event_type']=='device_completed'][0]
        self.assertEqual(bundle['source_timestamp_us'],123456)
        self.assertEqual((bundle['x'],bundle['y'],bundle['hbin'],bundle['test_time_us']),
                         (10,20,7,900))
        self.assertEqual(bundle['received_count'],1)
        measurement=bundle['measurements'][0]
        self.assertEqual(measurement['canonical_feature'],'220_Main.Suite1#CP')
        self.assertEqual((measurement['unit'],measurement['low_limit'],measurement['high_limit']),
                         ('V',1.0,1.5))
        self.assertEqual((measurement['test_flag'],measurement['param_flag']),('pass','valid'))
    def test_low_yield_queues_required_tester_message(self):
        d=self.core.detectors[self.tc.testerId]
        for _ in range(32):d.add('1',{},False)
        self.core.emit_alerts(self.tc.testerId)
        self.assertTrue(any(c[0]=='message' and 'Yield' in c[1][-1] for c in self.actions.calls))
        evidence=Path(self.tmp.name,'evidence.jsonl').read_text()
        self.assertIn('queued_unconfirmed',evidence)
        self.assertNotIn('Yield',self.actions.get(self.tc.testerId))
        response=self.core.consumeTPRequest(self.tc,'{"key":"prod_action"}')
        self.assertIn('Yield',response)
        self.assertIn('production_action_response',Path(self.tmp.name,'evidence.jsonl').read_text())
    def test_hex_part_flags_complete_devices_and_clear_features(self):
        from contextlib import redirect_stdout
        from io import StringIO
        output=StringIO()
        with redirect_stdout(output):
            self.core.consumeData(self.tc,Event('PRODUCTION_TESTEND',get_ResultCount=2,
                query_HeadSite=[65537,65538],query_PartFlag=['0x0','0x8'],
                query_SBinResult=[1,2],query_PartId=['p1','p2']))
        self.assertEqual(self.core.counts['callback_errors'],0)
        self.assertEqual(self.core.detectors[self.tc.testerId].completed,2)
        self.assertEqual(self.core.detectors[self.tc.testerId].good,1)
        self.assertEqual(self.core.state.snapshot(self.tc.testerId),{})
        records=[json.loads(line) for line in Path(self.tmp.name,'evidence.jsonl').read_text().splitlines()]
        ends=[r for r in records if r['kind']=='device_end']
        self.assertEqual([r['part_flag'] for r in ends],['0x0','0x8'])
        self.assertIn('GRP6_EVIDENCE ',output.getvalue())
        bundles=[e for e in self.exporter.events if e['event_type']=='device_completed']
        self.assertEqual(len(bundles),2)
        self.assertEqual(bundles[0]['part_id'],'p1')
        self.assertEqual(bundles[0]['device_id'],ends[0]['device_id'])
        self.assertEqual(bundles[0]['head'],1)
        self.assertTrue(bundles[0]['passed'])
        self.assertIsNone(bundles[0]['attempt'])
    def test_bad_stage_and_invalid_payload_are_logged(self):
        for request in ['bad','{"key":"predict","data":7}','{"key":"predict","data":true}']:
            self.assertEqual(self.core.consumeTPRequest(self.tc,request),'')
        self.assertEqual(sum(c[0]=='wait' for c in self.actions.calls),0)
    def test_delayed_measurements_can_finish_before_request_deadline(self):
        from threading import Thread, Event as ThreadEvent
        waiting = ThreadEvent()
        original_wait = self.core.data_ready.wait
        def observed_wait(timeout):
            waiting.set()
            return original_wait(timeout)
        self.core.data_ready.wait = observed_wait
        self.core.feature_wait_seconds = 1.0
        result = []
        worker = Thread(target=lambda: result.append(self.core.consumeTPRequest(
            self.tc, '{"key":"predict","data":1}')))
        worker.start()
        self.assertTrue(waiting.wait(1))
        with self.core.lock:
            model = self.core.models.models['1']
            for site in ['1','2']:
                for name,value in zip(model['features'],model['mean']):
                    self.core.state.record(self.tc.testerId,site,name,value)
            self.core.data_ready.notify_all()
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertIn('prediction 1:', result[0])
        self.assertIn('"waited_for_measurements": true', Path(self.tmp.name,'evidence.jsonl').read_text())
    def test_waiting_request_never_uses_next_touchdown(self):
        from threading import Thread, Event as ThreadEvent
        waiting = ThreadEvent()
        original_wait = self.core.data_ready.wait
        def observed_wait(timeout):
            waiting.set()
            return original_wait(timeout)
        self.core.data_ready.wait = observed_wait
        self.core.feature_wait_seconds = 1.0
        result=[]
        worker=Thread(target=lambda: result.append(self.core.consumeTPRequest(
            self.tc, '{"key":"predict","data":1}')))
        worker.start()
        self.assertTrue(waiting.wait(1))
        with self.core.lock:
            self.start()
            model=self.core.models.models['1']
            for site in ['1','2']:
                for name,value in zip(model['features'],model['mean']):
                    self.core.state.record(self.tc.testerId,site,name,value)
        worker.join(2)
        self.assertFalse(worker.is_alive())
        self.assertNotIn('prediction 1:',result[0])
        self.assertIn('"lifecycle_changed": true',Path(self.tmp.name,'evidence.jsonl').read_text())
    def test_future_measurements_cannot_change_earlier_predictions(self):
        artifact=Path(__file__).parents[1]/'artifacts'
        manifest=json.loads((artifact/'manifest.json').read_text())
        for stage in range(1,7):
            allowed=set(manifest['stages'][str(stage)])
            model=self.core.models.models[str(stage)]
            self.assertTrue(set(model['features']) <= allowed)
            current=dict(zip(model['features'],model['mean']))
            before=self.core.models.predict(stage,current)
            future=set(self.core.models.artifact['columns'])-allowed
            self.assertTrue(future)
            for replacement in [1e12,-1e12,float('nan')]:
                modified=dict(current,**dict.fromkeys(future,replacement))
                self.assertEqual(self.core.models.predict(stage,modified),before)
    def records(self):
        return [json.loads(s) for s in Path(self.tmp.name,"evidence.jsonl").read_text().splitlines()]

    def test_exported_predictions_actuals_and_devices_share_core_identity(self):
        self.test_repeated_predictions_join_final_actuals_without_overwriting()
        records = self.records()
        for kind in ('prediction_request', 'prediction_actual'):
            raw = {r['event_id']: r for r in records if r['kind'] == kind}
            exported = [e for e in self.exporter.events if e['event_type'] == kind]
            self.assertEqual(len(exported), len(raw))
            for event in exported:
                original = raw[event['event_id']]
                for key in ('run_id', 'request_id'):
                    self.assertEqual(event[key], original[key])
                self.assertEqual(event['lot_id'], original['lot'])
                self.assertEqual(event['wafer_id'], original['wafer'])
                key = 'prediction_ids' if kind == 'prediction_request' else 'prediction_id'
                self.assertEqual(event[key], original[key])
        bundles = {e['device_id']: e for e in self.exporter.events
                   if e['event_type'] == 'device_completed'}
        for actual in (r for r in records if r['kind'] == 'prediction_actual'):
            self.assertEqual(bundles[actual['device_id']]['run_id'], actual['run_id'])

    def test_export_failure_never_interrupts_six_stage_responses(self):
        from unittest.mock import Mock
        for failure in (False, RuntimeError('export unavailable')):
            with self.subTest(failure=str(failure)):
                submit = Mock(return_value=False)
                if isinstance(failure, Exception):
                    submit.side_effect = failure
                self.exporter.submit = submit
                self.test_six_stage_multisite_contract_and_latency()
                drops = [r for r in self.records() if r['kind'] == 'export_drop']
                self.assertGreaterEqual(len(drops), 6)
                self.assertTrue(all(r['event_id'] != r['dropped_event_id'] for r in drops))
                self.assertFalse(any(r['kind'] == 'request_error' for r in self.records()))

    def test_disabled_export_skips_measurement_bundle_getters_and_storage(self):
        self.core.exporter = None
        # The first 12 measurements intentionally sample core unit/flag metadata.
        self.core.counts['measurements'] = 12
        getters = []
        class TrackedEvent(Event):
            def __getattr__(self, name):
                getters.append(name)
                return super().__getattr__(name)
        self.core.consumeData(self.tc, TrackedEvent(
            'MEASURED_PARAMETRIC', get_ResultCount=1, query_HeadSite=[65537],
            query_TestNumber=[220], query_TestSuite=['Main.Suite1'], query_Result=[.2]))
        self.assertEqual(self.core.state.snapshot(self.tc.testerId)['1']['220_Main.Suite1#CP'], .2)
        self.assertNotIn('query_LowLimit', getters)
        self.assertNotIn('query_Unit', getters)
        self.assertEqual(self.core.device_measurements[self.tc.testerId]['1'], {})
        self.assertEqual(self.core.counts['callback_errors'], 0)

    def test_repeated_predictions_join_final_actuals_without_overwriting(self):
        from grp6_app.data import TARGETS
        model=self.core.models.models["1"]
        for site in ["1","2"]:
            for name,value in zip(model["features"],model["mean"]):
                self.core.state.record(self.tc.testerId,site,name,value)
            self.core.state.record(self.tc.testerId,site,TARGETS[1],.25)
        for _ in range(2): self.core.consumeTPRequest(self.tc,'{"key":"predict","data":1}')
        self.core.consumeData(self.tc,Event("PRODUCTION_TESTEND",get_ResultCount=2,
            query_HeadSite=[65537,65538],query_PartFlag=["0x0","0x0"],
            query_SBinResult=[1,1],query_PartId=["a","b"]))
        actuals=[r for r in self.records() if r["kind"]=="prediction_actual"]
        self.assertEqual(len(actuals),4)
        self.assertEqual(len({r["prediction_id"] for r in actuals}),4)
        self.assertTrue(all(r["actual"]==.25 for r in actuals))
        self.assertEqual(self.core.counts["callback_errors"],0)

    def test_second_tester_lot_does_not_change_first_run(self):
        before=self.core.tester_runs[self.tc.testerId]
        self.core.consumeData(SimpleNamespace(testerId="second"),Event("PRODUCTION_LOTSTART",get_LotId="B"))
        self.core.log("check",tester=self.tc.testerId)
        self.assertEqual(self.records()[-1]["run_id"],before)

    def test_ambiguous_heads_fail_closed(self):
        self.core.consumeData(self.tc,Event("PRODUCTION_TESTSTART",get_ResultCount=2,query_HeadSite=[65537,131073]))
        self.assertEqual(self.core.state.snapshot(self.tc.testerId),{})
        self.assertEqual(self.records()[-1]["kind"],"callback_error")

    def metadata(self, wafer, other_wafer=None):
        encoded=lambda s: int.from_bytes(s.encode("ascii"),"big")
        for number,suite,values in [(20,"lotidTest",["456","456"]),(21,"lotidTest",["B13","B13"]),
                                    (25,"waferidTest",[wafer,other_wafer or wafer])]:
            self.core.consumeData(self.tc,Event("MEASURED_PARAMETRIC",get_ResultCount=2,
                query_HeadSite=[65537,65538],query_TestNumber=[number,number],
                query_TestSuite=["Main."+suite]*2,query_Result=[encoded(s) for s in values]))

    def test_encoded_metadata_isolates_simulated_wafers(self):
        self.metadata("2")
        self.assertEqual(self.core.identity[self.tc.testerId],("B13456","2"))
        previous=self.core.detectors[self.tc.testerId]
        previous.add("1",{},True)
        self.start(); self.metadata("3")
        self.assertEqual(self.core.identity[self.tc.testerId],("B13456","3"))
        self.assertEqual(self.core.detectors[self.tc.testerId].completed,0)
        self.assertEqual(self.core.counts["callback_errors"],0)

    def test_mixed_wafer_metadata_fails_closed(self):
        self.metadata("2","3")
        self.assertEqual(self.core.state.snapshot(self.tc.testerId),{})
        self.assertEqual(self.records()[-1]["kind"],"callback_error")

if __name__=='__main__':unittest.main()
