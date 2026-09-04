import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { runCreativeDirector } from "@/lib/ai/agents/creative-director";
import { errorMessage } from "@/lib/utils/errors";

const BodySchema = z.object({
  message: z.string().min(1),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string() }))
    .default([]),
});

export async function POST(req: NextRequest) {
  try {
    const { message, history } = BodySchema.parse(await req.json());
    const result = await runCreativeDirector(history, message);
    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error("[/api/ai/creative-director]", err);
    return NextResponse.json(
      { error: errorMessage(err, "Creative Director failed") },
      { status: 400 }
    );
  }
}
