// Shared types + helpers for the timeline editor. Kept separate from the client
// component so the server page (page.tsx) can import the types without pulling
// in "use client" code.

// Mirrors the `TrackType` enum in prisma/schema.prisma. Kept as a local
// literal-union type (rather than importing Prisma's generated enum) so this
// file — and the client component that imports it — never pulls in
// `@prisma/client` at the type level. page.tsx and the timeline API route
// cast at the boundary where Prisma's enum meets this type.
export type TrackType = "VIDEO" | "AUDIO" | "MUSIC" | "VOICEOVER" | "CAPTION" | "OVERLAY";

// One clip inside TimelineTrack.items. Matches the shape documented in the
// Prisma schema comment: `{assetId/sceneId, start, end, trimIn, trimOut, effects}`.
// `start`/`end` are the clip's position on the timeline in seconds and are
// derived (not hand-edited) — this editor keeps clips within a track packed
// back-to-back with no gaps/overlaps, so start/end fall out of ordering +
// trim state. `sourceDuration` is the untrimmed length of the underlying
// asset and bounds how far the trim handles can be dragged.
export interface TimelineItem {
  id: string;
  assetId?: string;
  sceneId?: string;
  label: string;
  thumbUrl?: string;
  start: number;
  end: number;
  trimIn: number;
  trimOut: number;
  sourceDuration: number;
  effects?: Record<string, unknown>;
}

export interface EditorTrack {
  id: string;
  type: TrackType;
  order: number;
  items: TimelineItem[];
}

export const MIN_CLIP_SECONDS = 0.3;

export const TRACK_COLORS: Record<TrackType, { bg: string; border: string; label: string }> = {
  VIDEO: { bg: "bg-signal/20", border: "border-signal/50", label: "Video" },
  AUDIO: { bg: "bg-ember/20", border: "border-ember/50", label: "Audio" },
  MUSIC: { bg: "bg-emerald-500/15", border: "border-emerald-500/40", label: "Music" },
  VOICEOVER: { bg: "bg-sky-500/15", border: "border-sky-500/40", label: "Voiceover" },
  CAPTION: { bg: "bg-amber-500/15", border: "border-amber-500/40", label: "Captions" },
  OVERLAY: { bg: "bg-fuchsia-500/15", border: "border-fuchsia-500/40", label: "Overlay" },
};

/** Visible (post-trim) duration of a clip. */
export function clipDuration(item: TimelineItem): number {
  return Math.max(MIN_CLIP_SECONDS, item.sourceDuration - item.trimIn - item.trimOut);
}

/**
 * Recomputes start/end for every item in a track so clips sit back-to-back
 * in array order, starting at 0. Call this after any reorder or trim.
 */
export function repackTrack(items: TimelineItem[]): TimelineItem[] {
  let cursor = 0;
  return items.map((item) => {
    const duration = clipDuration(item);
    const start = cursor;
    const end = cursor + duration;
    cursor = end;
    return { ...item, start, end };
  });
}

export function trackDuration(track: EditorTrack): number {
  const last = track.items[track.items.length - 1];
  return last ? last.end : 0;
}

export function timelineDuration(tracks: EditorTrack[]): number {
  return tracks.reduce((max, t) => Math.max(max, trackDuration(t)), 0);
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, seconds);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.floor((s - Math.floor(s)) * 100);
  return `${mm}:${ss.toString().padStart(2, "0")}.${cs.toString().padStart(2, "0")}`;
}

/**
 * Defensively coerces a TimelineTrack.items JSON value (untyped at the
 * Prisma level) into TimelineItem[]. Unknown/missing fields fall back to
 * sane defaults rather than throwing, since this is user-editable JSON that
 * could predate this editor's shape. Always repacks afterward so start/end
 * are internally consistent even if the stored values were stale.
 */
