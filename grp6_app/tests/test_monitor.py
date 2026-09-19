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

class ProtocolTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.actions=Actions()
        self.core=MonitorCore(Path(__file__).parents[1]/'artifacts/runtime.json',self.actions,TYPES,lambda packed:packed&0xffff,Path(self.tmp.name)/'evidence.jsonl')
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
    def test_bad_stage_and_invalid_payload_are_logged(self):
        for request in ['bad','{"key":"predict","data":7}','{"key":"predict","data":true}']:
            self.assertEqual(self.core.consumeTPRequest(self.tc,request),'')
        self.assertEqual(sum(c[0]=='wait' for c in self.actions.calls),0)

if __name__=='__main__':unittest.main()
