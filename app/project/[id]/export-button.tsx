"use client";

import { useEffect, useRef, useState } from "react";

interface ExportJobState {
  id: string;
  status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  error: string | null;
  url: string | null;
  durationSec: number | null;
}

export default function ExportButton({
  projectId,
  onExported,
}: {
  projectId: string;
  // Lets the parent (page.tsx via a small client wrapper) swap the center
  // preview over to the full stitched video once it's ready, instead of
  // just leaving the download link as the only way to see it.
  onExported?: (url: string) => void;
}) {
  const [job, setJob] = useState<ExportJobState | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notifiedRef = useRef<string | null>(null);

  const active = starting || job?.status === "QUEUED" || job?.status === "RUNNING";

  async function refresh() {
    try {
      const res = await fetch(`/api/projects/${projectId}/export`);
      const body = await res.json();
      if (res.ok) setJob(body.job);
    } catch {
      // transient — next poll tick retries
    }
  }

  async function startExport() {
    if (active) return;
    setError(null);
    setStarting(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/export`, { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Failed to start export");
      setJob({ id: body.job.id, status: body.job.status, error: null, url: null, durationSec: null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start export");
    } finally {
      setStarting(false);
    }
  }

  // Load whatever export state already exists (e.g. a previous render) on mount.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only
  }, []);

  useEffect(() => {
    if (job?.status !== "QUEUED" && job?.status !== "RUNNING") return;
    const interval = setInterval(refresh, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.status]);

  useEffect(() => {
    if (job?.status === "SUCCEEDED" && job.url && notifiedRef.current !== job.id) {
      notifiedRef.current = job.id;
      onExported?.(job.url);
    }
  }, [job, onExported]);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-ember">{error}</span>}
      {job?.status === "FAILED" && <span className="max-w-[220px] truncate text-xs text-ember" title={job.error ?? undefined}>{job.error ?? "Export failed"}</span>}

      {job?.status === "SUCCEEDED" && job.url ? (
        <>
          <a
            href={job.url}
            download
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-bone hover:bg-white/5"
          >
            Download
          </a>
          <button
            onClick={startExport}
            className="rounded-full bg-signal px-4 py-1.5 text-sm text-white hover:brightness-110"
          >
            Re-export
          </button>
        </>
      ) : (
        <button
          onClick={startExport}
          disabled={active}
          className="rounded-full bg-signal px-4 py-1.5 text-sm text-white hover:brightness-110 disabled:opacity-50"
        >
          {active ? "Rendering…" : "Export"}
        </button>
      )}
    </div>
  );
}
