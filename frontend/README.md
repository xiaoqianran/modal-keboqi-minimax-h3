# MiniMax H3 Studio

Standalone React frontend for this repository. It keeps the existing Gradio application as the runtime host and fallback/debug surface while providing a dedicated browser UI for day-to-day H3 work.

## Architecture

```text
React + TypeScript + Vite
        |
        v
frontend/src/api/*
        |
        v
existing Gradio named APIs + h3_ui/studio_api.py
        |
        v
existing JobCoordinator / BatchQueueManager / generation
        |
        v
ComfyUI -> MiniMax H3 / LTX 2.5 / Music 3
```

The Studio does not introduce a second generation runtime, GPU queue, database, or independent FastAPI service.

## Local development against Modal

Copy the environment example:

```powershell
Copy-Item .env.example .env.local
```

Set the deployed backend URL in `.env.local`:

```text
H3_BACKEND_URL=https://YOUR-MODAL-URL
VITE_H3_BACKEND=/__h3
```

Then:

```powershell
npm install
npm run dev
```

Vite serves the frontend on `http://localhost:5173` and proxies `/__h3` to the configured backend. UI development therefore does not require redeploying the Modal GPU container.

## Production checks

```powershell
npm run typecheck
npm run build
```

GitHub Actions runs Python Studio API syntax checks, dependency installation, TypeScript typechecking, and the Vite production build on every frontend change.

## Surfaces

- **Create** — full H3 advanced generation, three conditioning modes, Video/Image/Audio results, prompt writer, reference media, FL2VA voice inputs, performance/cache/attention controls, latent/final upscale, SeedVR2 input upscale, image-frame selection and saving, and safe cancellation.
- **Batch** — persistent multi-batch queue with continued submission, inspection, per-batch cancellation, and shared single-GPU execution.
- **Gallery** — managed output browser, preview/download, provenance, local video import, delete/empty actions, interpolation/SeedVR2/LTX post-processing, and independent cancellation.
- **LTX 2.5** — T2V/I2V generation, start/middle/end keyframes, Gemini prompt writer, model inventory and official workflow model preparation.
- **Music 3** — generation, lyrics/caption controls, Gemini prompt writer with reference images, preview/download, and cancellation.
- **System** — backend diagnostics, Gradio/ComfyUI/API links, model unload/free-VRAM action, and TensorRT VAE compilation.

Gradio remains available as a fallback and debugging surface; both UIs operate on the same backend state and generated assets.
