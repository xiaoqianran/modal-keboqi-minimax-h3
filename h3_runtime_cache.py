from __future__ import annotations

import hashlib
import json
import shutil
import threading
import time
from pathlib import Path
from typing import Callable, Mapping

DIRTY_MARKER = ".runtime-cache-dirty"


def cache_namespace(values: Mapping[str, object]) -> str:
    payload = json.dumps(dict(values), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def trace(started: float, phase: str, **fields: object) -> None:
    suffix = " ".join(f"{key}={value}" for key, value in fields.items())
    print(f"[H3_STARTUP_TRACE] t={time.perf_counter() - started:.3f}s phase={phase}" + (f" {suffix}" if suffix else ""), flush=True)


def _fingerprint(root: Path) -> tuple[tuple[str, int, int], ...]:
    if not root.exists():
        return ()
    records: list[tuple[str, int, int]] = []
    for path in root.rglob("*"):
        if not path.is_file() or path.name == DIRTY_MARKER:
            continue
        try:
            stat = path.stat()
        except OSError:
            continue
        records.append((path.relative_to(root).as_posix(), stat.st_size, stat.st_mtime_ns))
    records.sort()
    return tuple(records)


def _copy_tree(source: Path, destination: Path) -> tuple[int, int]:
    if not source.exists():
        destination.mkdir(parents=True, exist_ok=True)
        return 0, 0
    destination.mkdir(parents=True, exist_ok=True)
    files = 0
    total_bytes = 0
    for path in source.rglob("*"):
        if not path.is_file() or path.name == DIRTY_MARKER:
            continue
        target = destination / path.relative_to(source)
        target.parent.mkdir(parents=True, exist_ok=True)
        try:
            src_stat = path.stat()
            if target.is_file():
                dst_stat = target.stat()
                if dst_stat.st_size == src_stat.st_size and dst_stat.st_mtime_ns == src_stat.st_mtime_ns:
                    continue
            shutil.copy2(path, target)
            total_bytes += src_stat.st_size
            files += 1
        except OSError:
            continue
    return files, total_bytes


def stage_caches(seed_root: Path, runtime_root: Path, names: tuple[str, ...]) -> dict[str, int]:
    results: dict[str, int] = {}
    for name in names:
        started = time.perf_counter()
        files, total_bytes = _copy_tree(seed_root / name, runtime_root / name)
        results[name] = files
        print(f"[H3_CACHE_STAGE] name={name} files={files} bytes={total_bytes} elapsed_s={time.perf_counter() - started:.3f}", flush=True)
    return results


def sync_caches(seed_root: Path, runtime_root: Path, names: tuple[str, ...]) -> list[str]:
    changed: list[str] = []
    for name in names:
        runtime = runtime_root / name
        seed = seed_root / name
        before = _fingerprint(seed)
        started = time.perf_counter()
        files, total_bytes = _copy_tree(runtime, seed)
        after = _fingerprint(seed)
        if before != after:
            seed.mkdir(parents=True, exist_ok=True)
            (seed / DIRTY_MARKER).write_text("1\n", encoding="utf-8")
            changed.append(name)
        print(f"[H3_CACHE_SYNC] name={name} files={files} bytes={total_bytes} changed={str(before != after).lower()} elapsed_s={time.perf_counter() - started:.3f}", flush=True)
    return changed


def start_cache_sync(
    seed_root: Path,
    runtime_root: Path,
    names: tuple[str, ...],
    commit: Callable[[], None],
    *,
    interval_s: int = 300,
) -> threading.Thread:
    def worker() -> None:
        previous = {name: _fingerprint(runtime_root / name) for name in names}
        while True:
            time.sleep(max(30, interval_s))
            current = {name: _fingerprint(runtime_root / name) for name in names}
            dirty = tuple(name for name in names if current[name] != previous[name])
            if not dirty:
                continue
            changed = sync_caches(seed_root, runtime_root, dirty)
            if changed:
                commit()
                print(f"[H3_CACHE_COMMIT] names={','.join(changed)}", flush=True)
            previous.update({name: current[name] for name in dirty})

    thread = threading.Thread(target=worker, name="h3-runtime-cache-sync", daemon=True)
    thread.start()
    return thread
