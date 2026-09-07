// The generation queue only handles media-generation job types — the ones
// that hit a slow, potentially-flaky external provider and belong in the
// background. Other `GenerationJob.type` values (e.g. a future "storyboard"
// job) may exist in the DB for bookkeeping without ever being enqueued here.
//
// Each schema mirrors the matching *GenerationRequest shape in
// lib/ai/types.ts, plus a `sceneId` so the worker can attribute the result
// to a scene when it writes the GenerationHistory row.

import { z } from "zod";

export const SceneImageInput = z.object({
  sceneId: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().min(1),
  negativePrompt: z.string().optional(),
  referenceImageUrls: z.array(z.string()).optional(),
  aspectRatio: z.string().optional(),
});

export const SceneVideoInput = z.object({
  sceneId: z.string().min(1),
  prompt: z.string().min(1),
  model: z.string().min(1),
  durationSec: z.number().positive(),
  referenceImageUrl: z.string().optional(),
  aspectRatio: z.string().optional(),
});

export const VoiceoverInput = z.object({
  sceneId: z.string().min(1).optional(),
  text: z.string().min(1),
  voiceId: z.string().min(1),
  emotion: z.string().optional(),
  speed: z.number().optional(),
});

export const MusicInput = z.object({
  sceneId: z.string().min(1).optional(),
  moodPrompt: z.string().min(1),
  durationSec: z.number().positive(),
});

// No input fields needed — the worker re-reads the project's saved
// timeline/scenes fresh from Postgres via the job's `projectId`, same as
// every other job type does for its own row. See lib/video/render-export.ts.
export const VideoExportInput = z.object({});

export const GENERATION_JOB_INPUT_SCHEMAS = {
  scene_image: SceneImageInput,
  scene_video: SceneVideoInput,
  voiceover: VoiceoverInput,
  music: MusicInput,
  video_export: VideoExportInput,
} as const;

export type GenerationJobType = keyof typeof GENERATION_JOB_INPUT_SCHEMAS;

export function isGenerationJobType(type: string): type is GenerationJobType {
  return Object.prototype.hasOwnProperty.call(GENERATION_JOB_INPUT_SCHEMAS, type);
}

// What actually rides on the BullMQ job. Deliberately just the DB row's id
// — the worker re-reads `input`/`status` from Postgres on pickup rather than
// trusting the payload, so it always sees the latest state even if the row
// changed (or was cancelled) between enqueue and a retry.
export interface GenerationJobPayload {
  generationJobId: string;
}
