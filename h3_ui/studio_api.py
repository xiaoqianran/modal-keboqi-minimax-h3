"""Stable JSON endpoints for the standalone H3 Studio frontend.

This module is intentionally thin. It exposes existing application services through
named Gradio API endpoints without duplicating the MiniMax H3 / ComfyUI runtime.
The React frontend talks only to these stable endpoints (plus the existing
``/generate_video`` generator) through its transport adapter.
"""

from __future__ import annotations

from typing import Any

import gradio as gr

from .batch_view import _MANAGER, _owner, _parse_prompts


def _batch_payload(owner: str, selected_batch_id: str | None = None) -> dict[str, Any]:
    batch_rows, _choices, selected, item_rows, _downloads, status = _MANAGER.snapshot(
        owner, selected_batch_id
    )
    return {
        "selected_batch_id": selected,
        "status": status,
        "batches": [
            {
                "id": str(row[0]),
                "status": str(row[1]),
                "progress": str(row[2]),
                "current_prompt": str(row[3] or ""),
            }
            for row in batch_rows
        ],
        "items": [
            {
                "index": int(row[0]),
                "prompt": str(row[1]),
                "status": str(row[2]),
                "output_url": str(row[3] or ""),
            }
            for row in item_rows
        ],
    }


def studio_batch_enqueue(prompts_text: str, request: gr.Request) -> dict[str, Any]:
    prompts = _parse_prompts(prompts_text)
    owner = _owner(request)
    batch_id = _MANAGER.enqueue(owner, prompts)
    payload = _batch_payload(owner, batch_id)
    payload["message"] = f"Added {batch_id} with {len(prompts)} prompt(s)."
    return payload


def studio_batch_snapshot(
    selected_batch_id: str | None, request: gr.Request
) -> dict[str, Any]:
    return _batch_payload(_owner(request), selected_batch_id)


def studio_batch_cancel(
    batch_id: str | None, request: gr.Request
) -> dict[str, Any]:
    owner = _owner(request)
    message = _MANAGER.cancel(owner, str(batch_id or ""))
    payload = _batch_payload(owner, batch_id)
    payload["message"] = message
    return payload


def studio_generate_cancel(request: gr.Request) -> dict[str, str]:
    # /generate_video is owned by the existing "api" job family.
    import gradio_app as legacy

    return {"message": str(legacy.interrupt(request, "api"))}


def studio_system_status() -> dict[str, Any]:
    # Lazy import avoids the layout -> studio_api -> gradio_app import cycle.
    import gradio_app as legacy

    detail = str(legacy.backend_status())
    return {
        "detail": detail,
        "comfyui_url": "/comfyui/",
        "api_schema_url": "/gradio_api/openapi.json",
    }


def build_studio_api() -> None:
    """Register hidden, stable endpoints consumed by the standalone frontend."""
    with gr.Group(visible=False):
        prompts = gr.Textbox()
        batch_id = gr.Textbox()
        payload = gr.JSON()

        gr.Button(visible=False).click(
            studio_batch_enqueue,
            inputs=prompts,
            outputs=payload,
            queue=False,
            show_progress="hidden",
            api_name="studio_batch_enqueue",
        )
        gr.Button(visible=False).click(
            studio_batch_snapshot,
            inputs=batch_id,
            outputs=payload,
            queue=False,
            show_progress="hidden",
            api_name="studio_batch_snapshot",
        )
        gr.Button(visible=False).click(
            studio_batch_cancel,
            inputs=batch_id,
            outputs=payload,
            queue=False,
            show_progress="hidden",
            api_name="studio_batch_cancel",
        )
        gr.Button(visible=False).click(
            studio_generate_cancel,
            outputs=payload,
            queue=False,
            show_progress="hidden",
            api_name="studio_generate_cancel",
        )
        gr.Button(visible=False).click(
            studio_system_status,
            outputs=payload,
            queue=False,
            show_progress="hidden",
            api_name="studio_system_status",
        )
