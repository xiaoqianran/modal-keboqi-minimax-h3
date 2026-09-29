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
uv run --with "modal[api-proxy-support]" modal deploy modal_h3.py
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
uv run --with "modal[api-proxy-support]" --with gradio_client python benchmark-cold-start.py
```

It writes structured JSON plus first/second-run Modal logs under `logs/`.

Inspect recent startup/cache logs:

```powershell
uv run --with "modal[api-proxy-support]" modal app logs minimax-h3 --timestamps --tail 1000
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

## 2026-09-30 live validation

### Control-plane fix

PC2/4060 could reach normal HTTPS endpoints, but direct Modal HTTP/2/gRPC RPCs were unstable. The host already runs Clash Verge / mihomo on `127.0.0.1:7890`. Modal 1.6.0 supports standard proxy environment variables when the optional API proxy dependency is installed, so deployment and control commands now use:

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7890'
$env:HTTP_PROXY='http://127.0.0.1:7890'
$env:ALL_PROXY='http://127.0.0.1:7890'
$env:NO_PROXY='127.0.0.1,localhost,.modal.run'
uv run --with "modal[api-proxy-support]" modal ...
```

The existing Modal secret `huggingface` is reused through `H3_MODAL_HF_SECRET=huggingface`; secret contents were not read. Windows CLI output is forced to UTF-8 to avoid GBK failures on Unicode build progress output.

### Model provision

`provision_models` completed on CPU before the GPU benchmark. All eight preload H3 model files were already up to date, so the benchmarked GPU cold starts did not perform model downloads or remote Hugging Face metadata work.

### Valid fresh-container A/B result

The corrected benchmark is `logs/h3-20260930-011448.json` locally. `logs/` is intentionally gitignored. The first runtime container was stopped before the second wake, and the second fresh container was also stopped after measurement.

| Metric | Cold #1 | Cold #2 |
| --- | ---: | ---: |
| External wake to HTTP response | **27.748 s** | **29.481 s** |
| Fast model validation complete | 0.024 s | 0.025 s |
| Runtime cache stage complete | 0.052 s | 0.054 s |
| ComfyUI ready | **20.088 s** | **20.099 s** |
| Gradio ready | 24.268 s | —* |
| Internal service ready | **24.303 s** | **26.310 s** |

`*` The second `gradio_ready` line was not present in the bounded log query used by the parser, but `service_ready` was recorded at 26.310 s.

Fixed-prompt H3 generation on cold #1:

- client-observed request: **51.051 s**
- H3 internal total: **46.58 s**
- ComfyUI prompt execution: **43.39 s**
- preparing request: 2.4 s
- model loading: about 3.5 s
- Qwen prompt/conditioning encode: 6.2 s
- H3 generation stages: 21.9 s combined
- decode: 6.6 s combined
- latent 2x upscale: 2.7 s
- NVENC save: 2.7 s
- reported compute per output second: 9.3 s

### Runtime-cache finding

After a complete H3 generation the cache state remained:

```text
runtime-cache.tar
files=62
bytes=2245362
archive_bytes=2385920
changed=false
```

The second fresh cold start was not faster than the first. Therefore this benchmark does **not** demonstrate a cold-start benefit from the currently persisted Triton / TorchInductor / CUDA / Torch Extensions cache set. Cache staging itself costs only about 0.03 s and is not a meaningful startup bottleneck.

### Benchmark harness correction

An earlier preliminary run produced an apparent `cold_2 = 0.924 s`. That number is invalid: the first version of the stop helper failed to classify and stop the live H3 container, so the second request reused the warm container. The stop logic was replaced with app-scoped container termination and the benchmark was rerun from two proven fresh containers. Only the A/B numbers above are valid.

### Current bottleneck

The startup budget is dominated by:

```text
container entry
  -> model validation + cache stage      ~0.05 s
  -> ComfyUI startup                     ~20.0 s
  -> Gradio/UI + proxy readiness         ~4.2-6.2 s
  -> service ready                       ~24.3-26.3 s
```

Custom-node import timing consistently includes approximately:

- `ComfyUI-LTXVideo`: 3.0-3.3 s
- `minimax-h3-audio-T8`: 1.4 s
- `comfyui_controlnet_aux`: 0.7-1.1 s

Each fresh container also recreates the ComfyUI asset SQLite schema and generates a new matplotlib font manager cache.

### Next optimization stage

Do not spend further effort micro-optimizing model validation or cache staging. The next phase should target the ~20 s ComfyUI boot path and the ~4-6 s Gradio/UI startup path: defer non-H3-heavy custom-node imports where possible, avoid repeated ephemeral DB/font initialization, and then rerun the same fresh-container benchmark.
