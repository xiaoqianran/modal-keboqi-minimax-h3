import { Client, handle_file } from "@gradio/client";

import type {
  BatchSnapshot,
  GallerySnapshot,
  GenerateUpdate,
  H3AdvancedRequest,
  H3GenerateUpdate,
  H3PromptEnhanceRequest,
  H3PromptEnhanceResult,
  Ltx25Request,
  LtxInventory,
  LtxPreparation,
  Music3Request,
  StudioCatalog,
  SystemStatus,
} from "./types";

const configuredSource = import.meta.env.VITE_H3_BACKEND || "/__h3";
const source = new URL(configuredSource, window.location.origin).toString();

let clientPromise: ReturnType<typeof Client.connect> | null = null;

function getClient() {
  if (!clientPromise) {
    clientPromise = Client.connect(source, { events: ["data", "status"] });
  }
  return clientPromise;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function parseJsonResult<T>(result: unknown): T {
  const data = (result as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error("The H3 backend returned an empty API response.");
  }
  return data[0] as T;
}

export function backendSource(): string {
  return source;
}

export function backendUrl(path: string): string {
  const raw = String(path || "").trim();
  if (!raw) return source;
  if (/^https?:\/\//i.test(raw)) return raw;

  const base = new URL(source);
  const prefix = base.pathname.replace(/\/$/, "");
  const suffix = raw.startsWith("/") ? raw : `/${raw}`;
  return new URL(`${prefix}${suffix}`, base.origin).toString();
}

function normalizeOutputUrl(value: unknown): string {
  if (typeof value === "string") {
    const raw = value.trim();
    if (!raw) return "";
    if (/^https?:\/\//i.test(raw) || raw.startsWith("/downloads/") || raw.startsWith("/gradio_api/")) {
      return backendUrl(raw);
    }
    return "";
  }
  if (value && typeof value === "object") {
    const file = value as Record<string, unknown>;
    const url = typeof file.url === "string" ? file.url : "";
    if (url) return backendUrl(url);
    const downloadUrl = typeof file.download_url === "string" ? file.download_url : "";
    if (downloadUrl) return backendUrl(downloadUrl);
    const path = typeof file.path === "string" ? file.path : "";
    if (/^https?:\/\//i.test(path) || path.startsWith("/gradio_api/")) {
      return backendUrl(path);
    }
  }
  return "";
}

function collectMediaUrls(value: unknown, target: string[] = []): string[] {
  const direct = normalizeOutputUrl(value);
  if (direct) {
    if (!target.includes(direct)) target.push(direct);
    return target;
  }
  if (Array.isArray(value)) {
    for (const child of value) collectMediaUrls(child, target);
    return target;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["value", "data", "files"]) {
      if (key in record) collectMediaUrls(record[key], target);
    }
  }
  return target;
}

function fileInput(file: File | null | undefined) {
  return file ? handle_file(file) : null;
}

function at<T>(values: Array<T | null>, index: number): T | null {
  return values[index] ?? null;
}

function normalizeGallery(snapshot: GallerySnapshot): GallerySnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map((item) => ({
      ...item,
      preview_url: item.preview_url ? backendUrl(item.preview_url) : "",
      download_url: item.download_url ? backendUrl(item.download_url) : "",
    })),
  };
}

function statusFields(message: unknown) {
  const status = message as {
    stage?: string;
    position?: number;
    size?: number;
    queue_size?: number;
    message?: string;
    progress_data?: Array<{ desc?: string | null }>;
  };
  const desc = status.progress_data?.at(-1)?.desc || status.message;
  return {
    status: desc || status.stage || "Working",
    stage: status.stage,
    queuePosition: status.position,
    queueSize: status.size ?? status.queue_size,
  };
}

function statusUpdate(message: unknown, latest: GenerateUpdate): GenerateUpdate {
  return { ...latest, ...statusFields(message) };
}

