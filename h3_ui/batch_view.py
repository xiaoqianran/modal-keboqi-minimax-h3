"""Persistent multi-batch queue surface for MiniMax H3.

The UI owns only orchestration. Each prompt is submitted through the existing
``/generate_video`` Gradio API, so all work still passes through the shared
``h3-gpu`` concurrency lane and the existing ComfyUI/H3 runtime.
"""

from __future__ import annotations

import html
import threading
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import gradio as gr
import requests
from gradio_client import Client


MAX_BATCH_PROMPTS = 50
_LOCAL_GRADIO_URL = "http://127.0.0.1:7860"
_POLL_SECONDS = 0.5

_BATCH_CSS = r"""
<style>
.h3-batch-shell {
  --batch-accent: #7c6df2;
  --batch-accent-2: #4f8cff;
  --batch-panel: color-mix(in srgb, var(--background-fill-primary) 94%, var(--batch-accent) 6%);
  gap: 1rem !important;
  max-width: 1380px;
  margin: 0 auto;
}
.h3-batch-hero {
  position: relative;
  overflow: hidden;
  padding: 1.4rem 1.5rem 1.25rem;
  border: 1px solid color-mix(in srgb, var(--batch-accent) 22%, var(--border-color-primary));
  border-radius: 20px;
  background:
    radial-gradient(circle at 86% 18%, color-mix(in srgb, var(--batch-accent-2) 18%, transparent), transparent 31%),
    linear-gradient(135deg, color-mix(in srgb, var(--batch-accent) 13%, var(--background-fill-primary)), var(--background-fill-primary) 58%);
  box-shadow: 0 18px 46px rgba(20, 18, 45, .09);
}
.h3-batch-eyebrow {
  margin-bottom: .45rem;
  color: var(--batch-accent);
  font-size: .72rem;
  font-weight: 800;
  letter-spacing: .13em;
  text-transform: uppercase;
}
.h3-batch-hero h2 {
  margin: 0;
  font-size: clamp(1.55rem, 2.5vw, 2.35rem);
  letter-spacing: -.035em;
}
.h3-batch-hero p {
  max-width: 850px;
  margin: .55rem 0 0;
  color: var(--body-text-color-subdued);
  line-height: 1.65;
}
.h3-batch-layout { align-items: stretch !important; gap: 1rem !important; }
.h3-batch-composer,
.h3-batch-control-card,
.h3-batch-results,
.h3-batch-list {
  border: 1px solid var(--border-color-primary);
  border-radius: 18px;
  background: var(--batch-panel);
  box-shadow: 0 10px 30px rgba(0, 0, 0, .055);
}
.h3-batch-composer { padding: .85rem; }
.h3-batch-composer textarea {
  min-height: 300px !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
  line-height: 1.65 !important;
}
.h3-batch-control-card {
  min-width: 290px;
  padding: 1rem;
  gap: .8rem !important;
}
.h3-batch-control-card h3 { margin: 0 0 .2rem; font-size: 1rem; }
.h3-batch-control-card p { margin: 0; color: var(--body-text-color-subdued); font-size: .88rem; line-height: 1.55; }
.h3-batch-pills { display: flex; flex-wrap: wrap; gap: .4rem; margin: .25rem 0 .35rem; }
.h3-batch-pill {
  display: inline-flex;
  align-items: center;
  padding: .32rem .55rem;
  border: 1px solid color-mix(in srgb, var(--batch-accent) 28%, var(--border-color-primary));
  border-radius: 999px;
  color: var(--batch-accent);
  background: color-mix(in srgb, var(--batch-accent) 9%, transparent);
  font-size: .72rem;
  font-weight: 750;
}
.h3-batch-run button {
  min-height: 52px !important;
  border-radius: 13px !important;
  font-size: 1rem !important;
  font-weight: 800 !important;
}
.h3-batch-cancel button { min-height: 44px !important; border-radius: 12px !important; }
.h3-batch-status {
  min-height: 68px;
  padding: .72rem .8rem;
  border: 1px solid var(--border-color-primary);
  border-radius: 12px;
  background: var(--background-fill-primary);
}
.h3-batch-status p { margin: 0; }
.h3-batch-list,
.h3-batch-results { padding: .9rem; }
.h3-batch-list table,
.h3-batch-results table { font-size: .84rem; }
.h3-batch-downloads {
  padding: .9rem 1rem;
  border: 1px solid var(--border-color-primary);
  border-radius: 16px;
  background: var(--background-fill-primary);
}
.h3-batch-downloads:empty { display: none; }
@media (max-width: 900px) {
  .h3-batch-layout { flex-direction: column !important; }
  .h3-batch-control-card { min-width: 0; }
  .h3-batch-composer textarea { min-height: 240px !important; }
}
</style>
"""


