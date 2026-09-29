from __future__ import annotations

import tempfile
import time
import unittest
from unittest.mock import Mock, patch
from pathlib import Path

from h3_runtime_cache import cache_namespace, file_revision, stage_caches, start_cache_sync, sync_caches
from h3_app.jobs import JobCoordinator


class RuntimeCacheTests(unittest.TestCase):
    def test_namespace_is_stable_and_sensitive(self):
        left = cache_namespace({"gpu": "B300", "torch": "2.13", "ref": "a"})
        self.assertEqual(left, cache_namespace({"ref": "a", "torch": "2.13", "gpu": "B300"}))
        self.assertNotEqual(left, cache_namespace({"gpu": "B300", "torch": "2.13", "ref": "b"}))

    def test_file_revision_tracks_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "code.py"
            path.write_bytes(b"one")
            first = file_revision(path)
            path.write_bytes(b"two")
            self.assertNotEqual(first, file_revision(path))


    def test_background_sync_retries_after_commit_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed = root / "seed"
            runtime = root / "runtime"
            (runtime / "triton").mkdir(parents=True)
            (runtime / "triton" / "kernel.bin").write_bytes(b"compiled")
            commit = Mock(side_effect=[RuntimeError("temporary"), None])
            with patch("h3_runtime_cache.time.sleep", side_effect=[None, SystemExit]):
                thread = start_cache_sync(seed, runtime, ("triton",), commit, interval_s=30)
                thread.join(2)
            self.assertGreaterEqual(commit.call_count, 2)

    def test_gpu_job_marks_runtime_cache_dirty(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "cache" / ".runtime-cache-sync-needed"
            with patch.dict("os.environ", {"H3_RUNTIME_CACHE_DIRTY_MARKER": str(marker)}):
                with JobCoordinator().run("owner", "h3"):
                    self.assertFalse(marker.exists())
                self.assertTrue(marker.is_file())

    def test_stage_and_incremental_sync(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            seed = root / "seed"
            runtime = root / "runtime"
            (seed / "triton").mkdir(parents=True)
            (seed / "triton" / "kernel.bin").write_bytes(b"old")
            staged = stage_caches(seed, runtime, ("triton",))
            self.assertEqual(staged["triton"], 1)
            self.assertEqual((runtime / "triton" / "kernel.bin").read_bytes(), b"old")

            time.sleep(0.002)
            (runtime / "triton" / "kernel.bin").write_bytes(b"new")
            changed = sync_caches(seed, runtime, ("triton",))
            self.assertEqual(changed, ["triton"])
            self.assertEqual((seed / "triton" / "kernel.bin").read_bytes(), b"new")
            self.assertTrue((seed / "triton" / ".runtime-cache-dirty").is_file())


if __name__ == "__main__":
    unittest.main()
