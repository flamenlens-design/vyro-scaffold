// Minimal fal.ai "queue" REST client shared by fal-image.ts and fal-video.ts.
//
// Deliberately dependency-free (plain `fetch`) so landing real image/video
// providers doesn't require adding the `@fal-ai/client` package. If richer
// features are needed later (streaming progress logs, direct file uploads),
// swap the internals here for the official client — callers only depend on
// `runFalModel`/`isFalConfigured`, not on how the HTTP calls are made.
//
// fal.ai queue protocol (https://docs.fal.ai/model-endpoints/queue):
//   1. POST  https://queue.fal.run/{endpointId}          -> { request_id, status_url, response_url }
//   2. GET   status_url (repeat until status === "COMPLETED")
//   3. GET   response_url                                 -> the model's output payload

const FAL_QUEUE_BASE = "https://queue.fal.run";
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes — generous for video jobs

export interface FalQueueResult<T> {
  data: T;
  requestId: string;
}

interface FalSubmitResponse {
  request_id: string;
  status_url: string;
  response_url: string;
}

interface FalStatusResponse {
  status: "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";
}

/** True once FAL_API_KEY is present. Used by index.ts to decide whether to
 * wire up the real fal.ai providers or fall back to the mocks. */
export function isFalConfigured(): boolean {
  return Boolean(process.env.FAL_API_KEY);
}

function falApiKey(): string {
  const key = process.env.FAL_API_KEY;
  if (!key) {
    throw new Error("FAL_API_KEY is not set");
  }
  return key;
}

async function falFetch(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Key ${falApiKey()}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fal.ai error ${res.status} for ${url}: ${body}`);
  }
  return res;
}

/**
 * Submits a job to a fal.ai queue-based model endpoint, polls until it
 * completes, and returns the parsed result payload.
 *
 * `endpointId` is the fal.ai "endpoint ID" (e.g. "fal-ai/flux-pro/v1.1-ultra"
 * or "bytedance/seedance-2.0/image-to-video") — always supplied by the
 * caller (never hardcoded here) so the AIModel registry table can pick
 * between models without touching this client.
 */
export async function runFalModel<T>(
  endpointId: string,
  input: Record<string, unknown>,
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<FalQueueResult<T>> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

  const submitRes = await falFetch(`${FAL_QUEUE_BASE}/${endpointId}`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  const submitted = (await submitRes.json()) as FalSubmitResponse;

  const start = Date.now();
  for (;;) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `fal.ai request ${submitted.request_id} on ${endpointId} timed out after ${timeoutMs}ms`
      );
    }
    const statusRes = await falFetch(submitted.status_url);
    const status = (await statusRes.json()) as FalStatusResponse;
    if (status.status === "COMPLETED") break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  const resultRes = await falFetch(submitted.response_url);
  const data = (await resultRes.json()) as T;
  return { data, requestId: submitted.request_id };
}
