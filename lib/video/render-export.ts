// Stitches every scene's generated clip into one continuous MP4, and mixes
// in the Voiceover + Music tracks on top.
//
// Why this exists: each scene only ever gets its own short clip from the
// video provider (fal.ai/Kling/Seedance/Wan — typically ~4s, whatever
// scene.durationSec asked for). Nothing previously combined those clips —
// the studio's center preview (app/project/[id]/page.tsx) just played
// `project.scenes[0]`'s clip, and there was no download affordance for
// anything beyond that single <video> element. This module is the piece
// that turns "N separate short clips + a voiceover track + a music track"
// into one video, using ffmpeg (already installed in the Docker image —
// see the Dockerfile's runner stage comment) so it costs nothing beyond
// compute already being paid for, no new paid API involved.
//
// Source of truth for clip order/trim/timing: the saved Timeline's tracks
// (TimelineEditor's handleSave) when one exists, since that reflects
// whatever the user actually arranged/trimmed in the editor. Falls back to
// scene order (video) / the most recent generated asset (voiceover, music)
// when the user hasn't saved a timeline yet — mirrors buildAssetTracks'
// fallback in timeline-utils.ts.
//
// Audio: every scene clip's own audio (if the video model generated any —
// dialogue, ambient, lip-synced sound) is kept, not muted. The Voiceover
// and Music tracks are layered on top at their real timeline positions,
// with Music ducked so narration and dialogue stay intelligible.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { uploadFileToS3 } from "@/lib/utils/s3";
import { coerceTrackItems, type TimelineItem } from "@/app/project/[id]/timeline-utils";

const execFileAsync = promisify(execFile);

interface ExportClip {
  sceneId: string;
  sourceUrl: string;
  trimIn: number;
  durationSec: number;
}

interface AudioLayerPlan {
  kind: "voiceover" | "music";
  sourceUrl: string;
  startSec: number;
  trimIn: number;
}

interface ExportResult {
  url: string;
  durationSec: number;
  clipCount: number;
}

// Target render resolution per aspect ratio — clips from different
// providers/models can come back at different resolutions/fps/codecs, so
// every clip gets normalized to this before concatenation. Without this,
// ffmpeg's concat either fails outright (mismatched codec) or the demuxer
// silently uses the first clip's parameters, cropping/distorting the rest.
function targetResolution(aspectRatio: string | null): { w: number; h: number } {
  switch (aspectRatio) {
    case "16:9":
      return { w: 1920, h: 1080 };
    case "1:1":
      return { w: 1080, h: 1080 };
    case "9:16":
    default:
      return { w: 1080, h: 1920 };
  }
}

function itemsFromTrack(track: { items: unknown } | undefined): TimelineItem[] {
  if (!track) return [];
  const raw = track.items as unknown[];
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return coerceTrackItems(track.items);
}

