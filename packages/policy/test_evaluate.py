import unittest
from pathlib import Path

from evaluate import classify_source, evaluate, load_policy

ROOT = Path(__file__).resolve().parent
POLICY = load_policy(ROOT / "policy.yaml")


class EvaluateTest(unittest.TestCase):
    def test_stops_after_two_failures(self):
        first = evaluate(POLICY, {"state": "running", "failures": 1})
        second = evaluate(POLICY, {"state": "running", "failures": 2})
        self.assertEqual(first["action"], "run")
        self.assertEqual(second["state"], "stopped")
        self.assertEqual(second["reason"], "max_failures")
        self.assertEqual(second["policy_version"], "2026-11-24.1")

    def test_unknown_state_stops(self):
        got = evaluate(POLICY, {"state": "backoff", "failures": 0})
        self.assertEqual(got["state"], "stopped")
        self.assertEqual(got["reason"], "unknown_state")

    def test_kill_switch(self):
        policy = dict(POLICY)
        policy["kill_switch"] = True
        got = evaluate(policy, {"state": "queued", "failures": 0})
        self.assertEqual(got["reason"], "kill_switch")

    def test_same_input_same_output(self):
        task = {"state": "queued", "failures": 0}
        self.assertEqual(evaluate(POLICY, task), evaluate(POLICY, task))

    def test_time_and_place(self):
        self.assertEqual(classify_source(POLICY, "time", "public_post"), "fact")
        self.assertEqual(classify_source(POLICY, "time", "file_time"), "candidate")
        self.assertEqual(classify_source(POLICY, "place", "public_post"), "fact")
        with self.assertRaises(ValueError):
            classify_source(POLICY, "place", "file_place")


if __name__ == "__main__":
    unittest.main()
