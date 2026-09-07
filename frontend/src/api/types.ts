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

export interface SystemStatus {
  detail: string;
  comfyui_url: string;
  api_schema_url: string;
}
