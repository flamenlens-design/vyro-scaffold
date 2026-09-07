"use client";

import { useEffect, useRef, useState } from "react";

export default function FullVideoPreview({
  projectId,
  sceneUrls,
}: {
  projectId: string;
  sceneUrls: string[];
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [showFullExport, setShowFullExport] = useState(false);
  const [sceneIndex, setSceneIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

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
        // Export status is optional for the browser preview; retry on the next tick.
      }
    }
    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  // Keep the current clip in sync when a generated scene list arrives/changes.
  useEffect(() => {
    setSceneIndex((i) => Math.min(i, Math.max(0, sceneUrls.length - 1)));
  }, [sceneUrls.length]);

  const activeSceneUrl = sceneUrls[sceneIndex];
  const activeUrl = showFullExport && exportUrl ? exportUrl : activeSceneUrl;

  function playCurrent() {
    const video = videoRef.current;
    if (!video) return;
    void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
  }

  function pauseCurrent() {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setPlaying(false);
  }

  function handleEnded() {
    if (showFullExport) {
      setPlaying(false);
      return;
    }
    const next = sceneIndex + 1;
    if (next < sceneUrls.length) {
      setSceneIndex(next);
      // The source changes after state commits; the effect below starts it.
    } else {
      setPlaying(false);
    }
  }

  // When advancing from one scene to the next, preserve continuous playback.
  useEffect(() => {
    if (!playing || showFullExport || !activeSceneUrl) return;
    const video = videoRef.current;
    if (!video) return;
    video.load();
    void video.play().catch(() => setPlaying(false));
  }, [sceneIndex, activeSceneUrl, playing, showFullExport]);

  if (!activeUrl) {
    return (
      <div className="flex h-full max-h-full flex-col items-center justify-center gap-2">
        <div className="flex aspect-[9/16] h-[70%] items-center justify-center rounded-xl2 border border-white/10 bg-void px-6 text-center text-xs text-ash">
          Generate scene videos to preview the full sequence.
        </div>
        {rendering && <span className="text-[10px] text-ash">Rendering the full video…</span>}
      </div>
    );
  }

  return (
    <div className="flex h-full max-h-full flex-col items-center justify-center gap-2">
      <video
        ref={videoRef}
        key={`${showFullExport ? "export" : "scene"}-${showFullExport ? exportUrl : activeSceneUrl}`}
        src={activeUrl}
        controls
        playsInline
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={handleEnded}
        className="aspect-[9/16] h-full max-h-full rounded-xl2 border border-white/10 bg-void object-cover"
      />

      {!showFullExport && sceneUrls.length > 1 && (
        <div className="flex items-center gap-2 text-[11px] text-ash">
          <button
            onClick={() => {
              pauseCurrent();
              setSceneIndex((i) => Math.max(0, i - 1));
            }}
            disabled={sceneIndex === 0}
            className="rounded border border-white/10 px-2 py-1 hover:text-bone disabled:opacity-30"
          >
            Previous
          </button>
          <span>
            Scene {sceneIndex + 1} / {sceneUrls.length}
          </span>
          <button
            onClick={() => {
              pauseCurrent();
              setSceneIndex((i) => Math.min(sceneUrls.length - 1, i + 1));
            }}
            disabled={sceneIndex === sceneUrls.length - 1}
            className="rounded border border-white/10 px-2 py-1 hover:text-bone disabled:opacity-30"
          >
            Next
          </button>
          <button
            onClick={() => (playing ? pauseCurrent() : playCurrent())}
            className="rounded border border-white/10 px-2 py-1 hover:text-bone"
          >
            {playing ? "Pause sequence" : "Play sequence"}
          </button>
        </div>
      )}

      {exportUrl && sceneUrls.length > 0 && (
        <button
          onClick={() => {
            setPlaying(false);
            setShowFullExport((s) => !s);
          }}
          className="text-[11px] text-ash underline hover:text-bone"
        >
          {showFullExport ? "Preview generated scenes" : "Preview rendered full video"}
        </button>
      )}

      {rendering && <span className="text-[10px] text-ash">Rendering the full video…</span>}
    </div>
  );
}
