import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { enqueueGenerationJob } from "@/lib/queue/enqueue";
import { errorMessage, errorStatus } from "@/lib/utils/errors";

// The one piece that was still missing after the storyboard/brand-kit/
// timeline UI work: scenes existed, the queue/worker existed, real
// providers existed — nothing actually called enqueueGenerationJob(). This
// route is that call site. Model choice below follows the cost analysis
// from earlier in this project: Seedance 2.0 for video (best cost/quality
// per the Artificial Analysis leaderboard at the time) rather than the
// video provider's own default (Kling 2.1 Standard) or a premium tier.
const VIDEO_MODEL = "seedance-2.0";

// Placeholder default until a real voice-picker UI exists — ElevenLabs'
// public "Rachel" voice, a commonly-used, always-available default.
const DEFAULT_VOICE_ID = "21m00Tcm4TlviJqp0N4X";

const BodySchema = z.object({
  // Re-enqueue scenes/voiceover/music that already have a SUCCEEDED result.
  // Without this, re-running "Generate" after a partial success only fills
  // in the gaps — cheaper, and avoids silently re-billing a provider for
  // something that already worked.
  regenerate: z.boolean().default(false),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: projectId } = await params;
    const { regenerate } = BodySchema.parse(await req.json().catch(() => ({})));

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        scenes: {
          orderBy: { order: "asc" },
          include: {
            generatedVideos: { where: { status: "SUCCEEDED" }, take: 1 },
          },
        },
        assets: { where: { type: { in: ["VOICEOVER", "MUSIC"] } } },
      },
    });

    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (project.scenes.length === 0) {
      return NextResponse.json(
        { error: "Generate a storyboard first — this project has no scenes yet." },
        { status: 400 }
      );
    }

    const videoJobIds: string[] = [];
    for (const scene of project.scenes) {
      if (!regenerate && scene.generatedVideos.length > 0) continue; // already succeeded
      const prompt = scene.enhancedPrompt ?? scene.rawPrompt;
      if (!prompt) continue; // shouldn't happen post-storyboard, but don't crash the batch over one bad row

      const job = await enqueueGenerationJob({
        projectId,
        type: "scene_video",
        input: {
          sceneId: scene.id,
          prompt,
          model: VIDEO_MODEL,
          durationSec: scene.durationSec,
          aspectRatio: project.aspectRatio,
        },
      });
      videoJobIds.push(job.id);
    }

    // Combined single voiceover track across all scenes (matches the
    // timeline's one continuous "Voiceover" row, not a per-scene track).
    let voiceoverJobId: string | null = null;
    const hasVoiceover = project.assets.some((a) => a.type === "VOICEOVER");
    const combinedVoiceover = project.scenes
      .map((s) => s.voiceoverText)
      .filter((t): t is string => Boolean(t && t.trim()))
      .join(" ");
    if (combinedVoiceover && (regenerate || !hasVoiceover)) {
      const job = await enqueueGenerationJob({
        projectId,
        type: "voiceover",
        input: { text: combinedVoiceover, voiceId: DEFAULT_VOICE_ID },
      });
      voiceoverJobId = job.id;
    }

    // Same for music — one background track for the whole video.
    let musicJobId: string | null = null;
    const hasMusic = project.assets.some((a) => a.type === "MUSIC");
    if (regenerate || !hasMusic) {
      const totalDurationSec =
        project.durationSec ?? project.scenes.reduce((sum, s) => sum + s.durationSec, 0);
      const moodPrompt = [project.tone, project.visualStyle, project.purpose]
        .filter(Boolean)
        .join(", ") || "Neutral, unobtrusive background music matching a short-form ad";
      const job = await enqueueGenerationJob({
        projectId,
        type: "music",
        input: { moodPrompt, durationSec: totalDurationSec },
      });
      musicJobId = job.id;
    }

    return NextResponse.json({
      videoJobIds,
      voiceoverJobId,
      musicJobId,
      skipped: {
        videos: project.scenes.length - videoJobIds.length,
        voiceover: !voiceoverJobId && hasVoiceover,
        music: !musicJobId && hasMusic,
      },
    });
  } catch (err: unknown) {
    console.error("[/api/projects/[id]/generate]", err);
    return NextResponse.json(
      { error: errorMessage(err, "Failed to start generation") },
      { status: errorStatus(err) }
    );
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: projectId } = await params;

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    // Polling target for the "Generate" button — jobs run asynchronously in
    // the worker, so the client needs somewhere to check progress. Ordered
    // newest-first and capped since a project can accumulate many jobs
    // across regenerate attempts.
    const jobs = await prisma.generationJob.findMany({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, type: true, status: true, error: true, createdAt: true },
    });

    return NextResponse.json({ jobs });
  } catch (err: unknown) {
    console.error("[/api/projects/[id]/generate GET]", err);
    return NextResponse.json(
      { error: errorMessage(err, "Failed to load generation jobs") },
      { status: errorStatus(err) }
    );
  }
}
