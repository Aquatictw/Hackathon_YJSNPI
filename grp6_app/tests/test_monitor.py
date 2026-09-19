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

    def production_action(self, reason):
        return json.dumps({'tester': self.tc.testerId, 'mtesterAction': [
            {'name': 'acs_prod_var', 'pool': [{'act_typ': 'msg', 'mactions': [
                {'testsuite': '', 'param': 'msg', 'val': '', 'reason': reason}]}]}]})

    def fifo_message(self, response):
        # TCCT parses the outer API JSON, then inserts the reason verbatim
        # into a second JSON string. MessUI strictly parses those FIFO bytes.
        reason = json.loads(response)['mtesterAction'][0]['pool'][0]['mactions'][0]['reason']
        fifo = '{"action":"text","value":"' + reason + '"}'
        return json.loads(fifo)

    def test_production_native_multiline_response_preserves_reasons_and_ids(self):
        # Exact joined reason text from historical production sequence 319.
        # Inline so packaged tests need no external retained-evidence files.
        messages = [
            'grp6 [bbe24a7975e6] wafer 02: 21340_Main.subflow3.Flow3_Suite39#CP: site 1 vs 3 differs by 10.04 baseline SD',
            'grp6 [7d9bfbbb7dd9] wafer 02: 28380_Main.subflow3.Flow3_Suite391#CP site 3: mean changed +4.67 baseline SD',
            'grp6 [60d64c90b080] wafer 02: 28900_Main.subflow3.Flow3_Suite417#CP site 4: mean changed -2.14 baseline SD',
        ]
        for message in messages:
            self.core.send_message(self.tc.testerId, message)
        candidate_ids = list(self.core.pending_messages[self.tc.testerId])
        valid = self.production_action('\n'.join(messages))
        raw = valid.replace('\\n', '\n')
        with self.assertRaises(json.JSONDecodeError):
            json.loads(raw)
        self.actions.get_prod = lambda tester: raw
        response = self.core.consumeTPRequest(self.tc, '{"key":"prod_action"}')
        self.assertEqual(self.fifo_message(response), {'action': 'text', 'value': '\n'.join(messages)})
        record = self.records()[-1]
        self.assertEqual(record['kind'], 'production_action_response')
        self.assertEqual(record['response'], response)
        self.assertEqual(record['raw_response'], raw)
        self.assertEqual(record['normalization'], 'escaped_control_characters')
        self.assertEqual(record['normalized_response'], valid)
        self.assertEqual(record['transport_adaptation'], 'tcct_msg_reason_json_fragment')
        self.assertEqual(record['candidate_message_ids'], candidate_ids)
        self.assertEqual(record['status'], 'returned_to_callback_unconfirmed')
        self.assertNotIn(self.tc.testerId, self.core.pending_messages)
        exported = self.exporter.events[-1]
        self.assertEqual(exported['response'], response)
        self.assertEqual(exported['event_id'], record['event_id'])
        self.assertEqual(exported['status'], record['status'])
        self.assertEqual(exported['normalized_response'], valid)
        self.assertEqual(exported['transport_adaptation'], record['transport_adaptation'])

    def test_production_json_controls_are_escaped_without_changing_text(self):
        reason = 'quoted "text", backslash \\, Unicode \u6eab\u5ea6: ' + ''.join(map(chr, range(32)))
        valid = self.production_action(reason)
        # Reproduce native literal controls, retaining valid quote/backslash escapes.
        raw = valid
        for character in map(chr, range(32)):
            raw = raw.replace(json.dumps(character)[1:-1], character)
        response = self.core.normalize_production_response(raw)
        self.assertEqual(json.loads(response), json.loads(valid))
        self.assertFalse(any(ord(c) < 32 for c in response))

    def test_valid_production_json_is_returned_byte_for_byte(self):
        responses = [
            ' { "tester": "grp6-test", "mtesterAction": [] }\n',
            self.production_action('line one\nline two \t "quoted" \\ path'),
        ]
        for raw in responses:
            with self.subTest(raw=raw):
                self.assertEqual(self.core.normalize_production_response(raw), raw)

    def test_tcct_message_fragment_round_trips_special_text_once(self):
        reasons = [
            'first\nsecond\nthird',
            'quote "value", backslash \\, literal escapes \\n \\u6eab',
            'Unicode \u6eab\u5ea6 \U0001f321: ' + ''.join(map(chr, range(32))),
            'end with backslash \\',
            '","action":"other","value":"injected',
        ]
        for reason in reasons:
            with self.subTest(reason=repr(reason)):
                raw = self.production_action(reason)
                self.assertEqual(self.core.normalize_production_response(raw), raw)
                self.actions.get_prod = lambda tester: raw
                response = self.core.consumeTPRequest(self.tc, '{"key":"prod_action"}')
                self.assertEqual(self.fifo_message(response), {'action': 'text', 'value': reason})
                record = self.records()[-1]
                self.assertEqual(record['normalized_response'], raw)
                self.assertEqual(record['raw_response'], raw)
                self.assertEqual(record['response'], response)
                self.assertEqual(record['transport_adaptation'], 'tcct_msg_reason_json_fragment')
                self.assertNotIn('normalization', record)
                self.assertEqual(record['status'], 'returned_to_callback_unconfirmed')

    def test_tcct_plain_messages_remain_byte_for_byte(self):
        for reason in ('', 'ordinary message', 'Unicode \u6eab\u5ea6 \U0001f321'):
            with self.subTest(reason=reason):
                raw = ' \n' + self.production_action(reason) + '\n'
                self.actions.get_prod = lambda tester: raw
                response = self.core.consumeTPRequest(self.tc, '{"key":"prod_action"}')
                self.assertEqual(response, raw)
                self.assertEqual(self.fifo_message(response)['value'], reason)
                self.assertNotIn('transport_adaptation', self.records()[-1])
                self.assertNotIn('normalization', self.records()[-1])

    def test_tcct_adaptation_changes_only_known_msg_reasons(self):
        from copy import deepcopy
        original = json.loads(self.production_action('alert\nsecond'))
        group = original['mtesterAction'][0]
        pool = group['pool'][0]
        action = pool['mactions'][0]
        action.update(extra='other\ntext', testsuite='suite\nname', val='keep\\value')
        pool['mactions'].extend([
            dict(action, param='wait'), {'param': 'msg', 'reason': 42},
            {'param': 'msg'}, None, 'not an action',
            dict(action, reason='plain'), dict(action, reason='third "message"'),
        ])
        group['pool'].extend([dict(deepcopy(pool), act_typ='wait'), None, {'act_typ': 'msg', 'mactions': {}}])
        original['mtesterAction'].extend([
            dict(deepcopy(group), name='other'), None,
            {'name': 'acs_prod_var', 'pool': {}},
        ])
        original['reason'] = 'root\nreason'
        expected = deepcopy(original)
        for index in (0, 7):
            target = expected['mtesterAction'][0]['pool'][0]['mactions'][index]
            target['reason'] = json.dumps(target['reason'], ensure_ascii=False)[1:-1]
        raw = json.dumps(original)
        result = self.core.adapt_tcct_message_response(raw)
        self.assertEqual(json.loads(result), expected)
        self.assertEqual(self.fifo_message(result)['value'], action['reason'])

    def test_tcct_unrelated_or_ambiguous_envelopes_remain_byte_for_byte(self):
        responses = ['[]', 'null', '42', '{"mtesterAction": {}}',
                     ' { "tester": "grp6-test", "mtesterAction": [] }\n']
        for level, field, value in [('group', 'name', 'other'), ('pool', 'act_typ', 'wait'),
                                    ('action', 'param', 'wait'), ('action', 'reason', None)]:
            obj = json.loads(self.production_action('one\ntwo'))
            group = obj['mtesterAction'][0]
            pool = group['pool'][0]
            {'group': group, 'pool': pool, 'action': pool['mactions'][0]}[level][field] = value
            responses.append(json.dumps(obj, indent=2))
        responses.append(self.production_action('one\ntwo').replace(
            '"param": "msg"', '"param": "wait", "param": "msg"'))
        for raw in responses:
            with self.subTest(raw=raw):
                self.actions.get_prod = lambda tester: raw
                self.assertEqual(self.core.consumeTPRequest(self.tc, '{"key":"prod_action"}'), raw)
                self.assertNotIn('transport_adaptation', self.records()[-1])

    def test_tcct_adaptation_never_touches_prediction_or_list_responses(self):
        # Even an envelope eligible for production adaptation must be unchanged
        # when returned by get() on prediction/list paths.
        raw = self.production_action('one\ntwo "quoted" \\ path')
        self.actions.get = lambda tester: raw
        model = self.core.models.models['1']
        for site in ['1', '2']:
            for name, value in zip(model['features'], model['mean']):
                self.core.state.record(self.tc.testerId, site, name, value)
        self.assertEqual(self.core.consumeTPRequest(self.tc, '{"key":"predict","data":1}'), raw)
        self.assertEqual(self.core.consumeTPRequest(self.tc, '{"action":"list"}'), raw)
        self.assertFalse(any('transport_adaptation' in r for r in self.records()))

    def test_other_invalid_production_json_fails_closed_with_evidence(self):
        multiline = self.production_action('one\ntwo').replace('\\n', '\n')
        invalid = ['', '{', '{"reason":"bad\\q"}', '{} trailing',
                   '{"value":NaN}', '{"value":Infinity}', '{"value":-Infinity}',
                   multiline[:-1], multiline + ' trailing',
                   '{"reason":"one\ntwo","value":NaN}',
                   '{"reason":"one\ntwo","reason":"replacement"}', None]
        for raw in invalid:
            with self.subTest(raw=raw):
                self.core.send_message(self.tc.testerId, 'pending anomaly')
                candidate_ids = list(self.core.pending_messages[self.tc.testerId])
                self.actions.get_prod = lambda tester: raw
                start = len(self.records())
                self.assertEqual(self.core.consumeTPRequest(self.tc, '{"key":"prod_action"}'), '')
                records = self.records()[start:]
                self.assertEqual(len(records), 1)
                error = records[0]
                self.assertEqual(error['kind'], 'request_error')
                self.assertEqual(error['operation'], 'prod_action')
                self.assertEqual(error['raw_response'], str(raw))
                self.assertEqual(error['candidate_message_ids'], candidate_ids)
                self.assertEqual(error['status'], 'rejected_invalid_json')
                self.assertTrue(error['error'])
                self.assertNotIn(self.tc.testerId, self.core.pending_messages)
                self.actions.get_prod = lambda tester: '{"mtesterAction":[]}'
                self.core.consumeTPRequest(self.tc, '{"key":"prod_action"}')
                self.assertEqual(self.records()[-1]['candidate_message_ids'], [])

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
