from __future__ import annotations

import json
import os
import socket
import re
import subprocess
import time
from datetime import datetime
from pathlib import Path
from urllib.request import urlopen

APP = "minimax-h3"
TRACE = re.compile(r"\[H3_STARTUP_TRACE\]\s+t=([\d.]+)s\s+phase=(\S+)")
def configure_network() -> None:
    proxy = "http://127.0.0.1:7890"
    if not os.environ.get("HTTPS_PROXY"):
        try:
            with socket.create_connection(("127.0.0.1", 7890), timeout=0.25):
                pass
        except OSError:
            pass
        else:
            os.environ["HTTPS_PROXY"] = proxy
            os.environ["HTTP_PROXY"] = proxy
            os.environ["ALL_PROXY"] = proxy
    bypass = [item for item in os.environ.get("NO_PROXY", "").split(",") if item]
    for item in ("127.0.0.1", "localhost", ".modal.run"):
        if item not in bypass:
            bypass.append(item)
    os.environ["NO_PROXY"] = ",".join(bypass)


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, text=True, capture_output=True, check=check, encoding="utf-8", errors="replace")


def modal(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return run("uv", "run", "--with", "modal[api-proxy-support]", "modal", *args, check=check)


def workspace() -> str:
    return modal("profile", "current").stdout.strip()


def url() -> str:
    return f"https://{workspace()}--h3.modal.run"


def app_id() -> str:
    rows = json.loads(modal("app", "list", "--json").stdout)
    for row in rows:
        if row.get("description") == APP and row.get("state") == "deployed":
            return str(row["app_id"])
    raise RuntimeError(f"deployed app {APP!r} not found")


def live_containers() -> list[str]:
    rows = json.loads(modal("container", "list", "--app-id", app_id(), "--json").stdout)
    return [str(row["container_id"]) for row in rows if row.get("container_id")]


def stop_gpu() -> list[str]:
    # During this benchmark, the deployed minimax-h3 app has only the long-lived
    # RTX PRO 6000 web_server container. Provisioning is invoked separately.
    stopped: list[str] = []
    for _ in range(10):
        live = live_containers()
        if not live:
            return stopped
        for cid in live:
            modal("container", "stop", cid, "--yes")
            if cid not in stopped:
                stopped.append(cid)
        time.sleep(3)
    remaining = live_containers()
    raise RuntimeError(f"Could not prove all app containers stopped: {remaining}")

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
    latest: list[dict[str, object]] = []
    for t, phase in TRACE.findall(text):
        if phase == "container_entry":
            latest = []
        latest.append({"t_s": float(t), "phase": phase})
    return latest


def main() -> int:
    configure_network()
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