@dataclass
class BatchItem:
    prompt: str
    status: str = "Queued"
    output_url: str = ""


@dataclass
class BatchRecord:
    batch_id: str
    owner: str
    items: list[BatchItem]
    created_at: float = field(default_factory=time.time)
    status: str = "Queued"
    cancel_requested: threading.Event = field(default_factory=threading.Event)


class BatchQueueManager:
    """One in-process queue feeding the app's existing Gradio H3 API."""

    def __init__(self) -> None:
        self._condition = threading.Condition(threading.RLock())
        self._records: dict[str, BatchRecord] = {}
        self._queue: deque[str] = deque()
        self._worker: threading.Thread | None = None
        self._active_batch_id: str | None = None
        self._active_client_job: Any = None
        self._client: Client | None = None

    def enqueue(self, owner: str, prompts: list[str]) -> str:
        batch_id = f"B-{uuid.uuid4().hex[:7]}"
        record = BatchRecord(
            batch_id=batch_id,
            owner=owner,
            items=[BatchItem(prompt=prompt) for prompt in prompts],
        )
        with self._condition:
            self._records[batch_id] = record
            self._queue.append(batch_id)
            self._ensure_worker_locked()
            self._condition.notify()
        return batch_id

    def cancel(self, owner: str, batch_id: str) -> str:
        client_job = None
        should_interrupt = False
        with self._condition:
            record = self._records.get(str(batch_id or ""))
            if record is None or record.owner != owner:
                return "Select one of your batches first."
            if record.status in {"Completed", "Completed with errors", "Cancelled"}:
                return f"{record.batch_id} is already {record.status.lower()}."

            record.cancel_requested.set()
            if record.status == "Queued":
                record.status = "Cancelled"
                for item in record.items:
                    if item.status == "Queued":
                        item.status = "Cancelled"
                return f"{record.batch_id} cancelled. Other batches are unchanged."

            record.status = "Cancelling"
            if self._active_batch_id == record.batch_id:
                client_job = self._active_client_job
                should_interrupt = self._job_is_processing(client_job)

        if client_job is not None:
            try:
                client_job.cancel()
            except Exception:
                pass
            should_interrupt = should_interrupt or self._job_is_processing(client_job)

        # Only interrupt ComfyUI when this batch's own API job is actually
        # processing. If it is merely waiting in Gradio's queue, interrupting
        # here could kill an unrelated Create/LTX/Music job.
        if should_interrupt:
            try:
                import gradio_app as legacy

                requests.post(
                    f"{legacy.COMFY_URL}/interrupt", json={}, timeout=5
                ).raise_for_status()
            except Exception:
                pass

        return (
            f"Cancel requested for {record.batch_id}. "
            "Its remaining prompts will be skipped; the next batch will continue."
        )

    def snapshot(
        self, owner: str, selected_batch_id: str | None
    ) -> tuple[list[list[Any]], list[str], str | None, list[list[Any]], str, str]:
        with self._condition:
            records = [
                record for record in self._records.values() if record.owner == owner
            ]
            records.sort(key=lambda record: record.created_at)

            choices = [record.batch_id for record in records]
            selected = (
                selected_batch_id
                if selected_batch_id in choices
                else (choices[-1] if choices else None)
            )

            batch_rows: list[list[Any]] = []
            for record in records:
                completed = sum(item.status == "Done" for item in record.items)
                failed = sum(item.status.startswith("Error") for item in record.items)
                cancelled = sum(item.status == "Cancelled" for item in record.items)
                current = next(
                    (
                        item.prompt
                        for item in record.items
                        if item.status
                        not in {"Queued", "Done", "Cancelled"}
                        and not item.status.startswith("Error")
                    ),
                    "",
                )
                progress = f"{completed}/{len(record.items)}"
                if failed:
                    progress += f" · {failed} failed"
                if cancelled:
                    progress += f" · {cancelled} cancelled"
                batch_rows.append(
                    [
                        record.batch_id,
                        record.status,
                        progress,
                        _short_prompt(current),
                    ]
                )

            item_rows: list[list[Any]] = []
            downloads = ""
            selected_record = self._records.get(selected) if selected else None
            if selected_record is not None and selected_record.owner == owner:
                item_rows = [
                    [
                        index + 1,
                        item.prompt,
                        item.status,
                        item.output_url,
                    ]
                    for index, item in enumerate(selected_record.items)
                ]
                downloads = _download_markdown(selected_record)

            running = next(
                (
                    record
                    for record in records
                    if record.status in {"Running", "Cancelling"}
                ),
                None,
            )
            queued_count = sum(record.status == "Queued" for record in records)
            if running is not None:
                done = sum(item.status == "Done" for item in running.items)
                status = (
                    f"**{running.batch_id}** · {running.status} · "
                    f"{done}/{len(running.items)} complete"
                )
                if queued_count:
                    status += f" · **{queued_count}** later batch(es) queued"
            elif queued_count:
                status = f"**{queued_count}** batch(es) queued."
            else:
                status = "Queue idle · add another batch at any time."

            return batch_rows, choices, selected, item_rows, downloads, status

    def _ensure_worker_locked(self) -> None:
        if self._worker is not None and self._worker.is_alive():
            return
        self._worker = threading.Thread(
            target=self._worker_loop,
            name="h3-batch-queue",
            daemon=True,
        )
        self._worker.start()

    def _get_client(self) -> Client:
        if self._client is None:
            self._client = Client(_LOCAL_GRADIO_URL, verbose=False)
        return self._client

    def _worker_loop(self) -> None:
        while True:
            with self._condition:
                while not self._queue:
                    self._condition.wait()
                batch_id = self._queue.popleft()
                record = self._records.get(batch_id)
                if record is None or record.cancel_requested.is_set():
                    continue
                record.status = "Running"
                self._active_batch_id = batch_id

            self._run_batch(record)

            with self._condition:
                self._active_batch_id = None
                self._active_client_job = None

    def _run_batch(self, record: BatchRecord) -> None:
        had_error = False
        for item in record.items:
            if record.cancel_requested.is_set():
                self._cancel_remaining(record)
                return

            with self._condition:
                item.status = "Submitting"

            try:
                client = self._get_client()
                client_job = client.submit(
                    item.prompt,
                    api_name="/generate_video",
                )
                with self._condition:
                    self._active_client_job = client_job
                    item.status = "Waiting for GPU"

                last_output: Any = None
                while not client_job.done():
                    if record.cancel_requested.is_set():
                        try:
                            client_job.cancel()
                        except Exception:
                            pass
                        break

                    outputs = client_job.outputs()
                    if outputs:
                        last_output = outputs[-1]
                        _url, status = _unpack_api_output(last_output)
                        if status:
                            with self._condition:
                                item.status = _compact_status(status)
                    else:
                        update = client_job.status()
                        with self._condition:
                            item.status = _client_status_label(update)
                    time.sleep(_POLL_SECONDS)

                outputs = client_job.outputs()
                if outputs:
                    last_output = outputs[-1]

                output_url, final_status = _unpack_api_output(last_output)
                if output_url:
                    with self._condition:
                        item.output_url = _relative_url(output_url)
                        item.status = "Done"
                elif record.cancel_requested.is_set():
                    with self._condition:
                        item.status = "Cancelled"
                else:
                    had_error = True
                    with self._condition:
                        item.status = (
                            f"Error: {_compact_status(final_status)}"
                            if final_status
                            else "Error: no output"
                        )
            except Exception as exc:
                if record.cancel_requested.is_set():
                    with self._condition:
                        item.status = "Cancelled"
                else:
                    had_error = True
                    with self._condition:
                        item.status = f"Error: {_short_error(exc)}"
                # Client configuration may have gone stale after a server reload.
                with self._condition:
                    self._client = None
            finally:
                with self._condition:
                    self._active_client_job = None

            if record.cancel_requested.is_set():
                self._cancel_remaining(record)
                return

        with self._condition:
            record.status = "Completed with errors" if had_error else "Completed"

    def _cancel_remaining(self, record: BatchRecord) -> None:
        with self._condition:
            for item in record.items:
                if item.status in {"Queued", "Submitting", "Waiting for GPU"}:
                    item.status = "Cancelled"
                elif (
                    item.status not in {"Done", "Cancelled"}
                    and not item.status.startswith("Error")
                ):
                    item.status = "Cancelled"
            record.status = "Cancelled"

    @staticmethod
    def _job_is_processing(client_job: Any) -> bool:
        if client_job is None:
            return False
        try:
            update = client_job.status()
            code = getattr(update, "code", "")
            name = getattr(code, "name", str(code)).upper()
            return "PROCESS" in name or "ITERAT" in name
        except Exception:
            return False


