import json
import tempfile
import unittest
from pathlib import Path
from grp6_app.report import from_log


class ReportTests(unittest.TestCase):
    def render(self, events):
        with tempfile.TemporaryDirectory() as folder:
            log=Path(folder)/"evidence.jsonl"
            log.write_text("\n".join(json.dumps(e) if isinstance(e,dict) else e for e in events),encoding="utf-8")
            output=Path(folder)/"report.html"
            summary=from_log(log,output)
            markup=output.read_text(encoding="utf-8")
            self.assertEqual(markup.count("<table>"),markup.count("</table>"))
            self.assertFalse(list(Path(folder).glob("*.tmp")))
            return summary,markup

    def event(self, kind, **fields):
        return dict(kind=kind,run_id="r",tester="t",lot="L",wafer="W",source_mode="live",**fields)

    def test_normal_run_duplicate_and_repeated_summary(self):
        device=self.event("device_end",event_id="d1",sbin=1)
        cumulative=self.event("run_summary",completed_devices=1,good_devices=1,yield_fraction=1)
        summary,markup=self.render([device,device,cumulative,cumulative,
            self.event("device_end",event_id="d2",sbin=2),
            self.event("run_summary",completed_devices=2,good_devices=1,yield_fraction=.5)])
        self.assertEqual(summary["wafers"][0]["devices"],2)
        self.assertEqual(summary["wafers"][0]["yield"],.5)
        self.assertEqual(summary["errors"],[])
        self.assertIn("none recorded",markup)

    def prediction(self):
        return self.event("prediction_request",stage=1,request_id="q",prediction_ids={"1":"p"},
            device_ids={"1":"d"},predictions={"1":2},coverage={"1":1},status="response_queued")

    def test_actual_requires_matching_scope(self):
        actual=self.event("prediction_actual",prediction_id="p",request_id="q",device_id="d",
                          site="1",stage=1,actual=3,absolute_error=1)
        bad=dict(actual,run_id="other")
        summary,_=self.render([self.prediction(),bad,actual])
        self.assertEqual(summary["predictions"][0]["actual"],3)
        self.assertEqual(len(summary["errors"]),1)
        self.assertIn("scope mismatch",summary["errors"][0])

    def test_malformed_errors_and_escaping(self):
        summary,markup=self.render(["not json",self.event("request_error",error="<script>bad</script>")])
        self.assertEqual(len(summary["errors"]),2)
        self.assertIn("&lt;script&gt;bad",markup)

    def test_legacy_process_restarts_remain_separate(self):
        summary,_=self.render([{"kind":"monitor_start"},{"kind":"device_end","tester":"t","sbin":1},
            {"kind":"monitor_start"},{"kind":"device_end","tester":"t","sbin":2}])
        self.assertEqual(len(summary["wafers"]),2)
        self.assertIn("legacy source unverified",summary["mode"])


if __name__=="__main__": unittest.main()
