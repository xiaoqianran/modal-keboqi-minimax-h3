import { Client } from "@gradio/client";

import type {
  BatchSnapshot,
  GenerateUpdate,
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

export async function generateDefaultVideo(
  prompt: string,
  onUpdate: (update: GenerateUpdate) => void,
  signal?: AbortSignal,
): Promise<GenerateUpdate> {
  const client = await getClient();
  const submission = client.submit("/generate_video", [prompt]);
  let latest: GenerateUpdate = { outputUrl: "", status: "Submitting" };

  const abort = () => submission.cancel();
  signal?.addEventListener("abort", abort, { once: true });

  try {
    for await (const message of submission) {
      if (message.type === "status") {
        const status = message as unknown as {
          stage?: string;
          position?: number;
          size?: number;
          queue_size?: number;
          message?: string;
          progress_data?: Array<{ desc?: string | null }>;
        };
        const desc = status.progress_data?.at(-1)?.desc || status.message;
        latest = {
          ...latest,
          status: desc || status.stage || "Working",
          stage: status.stage,
          queuePosition: status.position,
          queueSize: status.size ?? status.queue_size,
        };
        onUpdate(latest);
        continue;
      }

      if (message.type === "data") {
        const data = (message as unknown as { data?: unknown[] }).data ?? [];
        const outputUrl = asString(data[0]);
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

export async function cancelDefaultVideo(): Promise<string> {
  const client = await getClient();
  const payload = parseJsonResult<{ message?: string }>(
    await client.predict("/studio_generate_cancel", []),
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

export async function systemStatus(): Promise<SystemStatus> {
  const client = await getClient();
  return parseJsonResult<SystemStatus>(
    await client.predict("/studio_system_status", []),
  );
}
