export type StudioSection =
  | "create"
  | "batch"
  | "gallery"
  | "ltx"
  | "music"
  | "system";

export interface GenerateUpdate {
  outputUrl: string;
  status: string;
  queuePosition?: number;
  queueSize?: number;
  stage?: string;
}

export interface H3GenerateUpdate {
  videos: string[];
  images: string[];
  audioUrl: string;
  status: string;
  queuePosition?: number;
  queueSize?: number;
  stage?: string;
}

export interface H3Defaults {
  mode: string;
  result_format: string;
  image_vae: string;
  image_frames: number;
  model_profile: string;
  text_encoder: string;
  stage_model_offload: boolean;
  semantic_bridge: boolean;
  semantic_bridge_alpha: number;
  reuse_unchanged_inputs: boolean;
  use_int8_vae: boolean;
  use_trt_vae: boolean;
  generation_mode: string;
  turbo_variant: string;
  duration: number;
  width: number;
  height: number;
  steps: number;
  scheduler: string;
  seed: number;
  attention_mode: string;
  sla_preset: string;
  sol_tau: number;
  sol_thresh_type: string;
  sol_exact_mode: string;
  sol_dense_steps: number;
  sol_step_off: number;
  sol_sink_tokens: number;
  cache_mode: string;
  fbcache_preset: string;
  fbcache_threshold: number;
  fbcache_start: number;
  fbcache_end: number;
  fbcache_max_hits: number;
  fbcache_temporal_guard: boolean;
  easycache_threshold: number;
  easycache_start: number;
  easycache_end: number;
  easycache_verbose: boolean;
  ref_image_size: string;
  latent_upscale: boolean;
  latent_upscaler_model: string;
  latent_upscale_refine_steps: number;
  latent_upscale_method: string;
  latent_split_tile_width: number;
  latent_split_tile_height: number;
  latent_split_overlap_ratio: number;
  latent_split_fade_ratio: number;
  latent_split_chunk_frames: number;
  latent_split_temporal_overlap_frames: number;
  latent_split_seam_denoise: number;
  latent_split_seam_polish: string;
  postprocess: string;
  seedvr2_model: string;
  upscale_force_offload: boolean;
  upscale_split_enabled: boolean;
  upscale_split_seconds: number;
  upscale_resolution: string;
  ltx25_model: string;
  batch_count: number;
}

export interface H3Choices {
  modes: string[];
  result_formats: string[];
  model_profiles: string[];
  text_encoders: string[];
  image_vaes: string[];
  generation_modes: string[];
  turbo_variants: string[];
  schedulers: string[];
  attention_modes: string[];
  sla_presets: string[];
  sol_thresholds: string[];
  sol_exact_modes: string[];
  cache_modes: string[];
  fbcache_presets: string[];
  reference_sizes: string[];
  latent_upscalers: string[];
  latent_upscale_methods: string[];
  seam_polish: string[];
  postprocess: string[];
  upscale_resolutions: string[];
  seedvr2_models: string[];
  ltx25_models: string[];
}

export interface H3Catalog {
  defaults: H3Defaults;
  choices: H3Choices;
  resolutions: {
    draft: Record<string, [number, number]>;
    fast: Record<string, [number, number]>;
    large: Record<string, [number, number]>;
  };
}

