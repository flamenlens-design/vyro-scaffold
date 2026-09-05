import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateScript, refineScript, detectStructure } from "@/lib/ai/agents/script-agent";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { errorMessage, errorStatus } from "@/lib/utils/errors";

// Every action now takes `projectId` and persists to the `Script` row —
// closing the gap flagged in the previous merge round, where nothing wrote
// a Script to the database and the storyboard route had to trust a
// client-supplied `scriptApproved` flag instead of stored state.

const GenerateSchema = z.object({
  action: z.literal("generate"),
  projectId: z.string(),
  brief: z.string().min(1),
});

const RefineSchema = z.object({
  action: z.literal("refine"),
  projectId: z.string(),
  script: z.string().min(1),
  transform: z.enum([
    "cinematic", "emotional", "viral", "concise", "storytelling",
    "dialogue", "hooks", "pacing", "luxury", "humorous", "dramatic",
  ]),
});

const StructureSchema = z.object({
  action: z.literal("structure"),
  projectId: z.string(),
  script: z.string().min(1),
  durationSec: z.number().positive(),
});

const ApproveSchema = z.object({
  action: z.literal("approve"),
  projectId: z.string(),
  approved: z.boolean().default(true),
});

const BodySchema = z.union([GenerateSchema, RefineSchema, StructureSchema, ApproveSchema]);

async function assertOwnsProject(userId: string, projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project || project.userId !== userId) {
    const err = new Error("Project not found") as Error & { status: number };
    err.status = 404;
    throw err;
  }
  return project;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = BodySchema.parse(await req.json());
    const project = await assertOwnsProject(user.id, body.projectId);

    if (body.action === "generate") {
      const { script, hook } = await generateScript(body.brief, {
        purpose: project.purpose,
        platform: project.platform,
        aspectRatio: project.aspectRatio,
        durationSec: project.durationSec,
        tone: project.tone,
        visualStyle: project.visualStyle,
      });
      const saved = await prisma.script.upsert({
        where: { projectId: body.projectId },
        create: { projectId: body.projectId, original: script, current: script, hook },
        // Regenerating from the brief resets `current` back to the fresh
        // draft and un-approves it — this is a new draft, not a refinement.
        update: { original: script, current: script, hook, approved: false },
      });
      return NextResponse.json({ script: saved });
    }

    if (body.action === "refine") {
      const result = await refineScript(body.script, body.transform);
      const saved = await prisma.script.upsert({
        where: { projectId: body.projectId },
        create: { projectId: body.projectId, original: body.script, current: result.suggestion },
        // Refining an already-approved script un-approves it — the approval
        // was for specific text, not "whatever this script becomes."
        update: { current: result.suggestion, approved: false },
      });
      return NextResponse.json({ ...result, script: saved });
    }

    if (body.action === "structure") {
      const structure = await detectStructure(body.script, body.durationSec);
      const saved = await prisma.script.update({
        where: { projectId: body.projectId },
        data: { structure: structure as unknown as object },
      });
      return NextResponse.json({ structure, script: saved });
    }

    // action === "approve"
    const saved = await prisma.script.update({
      where: { projectId: body.projectId },
      data: { approved: body.approved },
    });
    return NextResponse.json({ script: saved });
  } catch (err: unknown) {
    console.error("[/api/ai/script]", err);
    return NextResponse.json(
      { error: errorMessage(err, "Script agent failed") },
      { status: errorStatus(err) }
    );
  }
}
