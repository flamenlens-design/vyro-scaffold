// Worker for the generation queue.
//
// Picks up BullMQ jobs pushed by lib/queue/enqueue.ts, loads the matching
// GenerationJob row, calls whatever provider is currently registered in
// lib/ai/providers/index.ts (mock or real — this file never knows or
// cares which), and writes the result back: job status/output, plus a
// GenerationHistory row on success.
//
// Run this as its own long-lived process (see lib/queue/run-worker.ts) —
// it does not run inside the Next.js server.

import { Worker, type Job } from "bullmq";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import {
  getImageProvider,
  getVideoProvider,
  getTTSProvider,
  getMusicProvider,
} from "@/lib/ai/providers";
import { newConnection } from "./connection";
import { GENERATION_QUEUE_NAME } from "./queue";
import {
  GENERATION_JOB_INPUT_SCHEMAS,
  isGenerationJobType,
  type GenerationJobPayload,
  type GenerationJobType,
} from "./types";

interface ProviderRunResult {
  output: Prisma.InputJsonValue;
  summary: string;
}

// Dispatches to the right provider for a given job type and shapes the
// result into what gets stored on GenerationJob.output / the
// GenerationHistory summary. One switch arm per type in
// GENERATION_JOB_INPUT_SCHEMAS — the `never` fallthrough below makes TS
// flag it if a type is ever added to the schema map without a handler here.
async function runProvider(
  type: GenerationJobType,
  rawInput: unknown
): Promise<ProviderRunResult> {
  switch (type) {
    case "scene_image": {
      const input = GENERATION_JOB_INPUT_SCHEMAS.scene_image.parse(rawInput);
      const result = await getImageProvider().generate(input);
      return {
        output: { ...result, sceneId: input.sceneId },
        summary: `Generated image for scene ${input.sceneId} with ${result.modelUsed}`,
      };
    }
    case "scene_video": {
      const input = GENERATION_JOB_INPUT_SCHEMAS.scene_video.parse(rawInput);
      const result = await getVideoProvider().generate(input);
      return {
        output: { ...result, sceneId: input.sceneId },
        summary: `Generated video for scene ${input.sceneId} with ${result.modelUsed}`,
      };
    }
    case "voiceover": {
      const input = GENERATION_JOB_INPUT_SCHEMAS.voiceover.parse(rawInput);
      const result = await getTTSProvider().generate(input);
      return {
        output: { ...result, sceneId: input.sceneId ?? null },
        summary: input.sceneId
          ? `Generated voiceover for scene ${input.sceneId}`
          : "Generated voiceover",
      };
    }
    case "music": {
      const input = GENERATION_JOB_INPUT_SCHEMAS.music.parse(rawInput);
      const result = await getMusicProvider().generate(input);
      return {
        output: { ...result, sceneId: input.sceneId ?? null },
        summary: input.sceneId
          ? `Generated music for scene ${input.sceneId}`
          : "Generated music",
      };
    }
    default: {
      const exhaustive: never = type;
      throw new Error(`No provider handler registered for job type "${exhaustive}"`);
    }
  }
}

async function processGenerationJob(bullJob: Job<GenerationJobPayload>) {
  const { generationJobId } = bullJob.data;

  const row = await prisma.generationJob.findUnique({ where: { id: generationJobId } });
  if (!row) {
    // Nothing in Postgres to update — surface it so it shows up as a failed
    // BullMQ job rather than silently vanishing.
    throw new Error(`GenerationJob ${generationJobId} not found`);
  }

  // A job can be marked CANCELLED between enqueue and pickup (e.g. the user
  // deleted the project). Skip it without touching status/output again.
  if (row.status === "CANCELLED") {
    return { skipped: true, reason: "cancelled" };
  }

  await prisma.generationJob.update({
    where: { id: row.id },
    data: { status: "RUNNING" },
  });

  if (!isGenerationJobType(row.type)) {
    const message = `Unsupported job type for the generation queue: "${row.type}"`;
    await prisma.generationJob.update({
      where: { id: row.id },
      data: { status: "FAILED", error: message },
    });
    throw new Error(message);
  }

  try {
    const { output, summary } = await runProvider(row.type, row.input);

    await prisma.$transaction([
      prisma.generationJob.update({
        where: { id: row.id },
        data: { status: "SUCCEEDED", output, error: null },
      }),
      prisma.generationHistory.create({
        data: {
          projectId: row.projectId,
          summary,
          diff: { jobId: row.id, type: row.type, output } as Prisma.InputJsonValue,
        },
      }),
    ]);

    return output;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Generation failed";
    await prisma.generationJob.update({
      where: { id: row.id },
      data: { status: "FAILED", error: message },
    });
    throw err;
  }
}

let worker: Worker<GenerationJobPayload> | null = null;

// BullMQ-level retries are off by default (see queue.ts's defaultJobOptions)
// because a retry would call a possibly-billed provider again for a job
// this worker already marked FAILED with a specific error. Roadmap item 10
// ("credit accounting on every GenerationJob completion") is the right
// place to add retry-with-backoff once double-charge protection exists —
// until then, callers can re-enqueue a fresh job for the same input.
export function startGenerationWorker(concurrency = 2): Worker<GenerationJobPayload> {
  if (worker) return worker;

  worker = new Worker<GenerationJobPayload>(GENERATION_QUEUE_NAME, processGenerationJob, {
    connection: newConnection(),
    concurrency,
  });

  worker.on("failed", (job, err) => {
    console.error(
      `[generation-queue] job ${job?.id ?? "?"} (row ${job?.data.generationJobId ?? "?"}) failed:`,
      err
    );
  });

  worker.on("error", (err) => {
    console.error("[generation-queue] worker error:", err);
  });

  return worker;
}
