# Modal RTX PRO 6000 cold-start benchmark

## Goal

Use the same discipline as the GLM deployment: deploy once, wake a fresh GPU container, generate once to populate reusable runtime caches, stop only the GPU container, wake a second fresh container, compare startup traces, then stop the GPU again while keeping the deployment deployed.

## Architecture under test

```text
minimax-h3-data
└─ models / input / output / manifests

minimax-h3-runtime-cache
└─ <environment-fingerprint>/
   ├─ triton/
   ├─ torchinductor/
   ├─ cuda-compute/
   └─ torch-extensions/

cold start:
cache Volume seed -> /tmp/h3-runtime-cache -> ComfyUI/H3

runtime:
GPU job or direct ComfyUI execution complete
-> .runtime-cache-sync-needed
-> background incremental sync
-> cache Volume commit
```

Model startup uses a local ready marker plus preload-file validation. Remote Hugging Face metadata is refreshed only after the configured TTL (default 6 hours) or when the model-runtime revision changes.

## Control commands

Deploy or update:

```powershell
uv run --with modal modal deploy modal_h3.py
```

Wake the already deployed service:

```powershell
.\start-rtx6000.bat
```

Stop only RTX PRO 6000 containers while keeping the deployment:

```powershell
.\stop-rtx6000.bat
```

Run the complete cold-start/cache A/B benchmark:

```powershell
uv run --with modal --with gradio_client python benchmark-cold-start.py
```

It writes structured JSON plus first/second-run Modal logs under `logs/`.

Inspect recent startup/cache logs:

```powershell
uv run --with modal modal app logs minimax-h3 --timestamps --tail 1000
```

## Required A/B protocol

1. Deploy the current commit.
2. Stop any existing RTX PRO 6000 container.
3. Wake the endpoint and record the first cold-start time.
4. Call /generate_video once with a fixed prompt.
5. Wait for H3_CACHE_SYNC and H3_CACHE_COMMIT.
6. Stop the RTX PRO 6000 container.
7. Wake a second fresh container.
8. Compare H3_STARTUP_TRACE and H3_CACHE_STAGE against run 1.
9. Stop the RTX PRO 6000 container again.

The service trace contains container_entry, model validation/provision, runtime cache stage, ComfyUI spawn/ready, Gradio spawn/ready, cache sync startup, and service_ready.

## 2026-09-29 live execution attempt

Code validation before deployment:

- focused tests: 51/51 passed
- py_compile: passed
- modal_h3 import: passed
- git diff --check: passed

Modal profile on PC2: xiaotaiyangqaq.

Two deployment attempts were made with:

```powershell
uv run --with modal modal deploy modal_h3.py
```

Both failed before image build or GPU allocation with:

```text
Could not connect to the Modal server.
```

Direct PC2 connectivity to https://api.modal.com first timed out and later returned HTTP 503 Service Unavailable. PC1 also received HTTP 503 and has a different active Modal profile, so it was deliberately not used to deploy into another account.

Therefore no RTX PRO 6000 container was created, no GPU cost was incurred by these attempts, and no cold-start performance number is recorded yet. Do not treat this infrastructure failure as an H3 application failure.


