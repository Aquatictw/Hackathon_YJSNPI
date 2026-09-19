import unittest

from grp6_app.data import Measurement, _number, stage_features
from grp6_app.predict import StageModels


class TrainingGuards(unittest.TestCase):
    def test_rejects_csv_order_fallback(self):
        with self.assertRaisesRegex(ValueError, "verified flow"):
            StageModels().fit([])

    def test_absent_target_has_no_features(self):
        self.assertEqual(stage_features(["10_early#CP", "999_future#CP"])[1], [])

    def test_rejects_nonfinite_measurements(self):
        for value in ("nan", "inf", "-inf", "bad", ""):
            self.assertIsNone(_number(value))
        self.assertEqual(_number("1.25"), 1.25)

    def test_lot_ids_do_not_merge_training_devices(self):
        rows = [Measurement("1", "1", "1", test, value, 0, lot)
                for lot, x, y in [("A", 1., 10.), ("B", 2., 30.)]
                for test, value in [("10_early#CP", x), ("100_Main.sensor1#CP", y)]]
        model = StageModels().fit(rows, allowlists={1: ["10_early#CP"]})
        self.assertEqual(model.defaults[1], 20.)
        self.assertIsNone(model.predict(1, {}))

    def test_rejects_sensor_in_manifest(self):
        with self.assertRaisesRegex(ValueError, "Sensor targets"):
            StageModels().fit([], allowlists={1: ["100_Main.sensor1#CP"]})


if __name__ == "__main__":
    unittest.main()
