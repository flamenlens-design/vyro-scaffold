"use client";

import { useEffect, useState } from "react";

export default function FullVideoPreview({
  projectId,
  sceneUrl,
}: {
  projectId: string;
  sceneUrl?: string;
}) {
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [showFull, setShowFull] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const res = await fetch(`/api/projects/${projectId}/export`);
        const body = await res.json();
        if (cancelled || !res.ok) return;
        setRendering(body.job?.status === "QUEUED" || body.job?.status === "RUNNING");
        if (body.job?.status === "SUCCEEDED" && body.job.url) setExportUrl(body.job.url);
      } catch {
        // transient — next tick retries
      }
    }
    poll();
    // Only a light background poll — this pane doesn't drive the render,
    // it just reflects whatever ExportButton (in the header) kicked off,
    // so it can hand off from "first scene" to "full video" the moment
    // it's ready without the user having to reload.
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [projectId]);

  const activeUrl = showFull && exportUrl ? exportUrl : sceneUrl;

  return (
    <div className="flex h-full max-h-full flex-col items-center justify-center gap-2">
      {activeUrl ? (
        <video
          key={activeUrl}
          src={activeUrl}
          controls
          className="aspect-[9/16] h-full max-h-full rounded-xl2 border border-white/10 bg-void object-cover"
        />
      ) : (
        <div className="aspect-[9/16] h-[70%] rounded-xl2 border border-white/10 bg-void" />
      )}
      {exportUrl && sceneUrl && (
        <button
          onClick={() => setShowFull((s) => !s)}
          className="text-[11px] text-ash underline hover:text-bone"
        >
          {showFull ? "Preview a single scene instead" : "Preview full video"}
        </button>
      )}
      {rendering && <span className="text-[10px] text-ash">Rendering the full video…</span>}
    </div>
  );
}
