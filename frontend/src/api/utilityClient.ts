import { Client, handle_file } from "@gradio/client";

import { backendSource, backendUrl } from "./h3Client";
import type { GallerySnapshot } from "./types";

let clientPromise: ReturnType<typeof Client.connect> | null = null;

function getClient() {
  if (!clientPromise) clientPromise = Client.connect(backendSource());
  return clientPromise;
}

function parseJson<T>(result: unknown): T {
  const data = (result as { data?: unknown[] } | null)?.data;
  if (!Array.isArray(data) || !data.length) throw new Error("Empty Studio utility response.");
  return data[0] as T;
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

export async function importGalleryVideo(file: File): Promise<GallerySnapshot> {
  const client = await getClient();
  return normalizeGallery(
    parseJson<GallerySnapshot>(
      await client.predict("/studio_gallery_import", [handle_file(file)]),
    ),
  );
}

export async function unloadStudioModels(): Promise<{ message: string; detail: string }> {
  const client = await getClient();
  return parseJson(await client.predict("/studio_unload_models", []));
}

export async function compileStudioTrtVae(): Promise<{ message: string }> {
  const client = await getClient();
  return parseJson(await client.predict("/studio_compile_trt_vae", []));
}
