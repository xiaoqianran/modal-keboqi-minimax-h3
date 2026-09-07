import { Client } from "@gradio/client";

import type {
  BatchSnapshot,
  GallerySnapshot,
  GenerateUpdate,
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
    return value.trim() ? backendUrl(value) : "";
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

function normalizeGallery(snapshot: GallerySnapshot): GallerySnapshot {
  return {
    ...snapshot,
    items: snapshot.items.map((item) => ({
      ...item,
      preview_url: normalizeOutputUrl(item.preview_url),
      download_url: normalizeOutputUrl(item.download_url),
    })),
  };
}

function statusUpdate(message: unknown, latest: GenerateUpdate): GenerateUpdate {
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
    ...latest,
    status: desc || status.stage || "Working",
    stage: status.stage,
    queuePosition: status.position,
    queueSize: status.size ?? status.queue_size,
  };
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

export async function cancelDefaultVideo(): Promise<string> {
  const client = await getClient();
  const payload = parseJsonResult<{ message?: string }>(
    await client.predict("/studio_generate_cancel", []),
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
