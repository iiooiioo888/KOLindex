import hashlib
import os
import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

os.environ["KOL_TOKEN_VIEWER"] = "viewer-token"
os.environ["KOL_TOKEN_REVIEWER"] = "reviewer-token"
os.environ["KOL_TOKEN_OPERATOR"] = "operator-token"
os.environ.pop("KOL_PROD", None)

from app import create_app, deliver  # noqa: E402
from evaluate import load_policy  # noqa: E402

POLICY = load_policy(Path(__file__).resolve().parents[2] / "packages" / "policy" / "policy.yaml")


class ControlTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        root = Path(self.tmp.name)
        os.environ["KOL_NAS_ROOT"] = str(root)
        os.environ["KOL_DATABASE_URL"] = "sqlite:///" + str(root / "buffer" / "control.sqlite")
        self.client = TestClient(create_app())
        self.op = {"Authorization": "Bearer operator-token"}
        self.viewer = {"Authorization": "Bearer viewer-token"}
        self.reviewer = {"Authorization": "Bearer reviewer-token"}

    def tearDown(self):
        self.tmp.cleanup()

    def test_roles_and_dedup(self):
        inbox = Path(os.environ["KOL_NAS_ROOT"]) / "inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        target = inbox / "a.bin"
        target.write_bytes(b"public-post")
        digest = hashlib.sha256(b"public-post").hexdigest()
        body = {
            "source_id": "collector",
            "captured_at": "2026-11-24T00:00:00Z",
            "content_hash": digest,
            "storage_path": str(target),
        }
        denied = self.client.post("/intake", json=body, headers=self.viewer)
        self.assertEqual(denied.status_code, 403)
        missing = self.client.post("/intake", json=body)
        self.assertEqual(missing.status_code, 401)
        first = self.client.post("/intake", json=body, headers=self.op)
        self.assertEqual(first.status_code, 200)
        self.assertFalse(first.json()["deduped"])
        second = self.client.post("/intake", json=body, headers=self.op)
        self.assertTrue(second.json()["deduped"])
        self.assertEqual(first.json()["seq"], second.json()["seq"])
        health = self.client.get("/__health/components", headers=self.viewer)
        self.assertEqual(health.status_code, 200)
        self.assertIn("duration_ms", health.json())
        decision = self.client.post(
            "/decisions",
            json={
                "source_id": "review",
                "target_id": "1",
                "action": "confirm",
                "reason": "公開提及",
                "reviewer": "ada",
                "decided_at": "2026-11-24T01:00:00Z",
            },
            headers=self.reviewer,
        )
        self.assertEqual(decision.status_code, 200)
        blocked = self.client.post(
            "/decisions",
            json={
                "source_id": "review",
                "target_id": "1",
                "action": "confirm",
                "reason": "x",
                "reviewer": "ada",
                "decided_at": "2026-11-24T01:00:00Z",
            },
            headers=self.viewer,
        )
        self.assertEqual(blocked.status_code, 403)

    def test_two_failures_stop_and_keep_file(self):
        inbox = Path(os.environ["KOL_NAS_ROOT"]) / "inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        target = inbox / "kept.bin"
        target.write_bytes(b"stay")

        def fail(_payload):
            raise RuntimeError("down")

        got = deliver(fail, {"source_id": "collector", "storage_path": str(target)}, POLICY)
        self.assertEqual(got["state"], "stopped")
        self.assertEqual(got["failures"], 2)
        self.assertTrue(target.is_file())


if __name__ == "__main__":
    unittest.main()
