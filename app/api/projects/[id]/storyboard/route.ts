import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { generateStoryboard, type StoryboardStyleContext } from "@/lib/ai/agents/storyboard-agent";
import { errorMessage, errorStatus } from "@/lib/utils/errors";

// `Script.approved` now exists in the schema (added when the "prompt →
// script → storyboard" UI flow was wired up) — checked against the stored
// row instead of trusting a client-supplied flag, closing the gap this
// route previously flagged.
const BodySchema = z.object({
  regenerate: z.boolean().default(false),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser();
    const { id: projectId } = await params;
    const { regenerate } = BodySchema.parse(await req.json());

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      include: {
        script: true,
        styleProfile: true,
        characters: { select: { name: true } },
        scenes: { select: { id: true, generatedVideos: { select: { id: true } }, generatedImages: { select: { id: true } } } },
      },
    });

    // 404 rather than 403 for a project owned by someone else — don't reveal
    // that the id exists.
    if (!project || project.userId !== user.id) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    if (!project.script || !project.script.current.trim()) {
      return NextResponse.json(
        { error: "This project has no script yet — write and approve a script before storyboarding." },
        { status: 400 }
      );
    }

    if (!project.script.approved) {
      return NextResponse.json(
        { error: "Approve the script before generating a storyboard." },
        { status: 400 }
      );
    }

    // Never silently overwrite an existing storyboard.
    if (project.scenes.length > 0 && !regenerate) {
      return NextResponse.json(
        {
          error:
            "This project already has a storyboard. Pass \"regenerate\": true to replace it.",
          existingSceneCount: project.scenes.length,
        },
        { status: 409 }
      );
    }

    // Refuse to blow away scenes that already have generated media — deleting
    // them would orphan (or, given the FK, fail on) GeneratedVideo/GeneratedImage
    // rows. Surface this instead of half-succeeding.
    const scenesWithMedia = project.scenes.filter(
      (s) => s.generatedVideos.length > 0 || s.generatedImages.length > 0
    );
    if (regenerate && scenesWithMedia.length > 0) {
      return NextResponse.json(
        {
          error:
            "Can't regenerate: some scenes already have generated images/video attached. " +
            "Remove that generated media first.",
          affectedSceneCount: scenesWithMedia.length,
        },
        { status: 409 }
      );
    }

    const rawPalette = project.styleProfile?.colorPalette;
    const colorPalette = Array.isArray(rawPalette)
      ? rawPalette.filter((v): v is string => typeof v === "string")
      : undefined;

    const style: StoryboardStyleContext | undefined = project.styleProfile
      ? {
          colorPalette,
          lighting: project.styleProfile.lighting ?? undefined,
          cameraStyle: project.styleProfile.cameraStyle ?? undefined,
          lensPref: project.styleProfile.lensPref ?? undefined,
          texture: project.styleProfile.texture ?? undefined,
          environment: project.styleProfile.environment ?? undefined,
          mood: project.styleProfile.mood ?? undefined,
          visualStyle: project.visualStyle ?? undefined,
          aspectRatio: project.aspectRatio,
        }
      : { visualStyle: project.visualStyle ?? undefined, aspectRatio: project.aspectRatio };

    const drafts = await generateStoryboard(project.script.current, {
      durationSec: project.durationSec ?? undefined,
      style,
      characterNames: project.characters.map((c) => c.name),
    });

    const scenes = await prisma.$transaction(async (tx) => {
      if (regenerate && project.scenes.length > 0) {
        await tx.scene.deleteMany({ where: { projectId } });
      }
      await tx.scene.createMany({
        data: drafts.map((d) => ({
          projectId,
          order: d.order,
          durationSec: d.durationSec,
          visualDesc: d.visualDesc,
          rawPrompt: d.rawPrompt,
          cameraAngle: d.cameraAngle,
          cameraMovement: d.cameraMovement,
          lighting: d.lighting,
          mood: d.mood,
          dialogue: d.dialogue,
          voiceoverText: d.voiceoverText,
          soundEffects: d.soundEffects,
          musicDirection: d.musicDirection,
        })),
      });
      return tx.scene.findMany({ where: { projectId }, orderBy: { order: "asc" } });
    });

    return NextResponse.json({ scenes, replacedExisting: regenerate && project.scenes.length > 0 }, { status: 201 });
  } catch (err: unknown) {
    console.error("[/api/projects/[id]/storyboard]", err);
    const status = err instanceof z.ZodError ? 400 : errorStatus(err);
    return NextResponse.json(
      { error: errorMessage(err, "Storyboard agent failed") },
      { status }
    );
  }
}
