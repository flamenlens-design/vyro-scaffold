import { getTextProvider } from "../providers";

export interface StyleProfileInput {
  colorPalette?: string[];
  lighting?: string;
  cameraStyle?: string;
  lensPref?: string;
  texture?: string;
  environment?: string;
  mood?: string;
}

export interface EnhancePromptResult {
  original: string;
  enhanced: string;
}

// Raw user prompts are never sent directly to an image/video model. This
// agent always sits in between, injecting the project's persistent style
// profile so multi-scene generations stay visually consistent.
export async function enhancePrompt(
  rawPrompt: string,
  opts: { mediaType: "image" | "video"; style?: StyleProfileInput; characterContext?: string }
): Promise<EnhancePromptResult> {
  const provider = getTextProvider();

  const styleLines = opts.style
    ? Object.entries(opts.style)
        .filter(([, v]) => v)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
        .join("\n")
    : "";

  const result = await provider.generate({
    messages: [
      {
        role: "system",
        content:
          `You are a prompt engineer for ${opts.mediaType} generation models (e.g. Flux, Kling, Runway). ` +
          `Rewrite the user's rough idea into a single dense, production-grade prompt: camera shot type, ` +
          `movement, lighting, lens, mood, texture, and composition. Weave in the provided style profile and ` +
          `character description so the result stays consistent with the rest of the project. Output ONLY the ` +
          `enhanced prompt as one paragraph — no labels, no preamble.`,
      },
      {
        role: "user",
        content: [
          `Idea: ${rawPrompt}`,
          styleLines ? `Style profile:\n${styleLines}` : "",
          opts.characterContext ? `Character context:\n${opts.characterContext}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    temperature: 0.6,
  });

  return { original: rawPrompt, enhanced: result.text.trim() };
}
