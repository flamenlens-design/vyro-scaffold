import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma, TrackType as DbTrackType } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { errorMessage, errorStatus } from "@/lib/utils/errors";

const ItemSchema = z.object({
  id: z.string(),
  assetId: z.string().optional(),
  sceneId: z.string().optional(),
  label: z.string(),
  thumbUrl: z.string().optional(),
  start: z.number(),
  end: z.number(),
  trimIn: z.number(),
  trimOut: z.number(),
  sourceDuration: z.number(),
  effects: z.record(z.unknown()).optional(),
});

const TrackSchema = z.object({
  // Absent, or a client-generated placeholder id (mock-/new- prefixed),
  // means "create a new TimelineTrack row"; a real cuid means "update".
  id: z.string().optional(),
  type: z.enum(["VIDEO", "AUDIO", "MUSIC", "VOICEOVER", "CAPTION", "OVERLAY"]),
  order: z.number(),
  items: z.array(ItemSchema),
});

const BodySchema = z.object({ tracks: z.array(TrackSchema) });

// Next.js 15+ makes dynamic route `params` async — must be awaited before use.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: projectId } = await params;
    const user = await requireUser();

    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, userId: true },
    });
    if (!project || project.userId !== user.id) {
      const err = new Error("Project not found") as Error & { status: number };
      err.status = 404;
      throw err;
    }

    const { tracks } = BodySchema.parse(await req.json());

    const timeline = await prisma.timeline.upsert({
      where: { projectId },
      create: { projectId },
      update: {},
    });

    const saved = await Promise.all(
      tracks.map((track) => {
        const items = track.items as unknown as Prisma.InputJsonValue;
        // zod's parsed enum and Prisma's generated TrackType enum share the
        // same runtime string values; cast through `unknown` at this boundary.
        const type = track.type as unknown as DbTrackType;
        // A real DB id is present and isn't one of the client's placeholder
        // prefixes (used for not-yet-persisted mock/new tracks) → update in
        // place. Checking `track.id` directly (not via a helper) lets TS
        // narrow it to `string` inside this branch.
        if (track.id && !track.id.startsWith("mock-") && !track.id.startsWith("new-")) {
          return prisma.timelineTrack.update({
            where: { id: track.id },
            data: { type, order: track.order, items },
          });
        }
        return prisma.timelineTrack.create({
          data: { timelineId: timeline.id, type, order: track.order, items },
        });
      })
    );

    return NextResponse.json({
      tracks: saved.map((t) => ({ id: t.id, type: t.type, order: t.order })),
    });
  } catch (err: unknown) {
    const status = err instanceof z.ZodError ? 400 : errorStatus(err);
    return NextResponse.json({ error: errorMessage(err, "Failed to save timeline") }, { status });
  }
}
