import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { refineScript, detectStructure } from "@/lib/ai/agents/script-agent";
import { errorMessage } from "@/lib/utils/errors";

const RefineSchema = z.object({
  action: z.literal("refine"),
  script: z.string().min(1),
  transform: z.enum([
    "cinematic", "emotional", "viral", "concise", "storytelling",
    "dialogue", "hooks", "pacing", "luxury", "humorous", "dramatic",
  ]),
});

const StructureSchema = z.object({
  action: z.literal("structure"),
  script: z.string().min(1),
  durationSec: z.number().positive(),
});

const BodySchema = z.union([RefineSchema, StructureSchema]);

export async function POST(req: NextRequest) {
  try {
    const body = BodySchema.parse(await req.json());

    if (body.action === "refine") {
      const result = await refineScript(body.script, body.transform);
      return NextResponse.json(result);
    }

    const structure = await detectStructure(body.script, body.durationSec);
    return NextResponse.json(structure);
  } catch (err: unknown) {
    console.error("[/api/ai/script]", err);
    return NextResponse.json({ error: errorMessage(err, "Script agent failed") }, { status: 400 });
  }
}
