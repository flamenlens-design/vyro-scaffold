// Real video provider backed by fal.ai.
//
// Implements the exact VideoProvider interface from ../types.ts. Model
// selection happens entirely through the `model` field already defined on
// VideoGenerationRequest — the fal.ai endpoint IDs live in FAL_VIDEO_MODELS
// below, never hardcoded in the request-building logic, so the AIModel
// registry can offer "Model A/B/C" side-by-side generation (per the README
// roadmap) without any change here.

import type { VideoProvider, VideoGenerationRequest, VideoGenerationResult } from "../types";
import { runFalModel } from "./fal-client";

interface VideoModelConfig {
  // Not every fal.ai video model exposes both directions — e.g. Kling's
  // "standard" and "pro" tiers are image-to-video only; only "master"
  // supports text-to-video too.
  textToVideo?: string;
  imageToVideo?: string;
}

// Logical model name -> fal.ai endpoint ID(s) for each supported mode.
export const FAL_VIDEO_MODELS: Record<string, VideoModelConfig> = {
  // Kling 2.1 — three quality tiers
  "kling-2.1-standard": {
    imageToVideo: "fal-ai/kling-video/v2.1/standard/image-to-video",
  },
  "kling-2.1-pro": {
    imageToVideo: "fal-ai/kling-video/v2.1/pro/image-to-video",
  },
  "kling-2.1-master": {
    textToVideo: "fal-ai/kling-video/v2.1/master/text-to-video",
    imageToVideo: "fal-ai/kling-video/v2.1/master/image-to-video",
  },
  // Seedance 2.0 — native audio, both directions
  "seedance-2.0": {
    textToVideo: "bytedance/seedance-2.0/text-to-video",
    imageToVideo: "bytedance/seedance-2.0/image-to-video",
  },
  "seedance-2.0-fast": {
    textToVideo: "bytedance/seedance-2.0/fast/text-to-video",
    imageToVideo: "bytedance/seedance-2.0/fast/image-to-video",
  },
  // Wan 2.6 — both directions
  "wan-2.6": {
    textToVideo: "wan/v2.6/text-to-video",
    imageToVideo: "wan/v2.6/image-to-video",
  },
};

// Seedance 2.0 is the app-wide default (best cost/quality per the
// Artificial Analysis leaderboard at the time — see the comment on
// app/api/projects/[id]/generate/route.ts's VIDEO_MODEL, which imports this
// constant rather than hardcoding its own so the two can never drift).
export const DEFAULT_VIDEO_MODEL = "seedance-2.0";

interface FalVideoOutput {
  video: { url: string; duration?: number };
}

function resolveEndpoint(modelKey: string, hasReferenceImage: boolean): string {
  const config = FAL_VIDEO_MODELS[modelKey];

  if (config) {
    const endpoint = hasReferenceImage ? config.imageToVideo : config.textToVideo;
    if (!endpoint) {
      const mode = hasReferenceImage ? "image-to-video" : "text-to-video";
      const available = Object.entries(config)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(", ");
      throw new Error(
        `Model "${modelKey}" doesn't support ${mode} in this integration (supports: ${available}).`
      );
    }
    return endpoint;
  }

  // Not a known logical name — allow a raw fal.ai endpoint ID to be passed
  // straight through (e.g. from a future AIModel registry row).
  if (modelKey.includes("/")) return modelKey;

  throw new Error(
    `Unknown video model "${modelKey}". Known models: ${Object.keys(FAL_VIDEO_MODELS).join(", ")}, ` +
      `or pass a raw fal.ai endpoint ID (e.g. "wan/v2.6/text-to-video").`
  );
}

function buildInput(req: VideoGenerationRequest): Record<string, unknown> {
  const input: Record<string, unknown> = {
    prompt: req.prompt,
    duration: String(req.durationSec),
  };

  if (req.referenceImageUrl) input.image_url = req.referenceImageUrl;
  if (req.aspectRatio) input.aspect_ratio = req.aspectRatio;

  return input;
}

export class FalVideoProvider implements VideoProvider {
  async generate(req: VideoGenerationRequest): Promise<VideoGenerationResult> {
    const modelKey = req.model || DEFAULT_VIDEO_MODEL;
    const endpoint = resolveEndpoint(modelKey, Boolean(req.referenceImageUrl));

    const { data } = await runFalModel<FalVideoOutput>(endpoint, buildInput(req), {
      timeoutMs: 10 * 60 * 1000, // video jobs run longer than image jobs
    });

    const url = data.video?.url;
    if (!url) {
      throw new Error(`fal.ai model ${endpoint} returned no video`);
    }

    return {
      url,
      modelUsed: endpoint,
      durationSec: data.video.duration ?? req.durationSec,
    };
  }
}
