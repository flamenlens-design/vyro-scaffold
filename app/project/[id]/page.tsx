// Studio shell: left tool rail, center preview, bottom timeline, right AI panel.
// The timeline panel is wired to real data (Timeline/TimelineTrack) via
// TimelineEditor; the right panel now runs the actual prompt -> script ->
// storyboard flow via CreativeStudioPanel, and the "Brand" rail button opens
// the Pomelli-style URL extraction flow via BrandToolButton. The rest of the
// left rail (Assets, Scenes, Media, etc.) is still a layout skeleton.

import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db/client";
import TimelineEditor from "./timeline-editor";
import { buildMockTracks, buildAssetTracks, coerceTrackItems, type EditorTrack } from "./timeline-utils";
import CreativeStudioPanel from "./creative-studio-panel";
import BrandToolButton from "./brand-tool-button";
import ExportButton from "./export-button";
import FullVideoPreview from "./full-video-preview";

const LEFT_TOOLS = ["Assets", "Scenes", "Media", "Text", "Captions", "Brand", "Audio", "AI Tools"];

// Next.js 15+ makes dynamic route `params` async — must be awaited before use.
export default async function StudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      timeline: { include: { tracks: { orderBy: { order: "asc" } } } },
      assets: { orderBy: { createdAt: "asc" } },
      script: true,
      brandKit: true,
      scenes: {
        orderBy: { order: "asc" },
        include: {
          // Only ever need the latest successful clip per scene for
          // display — the generate route already reads a similar shape to
          // decide what to skip on regenerate.
          generatedVideos: { where: { status: "SUCCEEDED" }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  if (!project || project.userId !== user.id) notFound();

  const dbTracks: EditorTrack[] = (project.timeline?.tracks ?? []).map((t) => ({
    id: t.id,
    // Prisma's generated TrackType enum and our local TrackType union share
    // the same runtime string values; cast through `unknown` at this one
    // boundary rather than importing the Prisma enum into shared/client code.
    type: t.type as unknown as EditorTrack["type"],
    order: t.order,
    items: coerceTrackItems(t.items),
  }));
  const hasRealClips = dbTracks.some((t) => t.items.length > 0);

  const isMock = !hasRealClips && project.scenes.length === 0;
  const tracks: EditorTrack[] = hasRealClips
    ? dbTracks
    : project.scenes.length > 0
    ? buildAssetTracks(project.scenes, project.assets)
    : buildMockTracks(project.assets);

  // Pass every successfully generated scene clip to the browser preview.
  // The preview can stitch these clips together client-side without waiting
  // for the server-side FFmpeg export job.
  const sceneVideoUrls = project.scenes
    .map((scene) => scene.generatedVideos[0]?.url)
    .filter((url): url is string => Boolean(url));
  // Pass every successfully generated scene clip to the browser preview.
  // The preview can stitch these clips together client-side without waiting
  // for the server-side FFmpeg export job.
  const sceneVideoUrls = project.scenes
    .map((scene) => scene.generatedVideos[0]?.url)
    .filter((url): url is string => Boolean(url));
  // Pass every successfully generated scene clip to the browser preview.
  // The preview can stitch these clips together client-side without waiting
  // for the server-side FFmpeg export job.
  const sceneVideoUrls = project.scenes
    .map((scene) => scene.generatedVideos[0]?.url)
    .filter((url): url is string => Boolean(url));

  return (
    <div className="flex h-screen flex-col bg-void text-bone">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
        <span className="font-display italic text-bone">{project.name}</span>
        <div className="flex items-center gap-3 text-sm text-ash">
          <button className="hover:text-bone">Undo</button>
          <button className="hover:text-bone">Redo</button>
          <span className="text-xs">Saved</span>
          <ExportButton projectId={project.id} />
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Left tool rail */}
        <aside className="flex w-16 shrink-0 flex-col items-center gap-4 border-r border-white/10 py-4">
          {LEFT_TOOLS.map((tool) =>
            tool === "Brand" ? (
              <BrandToolButton key={tool} projectId={project.id} initialBrandKit={project.brandKit} />
            ) : (
              <button
                key={tool}
                title={tool}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-[10px] text-ash hover:bg-white/5 hover:text-bone"
              >
                {tool.slice(0, 2)}
              </button>
            )
          )}
        </aside>

        {/* Center: preview + timeline */}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-obsidian/40">
            <FullVideoPreview projectId={project.id} sceneUrls={sceneVideoUrls} />
            <FullVideoPreview projectId={project.id} sceneUrls={sceneVideoUrls} />
          </div>
          <div className="h-72 shrink-0 border-t border-white/10 bg-obsidian/60 p-3">
            <TimelineEditor projectId={project.id} initialTracks={tracks} isMock={isMock} />
          </div>
        </div>

        {/* Right: properties + AI assistant */}
        <aside className="w-80 shrink-0 overflow-y-auto border-l border-white/10 p-4">
          <CreativeStudioPanel
            projectId={project.id}
            initialBrief={project.brief}
            initialScript={project.script}
            initialSceneCount={project.scenes.length}
          />
        </aside>
      </div>
    </div>
  );
}