async function loadExportPlan(
  projectId: string
): Promise<{ clips: ExportClip[]; audioLayers: AudioLayerPlan[]; aspectRatio: string | null }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      aspectRatio: true,
      timeline: { include: { tracks: true } },
      scenes: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          durationSec: true,
          generatedVideos: { where: { status: "SUCCEEDED" }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
      assets: {
        where: { type: { in: ["VOICEOVER", "MUSIC"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, url: true, type: true },
      },
    },
  });
  if (!project) throw new Error("Project not found");

  // ---- Video track ----
  const sceneUrlById = new Map(project.scenes.map((s) => [s.id, s.generatedVideos[0]?.url ?? null]));
  const savedVideoTrack = project.timeline?.tracks.find((t) => t.type === "VIDEO");

  let videoItems: TimelineItem[] = itemsFromTrack(savedVideoTrack);
  if (videoItems.length === 0) {
    // No saved timeline yet — fall back to raw scene order, full clip, no trim.
    videoItems = project.scenes.map((s, i) => ({
      id: `scene-${s.id}`,
      sceneId: s.id,
      label: `Scene ${i + 1}`,
      start: 0,
      end: 0,
      trimIn: 0,
      trimOut: 0,
      sourceDuration: s.durationSec,
    }));
  }

  const missing: string[] = [];
  const clips: ExportClip[] = [];
  for (const item of videoItems) {
    if (!item.sceneId) continue; // ignore non-scene rows
    const url = sceneUrlById.get(item.sceneId);
    if (!url) {
      missing.push(item.label);
      continue;
    }
    const duration = Math.max(0.1, item.sourceDuration - item.trimIn - item.trimOut);
    clips.push({ sceneId: item.sceneId, sourceUrl: url, trimIn: item.trimIn, durationSec: duration });
  }

  if (missing.length > 0) {
    throw new Error(
      `Can't export yet — these clips haven't finished generating: ${missing.join(", ")}. ` +
        `Wait for generation to complete (or remove them from the timeline) and try again.`
    );
  }
  if (clips.length === 0) {
    throw new Error("Nothing to export — generate at least one scene's video first.");
  }

  // ---- Voiceover / Music tracks ----
  const assetById = new Map(project.assets.map((a) => [a.id, a]));
  const audioLayers: AudioLayerPlan[] = [];

  function collectTrackLayer(type: "VOICEOVER" | "MUSIC", kind: "voiceover" | "music") {
    const track = project!.timeline?.tracks.find((t) => t.type === type);
    const items = itemsFromTrack(track).filter((i) => i.assetId && assetById.has(i.assetId));
    if (items.length > 0) {
      for (const item of items) {
        audioLayers.push({ kind, sourceUrl: assetById.get(item.assetId!)!.url, startSec: item.start, trimIn: item.trimIn });
      }
      return;
    }
    // No saved timeline placement for this track — fall back to the most
    // recently generated asset of this type, played from the start.
    const latest = project!.assets.find((a) => a.type === type);
    if (latest) audioLayers.push({ kind, sourceUrl: latest.url, startSec: 0, trimIn: 0 });
  }
  collectTrackLayer("VOICEOVER", "voiceover");
  collectTrackLayer("MUSIC", "music");

  return { clips, audioLayers, aspectRatio: project.aspectRatio };
}

async function downloadTo(url: string, destPath: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download clip (${res.status}): ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
}

// Different scenes can come back from different video models (kling /
// seedance / wan — see FAL_VIDEO_MODELS), and not all of them return an
// audio track. The concat demuxer used below assumes every input has the
// same streams; a silent clip sitting next to ones with audio desyncs or
// gets dropped. Checking per-clip and padding in silence when needed keeps
// every normalized clip's stream layout identical so concatenation is safe.
async function hasAudioStream(path: string): Promise<boolean> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-select_streams", "a",
    "-show_entries", "stream=index",
    "-of", "csv=p=0",
    path,
  ]);
  return stdout.trim().length > 0;
}

async function probeDuration(path: string): Promise<number> {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    path,
  ]);
  const d = parseFloat(stdout.trim());
  return Number.isFinite(d) ? d : 0;
}

/**
 * Downloads + trims a voiceover/music source and shifts it to its real
 * position on the timeline (silence-padded) so it lines up with the
 * concatenated video when mixed in later. Returns null if there's nothing
 * usable left after trimming (e.g. the layer starts past the end of the
 * video, or the source is empty).
 */
async function buildAudioLayer(
  workDir: string,
  index: number,
  layer: AudioLayerPlan,
  totalDurationSec: number
): Promise<string | null> {
  if (layer.startSec >= totalDurationSec) return null;

  const rawPath = join(workDir, `audio_raw_${index}`);
  await downloadTo(layer.sourceUrl, rawPath);
  const probed = await probeDuration(rawPath);
  const available = Math.max(0, probed - layer.trimIn);
  const duration = Math.min(available, totalDurationSec - layer.startSec);
  if (duration <= 0.05) return null;

  const outPath = join(workDir, `audio_layer_${index}.wav`);
  const delayMs = Math.round(layer.startSec * 1000);
  // Music sits under narration/dialogue rather than competing with it —
  // voiceover and each clip's own audio are left at full volume.
  const volumeFilter = layer.kind === "music" ? ",volume=0.3" : "";

  await execFileAsync("ffmpeg", [
    "-y",
    "-ss", String(layer.trimIn), "-i", rawPath,
    "-t", String(duration),
    "-af", `aformat=channel_layouts=stereo,adelay=${delayMs}|${delayMs}${volumeFilter}`,
    "-ar", "48000", "-ac", "2",
    outPath,
  ]);
  return outPath;
}

