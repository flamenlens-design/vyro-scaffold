import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { errorMessage, errorStatus } from "@/lib/utils/errors";

const CreateSchema = z.object({
  name: z.string().min(1).max(120),
  purpose: z.string().optional(),
  platform: z.string().optional(),
  aspectRatio: z.string().default("9:16"),
  durationSec: z.number().positive().optional(),
  tone: z.string().optional(),
  visualStyle: z.string().optional(),
  // The creative brief / prompt from the new-project form. Optional so
  // existing callers/tests that omit it don't break.
  brief: z.string().max(4000).optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    const projects = await prisma.project.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, name: true, status: true, aspectRatio: true,
        durationSec: true, updatedAt: true, createdAt: true,
      },
    });
    return NextResponse.json({ projects });
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err) }, { status: errorStatus(err) });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const body = CreateSchema.parse(await req.json());

    const project = await prisma.project.create({
      data: { ...body, userId: user.id },
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (err: unknown) {
    const status = err instanceof z.ZodError ? 400 : errorStatus(err);
    return NextResponse.json(
      { error: errorMessage(err, "Failed to create project") },
      { status }
    );
  }
}