export interface H3AdvancedRequest {
  batchCount: number;
  mode: string;
  modelProfile: string;
  textEncoder: string;
  stageModelOffload: boolean;
  generationMode: string;
  turboVariant: string;
  prompt: string;
  firstImage: File | null;
  lastImage: File | null;
  referenceImages: Array<File | null>;
  referenceVideos: Array<File | null>;
  referenceAudios: Array<File | null>;
  duration: number;
  width: number;
  height: number;
  steps: number;
  scheduler: string;
  seed: number;
  attentionMode: string;
  slaPreset: string;
  solTau: number;
  solThreshType: string;
  solExactMode: string;
  solDenseSteps: number;
  solStepOff: number;
  solSinkTokens: number;
  cacheMode: string;
  fbcachePreset: string;
  fbcacheThreshold: number;
  fbcacheStart: number;
  fbcacheEnd: number;
  fbcacheMaxHits: number;
  fbcacheTemporalGuard: boolean;
  easycacheThreshold: number;
  easycacheStart: number;
  easycacheEnd: number;
  easycacheVerbose: boolean;
  refImageSize: string;
  postprocess: string;
  reuseUnchangedInputs: boolean;
  latentUpscale: boolean;
  latentUpscalerModel: string;
  latentUpscaleRefineSteps: number;
  latentUpscaleMethod: string;
  latentSplitTileWidth: number;
  latentSplitTileHeight: number;
  latentSplitOverlapRatio: number;
  latentSplitFadeRatio: number;
  latentSplitChunkFrames: number;
  latentSplitTemporalOverlapFrames: number;
  latentSplitSeamDenoise: number;
  latentSplitSeamPolish: string;
  upscaleForceOffload: boolean;
  upscaleSplitEnabled: boolean;
  upscaleSplitSeconds: number;
  upscaleResolution: string;
  seedvr2Model: string;
  ltx25Model: string;
  useInt8Vae: boolean;
  useTrtVae: boolean;
  imageVae: string;
  resultFormat: string;
  imageFrames: number;
  semanticBridge: boolean;
  semanticBridgeAlpha: number;
  fl2vaAudios: Array<File | null>;
}

export interface BatchSummary {
  id: string;
  status: string;
  progress: string;
  current_prompt: string;
}

export interface BatchItem {
  index: number;
  prompt: string;
  status: string;
  output_url: string;
}

export interface BatchSnapshot {
  selected_batch_id: string | null;
  status: string;
  message?: string;
  batches: BatchSummary[];
  items: BatchItem[];
}

export interface GalleryItem {
  path: string;
  name: string;
  preview_url: string;
  download_url: string;
  size_bytes: number;
  modified_at: number;
  snapshot: Record<string, unknown> | null;
}

export interface GallerySnapshot {
  message?: string;
  count: number;
  items: GalleryItem[];
}

export interface Music3Defaults {
  model: string;
  duration: number;
  seed: number;
  steps: number;
  cfg: number;
  ar_cfg: number;
  top_k: number;
  tiled_decode: boolean;
}

export interface Ltx25Defaults {
  model: string;
  mode: string;
  duration: number;
  fps: number;
  width: number;
  height: number;
  seed: number;
  cfg: number;
  sampler: string;
  image_strength: number;
  middle_time: number;
  middle_strength: number;
  end_strength: number;
}

export interface LtxWorkflowSummary {
  name: string;
  id: string;
  description: string;
  inputs: string;
  audio_only: boolean;
}

export interface StudioCatalog {
  h3: H3Catalog;
  music3: {
    models: string[];
    defaults: Music3Defaults;
  };
  ltx25: {
    models: string[];
    defaults: Ltx25Defaults;
    prompt_models: string[];
    default_prompt_model: string;
    workflows: LtxWorkflowSummary[];
  };
}

export interface Music3Request {
  model: string;
  caption: string;
  lyrics: string;
  duration: number;
  seed: number;
  steps: number;
  cfg: number;
  arCfg: number;
  topK: number;
  tiledDecode: boolean;
}

export interface Ltx25Request {
  mode: "Text to video" | "Image to video";
  model: string;
  prompt: string;
  negativePrompt: string;
  firstImage: File | null;
  duration: number;
  fps: number;
  width: number;
  height: number;
  seed: number;
  cfg: number;
  sampler: string;
  imageStrength: number;
  middleImage: File | null;
  middleTime: number;
  middleStrength: number;
  endImage: File | null;
  endStrength: number;
}

export interface LtxInventory {
  inventory: string;
}

export interface LtxPreparation extends LtxInventory {
  status: string;
}

export interface SystemStatus {
  detail: string;
  comfyui_url: string;
  api_schema_url: string;
}
