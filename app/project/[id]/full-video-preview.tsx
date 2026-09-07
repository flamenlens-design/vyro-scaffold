"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { dispatchPlaybackTime, PLAYBACK_EVENT, type PlaybackCommand } from "./playback-events";
import type { TimelineItem } from "./timeline-utils";

interface PreviewClip extends TimelineItem {
  thumbUrl: string;
}

export default function FullVideoPreview({
  projectId,
  sceneUrl,
  clips = [],
}: {
  projectId: string;
  sceneUrl?: string;
  clips?: TimelineItem[];
}) {
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [showFull, setShowFull] = useState(false);
  const [clipIndex, setClipIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const suppressEndedRef = useRef(false);

  const previewClips = useMemo<PreviewClip[]>(
    () => clips.filter((clip): clip is PreviewClip => Boolean(clip.thumbUrl)),
    [clips]
  );

  const previewDuration = useMemo(
    () => previewClips.reduce((sum, clip) => sum + Math.max(0, clip.end - clip.start), 0),
    [previewClips]
  );

  const activeClip = previewClips[clipIndex];
  const activeUrl = showFull && exportUrl ? exportUrl : activeClip?.thumbUrl ?? sceneUrl;

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/projects/${projectId}/export`, { cache: "no-store" });
        const body = await res.json();
        if (cancelled || !res.ok) return;
        setRendering(body.job?.status === "QUEUED" || body.job?.status === "RUNNING");
        if (body.job?.status === "SUCCEEDED" && body.job.url) setExportUrl(body.job.url);
      } catch {
        // transient — next tick retries
      }
    }
    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  const reportTime = useCallback(
    (time: number, isPlaying: boolean) => {
      dispatchPlaybackTime({ time, duration: previewDuration, playing: isPlaying });
    },
    [previewDuration]
  );

  const getGlobalTime = useCallback(() => {
    if (!activeClip || !videoRef.current) return 0;
    return activeClip.start + Math.max(0, videoRef.current.currentTime - activeClip.trimIn);
  }, [activeClip]);

  const seekGlobal = useCallback(
    (time: number) => {
      if (!previewClips.length) return;
      const clamped = Math.min(Math.max(time, 0), previewDuration);
      let targetIndex = previewClips.findIndex((clip) => clamped < clip.end || clip === previewClips[previewClips.length - 1]);
      if (targetIndex < 0) targetIndex = previewClips.length - 1;
      const clip = previewClips[targetIndex];
      const local = Math.max(0, clamped - clip.start) + clip.trimIn;

      suppressEndedRef.current = true;
      setClipIndex(targetIndex);
      window.setTimeout(() => {
        const video = videoRef.current;
        if (!video) return;
        video.currentTime = Math.min(local, Math.max(0, video.duration || local));
        suppressEndedRef.current = false;
        reportTime(clamped, !video.paused);
      }, 0);
    },
    [previewClips, previewDuration, reportTime]
  );

  useEffect(() => {
    function onCommand(event: Event) {
      const command = (event as CustomEvent<PlaybackCommand>).detail;
      const video = videoRef.current;
      if (!video || showFull || !previewClips.length) return;

      if (command.type === "play" || (command.type === "toggle" && video.paused)) {
        video.play().catch(() => setPlaying(false));
      } else if (command.type === "pause" || command.type === "toggle") {
        video.pause();
      } else if (command.type === "seek") {
        seekGlobal(command.time);
      }
    }

    window.addEventListener(PLAYBACK_EVENT, onCommand);
    return () => window.removeEventListener(PLAYBACK_EVENT, onCommand);
  }, [previewClips.length, seekGlobal, showFull]);

  useEffect(() => {
    if (activeUrl && videoRef.current) {
      videoRef.current.load();
      if (playing && !showFull) videoRef.current.play().catch(() => setPlaying(false));
    }
  }, [activeUrl, playing, showFull]);

  function handleTimeUpdate() {
    if (showFull || !activeClip || !videoRef.current) return;
    reportTime(getGlobalTime(), !videoRef.current.paused);
  }

  function handlePlay() {
    setPlaying(true);
    reportTime(getGlobalTime(), true);
  }

  function handlePause() {
    setPlaying(false);
    reportTime(getGlobalTime(), false);
  }

  function handleEnded() {
    if (suppressEndedRef.current || showFull) return;
    const nextIndex = clipIndex + 1;
    if (nextIndex < previewClips.length) {
      setClipIndex(nextIndex);
      setPlaying(true);
      window.setTimeout(() => videoRef.current?.play().catch(() => setPlaying(false)), 0);
    } else {
      setPlaying(false);
      reportTime(previewDuration, false);
    }
  }

  return (
    <div className="flex h-full max-h-full flex-col items-center justify-center gap-2">
      {activeUrl ? (
        <>
          <video
            ref={videoRef}
            key={activeUrl}
            src={activeUrl}
            controls
            playsInline
            onTimeUpdate={handleTimeUpdate}
            onPlay={handlePlay}
            onPause={handlePause}
            onEnded={handleEnded}
            className="aspect-[9/16] h-full max-h-full rounded-xl2 border border-white/10 bg-void object-cover"
          />
          {!showFull && previewClips.length > 0 && (
            <span className="text-[10px] text-ash">
              Scene {Math.min(clipIndex + 1, previewClips.length)} / {previewClips.length}
            </span>
          )}
        </>
      ) : (
        <div className="flex aspect-[9/16] h-[70%] items-center justify-center rounded-xl2 border border-white/10 bg-void text-xs text-ash">
          Generate a scene to preview your video
        </div>
      )}

      {exportUrl && previewClips.length > 0 && (
        <button
          onClick={() => {
            setShowFull((current) => !current);
            setPlaying(false);
          }}
          className="text-[11px] text-ash underline hover:text-bone"
        >
          {showFull ? "Preview generated scenes" : "Preview exported full video"}
        </button>
      )}
      {rendering && <span className="text-[10px] text-ash">Rendering the full video…</span>}
    </div>
  );
}
