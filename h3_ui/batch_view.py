"""Focused batch-generation surface for MiniMax H3.

This view deliberately reuses the existing gradio_app generation entrypoint so
batch support does not fork or duplicate the ComfyUI/H3 runtime.  The legacy
single-generation UI remains available unchanged.
"""

from __future__ import annotations

import html
import threading
from typing import Any

import gradio as gr
import requests


MAX_BATCH_PROMPTS = 50
_CANCEL = threading.Event()

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
  max-width: 760px;
  margin: .55rem 0 0;
  color: var(--body-text-color-subdued);
  line-height: 1.65;
}
.h3-batch-layout { align-items: stretch !important; gap: 1rem !important; }
.h3-batch-composer,
.h3-batch-control-card,
.h3-batch-results {
  border: 1px solid var(--border-color-primary);
  border-radius: 18px;
  background: var(--batch-panel);
  box-shadow: 0 10px 30px rgba(0, 0, 0, .055);
}
.h3-batch-composer { padding: .85rem; }
.h3-batch-composer textarea {
  min-height: 360px !important;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace !important;
  line-height: 1.65 !important;
}
.h3-batch-control-card {
  min-width: 280px;
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
.h3-batch-stop button { min-height: 44px !important; border-radius: 12px !important; }
.h3-batch-status {
  min-height: 72px;
  padding: .72rem .8rem;
  border: 1px solid var(--border-color-primary);
  border-radius: 12px;
  background: var(--background-fill-primary);
}
.h3-batch-status p { margin: 0; }
.h3-batch-results { padding: .9rem; }
.h3-batch-results table { font-size: .86rem; }
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
  .h3-batch-composer textarea { min-height: 280px !important; }
}
</style>
"""


def _parse_prompts(raw: str) -> list[str]:
    prompts = [line.strip() for line in str(raw or "").splitlines() if line.strip()]
    if not prompts:
        raise gr.Error("Add at least one prompt. Use one prompt per line.")
    if len(prompts) > MAX_BATCH_PROMPTS:
        raise gr.Error(f"A batch can contain at most {MAX_BATCH_PROMPTS} prompts.")
    return prompts


def _compact_status(status: Any) -> str:
    text = str(status or "").strip()
    if not text:
        return "Running"
    first = text.splitlines()[0].strip()
    if len(first) > 110:
        first = first[:107].rstrip() + "..."
    return first


def _download_markdown(completed: list[tuple[int, str, str]]) -> str:
    if not completed:
        return ""
    lines = ["### Completed outputs"]
    for index, prompt, url in completed:
        safe_prompt = html.escape(prompt[:96] + ("…" if len(prompt) > 96 else ""))
        lines.append(f"- **#{index}** [{safe_prompt}]({url})")
    return "\n".join(lines)


def run_prompt_batch(
    prompts_text: str,
    request: gr.Request,
    progress=gr.Progress(track_tqdm=False),
):
    """Run distinct prompts serially through the existing H3 default path."""
    # Lazy import avoids an import cycle: layout -> batch_view while gradio_app
    # itself is still being imported.
    import gradio_app as legacy

    prompts = _parse_prompts(prompts_text)
    _CANCEL.clear()
    total = len(prompts)
    rows: list[list[Any]] = [
        [index + 1, prompt, "Queued", ""] for index, prompt in enumerate(prompts)
    ]
    completed: list[tuple[int, str, str]] = []

    yield rows, "", f"Queued **{total}** prompt{'s' if total != 1 else ''}."

    for index, prompt in enumerate(prompts):
        if _CANCEL.is_set():
            for waiting in range(index, total):
                if rows[waiting][2] == "Queued":
                    rows[waiting][2] = "Cancelled"
            yield rows, _download_markdown(completed), (
                f"Stopped after **{len(completed)}/{total}** completed outputs."
            )
            return

        rows[index][2] = "Starting"
        yield rows, _download_markdown(completed), (
            f"Running **{index + 1}/{total}** · GPU stays on the same serial H3 queue."
        )

        final_url: str | None = None
        final_status = ""
        try:
            for download_url, status in legacy.generate_with_ui_defaults(
                prompt,
                request,
                progress,
            ):
                if download_url:
                    final_url = str(download_url)
                final_status = str(status or "")
                rows[index][2] = _compact_status(status)
                yield rows, _download_markdown(completed), (
                    f"Running **{index + 1}/{total}** · {rows[index][2]}"
                )
                if _CANCEL.is_set():
                    break
        except Exception as exc:  # Keep the remaining batch usable after one failure.
            final_status = f"Error: {exc}"

        if _CANCEL.is_set():
            rows[index][2] = "Cancelled"
            continue

        if final_url:
            rows[index][2] = "Done"
            rows[index][3] = final_url
            completed.append((index + 1, prompt, final_url))
        else:
            rows[index][2] = (
                _compact_status(final_status)
                if str(final_status).strip()
                else "Failed: no output"
            )

        progress((index + 1, total), desc=f"Batch {index + 1}/{total}")
        yield rows, _download_markdown(completed), (
            f"Completed **{index + 1}/{total}** batch items · "
            f"**{len(completed)}** outputs ready."
        )

    yield rows, _download_markdown(completed), (
        f"Batch complete · **{len(completed)}/{total}** outputs generated. "
        "All files also appear in Gallery."
    )


def stop_prompt_batch() -> str:
    """Stop the active ComfyUI graph and prevent the next batch item from starting."""
    _CANCEL.set()
    try:
        import gradio_app as legacy

        requests.post(f"{legacy.COMFY_URL}/interrupt", json={}, timeout=5).raise_for_status()
        return "Stop requested. The active ComfyUI job is being interrupted."
    except Exception as exc:
        return f"Stop requested locally; backend interrupt returned: {exc}"


def build_batch_view() -> None:
    """Render and bind the batch studio inside the current Gradio application."""
    gr.HTML(_BATCH_CSS)
    with gr.Column(elem_classes=["h3-batch-shell"]):
        gr.HTML(
            '<section class="h3-batch-hero">'
            '<div class="h3-batch-eyebrow">MiniMax H3 · Batch Studio</div>'
            '<h2>Queue a whole scene list at once.</h2>'
            '<p>One line is one independent H3 prompt. Jobs run serially on the same '
            'GPU and reuse the existing default H3 generation path, so no ComfyUI '
            'workflow or model backend is duplicated.</p>'
            '</section>'
        )

        with gr.Row(elem_classes=["h3-batch-layout"]):
            with gr.Column(scale=7, elem_classes=["h3-batch-composer"]):
                prompts = gr.Textbox(
                    label="Scene prompts",
                    placeholder=(
                        "A train glides into a quiet Japanese station at sunset...\n"
                        "Two people pass each other beneath warm platform lights...\n"
                        "The empty tracks reflect the last orange light of the day..."
                    ),
                    lines=16,
                    max_lines=50,
                    info=f"One prompt per line · up to {MAX_BATCH_PROMPTS} prompts",
                    elem_id="h3-batch-prompts",
                )

            with gr.Column(scale=3, elem_classes=["h3-batch-control-card"]):
                gr.HTML(
                    '<h3>Batch behavior</h3>'
                    '<p>This surface intentionally uses the same defaults as the '
                    'existing <strong>/generate_video</strong> path. Each prompt '
                    'gets its own random seed.</p>'
                    '<div class="h3-batch-pills">'
                    '<span class="h3-batch-pill">Serial GPU queue</span>'
                    '<span class="h3-batch-pill">Random seed / scene</span>'
                    '<span class="h3-batch-pill">Same H3 workflow</span>'
                    '</div>'
                )
                run = gr.Button(
                    "Queue batch",
                    variant="primary",
                    elem_classes=["h3-batch-run"],
                )
                stop = gr.Button(
                    "Stop current batch",
                    variant="secondary",
                    elem_classes=["h3-batch-stop"],
                )
                status = gr.Markdown(
                    "Ready · paste one prompt per line.",
                    elem_classes=["h3-batch-status"],
                )

        table = gr.Dataframe(
            headers=["#", "Prompt", "Status", "Output URL"],
            datatype=["number", "str", "str", "str"],
            value=[],
            interactive=False,
            wrap=True,
            label="Batch queue",
            elem_classes=["h3-batch-results"],
        )
        downloads = gr.Markdown(elem_classes=["h3-batch-downloads"])

        event = run.click(
            run_prompt_batch,
            inputs=prompts,
            outputs=[table, downloads, status],
            concurrency_id="h3-gpu",
            concurrency_limit=1,
            show_progress="minimal",
            api_name="generate_prompt_batch",
        )
        stop.click(
            stop_prompt_batch,
            outputs=status,
            queue=False,
            show_progress="hidden",
            api_name=False,
        ).then(fn=None, cancels=[event], queue=False, api_name=False)