/** Renders the full project video and returns its public URL + duration. */
export async function renderProjectExport(projectId: string): Promise<ExportResult> {
  const { clips, audioLayers, aspectRatio } = await loadExportPlan(projectId);
  const { w, h } = targetResolution(aspectRatio);

  const workDir = await mkdtemp(join(tmpdir(), "vyro-export-"));
  try {
    const normalizedPaths: string[] = [];

    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const rawPath = join(workDir, `raw_${i}.mp4`);
      const normPath = join(workDir, `norm_${i}.mp4`);
      await downloadTo(clip.sourceUrl, rawPath);
      const withAudio = await hasAudioStream(rawPath);

      // -ss before -i for fast input seeking; scale+pad normalizes every
      // clip to the same resolution (letterboxed, never stretched) and
      // -r/-c:v/-c:a pin a common fps/codec so the concat step below can
      // stream-copy instead of re-encoding twice. Clips with no audio get
      // an explicit silent track muxed in (see hasAudioStream above) so
      // every normalized clip has the same stream layout going into concat.
      // Each clip's own audio (dialogue/ambient) is kept as-is here — it's
      // the base layer that voiceover/music get mixed on top of below.
      const args = withAudio
        ? [
            "-y",
            "-ss", String(clip.trimIn), "-i", rawPath,
            "-t", String(clip.durationSec),
            "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
            "-r", "30",
            "-c:v", "libx264", "-preset", "veryfast",
            "-c:a", "aac", "-ar", "48000", "-ac", "2",
            "-pix_fmt", "yuv420p",
            normPath,
          ]
        : [
            "-y",
            "-ss", String(clip.trimIn), "-i", rawPath,
            "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=48000",
            "-t", String(clip.durationSec),
            "-vf", `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`,
            "-r", "30",
            "-map", "0:v:0", "-map", "1:a:0",
            "-c:v", "libx264", "-preset", "veryfast",
            "-c:a", "aac", "-ar", "48000", "-ac", "2",
            "-pix_fmt", "yuv420p",
            "-shortest",
            normPath,
          ];
      await execFileAsync("ffmpeg", args);
      normalizedPaths.push(normPath);
    }

    const concatListPath = join(workDir, "concat.txt");
    await writeFile(
      concatListPath,
      normalizedPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n")
    );

    const concatenatedPath = join(workDir, "concatenated.mp4");
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatListPath,
      "-c", "copy",
      concatenatedPath,
    ]);

    const durationSec = clips.reduce((sum, c) => sum + c.durationSec, 0);

    // ---- Layer in voiceover + music at their real timeline positions ----
    const layerPaths: string[] = [];
    for (let i = 0; i < audioLayers.length; i++) {
      const built = await buildAudioLayer(workDir, i, audioLayers[i], durationSec);
      if (built) layerPaths.push(built);
    }

    let finalPath = concatenatedPath;
    if (layerPaths.length > 0) {
      finalPath = join(workDir, "final.mp4");
      const inputArgs: string[] = ["-i", concatenatedPath];
      layerPaths.forEach((p) => inputArgs.push("-i", p));
      const audioRefs = ["[0:a]", ...layerPaths.map((_, i) => `[${i + 1}:a]`)].join("");
      // duration=first pins the mixed-down output to the concatenated
      // video's own audio length, so voiceover/music never extend the
      // final video even if their source files run longer.
      const filter = `${audioRefs}amix=inputs=${layerPaths.length + 1}:duration=first:dropout_transition=0[aout]`;
      await execFileAsync("ffmpeg", [
        "-y",
        ...inputArgs,
        "-filter_complex", filter,
        "-map", "0:v:0", "-map", "[aout]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k",
        finalPath,
      ]);
    }

    const key = `exports/${projectId}/${randomUUID()}.mp4`;
    const url = await uploadFileToS3(key, finalPath, "video/mp4");

    return { url, durationSec, clipCount: clips.length };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}