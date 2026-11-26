import unittest
from pathlib import Path

from evaluate import classify_media_similarity, classify_source, evaluate, load_policy

ROOT = Path(__file__).resolve().parent
POLICY = load_policy(ROOT / "policy.yaml")


class EvaluateTest(unittest.TestCase):
    def test_stops_after_two_failures(self):
        first = evaluate(POLICY, {"state": "running", "failures": 1})
        second = evaluate(POLICY, {"state": "running", "failures": 2})
        self.assertEqual(first["action"], "run")
        self.assertEqual(second["state"], "stopped")
        self.assertEqual(second["reason"], "max_failures")
        self.assertEqual(second["policy_version"], "2026-11-26.1")

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

    def test_media_similarity_copy_suspect(self):
        below = classify_media_similarity(
            POLICY,
            score=0.99,
            left_subject_id="s1",
            right_subject_id="s2",
            left_account_id="a1",
            right_account_id="a2",
        )
        self.assertEqual(below["action"], "skip")
        same = classify_media_similarity(
            POLICY,
            score=0.9999,
            left_subject_id="s1",
            right_subject_id="s1",
            left_account_id="a1",
            right_account_id="a1",
        )
        self.assertEqual(same["kind"], "near_duplicate")
        self.assertEqual(same["status"], "waiting_review")
        self.assertFalse(same["auto_confirm"])
        plag = classify_media_similarity(
            POLICY,
            score=0.99995,
            left_subject_id="s1",
            right_subject_id="s2",
            left_account_id="a1",
            right_account_id="a2",
        )
        self.assertEqual(plag["kind"], "copy_suspect")


if __name__ == "__main__":
    unittest.main()
