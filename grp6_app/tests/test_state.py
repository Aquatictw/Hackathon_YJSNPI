import unittest
from grp6_app.state import LiveState


class LiveStateTests(unittest.TestCase):
    def test_current_touchdown_and_tester_isolation(self):
        state = LiveState()
        state.start("T1", [1, 2])
        state.start("T2", [1])
        state.record("T1", 1, "test", 10)
        state.record("T1", 2, "test", 20)
        state.record("T2", 1, "test", 30)
        self.assertEqual(state.snapshot("T1"), {"1": {"test": 10}, "2": {"test": 20}})
        self.assertEqual(state.snapshot("T2"), {"1": {"test": 30}})
        state.start("T1", [2])
        self.assertEqual(state.snapshot("T1"), {"2": {}})
        self.assertFalse(state.record("T1", 1, "test", 999))
        self.assertEqual(state.snapshot("T2"), {"1": {"test": 30}})

    def test_snapshots_are_copies_and_end_discards_values(self):
        state = LiveState()
        state.start("T", [1, 2])
        state.record("T", 1, "test", 1)
        snapshot = state.snapshot("T")
        snapshot["1"]["test"] = 99
        self.assertEqual(state.snapshot("T")["1"]["test"], 1)
        state.end("T", [1])
        self.assertEqual(state.snapshot("T"), {"2": {}})
        state.reset("T", "new lot", "new wafer")
        self.assertEqual(state.snapshot("T"), {})

    def test_invalid_and_out_of_lifecycle_values_are_rejected(self):
        state = LiveState()
        self.assertFalse(state.record("T", 1, "test", 1))
        state.start("T", [1])
        for value in [float("nan"), float("inf"), "bad", None]:
            self.assertFalse(state.record("T", 1, "test", value))
        self.assertEqual(state.rejected, 5)


if __name__ == "__main__":
    unittest.main()
