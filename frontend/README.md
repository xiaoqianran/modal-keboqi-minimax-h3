# MiniMax H3 Studio

Standalone React/TypeScript frontend for this repository. It deliberately keeps the proven Python/Gradio/ComfyUI runtime intact and accesses it through a small transport adapter.

## Current vertical slice

- **Create**: submit the existing `/generate_video` generator, receive live queue/generation status, preview output, and request a real backend interrupt.
- **Batch**: add new prompt groups while earlier batches run, poll the existing persistent queue, inspect items, and cancel one batch without cancelling later batches.
- **System**: read backend diagnostics and link to fallback Gradio, ComfyUI and the API schema.
- **Gallery / LTX 2.5 / Music 3**: reserved in the final navigation shell; their existing backend functionality remains available in Gradio until each typed adapter is migrated.

## Development

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

For a remote Modal deployment, set `H3_BACKEND_URL` in `.env.local` to the deployed app URL. Vite proxies `/__h3` to that backend so local development does not require CORS changes.

```env
H3_BACKEND_URL=https://YOUR-MODAL-APP.modal.run
VITE_H3_BACKEND=/__h3
```

Open `http://127.0.0.1:5173`.

## Architecture

```text
React views
   ↓
frontend/src/api/h3Client.ts
   ↓
@gradio/client
   ↓
stable Studio JSON endpoints + existing /generate_video
   ↓
existing JobCoordinator / BatchQueueManager / generation functions
   ↓
ComfyUI → MiniMax H3
```

Only `h3Client.ts` knows the Gradio transport. Feature components consume typed domain functions, which keeps a future REST transport replacement local to one file.
