import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { enqueueGenerationJob } from "@/lib/queue/enqueue";
import { errorMessage, errorStatus } from "@/lib/utils/errors";

interface ExportJobOutput {
  url: string;
  durationSec: number;
  clipCount: number;
}

// Next.js 15+ makes dynamic route `params` async — must be awaited before use.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true },
    });
    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // A render already in flight for this project — return it instead of
    // stacking up a second ffmpeg run (and a second S3 upload) for the same
    // timeline state. Clicking Export again once it's done starts a fresh one.
    const inFlight = await prisma.generationJob.findFirst({
      where: { projectId, type: "video_export", status: { in: ["QUEUED", "RUNNING"] } },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true },
    });
    if (inFlight) {
      return NextResponse.json({ job: inFlight });
    }

    const job = await enqueueGenerationJob({ projectId, type: "video_export", input: {} });
    return NextResponse.json({ job: { id: job.id, status: job.status } });
  } catch (err: unknown) {
    console.error("[/api/projects/[id]/export POST]", err);
    return NextResponse.json(
      { error: errorMessage(err, "Failed to start export") },
      { status: errorStatus(err) }
    );
  }
}

// Polling target for the Export button — returns the most recent export job
// (any status) so the client can show progress, or the finished download URL.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true },
    });
    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const job = await prisma.generationJob.findFirst({
      where: { projectId, type: "video_export" },
      orderBy: { createdAt: "desc" },
      select: { id: true, status: true, error: true, output: true },
    });

    const output = job?.output as ExportJobOutput | null | undefined;

    return NextResponse.json({
      job: job
        ? {
            id: job.id,
            status: job.status,
            error: job.error,
            url: output?.url ?? null,
            durationSec: output?.durationSec ?? null,
          }
        : null,
    });
  } catch (err: unknown) {
    console.error("[/api/projects/[id]/export GET]", err);
    return NextResponse.json(
      { error: errorMessage(err, "Failed to load export status") },
      { status: errorStatus(err) }
    );
  }
}
