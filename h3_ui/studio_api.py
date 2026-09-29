"""Stable JSON endpoints for the standalone H3 Studio frontend.

This module is intentionally thin. It exposes existing application services through
named Gradio API endpoints without duplicating the MiniMax H3 / ComfyUI runtime.
The React frontend talks only to these stable endpoints (plus existing generation
endpoints) through its transport adapter.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

import gradio as gr

from .batch_view import _MANAGER, _owner, _parse_prompts
from .job_bindings import owned_generation


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


def _relative_app_url(url: str) -> str:
    """Return a same-app URL so the Vite dev proxy can keep one origin."""
    parsed = urlsplit(str(url or ""))
    if not parsed.scheme and not parsed.netloc:
        return str(url or "")
    return urlunsplit(("", "", parsed.path or "/", parsed.query, parsed.fragment))


def _update_value(value: Any) -> Any:
    if isinstance(value, dict):
        return value.get("value")
    return value


def _gallery_payload(request: gr.Request, *, message: str = "") -> dict[str, Any]:
    import gradio_app as legacy

    items: list[dict[str, Any]] = []
    for video in legacy.gallery_video_paths():
        try:
            stat = video.stat()
        except OSError:
            continue
        snapshot = legacy.read_snapshot(video)
        items.append(
            {
                "path": str(video),
                "name": video.name,
                "preview_url": _relative_app_url(
                    legacy.absolute_video_url(video, request, download=False)
                ),
                "download_url": _relative_app_url(
                    legacy.absolute_video_url(video, request, download=True)
                ),
                "size_bytes": int(stat.st_size),
                "modified_at": float(stat.st_mtime),
                "snapshot": snapshot,
            }
        )
    return {"message": message, "count": len(items), "items": items}


def studio_catalog() -> dict[str, Any]:
    """Return stable choice/default data needed by non-Gradio views."""
    import gradio_app as legacy

    h3_defaults = {
        **dict(legacy.UI_DEFAULTS),
        "batch_count": legacy.DEFAULT_VIDEO_BATCH_COUNT,
        "sol_step_off": 0.0,
        "sol_sink_tokens": 0,
        "upscale_resolution": legacy.DEFAULT_UPSCALE_RESOLUTION,
        "ltx25_model": legacy.DEFAULT_LTX25_MODEL,
    }
    return {
        "h3": {
            "defaults": h3_defaults,
            "choices": {
                "modes": ["Text to video", "First / last frame", "Reference media"],
                "result_formats": list(legacy.RESULT_FORMATS),
                "model_profiles": list(legacy.MODEL_PROFILE_CHOICES),
                "text_encoders": list(legacy.H3_TEXT_ENCODER_CHOICES),
                "image_vaes": list(legacy.IMAGE_VAE_CHOICES),
                "generation_modes": ["Normal", "Turbo"],
                "turbo_variants": list(legacy.TURBO_SETTINGS),
                "schedulers": ["simple", "beta", "normal"],
                "attention_modes": ["Sage 2", "Kitchen", "SLA", "Sol-Attn", "Auto"],
                "sla_presets": list(legacy.SLA_PRESET_INPUTS),
                "sol_thresholds": ["diag", "exact"],
                "sol_exact_modes": ["off", "exact_kv", "exact_kv_and_rows"],
                "cache_modes": ["Spectrum", "FirstBlockCache", "EasyCache", "Off"],
                "fbcache_presets": ["Safe", "Fast", "Aggressive", "Custom"],
                "reference_sizes": ["match", "max"],
                "latent_upscalers": list(legacy.H3_LATENT_UPSCALER_MODEL_CHOICES),
                "latent_upscale_methods": list(legacy.H3_LATENT_UPSCALE_METHODS),
                "seam_polish": ["off", "auto", "all"],
                "postprocess": list(legacy.GENERATION_POSTPROCESS_OPTIONS),
                "upscale_resolutions": list(legacy.UPSCALE_RESOLUTION_PRESETS),
                "seedvr2_models": list(legacy.SEEDVR2_MODEL_CHOICES),
                "ltx25_models": list(legacy.LTX25_MODEL_CHOICES),
            },
            "resolutions": {
                "draft": {name: list(size) for name, size in legacy.DRAFT_RESOLUTIONS.items()},
                "fast": {name: list(size) for name, size in legacy.FAST_RESOLUTIONS.items()},
                "large": {name: list(size) for name, size in legacy.LARGE_RESOLUTIONS.items()},
            },
            "prompt_writer": {
                "backends": list(legacy.PROMPT_WRITER_BACKENDS),
                "default_backend": legacy.DEFAULT_PROMPT_WRITER_BACKEND,
                "local_models": list(legacy.LOCAL_PROMPT_BASE_MODELS),
                "default_local_model": legacy.DEFAULT_LOCAL_PROMPT_BASE_MODEL,
                "gemini_models": list(legacy.GEMINI_PROMPT_MODELS),
                "default_gemini_model": legacy.DEFAULT_GEMINI_PROMPT_MODEL,
                "lightning_model": legacy.LIGHTNING_PROMPT_MODEL,
            },
            "input_upscale": {
                "slots": list(legacy.INPUT_IMAGE_UPSCALE_SLOTS),
                "frame_presets": {
                    name: list(size) if size is not None else None
                    for name, size in legacy.INPUT_IMAGE_FRAME_PRESETS.items()
                },
                "default_frame_preset": legacy.DEFAULT_INPUT_IMAGE_FRAME_PRESET,
            },
        },
        "gallery": {
            "postprocess_options": list(legacy.POSTPROCESS_OPTIONS),
            "ai_postprocess_options": list(legacy.AI_POSTPROCESS_OPTIONS),
            "seedvr2_option": legacy.SEEDVR2_UPSCALE,
            "ltx25_option": legacy.LTX25_UPSCALE,
            "default_upscale_resolution": legacy.DEFAULT_UPSCALE_RESOLUTION,
            "default_seedvr2_model": legacy.DEFAULT_SEEDVR2_MODEL,
            "default_ltx25_model": legacy.DEFAULT_LTX25_MODEL,
            "upscale_resolutions": list(legacy.UPSCALE_RESOLUTION_PRESETS),
            "seedvr2_models": list(legacy.SEEDVR2_MODEL_CHOICES),
            "ltx25_models": list(legacy.LTX25_MODEL_CHOICES),
        },
        "music3": {
            "models": list(legacy.MUSIC3_MODEL_CHOICES),
            "defaults": dict(legacy.MUSIC3_DEFAULTS),
            "prompt_models": list(legacy.GEMINI_PROMPT_MODELS),
            "default_prompt_model": legacy.DEFAULT_GEMINI_PROMPT_MODEL,
        },
        "ltx25": {
            "models": list(legacy.LTX25_MODEL_CHOICES),
            "defaults": dict(legacy.LTX25_DEFAULTS),
            "prompt_models": list(legacy.GEMINI_PROMPT_MODELS),
            "default_prompt_model": legacy.DEFAULT_GEMINI_PROMPT_MODEL,
            "workflows": [
                {
                    "name": name,
                    "id": entry["id"],
                    "description": entry["description"],
                    "inputs": entry["inputs"],
                    "audio_only": bool(entry.get("audio_only", False)),
                }
                for name, entry in legacy.LTX25_WORKFLOWS.items()
            ],
        },
    }


def studio_batch_enqueue(prompts_text: str, request: gr.Request) -> dict[str, Any]:
    prompts = _parse_prompts(prompts_text)
    owner = _owner(request)
    batch_id = _MANAGER.enqueue(owner, prompts)
    payload = _batch_payload(owner, batch_id)
    payload["message"] = f"Added {batch_id} with {len(prompts)} prompt(s)."
    return payload


def studio_batch_snapshot(selected_batch_id: str | None, request: gr.Request) -> dict[str, Any]:
    return _batch_payload(_owner(request), selected_batch_id)


def studio_batch_cancel(batch_id: str | None, request: gr.Request) -> dict[str, Any]:
    owner = _owner(request)
    message = _MANAGER.cancel(owner, str(batch_id or ""))
    payload = _batch_payload(owner, batch_id)
    payload["message"] = message
    return payload


def _cancel_family(request: gr.Request, family: str) -> dict[str, str]:
    import gradio_app as legacy
    return {"message": str(legacy.interrupt(request, family))}


def studio_generate_cancel(request: gr.Request) -> dict[str, str]:
    return _cancel_family(request, "api")


def studio_h3_cancel(request: gr.Request) -> dict[str, str]:
    return _cancel_family(request, "h3")


def studio_h3_input_cancel(request: gr.Request) -> dict[str, str]:
    return _cancel_family(request, "h3-input")


def studio_ltx_cancel(request: gr.Request) -> dict[str, str]:
    return _cancel_family(request, "ltx")


def studio_music_cancel(request: gr.Request) -> dict[str, str]:
    return _cancel_family(request, "music")


def studio_gallery_cancel(request: gr.Request) -> dict[str, str]:
    return _cancel_family(request, "gallery")


def studio_gallery_list(request: gr.Request) -> dict[str, Any]:
    return _gallery_payload(request)


def studio_gallery_delete(selected_video: str, request: gr.Request) -> dict[str, Any]:
    import gradio_app as legacy
    result = legacy.delete_selected_gallery_video(selected_video, True)
    message = str(result[2]) if len(result) > 2 else "Output deleted."
    return _gallery_payload(request, message=message)


def studio_gallery_empty(request: gr.Request) -> dict[str, Any]:
    import gradio_app as legacy
    result = legacy.empty_generated_gallery(None, True)
    message = str(result[2]) if len(result) > 2 else "Gallery emptied."
    return _gallery_payload(request, message=message)


def studio_gallery_import(uploaded_video: str | None, request: gr.Request) -> dict[str, Any]:
    import gradio_app as legacy
    result = legacy.import_gallery_video(uploaded_video)
    message = str(result[2]) if len(result) > 2 else "Video imported."
    return _gallery_payload(request, message=message)


def studio_gallery_postprocess(
    selected_video: str,
    option: str,
    seed: int,
    seedvr2_model: str,
    ltx25_model: str,
    ltx25_prompt: str,
    force_offload: bool,
    split_upscale: bool,
    split_seconds: float,
    upscale_resolution: str,
    request: gr.Request,
    progress=gr.Progress(track_tqdm=False),
):
    import gradio_app as legacy
    updates = legacy.postprocess_selected_gallery_video(
        selected_video, option, seed, seedvr2_model, ltx25_model, ltx25_prompt,
        force_offload, split_upscale, split_seconds, upscale_resolution, request, progress,
    )
    for update in updates:
        values = tuple(update) if isinstance(update, (tuple, list)) else (update,)
        selected = _update_value(values[5]) if len(values) > 5 else None
        status = values[-1] if values else ""
        yield {"status": str(status or ""), "selected_path": str(selected or "")}


def studio_ltx_inventory() -> dict[str, str]:
    import gradio_app as legacy
    return {"inventory": str(legacy.render_ltx25_official_model_inventory())}


def studio_ltx_prepare_workflow(workflow_name: str) -> dict[str, str]:
    import gradio_app as legacy
    status, inventory = legacy.prepare_ltx25_official_workflow(workflow_name)
    return {"status": str(status), "inventory": str(inventory)}


def studio_ltx_prepare_all() -> dict[str, str]:
    import gradio_app as legacy
    status, inventory = legacy.prepare_all_ltx25_official_models()
    return {"status": str(status), "inventory": str(inventory)}


def studio_unload_models() -> dict[str, str]:
    import gradio_app as legacy
    message, detail = legacy.unload_all_models()
    return {"message": str(message), "detail": str(detail)}


def studio_compile_trt_vae() -> dict[str, str]:
    import gradio_app as legacy
    return {"message": str(legacy.compile_trt_video_vae())}


def studio_system_status() -> dict[str, Any]:
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
        gallery_video = gr.Textbox()
        gallery_upload = gr.Video()
        gallery_option = gr.Textbox()
        gallery_seed = gr.Number()
        gallery_seedvr2_model = gr.Textbox()
        gallery_ltx25_model = gr.Textbox()
        gallery_ltx25_prompt = gr.Textbox()
        gallery_force_offload = gr.Checkbox()
        gallery_split_upscale = gr.Checkbox()
        gallery_split_seconds = gr.Number()
        gallery_upscale_resolution = gr.Textbox()
        workflow_name = gr.Textbox()
        payload = gr.JSON()

        gr.Button(visible=False).click(studio_catalog, outputs=payload, queue=False, show_progress="hidden", api_name="studio_catalog")
        gr.Button(visible=False).click(studio_batch_enqueue, inputs=prompts, outputs=payload, queue=False, show_progress="hidden", api_name="studio_batch_enqueue")
        gr.Button(visible=False).click(studio_batch_snapshot, inputs=batch_id, outputs=payload, queue=False, show_progress="hidden", api_name="studio_batch_snapshot")
        gr.Button(visible=False).click(studio_batch_cancel, inputs=batch_id, outputs=payload, queue=False, show_progress="hidden", api_name="studio_batch_cancel")
        gr.Button(visible=False).click(studio_generate_cancel, outputs=payload, queue=False, show_progress="hidden", api_name="studio_generate_cancel")
        gr.Button(visible=False).click(studio_h3_cancel, outputs=payload, queue=False, show_progress="hidden", api_name="studio_h3_cancel")
        gr.Button(visible=False).click(studio_h3_input_cancel, outputs=payload, queue=False, show_progress="hidden", api_name="studio_h3_input_cancel")
        gr.Button(visible=False).click(studio_ltx_cancel, outputs=payload, queue=False, show_progress="hidden", api_name="studio_ltx_cancel")
        gr.Button(visible=False).click(studio_music_cancel, outputs=payload, queue=False, show_progress="hidden", api_name="studio_music_cancel")
        gr.Button(visible=False).click(studio_gallery_cancel, outputs=payload, queue=False, show_progress="hidden", api_name="studio_gallery_cancel")
        gr.Button(visible=False).click(studio_gallery_list, outputs=payload, queue=False, show_progress="hidden", api_name="studio_gallery_list")
        gr.Button(visible=False).click(studio_gallery_delete, inputs=gallery_video, outputs=payload, queue=False, show_progress="hidden", api_name="studio_gallery_delete")
        gr.Button(visible=False).click(studio_gallery_empty, outputs=payload, queue=False, show_progress="hidden", api_name="studio_gallery_empty")
        gr.Button(visible=False).click(studio_gallery_import, inputs=gallery_upload, outputs=payload, concurrency_id="h3-gpu", concurrency_limit=1, show_progress="minimal", api_name="studio_gallery_import")
        gr.Button(visible=False).click(
            owned_generation(studio_gallery_postprocess, "gallery"),
            inputs=[gallery_video, gallery_option, gallery_seed, gallery_seedvr2_model,
                    gallery_ltx25_model, gallery_ltx25_prompt, gallery_force_offload,
                    gallery_split_upscale, gallery_split_seconds, gallery_upscale_resolution],
            outputs=payload, concurrency_id="h3-gpu", concurrency_limit=1,
            show_progress="minimal", api_name="studio_gallery_postprocess",
        )
        gr.Button(visible=False).click(studio_ltx_inventory, outputs=payload, queue=False, show_progress="hidden", api_name="studio_ltx_inventory")
        gr.Button(visible=False).click(studio_ltx_prepare_workflow, inputs=workflow_name, outputs=payload, concurrency_id="h3-gpu", concurrency_limit=1, show_progress="minimal", api_name="studio_ltx_prepare_workflow")
        gr.Button(visible=False).click(studio_ltx_prepare_all, outputs=payload, concurrency_id="h3-gpu", concurrency_limit=1, show_progress="minimal", api_name="studio_ltx_prepare_all")
        gr.Button(visible=False).click(studio_unload_models, outputs=payload, concurrency_id="h3-gpu", concurrency_limit=1, show_progress="minimal", api_name="studio_unload_models")
        gr.Button(visible=False).click(studio_compile_trt_vae, outputs=payload, concurrency_id="h3-gpu", concurrency_limit=1, show_progress="minimal", api_name="studio_compile_trt_vae")
        gr.Button(visible=False).click(studio_system_status, outputs=payload, queue=False, show_progress="hidden", api_name="studio_system_status")