_MANAGER = BatchQueueManager()


def _parse_prompts(raw: str) -> list[str]:
    prompts = [line.strip() for line in str(raw or "").splitlines() if line.strip()]
    if not prompts:
        raise gr.Error("Add at least one prompt. Use one prompt per line.")
    if len(prompts) > MAX_BATCH_PROMPTS:
        raise gr.Error(f"A batch can contain at most {MAX_BATCH_PROMPTS} prompts.")
    return prompts


def _owner(request: gr.Request) -> str:
    return str(getattr(request, "session_hash", "") or "anonymous")


def _short_prompt(prompt: str, limit: int = 80) -> str:
    text = str(prompt or "").strip().replace("\n", " ")
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def _short_error(exc: Exception, limit: int = 110) -> str:
    text = f"{type(exc).__name__}: {exc}".replace("\n", " ").strip()
    return text if len(text) <= limit else text[: limit - 3].rstrip() + "..."


def _compact_status(status: Any) -> str:
    text = str(status or "").strip()
    if not text:
        return "Running"
    first = text.splitlines()[0].strip()
    if len(first) > 110:
        first = first[:107].rstrip() + "..."
    return first


def _client_status_label(update: Any) -> str:
    code = getattr(update, "code", "")
    name = getattr(code, "name", str(code)).upper()
    rank = getattr(update, "rank", None)
    queue_size = getattr(update, "queue_size", None)

    if "QUEUE" in name and rank is not None:
        if queue_size is not None:
            return f"Queued · position {int(rank) + 1}/{queue_size}"
        return f"Queued · position {int(rank) + 1}"
    if "PROCESS" in name or "ITERAT" in name:
        progress_data = getattr(update, "progress_data", None) or []
        if progress_data:
            desc = getattr(progress_data[-1], "desc", None)
            if desc:
                return _compact_status(desc)
        return "Generating"
    if "CANCEL" in name:
        return "Cancelled"
    return name.title().replace("_", " ") if name else "Waiting for GPU"


