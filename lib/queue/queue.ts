import { Queue } from "bullmq";
import { getConnection } from "./connection";
import type { GenerationJobPayload } from "./types";

export const GENERATION_QUEUE_NAME = "generation";

let queue: Queue<GenerationJobPayload> | null = null;

// Single shared Queue instance (producer side). Lazily created so importing
// this module — e.g. from an API route — doesn't force a Redis connection
// at module-load time.
export function getGenerationQueue(): Queue<GenerationJobPayload> {
  if (!queue) {
    queue = new Queue<GenerationJobPayload>(GENERATION_QUEUE_NAME, {
      connection: getConnection(),
      defaultJobOptions: {
        attempts: 1, // see lib/queue/worker.ts for why retries are off by default
        removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
        removeOnFail: { age: 7 * 24 * 60 * 60 },
      },
    });
  }
  return queue;
}
