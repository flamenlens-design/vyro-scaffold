// Real image provider backed by fal.ai.
//
// Implements the exact ImageProvider interface from ../types.ts — nothing
// about the interface changes here, only what's behind it.
//
// The fal.ai endpoint is a *parameter*, never hardcoded: FAL_IMAGE_MODELS
// maps the logical model names the app/UI/AIModel registry deal with to the
// actual fal.ai endpoint ID(s). Adding a new image model later (or pointing
// "flux-1.1-pro-ultra" at a different endpoint) is a one-line change to that
// map — no code in this class or in any agent/route needs to change.

import type { ImageProvider, ImageGenerationRequest, ImageGenerationResult } from "../types";
import { runFalModel } from "./fal-client";

interface SeedreamModelConfig {
  textToImage: string;
  edit: string; // used automatically when reference images are supplied
}

type FalImageModelConfig = string | SeedreamModelConfig;

// Logical model name -> fal.ai endpoint ID(s).
//
// "flux-1.1-pro-ultra" is the primary/default (best consistency for
// storyboards/character refs, per README). "seedream-v4" is wired in as the
// cheaper alternative the AIModel registry can select instead.
export const FAL_IMAGE_MODELS: Record<string, FalImageModelConfig> = {
  "flux-1.1-pro-ultra": "fal-ai/flux-pro/v1.1-ultra",
  "seedream-v4": {
    textToImage: "fal-ai/bytedance/seedream/v4/text-to-image",
    edit: "fal-ai/bytedance/seedream/v4/edit",
  },
};

export const DEFAULT_IMAGE_MODEL = "flux-1.1-pro-ultra";

interface FalImageOutput {
  images: { url: string }[];
}

function resolveEndpoint(modelKey: string, hasReferenceImages: boolean): string {
  const config = FAL_IMAGE_MODELS[modelKey];

  if (config) {
    if (typeof config === "string") {
      if (hasReferenceImages) {
        throw new Error(
          `Model "${modelKey}" (${config}) does not accept reference images in this integration. ` +
            `Use "seedream-v4" for reference-guided edits, or drop referenceImageUrls.`
        );
      }
      return config;
    }
    return hasReferenceImages ? config.edit : config.textToImage;
  }

  // Not a known logical name — allow the caller (e.g. a future AIModel
  // registry row) to pass a raw fal.ai endpoint ID directly.
  if (modelKey.includes("/")) return modelKey;

  throw new Error(
    `Unknown image model "${modelKey}". Known models: ${Object.keys(FAL_IMAGE_MODELS).join(", ")}, ` +
      `or pass a raw fal.ai endpoint ID (e.g. "fal-ai/flux-pro/v1.1-ultra").`
  );
}

function buildInput(req: ImageGenerationRequest): Record<string, unknown> {
  const input: Record<string, unknown> = { prompt: req.prompt };

  if (req.negativePrompt) input.negative_prompt = req.negativePrompt;
  if (req.aspectRatio) input.aspect_ratio = req.aspectRatio;
  if (req.referenceImageUrls?.length) input.image_urls = req.referenceImageUrls;

  return input;
}

export class FalImageProvider implements ImageProvider {
  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const modelKey = req.model || DEFAULT_IMAGE_MODEL;
    const endpoint = resolveEndpoint(modelKey, Boolean(req.referenceImageUrls?.length));

    const { data } = await runFalModel<FalImageOutput>(endpoint, buildInput(req));
    const url = data.images?.[0]?.url;
    if (!url) {
      throw new Error(`fal.ai model ${endpoint} returned no image`);
    }

    return { url, modelUsed: endpoint };
  }
}
