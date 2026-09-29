from __future__ import annotations

import tempfile
import time
import unittest
from pathlib import Path

from h3_runtime_cache import cache_namespace, stage_caches, sync_caches


class RuntimeCacheTests(unittest.TestCase):
    def test_namespace_is_stable_and_sensitive(self):
        left = cache_namespace({"gpu": "B300", "torch": "2.13", "ref": "a"})
        self.assertEqual(left, cache_namespace({"ref": "a", "torch": "2.13", "gpu": "B300"}))
        self.assertNotEqual(left, cache_namespace({"gpu": "B300", "torch": "2.13", "ref": "b"}))

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