export function coerceTrackItems(raw: unknown): TimelineItem[] {
  if (!Array.isArray(raw)) return [];
  const items = raw
    .filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    .map((v, i) => {
      const trimIn = typeof v.trimIn === "number" ? v.trimIn : 0;
      const trimOut = typeof v.trimOut === "number" ? v.trimOut : 0;
      const inferredFromRange =
        typeof v.start === "number" && typeof v.end === "number" ? v.end - v.start : undefined;
      const sourceDuration =
        typeof v.sourceDuration === "number"
          ? v.sourceDuration
          : Math.max(MIN_CLIP_SECONDS, (inferredFromRange ?? 3) + trimIn + trimOut);

      const item: TimelineItem = {
        id: typeof v.id === "string" ? v.id : `item-${i}`,
        assetId: typeof v.assetId === "string" ? v.assetId : undefined,
        sceneId: typeof v.sceneId === "string" ? v.sceneId : undefined,
        label:
          typeof v.label === "string"
            ? v.label
            : typeof v.assetId === "string"
            ? v.assetId
            : `Clip ${i + 1}`,
        thumbUrl: typeof v.thumbUrl === "string" ? v.thumbUrl : undefined,
        start: 0,
        end: 0,
        trimIn,
        trimOut,
        sourceDuration: Math.max(sourceDuration, trimIn + trimOut + MIN_CLIP_SECONDS),
        effects:
          typeof v.effects === "object" && v.effects !== null
            ? (v.effects as Record<string, unknown>)
            : undefined,
      };
      return item;
    });
  return repackTrack(items);
}

interface MockAssetSeed {
  id: string;
  name: string | null;
  type: string;
  url: string;
}

interface SceneWithVideo {
  id: string;
  order: number;
  durationSec: number;
  visualDesc: string;
  generatedVideos: { url: string | null }[]; // pass pre-filtered to SUCCEEDED, take: 1
}

/**
 * Builds the video track from real per-scene generation state — this is the
 * piece that was missing even after the worker started actually persisting
 * results: the worker writes to GeneratedVideo (keyed by sceneId), but
 * nothing ever read that table for display. buildMockTracks below only ever
 * looked at the project-level Asset list (VIDEO/IMAGE type), which no scene
 * video ever lands in — so generated clips were invisible in the timeline
 * regardless of how many succeeded. A scene without a succeeded video yet
 * still gets a placeholder block (so the track shows the full intended
 * shape of the video), it just has no thumbUrl/assetId.
 */
function buildVideoTrackFromScenes(scenes: SceneWithVideo[]): TimelineItem[] {
  const items: TimelineItem[] = scenes.map((scene, i) => {
    const video = scene.generatedVideos[0];
    return {
      id: `scene-video-${scene.id}`,
      sceneId: scene.id,
      label: video?.url ? `Scene ${scene.order + 1}` : `Scene ${scene.order + 1} — pending`,
      thumbUrl: video?.url ?? undefined,
      start: 0,
      end: 0,
      trimIn: 0,
      trimOut: 0,
      sourceDuration: Math.max(MIN_CLIP_SECONDS, scene.durationSec || 3.5),
    };
  });
  return repackTrack(items);
}

/**
 * Real tracks built from actual project state (scenes' generated videos +
 * project-level voiceover/music assets) — used whenever a project has
 * scenes, regardless of whether every scene has finished generating yet.
 * Distinct from buildMockTracks (below), which is the true empty-project
 * placeholder shown before any storyboard exists at all.
 */
