// Stitches every scene's generated clip into one continuous MP4.
//
// Why this exists: each scene only ever gets its own short clip from the
// video provider (fal.ai/Kling/Seedance/Wan — typically ~4s, whatever
// scene.durationSec asked for). Nothing previously combined those clips —
// the studio's center preview (app/project/[id]/page.tsx) just played
// `project.scenes[0]`'s clip, and there was no download affordance for
// anything beyond that single <video> element. This module is the piece
// that turns "N separate short clips" into "one video", using ffmpeg
// (already installed in the Docker image — see the Dockerfile's runner
// stage comment) so it costs nothing beyond compute already being paid
// for, no new paid API involved.
//
// Source of truth for clip order/trim: the saved Timeline's VIDEO track
// (TimelineEditor's handleSave) when one exists, since that reflects
// whatever the user actually arranged/trimmed in the editor. Falls back to
// scene order with no trim when the user hasn't saved a timeline yet —
// mirrors buildAssetTracks' fallback in timeline-utils.ts.

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

async function loadExportPlan(projectId: string): Promise<{ clips: ExportClip[]; aspectRatio: string | null }> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      aspectRatio: true,
      timeline: { include: { tracks: { where: { type: "VIDEO" } } } },
      scenes: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          durationSec: true,
          generatedVideos: { where: { status: "SUCCEEDED" }, orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });
  if (!project) throw new Error("Project not found");

  const sceneUrlById = new Map(project.scenes.map((s) => [s.id, s.generatedVideos[0]?.url ?? null]));
  const savedVideoTrack = project.timeline?.tracks[0];

  let items: TimelineItem[];
  if (savedVideoTrack && savedVideoTrack.items && (savedVideoTrack.items as unknown[]).length > 0) {
    items = coerceTrackItems(savedVideoTrack.items);
  } else {
    // No saved timeline yet — fall back to raw scene order, full clip, no trim.
    items = project.scenes.map((s, i) => ({
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
  for (const item of items) {
    if (!item.sceneId) continue; // ignore non-scene rows (asset-backed items aren't part of the export MVP)
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

  return { clips, aspectRatio: project.aspectRatio };
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

/** Renders the full project video and returns its public URL + duration. */
export async function renderProjectExport(projectId: string): Promise<ExportResult> {
  const { clips, aspectRatio } = await loadExportPlan(projectId);
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

    const outputPath = join(workDir, "output.mp4");
    await execFileAsync("ffmpeg", [
      "-y",
      "-f", "concat",
      "-safe", "0",
      "-i", concatListPath,
      "-c", "copy",
      outputPath,
    ]);

    const key = `exports/${projectId}/${randomUUID()}.mp4`;
    const url = await uploadFileToS3(key, outputPath, "video/mp4");
    const durationSec = clips.reduce((sum, c) => sum + c.durationSec, 0);

    return { url, durationSec, clipCount: clips.length };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
