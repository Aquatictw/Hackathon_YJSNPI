from __future__ import annotations

import json
import queue
from collections import defaultdict
from pathlib import Path

from .detectors import StreamingDetector
from .predict import StageModels


class RTDIAdapter:
    """Replay-safe core used by local tests and the Edge monitor."""

    def __init__(self, model_path=None):
        self.detector = StreamingDetector()
        self.models = StageModels.load(model_path) if model_path and Path(model_path).exists() else StageModels()
        self.features = defaultdict(dict)
        self.alerts = queue.Queue(maxsize=2048)
        self.active_key = None
        self.dropped_alerts = 0

    def reset(self, key=None):
        self.active_key = key

    def ingest_measurement(self, wafer, device, site, test, value, tester="local"):
        key = (str(tester), str(wafer), str(device), str(site))
        self.active_key = key
        self.features[key][str(test)] = float(value)
        alert = self.detector.update(str(wafer), str(site), str(test), float(value))
        if alert:
            try:
                self.alerts.put_nowait(alert)
            except queue.Full:
                self.dropped_alerts += 1
        return alert

    def consumeData(self, event):
        item = dict(event) if isinstance(event, dict) else json.loads(event)
        required = ["wafer", "device", "site", "test", "value"]
        if any(name not in item for name in required):
            raise ValueError(f"event requires {required}")
        return self.ingest_measurement(
            item["wafer"], item["device"], item["site"], item["test"], item["value"], item.get("tester", "local")
        )

    def _prediction_values(self, stage, key=None):
        values = self.features.get(key or self.active_key, {})
        if not values:
            return None
        return self.models.predict(stage, values)

    def consumeTPRequest(self, request, key=None):
        obj = json.loads(request) if isinstance(request, str) else dict(request)
        if obj.get("key") != "predict":
            return json.dumps({"status": "unsupported"})
        stage = obj.get("data")
        prediction = self._prediction_values(stage, key)
        if prediction is None:
            return json.dumps({"status": "insufficient_data", "target": stage})
        return json.dumps({"status": "ok", "target": stage, "prediction": prediction})


class OneAPIMonitor(RTDIAdapter):
    """ONEAPI adapter with tester-scoped ActionManager delivery."""

    def __init__(self, model_path=None, action_manager=None):
        super().__init__(model_path)
        if action_manager is None:
            try:
                from libACSAction import ActionManager as action_manager
            except ImportError:
                action_manager = None
        self.action_manager = action_manager
        self.tester_id = None
        self.sites = []
        self.wafer = "unknown"
        self.device = "unknown"

    @staticmethod
    def _call(obj, name, *args, default=None):
        method = getattr(obj, name, None)
        if method is None:
            return default
        try:
            return method(*args)
        except Exception:
            return default

    def _send_message(self, message):
        if self.action_manager is None or not self.tester_id:
            return False
        try:
            return bool(self.action_manager.set_message(self.tester_id, message))
        except Exception:
            return False

    def _measurement_rows(self, data):
        count = self._call(data, "get_ResultCount", default=0) or 0
        rows = []
        for index in range(int(count)):
            head_site = self._call(data, "query_HeadSite", index, default=0)
            test = self._call(data, "query_TestText", index, default=None)
            if not test:
                test = self._call(data, "query_TestNumber", index, default=f"result_{index}")
            value = self._call(data, "query_Result", index, default=None)
            if value is None:
                results = self._call(data, "query_Results", index, default=[])
                value = results[0] if results else None
            if value is not None:
                rows.append((str(head_site), str(test), value))
        return rows

    def consumeData(self, tc, data):
        # ONEAPI requires getType() before reading payload fields. Copy all
        # values before this callback returns because the SDK may clear data.
        data_type = self._call(data, "getType", default=None)
        self.tester_id = getattr(tc, "testerId", None)
        type_name = str(data_type).lower()
        if "waferstart" in type_name:
            self.wafer = str(self._call(data, "get_WaferId", default=self.wafer))
            self.device = self.wafer
            self.features = defaultdict(dict)
            self.sites = []
            self.reset((self.tester_id, self.wafer, self.device, "*"))
            return None
        if "waferend" in type_name:
            return None
        for site, test, value in self._measurement_rows(data):
            alert = self.ingest_measurement(self.wafer, self.device, site, test, value, self.tester_id)
            if alert:
                self._send_message(alert.message)
        return None

    def consumeTPRequest(self, tc, request):
        self.tester_id = getattr(tc, "testerId", self.tester_id)
        obj = json.loads(request) if isinstance(request, str) else dict(request)
        if obj.get("key") == "predict":
            stage = obj.get("data")
            messages = []
            keys = [key for key in self.features if key[0] == self.tester_id]
            if not keys and self.active_key in self.features:
                keys = [self.active_key]
            for key in sorted(keys, key=str):
                prediction = self._prediction_values(stage, key)
                if prediction is not None:
                    messages.append(f"prediction {stage}: ({key[3]},{prediction:.6g})")
            payload = " ".join(messages)
            if payload and self.action_manager is not None:
                try:
                    self.action_manager.set_wait(self.tester_id, 10, payload)
                except Exception:
                    self._send_message(payload)
            if self.action_manager is not None:
                try:
                    return self.action_manager.get(self.tester_id)
                except Exception:
                    pass
            return payload
        if obj.get("key") == "prod_action" and self.action_manager is not None:
            try:
                return self.action_manager.get_prod(self.tester_id)
            except Exception:
                return ""
        if obj.get("action") == "list" and self.action_manager is not None:
            try:
                return self.action_manager.get(self.tester_id)
            except Exception:
                return ""
        return ""
