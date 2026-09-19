import json
from pathlib import Path
from grp6_app.data import parse_csv
from grp6_app.predict import StageModels
from grp6_app.adapter import RTDIAdapter, OneAPIMonitor

def test_stage_features_do_not_use_target(tmp_path):
    p=tmp_path/'A12345_W01_RawResult.csv'
    p.write_text('meta\nDevice,Site,10_a#p,100_Main.sensor1#CP,120_Main.sensor2#DS0\nD1,S1,2,20,30\nD2,S1,4,40,50\n',encoding='utf-8')
    rows=parse_csv(p); model=StageModels().fit(rows, order=list(dict.fromkeys(m.test for m in rows)))
    assert '100_Main.sensor1#CP' not in model.features[1]
    assert '10_a#p' in model.features[1]
    assert model.predict(1, {'10_a#p':3}) is not None

def test_adapter_contract():
    adapter=RTDIAdapter()
    assert json.loads(adapter.consumeTPRequest('{"key":"predict","data":1}'))['status']=='insufficient_data'
    assert json.loads(adapter.consumeTPRequest('{"key":"other"}'))['status']=='unsupported'


def test_real_export_uses_pid_and_site_and_skips_metadata(tmp_path):
    p = tmp_path / 'A12345_W09_RawResult.csv'
    p.write_text(
        'PID,Lot,Wafer,Site,X,Y,PF,SBin,HBin,Test Time,10_a#p,100_Main.sensor1#CP\n'
        'Pin,,,,,,,,,,CP,CP\n'
        'Test Num,,,,,,,,,,10,100\n'
        'High Limit,,,,,,,,,,1.0,2.0\n'
        'Low Limit,,,,,,,,,,0.0,0.0\n'
        '1,A12345,9,4,1,2,0,1,1,10.0,0.5,1.5\n',
        encoding='utf-8',
    )
    rows = parse_csv(p)
    assert len(rows) == 2
    assert {(row.device, row.site, row.wafer) for row in rows} == {('1', '4', '9')}


def test_oneapi_prediction_is_tester_and_site_scoped():
    class Actions:
        def __init__(self):
            self.messages = []
            self.waits = []
        def set_message(self, tester, message):
            self.messages.append((tester, message)); return True
        def set_wait(self, tester, seconds, message):
            self.waits.append((tester, seconds, message))
        def get(self, tester):
            return self.waits[-1][2] if self.waits else ''

    class TC:
        testerId = 'T1'

    actions = Actions()
    monitor = OneAPIMonitor(action_manager=actions)
    monitor.ingest_measurement('W1', 'D1', '1', '10_a#p', 3, 'T1')
    monitor.features[('T1', 'W1', 'D1', '1')]['10_a#p'] = 3
    monitor.models.features = {1: ['10_a#p']}
    class Model:
        def predict(self, values): return [25.5]
    monitor.models.models[1] = Model()
    assert 'prediction 1: (1,25.5)' in monitor.consumeTPRequest(TC(), '{"key":"predict","data":1}')
    assert actions.waits[0][0] == 'T1'
