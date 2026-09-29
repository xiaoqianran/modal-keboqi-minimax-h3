from __future__ import annotations

import atexit
import hashlib
import json
import os
import shutil
import threading
import time
from pathlib import Path
from typing import Callable, Mapping

DIRTY_MARKER = ".runtime-cache-dirty"
DIRTY_SIGNAL = ".runtime-cache-sync-needed"


def file_revision(path: Path) -> str:
    digest = hashlib.sha256()
    with Path(path).open("rb") as source:
        while chunk := source.read(8 * 1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()[:16]


def cache_namespace(values: Mapping[str, object]) -> str:
    payload = json.dumps(dict(values), sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:16]


def trace(started: float, phase: str, **fields: object) -> None:
    suffix = " ".join(f"{key}={value}" for key, value in fields.items())
    print(f"[H3_STARTUP_TRACE] t={time.perf_counter() - started:.3f}s phase={phase}" + (f" {suffix}" if suffix else ""), flush=True)


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
        started = time.perf_counter()
        files, total_bytes = _copy_tree(runtime, seed)
        if files:
            seed.mkdir(parents=True, exist_ok=True)
            (seed / DIRTY_MARKER).write_text("1\n", encoding="utf-8")
            changed.append(name)
        print(f"[H3_CACHE_SYNC] name={name} files={files} bytes={total_bytes} changed={str(bool(files)).lower()} elapsed_s={time.perf_counter() - started:.3f}", flush=True)
    return changed


def mark_cache_dirty(runtime_root: Path) -> None:
    root = Path(runtime_root)
    root.mkdir(parents=True, exist_ok=True)
    (root / DIRTY_SIGNAL).touch()


def mark_cache_dirty_from_env() -> None:
    marker = os.getenv("H3_RUNTIME_CACHE_DIRTY_MARKER", "").strip()
    if not marker:
        return
    try:
        path = Path(marker)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch()
    except OSError:
        pass


def start_cache_sync(
    seed_root: Path,
    runtime_root: Path,
    names: tuple[str, ...],
    commit: Callable[[], None],
    *,
    interval_s: int = 30,
) -> threading.Thread:
    seed_root = Path(seed_root)
    runtime_root = Path(runtime_root)
    signal = runtime_root / DIRTY_SIGNAL
    lock = threading.Lock()
    pending_commit = False

    def persist(*, force: bool = False) -> bool:
        nonlocal pending_commit
        if not force and not signal.exists() and not pending_commit:
            return True
        with lock:
            try:
                changed = sync_caches(seed_root, runtime_root, names)
            except Exception as exc:
                print(f"[H3_CACHE_SYNC_ERROR] stage=copy error={exc!r}", flush=True)
                return False
            pending_commit = pending_commit or bool(changed)
            if pending_commit:
                try:
                    commit()
                except Exception as exc:
                    print(f"[H3_CACHE_SYNC_ERROR] stage=commit error={exc!r}", flush=True)
                    return False
                pending_commit = False
                print(f"[H3_CACHE_COMMIT] names={','.join(changed) if changed else 'pending'}", flush=True)
            signal.unlink(missing_ok=True)
            return True

    def worker() -> None:
        # Capture kernels compiled during ComfyUI startup once, then stay O(1)
        # while idle. GPU jobs touch DIRTY_SIGNAL when they release the GPU.
        persist(force=True)
        while True:
            time.sleep(max(5, interval_s))
            persist()

    def flush_on_exit() -> None:
        # Best effort only; Modal may still terminate a container abruptly.
        if runtime_root.exists():
            persist(force=True)

    atexit.register(flush_on_exit)
    thread = threading.Thread(target=worker, name="h3-runtime-cache-sync", daemon=True)
    thread.start()
    return thread
