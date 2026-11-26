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

    def test_subjects_and_account_links(self):
        denied = self.client.post(
            "/subjects",
            json={"display_name": "示例人物"},
            headers=self.viewer,
        )
        self.assertEqual(denied.status_code, 403)
        created = self.client.post(
            "/subjects",
            json={"display_name": "示例人物", "note": "P0 人物主檔"},
            headers=self.op,
        )
        self.assertEqual(created.status_code, 200)
        subject = created.json()
        self.assertEqual(subject["display_name"], "示例人物")
        self.assertEqual(subject["coverage"]["indexed_posts"], 0)
        self.assertEqual(subject["coverage"]["media_assets"], 0)
        linked = self.client.post(
            f"/subjects/{subject['id']}/accounts",
            json={
                "platform": "bilibili",
                "external_account_id": "42",
                "display_name": "示例用户",
                "profile_url": "https://space.bilibili.com/42",
                "link_status": "confirmed",
                "linked_by": "ada",
            },
            headers=self.reviewer,
        )
        self.assertEqual(linked.status_code, 200)
        body = linked.json()
        self.assertEqual(body["coverage"]["confirmed_accounts"], 1)
        self.assertEqual(body["accounts"][0]["platform"], "bilibili")
        listed = self.client.get("/subjects?q=示例", headers=self.viewer)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.json()["total"], 1)
        self.assertEqual(listed.json()["source"], "control.subjects")
        bad_platform = self.client.post(
            f"/subjects/{subject['id']}/accounts",
            json={
                "platform": "myspace",
                "external_account_id": "1",
                "display_name": "x",
                "link_status": "candidate",
            },
            headers=self.op,
        )
        self.assertEqual(bad_platform.status_code, 400)
        post = self.client.post(
            "/posts",
            json={
                "platform": "bilibili",
                "external_account_id": "42",
                "external_post_id": "BV1xx",
                "subject_id": subject["id"],
                "title": "示例作品",
                "source_url": "https://www.bilibili.com/video/BV1xx",
            },
            headers=self.op,
        )
        self.assertEqual(post.status_code, 200)
        self.assertFalse(post.json()["deduped"])
        digest = "a" * 64
        media = self.client.post(
            "/media-index",
            json={
                "checksum": digest,
                "storage_path": "media/demo.jpg",
                "media_kind": "image",
                "subject_id": subject["id"],
                "platform": "bilibili",
                "external_account_id": "42",
                "post_id": post.json()["id"],
                "bytes": 1200,
                "time_source": "public_post",
                "time_status": "fact",
            },
            headers=self.op,
        )
        self.assertEqual(media.status_code, 200)
        again = self.client.post(
            "/media-index",
            json={
                "checksum": digest,
                "storage_path": "media/demo.jpg",
                "subject_id": subject["id"],
            },
            headers=self.op,
        )
        self.assertEqual(again.status_code, 200)
        self.assertTrue(again.json()["deduped"])
        listed_media = self.client.get(f"/subjects/{subject['id']}/media", headers=self.viewer)
        self.assertEqual(listed_media.status_code, 200)
        self.assertEqual(len(listed_media.json()["posts"]), 1)
        self.assertEqual(len(listed_media.json()["media"]), 1)
        refreshed = self.client.get(f"/subjects/{subject['id']}", headers=self.viewer)
        self.assertEqual(refreshed.json()["coverage"]["indexed_posts"], 1)
        self.assertEqual(refreshed.json()["coverage"]["media_assets"], 1)
        self.assertEqual(refreshed.json()["coverage"]["similarity_pending"], 0)

        other = self.client.post(
            "/subjects",
            json={"display_name": "另一人物"},
            headers=self.op,
        ).json()
        self.client.post(
            f"/subjects/{other['id']}/accounts",
            json={
                "platform": "bilibili",
                "external_account_id": "99",
                "display_name": "搬運用戶",
                "link_status": "confirmed",
                "linked_by": "ada",
            },
            headers=self.reviewer,
        )
        other_media = self.client.post(
            "/media-index",
            json={
                "checksum": "b" * 64,
                "storage_path": "media/copy.jpg",
                "media_kind": "image",
                "subject_id": other["id"],
                "platform": "bilibili",
                "external_account_id": "99",
                "time_source": "public_post",
                "time_status": "fact",
            },
            headers=self.op,
        )
        self.assertEqual(other_media.status_code, 200)
        below = self.client.post(
            "/media-similarity",
            json={
                "left_media_id": media.json()["id"],
                "right_media_id": other_media.json()["id"],
                "score": 0.99,
                "tool_name": "phash",
                "tool_version": "1",
            },
            headers=self.op,
        )
        self.assertEqual(below.status_code, 200)
        self.assertFalse(below.json()["created"])
        plag = self.client.post(
            "/media-similarity",
            json={
                "left_media_id": media.json()["id"],
                "right_media_id": other_media.json()["id"],
                "score": 0.9999,
                "tool_name": "phash",
                "tool_version": "1",
            },
            headers=self.op,
        )
        self.assertEqual(plag.status_code, 200)
        self.assertTrue(plag.json()["created"])
        self.assertEqual(plag.json()["kind"], "copy_suspect")
        self.assertEqual(plag.json()["status"], "waiting_review")
        pending = self.client.get("/media-similarity?status=waiting_review", headers=self.viewer)
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.json()["total"], 1)
        with_links = self.client.get(f"/subjects/{subject['id']}/media", headers=self.viewer)
        self.assertEqual(len(with_links.json()["similarity_links"]), 1)
        again_subject = self.client.get(f"/subjects/{subject['id']}", headers=self.viewer)
        self.assertEqual(again_subject.json()["coverage"]["similarity_pending"], 1)
        inbox = self.client.get("/intelligence/inbox", headers=self.viewer)
        self.assertEqual(inbox.status_code, 200)
        body = inbox.json()
        self.assertTrue(body["ok"])
        self.assertGreaterEqual(body["total"], 1)
        self.assertFalse(body["limits"]["auto_confirm"])
        self.assertFalse(body["limits"]["llm_can_act"])
        kinds = {item["kind"] for item in body["items"]}
        self.assertIn("copy_suspect", kinds)

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