def _unpack_api_output(output: Any) -> tuple[str, str]:
    if output is None:
        return "", ""
    if isinstance(output, (tuple, list)):
        url = output[0] if len(output) >= 1 else ""
        status = output[1] if len(output) >= 2 else ""
        return str(url or ""), str(status or "")
    return "", str(output)


def _relative_url(url: str) -> str:
    """Turn the worker's localhost absolute URL into a browser-safe same-origin URL."""
    raw = str(url or "").strip()
    if not raw:
        return ""
    parsed = urlsplit(raw)
    if not parsed.scheme and not parsed.netloc:
        return raw
    return urlunsplit(("", "", parsed.path or "/", parsed.query, parsed.fragment))


def _download_markdown(record: BatchRecord) -> str:
    completed = [
        (index + 1, item.prompt, item.output_url)
        for index, item in enumerate(record.items)
        if item.status == "Done" and item.output_url
    ]
    if not completed:
        return ""
    lines = [f"### {record.batch_id} · completed outputs"]
    for index, prompt, url in completed:
        safe_prompt = html.escape(_short_prompt(prompt, 96))
        lines.append(f"- **#{index}** [{safe_prompt}]({url})")
    return "\n".join(lines)


def _render_for_request(
    selected_batch_id: str | None,
    request: gr.Request,
) -> tuple[Any, list[list[Any]], list[list[Any]], str, str]:
    batch_rows, choices, selected, item_rows, downloads, status = _MANAGER.snapshot(
        _owner(request), selected_batch_id
    )
    return (
        gr.update(choices=choices, value=selected),
        batch_rows,
        item_rows,
        downloads,
        status,
    )


def enqueue_prompt_batch(
    prompts_text: str,
    request: gr.Request,
) -> tuple[Any, Any, list[list[Any]], list[list[Any]], str, str]:
    prompts = _parse_prompts(prompts_text)
    batch_id = _MANAGER.enqueue(_owner(request), prompts)
    batch_rows, choices, selected, item_rows, downloads, status = _MANAGER.snapshot(
        _owner(request), batch_id
    )
    return (
        gr.update(value=""),
        gr.update(choices=choices, value=selected),
        batch_rows,
        item_rows,
        downloads,
        f"Added **{batch_id}** with **{len(prompts)}** prompt(s). {status}",
    )


def cancel_selected_batch(
    batch_id: str | None,
    request: gr.Request,
) -> tuple[Any, list[list[Any]], list[list[Any]], str, str]:
    message = _MANAGER.cancel(_owner(request), str(batch_id or ""))
    batch_rows, choices, selected, item_rows, downloads, status = _MANAGER.snapshot(
        _owner(request), batch_id
    )
    return (
        gr.update(choices=choices, value=selected),
        batch_rows,
        item_rows,
        downloads,
        f"{message}\n\n{status}",
    )


