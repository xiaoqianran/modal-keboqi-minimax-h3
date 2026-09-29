from __future__ import annotations

import atexit
import hashlib
import json
import os
import shutil
import tarfile
import tempfile
import threading
import time
from pathlib import Path
from typing import Callable, Mapping

ARCHIVE_NAME = "runtime-cache.tar"
MANIFEST_NAME = "runtime-cache.json"
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
    print(
        f"[H3_STARTUP_TRACE] t={time.perf_counter() - started:.3f}s phase={phase}"
        + (f" {suffix}" if suffix else ""),
        flush=True,
    )


def _runtime_digest(root: Path, names: tuple[str, ...]) -> tuple[str, int, int]:
    digest = hashlib.sha256()
    files = 0
    total_bytes = 0
    for name in names:
        base = root / name
        if not base.exists():
            continue
        for path in sorted(p for p in base.rglob("*") if p.is_file()):
            rel = path.relative_to(root).as_posix()
            digest.update(rel.encode("utf-8"))
            digest.update(b"\0")
            try:
                size = path.stat().st_size
                digest.update(str(size).encode("ascii"))
                with path.open("rb") as source:
                    while chunk := source.read(8 * 1024 * 1024):
                        digest.update(chunk)
            except OSError:
                continue
            files += 1
            total_bytes += size
    return digest.hexdigest(), files, total_bytes


def _read_manifest(seed_root: Path) -> dict[str, object]:
    try:
        return json.loads((seed_root / MANIFEST_NAME).read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return {}


def _write_atomic(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(path.name + ".partial")
    partial.write_bytes(data)
    os.replace(partial, path)


def stage_caches(seed_root: Path, runtime_root: Path, names: tuple[str, ...]) -> dict[str, int]:
    seed_root = Path(seed_root)
    runtime_root = Path(runtime_root)
    archive = seed_root / ARCHIVE_NAME
    runtime_root.mkdir(parents=True, exist_ok=True)
    if not archive.is_file():
        for name in names:
            (runtime_root / name).mkdir(parents=True, exist_ok=True)
        print("[H3_CACHE_STAGE] archive=none files=0 bytes=0 elapsed_s=0.000", flush=True)
        return {name: 0 for name in names}

    started = time.perf_counter()
    fd, tmp_name = tempfile.mkstemp(prefix="h3-cache-", suffix=".tar", dir=runtime_root.parent)
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        shutil.copyfile(archive, tmp)
        archive_bytes = tmp.stat().st_size
        with tarfile.open(tmp, "r") as bundle:
            bundle.extractall(runtime_root, filter="data")
    finally:
        tmp.unlink(missing_ok=True)

    results: dict[str, int] = {}
    total_files = 0
    total_bytes = 0
    for name in names:
        base = runtime_root / name
        files = [p for p in base.rglob("*") if p.is_file()] if base.exists() else []
        results[name] = len(files)
        total_files += len(files)
        for path in files:
            try:
                total_bytes += path.stat().st_size
            except OSError:
                pass
    print(
        f"[H3_CACHE_STAGE] archive={ARCHIVE_NAME} files={total_files} bytes={total_bytes} "
        f"archive_bytes={archive_bytes} elapsed_s={time.perf_counter() - started:.3f}",
        flush=True,
    )
    return results


def sync_caches(seed_root: Path, runtime_root: Path, names: tuple[str, ...]) -> list[str]:
    seed_root = Path(seed_root)
    runtime_root = Path(runtime_root)
    started = time.perf_counter()
    digest, files, total_bytes = _runtime_digest(runtime_root, names)
    previous = _read_manifest(seed_root)
    if previous.get("sha256") == digest and (seed_root / ARCHIVE_NAME).is_file():
        print(
            f"[H3_CACHE_SYNC] archive={ARCHIVE_NAME} files={files} bytes={total_bytes} "
            f"changed=false elapsed_s={time.perf_counter() - started:.3f}",
            flush=True,
        )
        return []

    fd, tmp_name = tempfile.mkstemp(prefix="h3-cache-build-", suffix=".tar", dir=runtime_root.parent)
    os.close(fd)
    tmp = Path(tmp_name)
    try:
        with tarfile.open(tmp, "w") as bundle:
            for name in names:
                path = runtime_root / name
                if path.exists():
                    bundle.add(path, arcname=name, recursive=True)
        archive_bytes = tmp.stat().st_size
        seed_root.mkdir(parents=True, exist_ok=True)
        partial = seed_root / f"{ARCHIVE_NAME}.partial"
        shutil.copyfile(tmp, partial)
        os.replace(partial, seed_root / ARCHIVE_NAME)
        manifest = {
            "schema_version": 1,
            "sha256": digest,
            "files": files,
            "bytes": total_bytes,
            "archive_bytes": archive_bytes,
            "names": list(names),
        }
        _write_atomic(
            seed_root / MANIFEST_NAME,
            (json.dumps(manifest, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8"),
        )
    finally:
        tmp.unlink(missing_ok=True)

    changed = [name for name in names if (runtime_root / name).exists()]
    print(
        f"[H3_CACHE_SYNC] archive={ARCHIVE_NAME} files={files} bytes={total_bytes} "
        f"archive_bytes={archive_bytes} changed=true elapsed_s={time.perf_counter() - started:.3f}",
        flush=True,
    )
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
                print(f"[H3_CACHE_SYNC_ERROR] stage=archive error={exc!r}", flush=True)
                return False
            pending_commit = pending_commit or bool(changed)
            if pending_commit:
                try:
                    commit()
                except Exception as exc:
                    print(f"[H3_CACHE_SYNC_ERROR] stage=commit error={exc!r}", flush=True)
                    return False
                pending_commit = False
                print(
                    f"[H3_CACHE_COMMIT] names={','.join(changed) if changed else 'pending'}",
                    flush=True,
                )
            signal.unlink(missing_ok=True)
            return True

    def worker() -> None:
        persist(force=True)
        while True:
            time.sleep(max(5, interval_s))
            persist()

    def flush_on_exit() -> None:
        if runtime_root.exists():
            persist(force=True)

    atexit.register(flush_on_exit)
    thread = threading.Thread(target=worker, name="h3-runtime-cache-sync", daemon=True)
    thread.start()
    return thread
