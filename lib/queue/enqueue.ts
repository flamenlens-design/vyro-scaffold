// Single entry point API routes should use to kick off a background
// generation job — it creates the GenerationJob row (status QUEUED) and
// pushes the corresponding BullMQ job in one call, so the two never drift
// out of sync (a BullMQ job with no DB row, or a QUEUED row nothing will
// ever pick up).
//
// Usage from a route handler:
//
//   import { enqueueGenerationJob } from "@/lib/queue/enqueue";
//
//   const job = await enqueueGenerationJob({
//     projectId: scene.projectId,
//     type: "scene_image",
//     input: { sceneId: scene.id, prompt: scene.enhancedPrompt!, model: "flux-1.1-pro" },
//   });

import type { z } from "zod";
import type { Prisma, GenerationJob } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getGenerationQueue } from "./queue";
import { GENERATION_JOB_INPUT_SCHEMAS, type GenerationJobType } from "./types";

export type { GenerationJobType } from "./types";

interface EnqueueGenerationJobParams<T extends GenerationJobType> {
  projectId: string;
  type: T;
  input: z.infer<(typeof GENERATION_JOB_INPUT_SCHEMAS)[T]>;
  /** Credits this job is expected to cost — bookkeeping only for now; see
   *  README roadmap item 10 for actually deducting them on completion. */
  costCredits?: number;
}

export async function enqueueGenerationJob<T extends GenerationJobType>(
  params: EnqueueGenerationJobParams<T>
): Promise<GenerationJob> {
  const schema = GENERATION_JOB_INPUT_SCHEMAS[params.type];
  // Throws a ZodError the caller's route can map to a 400, same as the
  // existing POST /api/projects pattern.
  const input = schema.parse(params.input);

  const row = await prisma.generationJob.create({
    data: {
      projectId: params.projectId,
      type: params.type,
      status: "QUEUED",
      input: input as Prisma.InputJsonValue,
      costCredits: params.costCredits ?? 0,
    },
  });

  try {
    // jobId ties the BullMQ job 1:1 to the DB row and makes re-enqueueing
    // the same row id a no-op while it's still active/queued in Redis.
    await getGenerationQueue().add(
      params.type,
      { generationJobId: row.id },
      { jobId: row.id }
    );
  } catch (err) {
    // Redis push failed after the DB row was already written — fail it
    // immediately rather than leave a QUEUED row nothing will ever process.
    await prisma.generationJob.update({
      where: { id: row.id },
      data: {
        status: "FAILED",
        error: err instanceof Error ? err.message : "Failed to enqueue job",
      },
    });
    throw err;
  }

  return row;
}
