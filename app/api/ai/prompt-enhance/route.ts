import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { enhancePrompt } from "@/lib/ai/agents/prompt-enhancer";
import { errorMessage } from "@/lib/utils/errors";

const BodySchema = z.object({
  prompt: z.string().min(1),
  mediaType: z.enum(["image", "video"]),
  style: z
    .object({
      colorPalette: z.array(z.string()).optional(),
      lighting: z.string().optional(),
      cameraStyle: z.string().optional(),
      lensPref: z.string().optional(),
      texture: z.string().optional(),
      environment: z.string().optional(),
      mood: z.string().optional(),
    })
    .optional(),
  characterContext: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());
    const result = await enhancePrompt(body.prompt, {
      mediaType: body.mediaType,
      style: body.style,
      characterContext: body.characterContext,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("[/api/ai/prompt-enhance]", err);
    return NextResponse.json(
      { error: errorMessage(err, "Prompt enhancer failed") },
      { status: 400 }
    );
  }
}
