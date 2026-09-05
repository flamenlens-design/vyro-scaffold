import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { requireUser } from "@/lib/auth/session";
import { errorMessage, errorStatus } from "@/lib/utils/errors";
import { extractBrandKit } from "@/lib/ai/agents/brand-kit-agent";

const BodySchema = z.object({
  url: z.string().url(),
});

// Next.js 15+ makes dynamic route `params` async — must be awaited before use
// (see app/project/[id]/page.tsx for the same pattern).
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireUser();
    const { id: projectId } = await params;
    const { url } = BodySchema.parse(await req.json());

    const project = await prisma.project.findFirst({
      where: { id: projectId, userId: user.id },
      select: { id: true, name: true },
    });
    if (!project) {
      const err = new Error("Project not found") as Error & { status: number };
      err.status = 404;
      throw err;
    }

    const extraction = await extractBrandKit(url);

    // BrandKit now carries `projectId` (added during merge — see
    // schema.prisma comment) so this upserts scoped to *this* project via
    // its unique constraint, rather than the user-wide find-then-update the
    // agent's own handoff flagged as a known gap.
    const data = {
      name: extraction.name || project.name,
      logoUrl: extraction.logoUrl,
      colors: extraction.colors,
      fonts: extraction.fonts,
      voiceTone: extraction.voiceTone,
      toneKeywords: extraction.toneKeywords,
      description: extraction.description,
    };

    const brandKit = await prisma.brandKit.upsert({
      where: { projectId },
      create: { ...data, userId: user.id, projectId },
      update: data,
    });

    return NextResponse.json({
      brandKit,
      // Provenance from the extraction pass — useful for debugging/audit,
      // not persisted on the BrandKit row itself.
      extracted: {
        sourceUrl: extraction.sourceUrl,
        pagesAnalyzed: extraction.pagesAnalyzed,
      },
    });
  } catch (err: unknown) {
    console.error("[/api/projects/[id]/brand-kit]", err);
    const status = err instanceof z.ZodError ? 400 : errorStatus(err);
    return NextResponse.json(
      { error: errorMessage(err, "Brand kit extraction failed") },
      { status }
    );
  }
}