export function buildAssetTracks(scenes: SceneWithVideo[], assets: MockAssetSeed[]): EditorTrack[] {
  const voiceAssets = assets.filter((a) => a.type === "VOICEOVER");
  const musicAssets = assets.filter((a) => a.type === "MUSIC");

  const voiceItems: TimelineItem[] = [
    {
      id: "voiceover-0",
      assetId: voiceAssets[0]?.id,
      label: voiceAssets[0]?.name ?? "Voiceover — not generated yet",
      thumbUrl: voiceAssets[0]?.url,
      start: 0,
      end: 0,
      trimIn: 0,
      trimOut: 0,
      sourceDuration: 12.5,
    },
  ];

  const musicItems: TimelineItem[] = [
    {
      id: "music-0",
      assetId: musicAssets[0]?.id,
      label: musicAssets[0]?.name ?? "Background music — not generated yet",
      thumbUrl: musicAssets[0]?.url,
      start: 0,
      end: 0,
      trimIn: 0,
      trimOut: 0,
      sourceDuration: 14,
    },
  ];

  return [
    { id: "video-track", type: "VIDEO", order: 0, items: buildVideoTrackFromScenes(scenes) },
    { id: "voiceover-track", type: "VOICEOVER", order: 1, items: repackTrack(voiceItems) },
    { id: "music-track", type: "MUSIC", order: 2, items: repackTrack(musicItems) },
  ];
}

/**
 * Builds placeholder tracks when a project has no scenes yet at all (before
 * a storyboard has ever been generated) — the true empty-state mock, not to
 * be confused with buildAssetTracks above, which handles the (far more
 * common) case of scenes existing with generation in progress or partially
 * done.
 */
export function buildMockTracks(assets: MockAssetSeed[]): EditorTrack[] {
  const videoAssets = assets.filter((a) => a.type === "VIDEO" || a.type === "IMAGE");
  const voiceAssets = assets.filter((a) => a.type === "VOICEOVER");
  const musicAssets = assets.filter((a) => a.type === "MUSIC");

  const videoLabels =
    videoAssets.length > 0
      ? videoAssets.map((a) => a.name ?? "Clip").slice(0, 5)
      : ["Scene 1 — hook", "Scene 2 — context", "Scene 3 — payoff", "Scene 4 — CTA"];

  const videoItems: TimelineItem[] = videoLabels.map((label, i) => ({
    id: `mock-video-${i}`,
    assetId: videoAssets[i]?.id,
    label,
    thumbUrl: videoAssets[i]?.url,
    start: 0,
    end: 0,
    trimIn: 0,
    trimOut: 0,
    sourceDuration: [3.5, 4.2, 3.8, 2.5][i % 4],
  }));

  const voiceLabel = voiceAssets[0]?.name ?? "Voiceover — draft take";
  const voiceItems: TimelineItem[] = [
    {
      id: "mock-voice-0",
      assetId: voiceAssets[0]?.id,
      label: voiceLabel,
      start: 0,
      end: 0,
      trimIn: 0,
      trimOut: 0,
      sourceDuration: 12.5,
    },
  ];

  const musicLabel = musicAssets[0]?.name ?? "Background music — draft";
  const musicItems: TimelineItem[] = [
    {
      id: "mock-music-0",
      assetId: musicAssets[0]?.id,
      label: musicLabel,
      start: 0,
      end: 0,
      trimIn: 0,
      trimOut: 0,
      sourceDuration: 14,
    },
  ];

  const captionItems: TimelineItem[] = [
    { id: "mock-cap-0", label: "\"Ever wondered why...\"", start: 0, end: 0, trimIn: 0, trimOut: 0, sourceDuration: 3.5 },
    { id: "mock-cap-1", label: "\"Here's the answer.\"", start: 0, end: 0, trimIn: 0, trimOut: 0, sourceDuration: 4.2 },
    { id: "mock-cap-2", label: "\"So what changed?\"", start: 0, end: 0, trimIn: 0, trimOut: 0, sourceDuration: 3.8 },
    { id: "mock-cap-3", label: "\"Try it yourself.\"", start: 0, end: 0, trimIn: 0, trimOut: 0, sourceDuration: 2.5 },
  ];

  return [
    { id: "mock-track-video", type: "VIDEO", order: 0, items: repackTrack(videoItems) },
    { id: "mock-track-voiceover", type: "VOICEOVER", order: 1, items: repackTrack(voiceItems) },
    { id: "mock-track-music", type: "MUSIC", order: 2, items: repackTrack(musicItems) },
    { id: "mock-track-caption", type: "CAPTION", order: 3, items: repackTrack(captionItems) },
  ];
}
