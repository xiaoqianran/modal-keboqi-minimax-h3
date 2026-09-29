from __future__ import annotations

import json
import re
import subprocess
import time
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen

APP = "minimax-h3"
TRACE = re.compile(r"\[H3_STARTUP_TRACE\]\s+t=([\d.]+)s\s+phase=(\S+)")
GPU_NAMES = ("RTX PRO 6000", "RTX 6000")


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True, check=check, encoding="utf-8", errors="replace")


def modal(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return run("uv", "run", "--with", "modal", "modal", *args, check=check)


def workspace() -> str:
    return modal("profile", "current").stdout.strip()


def url() -> str:
    return f"https://{workspace()}--{APP}-serve.modal.run"


def app_id() -> str:
    rows = json.loads(modal("app", "list", "--json").stdout)
    for row in rows:
        if row.get("description") == APP and row.get("state") == "deployed":
            return str(row["app_id"])
    raise RuntimeError(f"deployed app {APP!r} not found")


def classify_containers() -> tuple[list[str], list[str]]:
    rows = json.loads(modal("container", "list", "--app-id", app_id(), "--json").stdout)
    gpu: list[str] = []
    unknown: list[str] = []
    for row in rows:
        cid = row.get("container_id")
        if not cid:
            continue
        cid = str(cid)
        probe = modal("container", "exec", "--no-pty", cid, "--", "nvidia-smi", "-L", check=False)
        text = probe.stdout + probe.stderr
        if probe.returncode == 0:
            if any(name.lower() in text.lower() for name in GPU_NAMES):
                gpu.append(cid)
            continue
        recent = modal("container", "logs", cid, "--tail", "200", check=False)
        log_text = recent.stdout + recent.stderr
        if "[H3_STARTUP_TRACE]" in log_text or "[modal-h3] Launching ComfyUI" in log_text:
            gpu.append(cid)
        elif log_text.strip():
            unknown.append(cid)
    return gpu, unknown


def stop_gpu() -> list[str]:
    stopped: list[str] = []
    for _ in range(10):
        gpu, unknown = classify_containers()
        for cid in gpu:
            modal("container", "stop", cid, "--yes")
            if cid not in stopped:
                stopped.append(cid)
        if not gpu and not unknown:
            return stopped
        if unknown and not gpu:
            raise RuntimeError(f"Could not safely classify live containers: {unknown}")
        time.sleep(3)
    raise RuntimeError("Could not prove that all RTX PRO 6000 containers stopped")


def wake(base: str) -> float:
    started = time.perf_counter()
    with urlopen(base + "/", timeout=1800) as response:
        response.read(1)
        if response.status >= 400:
            raise RuntimeError(f"HTTP {response.status}")
    return round(time.perf_counter() - started, 3)


def generate(base: str) -> tuple[float, object]:
    from gradio_client import Client
    started = time.perf_counter()
    result = Client(base, verbose=False).predict(
        "A cinematic tracking shot through a rain-soaked neon city at night",
        api_name="/generate_video",
    )
    return round(time.perf_counter() - started, 3), result


def logs() -> str:
    return modal("app", "logs", APP, "--since", "45m", "--tail", "5000", "--timestamps").stdout


def parse_trace(text: str) -> list[dict[str, object]]:
    return [{"t_s": float(t), "phase": phase} for t, phase in TRACE.findall(text)]


def main() -> int:
    out = Path("logs")
    out.mkdir(exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    base = url()
    report: dict[str, object] = {"app": APP, "url": base, "started_at": datetime.now().isoformat()}

    report["pre_stopped"] = stop_gpu()
    time.sleep(5)

    report["cold_1_s"] = wake(base)
    first = logs()
    report["cold_1_trace"] = parse_trace(first)

    generation_s, generation_result = generate(base)
    report["generation_s"] = generation_s
    report["generation_result"] = generation_result
    time.sleep(40)

    first = logs()
    (out / f"h3-{stamp}-first.log").write_text(first, encoding="utf-8")
    report["first_trace_after_generation"] = parse_trace(first)
    report["stopped_after_first"] = stop_gpu()
    time.sleep(8)

    report["cold_2_s"] = wake(base)
    second = logs()
    (out / f"h3-{stamp}-second.log").write_text(second, encoding="utf-8")
    report["cold_2_trace"] = parse_trace(second)
    report["stopped_after_second"] = stop_gpu()
    report["finished_at"] = datetime.now().isoformat()

    path = out / f"h3-{stamp}.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    print(f"Saved: {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())