async function consumeMediaSubmission(
  submission: ReturnType<Awaited<ReturnType<typeof getClient>>["submit"]>,
  onUpdate: (update: GenerateUpdate) => void,
  signal?: AbortSignal,
): Promise<GenerateUpdate> {
  let latest: GenerateUpdate = { outputUrl: "", status: "Submitting" };
  const abort = () => submission.cancel();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    for await (const message of submission) {
      if (message.type === "status") {
        latest = statusUpdate(message, latest);
        onUpdate(latest);
        continue;
      }
      if (message.type === "data") {
        const data = (message as unknown as { data?: unknown[] }).data ?? [];
        const outputUrl = normalizeOutputUrl(data[0]);
        const status = asString(data[1]) || latest.status;
        latest = { ...latest, outputUrl: outputUrl || latest.outputUrl, status };
        onUpdate(latest);
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }

  return latest;
}

export async function studioCatalog(): Promise<StudioCatalog> {
  const client = await getClient();
  return parseJsonResult<StudioCatalog>(await client.predict("/studio_catalog", []));
}

export async function generateDefaultVideo(
  prompt: string,
  onUpdate: (update: GenerateUpdate) => void,
  signal?: AbortSignal,
): Promise<GenerateUpdate> {
  const client = await getClient();
  return consumeMediaSubmission(
    client.submit("/generate_video", [prompt]),
    onUpdate,
    signal,
  );
}

export async function generateH3Advanced(
  request: H3AdvancedRequest,
  onUpdate: (update: H3GenerateUpdate) => void,
  signal?: AbortSignal,
): Promise<H3GenerateUpdate> {
  const client = await getClient();
  const refsImage = request.referenceImages;
  const refsVideo = request.referenceVideos;
  const refsAudio = request.referenceAudios;
  const voices = request.fl2vaAudios;

  const payload: Record<string, unknown> = {
    batch_count: request.resultFormat === "Video" ? request.batchCount : 1,
    mode: request.mode,
    model_profile: request.modelProfile,
    text_encoder: request.textEncoder,
    stage_model_offload: request.stageModelOffload,
    generation_mode: request.generationMode,
    turbo_variant: request.turboVariant,
    prompt: request.prompt,
    first_image: fileInput(request.firstImage),
    last_image: fileInput(request.lastImage),
    ref_image_1: fileInput(at(refsImage, 0)),
    ref_image_2: fileInput(at(refsImage, 1)),
    ref_image_3: fileInput(at(refsImage, 2)),
    ref_image_4: fileInput(at(refsImage, 3)),
    ref_image_5: fileInput(at(refsImage, 4)),
    ref_image_6: fileInput(at(refsImage, 5)),
    ref_image_7: fileInput(at(refsImage, 6)),
    ref_image_8: fileInput(at(refsImage, 7)),
    ref_image_9: fileInput(at(refsImage, 8)),
    ref_video_1: fileInput(at(refsVideo, 0)),
    ref_video_2: fileInput(at(refsVideo, 1)),
    ref_video_3: fileInput(at(refsVideo, 2)),
    ref_audio_1: fileInput(at(refsAudio, 0)),
    ref_audio_2: fileInput(at(refsAudio, 1)),
    ref_audio_3: fileInput(at(refsAudio, 2)),
    duration: request.duration,
    width: request.width,
    height: request.height,
    steps: request.steps,
    scheduler: request.scheduler,
    seed: request.seed,
    attention_mode: request.attentionMode,
    sla_preset: request.slaPreset,
    sol_tau: request.solTau,
    sol_thresh_type: request.solThreshType,
    sol_exact_mode: request.solExactMode,
    sol_dense_steps: request.solDenseSteps,
    sol_step_off: request.solStepOff,
    sol_sink_tokens: request.solSinkTokens,
    cache_mode: request.cacheMode,
    fbcache_preset: request.fbcachePreset,
    fbcache_threshold: request.fbcacheThreshold,
    fbcache_start: request.fbcacheStart,
    fbcache_end: request.fbcacheEnd,
    fbcache_max_hits: request.fbcacheMaxHits,
    fbcache_temporal_guard: request.fbcacheTemporalGuard,
    easycache_threshold: request.easycacheThreshold,
    easycache_start: request.easycacheStart,
    easycache_end: request.easycacheEnd,
    easycache_verbose: request.easycacheVerbose,
    ref_image_size: request.refImageSize,
    postprocess: request.postprocess,
    reuse_unchanged_inputs: request.reuseUnchangedInputs,
    latent_upscale: request.latentUpscale,
    latent_upscaler_model: request.latentUpscalerModel,
    latent_upscale_refine_steps: request.latentUpscaleRefineSteps,
    latent_upscale_method: request.latentUpscaleMethod,
    latent_split_tile_width: request.latentSplitTileWidth,
    latent_split_tile_height: request.latentSplitTileHeight,
    latent_split_overlap_ratio: request.latentSplitOverlapRatio,
    latent_split_fade_ratio: request.latentSplitFadeRatio,
    latent_split_chunk_frames: request.latentSplitChunkFrames,
    latent_split_temporal_overlap_frames: request.latentSplitTemporalOverlapFrames,
    latent_split_seam_denoise: request.latentSplitSeamDenoise,
    latent_split_seam_polish: request.latentSplitSeamPolish,
    upscale_force_offload: request.upscaleForceOffload,
    upscale_split_enabled: request.upscaleSplitEnabled,
    upscale_split_seconds: request.upscaleSplitSeconds,
    upscale_resolution: request.upscaleResolution,
    seedvr2_model: request.seedvr2Model,
    ltx25_model: request.ltx25Model,
    use_int8_vae: request.useInt8Vae,
    use_trt_vae: request.useTrtVae,
    image_vae: request.imageVae,
    result_format: request.resultFormat,
    image_frames: request.imageFrames,
    semantic_bridge: request.semanticBridge,
    semantic_bridge_alpha: request.semanticBridgeAlpha,
    fl2va_audio_1: fileInput(at(voices, 0)),
    fl2va_audio_2: fileInput(at(voices, 1)),
    fl2va_audio_3: fileInput(at(voices, 2)),
  };

  const submission = client.submit("/generate_video_advanced", payload);
  let latest: H3GenerateUpdate = {
    videos: [], images: [], audioUrl: "", status: "Submitting",
  };
  const abort = () => submission.cancel();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    for await (const message of submission) {
      if (message.type === "status") {
        latest = { ...latest, ...statusFields(message) };
        onUpdate(latest);
        continue;
      }
      if (message.type !== "data") continue;

      const data = (message as unknown as { data?: unknown[] }).data ?? [];
      const status = asString(data[11]) || latest.status;
      const videos = [...latest.videos];
      for (const value of data.slice(0, 4)) {
        for (const url of collectMediaUrls(value)) {
          if (!videos.includes(url)) videos.push(url);
        }
      }
      const images = collectMediaUrls(data[5], [...latest.images]);
      const audioUrl = collectMediaUrls(data[9])[0] || latest.audioUrl;
      latest = { ...latest, videos, images, audioUrl, status };
      onUpdate(latest);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
  }

  return latest;
}

export async function enhanceH3Prompt(request: H3PromptEnhanceRequest): Promise<H3PromptEnhanceResult> {
  const client = await getClient();
  const generation = request.generation;
  const images = generation.referenceImages;
  const videos = generation.referenceVideos;
  const audios = generation.referenceAudios;
  const voices = generation.fl2vaAudios;
  const result = await client.predict("/enhance_prompt", {
    prompt: generation.prompt,
    backend: request.backend,
    local_base_model: request.localBaseModel,
    local_max_new_tokens: request.localMaxNewTokens,
    local_temperature: request.localTemperature,
    local_top_p: request.localTopP,
    local_greedy: request.localGreedy,
    local_seed: request.localSeed,
    gemini_model: request.geminiModel,
    gemini_api_key: request.geminiApiKey,
    lightning_api_key: request.lightningApiKey,
    mode: generation.mode,
    first_image: fileInput(generation.firstImage),
    last_image: fileInput(generation.lastImage),
    ref_image_1: fileInput(at(images, 0)),
    ref_image_2: fileInput(at(images, 1)),
    ref_image_3: fileInput(at(images, 2)),
    ref_image_4: fileInput(at(images, 3)),
    ref_image_5: fileInput(at(images, 4)),
    ref_image_6: fileInput(at(images, 5)),
    ref_image_7: fileInput(at(images, 6)),
    ref_image_8: fileInput(at(images, 7)),
    ref_image_9: fileInput(at(images, 8)),
    ref_video_1: fileInput(at(videos, 0)),
    ref_video_2: fileInput(at(videos, 1)),
    ref_video_3: fileInput(at(videos, 2)),
    ref_audio_1: fileInput(at(audios, 0)),
    ref_audio_2: fileInput(at(audios, 1)),
    ref_audio_3: fileInput(at(audios, 2)),
    duration: generation.duration,
    width: generation.width,
    height: generation.height,
    result_format: generation.resultFormat,
    image_frames: generation.imageFrames,
    fl2va_audio_1: fileInput(at(voices, 0)),
    fl2va_audio_2: fileInput(at(voices, 1)),
    fl2va_audio_3: fileInput(at(voices, 2)),
  });
  const data = (result as { data?: unknown[] }).data ?? [];
  return {
    prompt: asString(data[0]),
    status: asString(data[1]),
  };
}

export async function cancelDefaultVideo(): Promise<string> {
  const client = await getClient();
  const payload = parseJsonResult<{ message?: string }>(
    await client.predict("/studio_generate_cancel", []),
  );
  return payload.message || "Cancellation requested.";
}

export async function cancelH3Advanced(): Promise<string> {
  const client = await getClient();
  const payload = parseJsonResult<{ message?: string }>(
    await client.predict("/studio_h3_cancel", []),
  );
  return payload.message || "Cancellation requested.";
}

export async function generateMusic3(
  request: Music3Request,
  onUpdate: (update: GenerateUpdate) => void,
  signal?: AbortSignal,
): Promise<GenerateUpdate> {
  const client = await getClient();
  return consumeMediaSubmission(
    client.submit("/generate_music3", [
      request.model,
      request.caption,
      request.lyrics,
      request.duration,
      request.seed,
      request.steps,
      request.cfg,
      request.arCfg,
      request.topK,
      request.tiledDecode,
    ]),
    onUpdate,
    signal,
  );
}

export async function cancelMusic3(): Promise<string> {
  const client = await getClient();
  const payload = parseJsonResult<{ message?: string }>(
    await client.predict("/studio_music_cancel", []),
  );
  return payload.message || "Cancellation requested.";
}

export async function generateLtx25(
  request: Ltx25Request,
  onUpdate: (update: GenerateUpdate) => void,
  signal?: AbortSignal,
): Promise<GenerateUpdate> {
  const client = await getClient();
  return consumeMediaSubmission(
    client.submit("/generate_ltx25_video", [
      request.mode,
      request.model,
      request.prompt,
      request.negativePrompt,
      fileInput(request.firstImage),
      request.duration,
      request.fps,
      request.width,
      request.height,
      request.seed,
      request.cfg,
      request.sampler,
      request.imageStrength,
      fileInput(request.middleImage),
      request.middleTime,
      request.middleStrength,
      fileInput(request.endImage),
      request.endStrength,
    ]),
    onUpdate,
    signal,
  );
}

export async function cancelLtx25(): Promise<string> {
  const client = await getClient();
  const payload = parseJsonResult<{ message?: string }>(
    await client.predict("/studio_ltx_cancel", []),
  );
  return payload.message || "Cancellation requested.";
}

export async function ltxInventory(): Promise<LtxInventory> {
  const client = await getClient();
  return parseJsonResult<LtxInventory>(await client.predict("/studio_ltx_inventory", []));
}

export async function prepareLtxWorkflow(workflowName: string): Promise<LtxPreparation> {
  const client = await getClient();
  return parseJsonResult<LtxPreparation>(
    await client.predict("/studio_ltx_prepare_workflow", [workflowName]),
  );
}

export async function prepareAllLtxModels(): Promise<LtxPreparation> {
  const client = await getClient();
  return parseJsonResult<LtxPreparation>(
    await client.predict("/studio_ltx_prepare_all", []),
  );
}

export async function enqueueBatch(promptsText: string): Promise<BatchSnapshot> {
  const client = await getClient();
  return parseJsonResult<BatchSnapshot>(
    await client.predict("/studio_batch_enqueue", [promptsText]),
  );
}

export async function batchSnapshot(
  selectedBatchId: string | null,
): Promise<BatchSnapshot> {
  const client = await getClient();
  return parseJsonResult<BatchSnapshot>(
    await client.predict("/studio_batch_snapshot", [selectedBatchId || ""]),
  );
}

export async function cancelBatch(batchId: string): Promise<BatchSnapshot> {
  const client = await getClient();
  return parseJsonResult<BatchSnapshot>(
    await client.predict("/studio_batch_cancel", [batchId]),
  );
}

export async function gallerySnapshot(): Promise<GallerySnapshot> {
  const client = await getClient();
  return normalizeGallery(
    parseJsonResult<GallerySnapshot>(
      await client.predict("/studio_gallery_list", []),
    ),
  );
}

export async function deleteGalleryItem(path: string): Promise<GallerySnapshot> {
  const client = await getClient();
  return normalizeGallery(
    parseJsonResult<GallerySnapshot>(
      await client.predict("/studio_gallery_delete", [path]),
    ),
  );
}

export async function emptyGallery(): Promise<GallerySnapshot> {
  const client = await getClient();
  return normalizeGallery(
    parseJsonResult<GallerySnapshot>(
      await client.predict("/studio_gallery_empty", []),
    ),
  );
}

export async function systemStatus(): Promise<SystemStatus> {
  const client = await getClient();
  return parseJsonResult<SystemStatus>(
    await client.predict("/studio_system_status", []),
  );
}
