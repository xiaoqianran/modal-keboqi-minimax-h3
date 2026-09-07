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