def build_batch_view() -> None:
    """Render a persistent queue where batches can be added and cancelled independently."""
    gr.HTML(_BATCH_CSS)
    with gr.Column(elem_classes=["h3-batch-shell"]):
        gr.HTML(
            '<section class="h3-batch-hero">'
            '<div class="h3-batch-eyebrow">MiniMax H3 · Batch Studio</div>'
            '<h2>Keep adding batches while the GPU works.</h2>'
            '<p>Each submission becomes an independent batch with its own cancel state. '
            'Batches execute in order, one prompt at a time, through the existing '
            '<strong>/generate_video</strong> API and shared H3 GPU queue.</p>'
            '</section>'
        )

        with gr.Row(elem_classes=["h3-batch-layout"]):
            with gr.Column(scale=7, elem_classes=["h3-batch-composer"]):
                prompts = gr.Textbox(
                    label="New batch · scene prompts",
                    placeholder=(
                        "A train glides into a quiet Japanese station at sunset...\n"
                        "Two people pass each other beneath warm platform lights...\n"
                        "The empty tracks reflect the last orange light of the day..."
                    ),
                    lines=14,
                    max_lines=50,
                    info=f"One prompt per line · up to {MAX_BATCH_PROMPTS} prompts per batch",
                    elem_id="h3-batch-prompts",
                )

            with gr.Column(scale=3, elem_classes=["h3-batch-control-card"]):
                gr.HTML(
                    '<h3>Queue controls</h3>'
                    '<p><strong>Add batch</strong> returns immediately, so you can paste '
                    'another scene list while earlier work is still running. Cancel only '
                    'the selected batch; later batches continue automatically.</p>'
                    '<div class="h3-batch-pills">'
                    '<span class="h3-batch-pill">Persistent queue</span>'
                    '<span class="h3-batch-pill">Per-batch cancel</span>'
                    '<span class="h3-batch-pill">Single GPU lane</span>'
                    '</div>'
                )
                add_batch = gr.Button(
                    "Add batch to queue",
                    variant="primary",
                    elem_classes=["h3-batch-run"],
                )
                selected_batch = gr.Dropdown(
                    choices=[],
                    value=None,
                    label="Selected batch",
                    info="Choose the batch to inspect or cancel.",
                )
                cancel_batch = gr.Button(
                    "Cancel selected batch",
                    variant="secondary",
                    elem_classes=["h3-batch-cancel"],
                )
                status = gr.Markdown(
                    "Queue idle · add a batch when ready.",
                    elem_classes=["h3-batch-status"],
                )

        batch_table = gr.Dataframe(
            headers=["Batch", "Status", "Progress", "Current prompt"],
            datatype=["str", "str", "str", "str"],
            value=[],
            interactive=False,
            wrap=True,
            label="Batch queue",
            elem_classes=["h3-batch-list"],
        )
        item_table = gr.Dataframe(
            headers=["#", "Prompt", "Status", "Output URL"],
            datatype=["number", "str", "str", "str"],
            value=[],
            interactive=False,
            wrap=True,
            label="Selected batch",
            elem_classes=["h3-batch-results"],
        )
        downloads = gr.Markdown(elem_classes=["h3-batch-downloads"])

        add_batch.click(
            enqueue_prompt_batch,
            inputs=prompts,
            outputs=[
                prompts,
                selected_batch,
                batch_table,
                item_table,
                downloads,
                status,
            ],
            queue=False,
            show_progress="hidden",
            api_name="enqueue_prompt_batch",
        )

        cancel_batch.click(
            cancel_selected_batch,
            inputs=selected_batch,
            outputs=[
                selected_batch,
                batch_table,
                item_table,
                downloads,
                status,
            ],
            queue=False,
            show_progress="hidden",
            api_name=False,
        )

        selected_batch.input(
            _render_for_request,
            inputs=selected_batch,
            outputs=[
                selected_batch,
                batch_table,
                item_table,
                downloads,
                status,
            ],
            queue=False,
            show_progress="hidden",
            api_name=False,
        )

        timer = gr.Timer(1.0, active=True)
        timer.tick(
            _render_for_request,
            inputs=selected_batch,
            outputs=[
                selected_batch,
                batch_table,
                item_table,
                downloads,
                status,
            ],
            queue=False,
            show_progress="hidden",
            api_name=False,
        )
