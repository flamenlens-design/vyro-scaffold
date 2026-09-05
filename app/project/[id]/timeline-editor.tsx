"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Pause, Play, Minus, Plus } from "lucide-react";
import {
  type EditorTrack,
  type TimelineItem,
  MIN_CLIP_SECONDS,
  TRACK_COLORS,
  clipDuration,
  formatTime,
  repackTrack,
  timelineDuration,
} from "./timeline-utils";

type DragMode = "move" | "trim-left" | "trim-right";

interface DragContext {
  mode: DragMode;
  trackId: string;
  itemId: string;
  startX: number;
  pxPerSecond: number;
  // "move" snapshot
  originItems: TimelineItem[];
  // "trim-*" snapshot
  trimIn: number;
  trimOut: number;
  sourceDuration: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface SavedTrackPayload {
  id: string;
  type: EditorTrack["type"];
  order: number;
}

interface TimelineEditorProps {
  projectId: string;
  initialTracks: EditorTrack[];
  isMock: boolean;
}

export default function TimelineEditor({ projectId, initialTracks, isMock }: TimelineEditorProps) {
  const [tracks, setTracks] = useState<EditorTrack[]>(initialTracks);
  const [pxPerSecond, setPxPerSecond] = useState(50);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const dragCtxRef = useRef<DragContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);

  const duration = useMemo(() => Math.max(timelineDuration(tracks), 1), [tracks]);
  const LABEL_WIDTH = 96;
  const contentWidth = Math.max(700, duration * pxPerSecond + LABEL_WIDTH + 120);
  const tickStep = pxPerSecond < 40 ? 5 : pxPerSecond < 90 ? 2 : 1;
  const ticks = useMemo(() => {
    const count = Math.ceil(duration / tickStep) + 1;
    return Array.from({ length: count }, (_, i) => i * tickStep);
  }, [duration, tickStep]);

  // Playhead position clamped to the (possibly shrinking) timeline bounds.
  // Derived at render time rather than synced via a setState-in-effect —
  // `currentTime` itself may transiently exceed `duration` right after a
  // trim/reorder shrinks it, but every read goes through this clamped value,
  // so nothing ever displays or scrubs past the end of the timeline.
  const displayTime = Math.min(currentTime, duration);

  // Playback loop.
  useEffect(() => {
    if (!isPlaying) {
      lastTsRef.current = null;
      return;
    }
    function tick(ts: number) {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setCurrentTime((prev) => {
        const next = prev + dt;
        if (next >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return next;
      });
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, duration]);

  function scrubTo(clientX: number) {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const scrollLeft = scrollRef.current?.scrollLeft ?? 0;
    const x = clientX - rect.left + scrollLeft - LABEL_WIDTH;
    const t = clamp(x / pxPerSecond, 0, duration);
    setCurrentTime(t);
  }

  function handleRulerPointerDown(e: React.PointerEvent) {
    e.preventDefault();
    setIsPlaying(false);
    scrubTo(e.clientX);
    function onMove(ev: PointerEvent) {
      scrubTo(ev.clientX);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function beginDrag(ctx: DragContext) {
    dragCtxRef.current = ctx;
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  }

  function handlePointerMove(e: PointerEvent) {
    const ctx = dragCtxRef.current;
    if (!ctx) return;
    const dt = (e.clientX - ctx.startX) / ctx.pxPerSecond;

    if (ctx.mode === "move") {
      const dragged = ctx.originItems.find((i) => i.id === ctx.itemId);
      if (!dragged) return;
      const draggedCenter = (dragged.start + dragged.end) / 2 + dt;
      const others = ctx.originItems.filter((i) => i.id !== ctx.itemId);
      let insertAt = others.length;
      for (let idx = 0; idx < others.length; idx++) {
        const center = (others[idx].start + others[idx].end) / 2;
        if (draggedCenter < center) {
          insertAt = idx;
          break;
        }
      }
      const reordered = [...others];
      reordered.splice(insertAt, 0, dragged);
      const repacked = repackTrack(reordered);
      setTracks((prev) => prev.map((t) => (t.id === ctx.trackId ? { ...t, items: repacked } : t)));
    } else if (ctx.mode === "trim-left") {
      const maxTrimIn = ctx.sourceDuration - ctx.trimOut - MIN_CLIP_SECONDS;
      const newTrimIn = clamp(ctx.trimIn + dt, 0, Math.max(0, maxTrimIn));
      setTracks((prev) =>
        prev.map((t) =>
          t.id !== ctx.trackId
            ? t
            : { ...t, items: repackTrack(t.items.map((i) => (i.id === ctx.itemId ? { ...i, trimIn: newTrimIn } : i))) }
        )
      );
    } else {
      const maxTrimOut = ctx.sourceDuration - ctx.trimIn - MIN_CLIP_SECONDS;
      const newTrimOut = clamp(ctx.trimOut - dt, 0, Math.max(0, maxTrimOut));
      setTracks((prev) =>
        prev.map((t) =>
          t.id !== ctx.trackId
            ? t
            : { ...t, items: repackTrack(t.items.map((i) => (i.id === ctx.itemId ? { ...i, trimOut: newTrimOut } : i))) }
        )
      );
    }
    setIsDirty(true);
  }

  function handlePointerUp() {
    dragCtxRef.current = null;
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
  }

  function handleClipPointerDown(e: React.PointerEvent, track: EditorTrack, item: TimelineItem) {
    e.preventDefault();
    e.stopPropagation();
    setSelectedItemId(item.id);
    beginDrag({
      mode: "move",
      trackId: track.id,
      itemId: item.id,
      startX: e.clientX,
      pxPerSecond,
      originItems: track.items,
      trimIn: item.trimIn,
      trimOut: item.trimOut,
      sourceDuration: item.sourceDuration,
    });
  }

  function handleTrimPointerDown(e: React.PointerEvent, track: EditorTrack, item: TimelineItem, mode: "trim-left" | "trim-right") {
    e.preventDefault();
    e.stopPropagation();
    setSelectedItemId(item.id);
    beginDrag({
      mode,
      trackId: track.id,
      itemId: item.id,
      startX: e.clientX,
      pxPerSecond,
      originItems: track.items,
      trimIn: item.trimIn,
      trimOut: item.trimOut,
      sourceDuration: item.sourceDuration,
    });
  }

  async function handleSave() {
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/timeline`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tracks: tracks.map((t) => ({
            id: t.id.startsWith("mock-") ? undefined : t.id,
            type: t.type,
            order: t.order,
            items: t.items,
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save timeline");
      }
      const body: { tracks: SavedTrackPayload[] } = await res.json();
      setTracks((prev) =>
        prev.map((t, i) => {
          const saved = body.tracks[i];
          return saved ? { ...t, id: saved.id } : t;
        })
      );
      setIsDirty(false);
      setSaveState("saved");
    } catch (err: unknown) {
      setSaveState("error");
      setSaveError(err instanceof Error ? err.message : "Could not save timeline");
    }
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsPlaying((p) => !p)}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-signal text-white hover:brightness-110"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} className="translate-x-[1px]" />}
          </button>
          <span className="font-mono text-[11px] text-ash">
            {formatTime(displayTime)} / {formatTime(duration)}
          </span>
          {isMock && (
            <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-ash">
              Placeholder clips — no generated assets yet
            </span>
          )}
        </div>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPxPerSecond((z) => clamp(z - 15, 20, 160))}
              className="flex h-5 w-5 items-center justify-center rounded text-ash hover:text-bone"
              title="Zoom out"
            >
              <Minus size={11} />
            </button>
            <span className="w-9 text-center text-[10px] text-ash">{pxPerSecond}px/s</span>
            <button
              onClick={() => setPxPerSecond((z) => clamp(z + 15, 20, 160))}
              className="flex h-5 w-5 items-center justify-center rounded text-ash hover:text-bone"
              title="Zoom in"
            >
              <Plus size={11} />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-ash">
              {saveState === "saving"
                ? "Saving…"
                : saveState === "error"
                ? (saveError ?? "Save failed")
                : isDirty
                ? "Unsaved changes"
                : "Saved"}
            </span>
            <button
              onClick={handleSave}
              disabled={!isDirty || saveState === "saving"}
              className="rounded-full bg-signal px-3 py-1 text-[11px] font-medium text-white transition hover:brightness-110 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="relative flex-1 overflow-auto rounded-lg border border-white/10 bg-obsidian/40">
        <div style={{ width: contentWidth, minWidth: "100%" }} className="relative">
          {/* Ruler */}
          <div
            ref={rulerRef}
            onPointerDown={handleRulerPointerDown}
            className="sticky top-0 z-20 flex h-6 cursor-pointer select-none border-b border-white/10 bg-obsidian"
          >
            <div className="sticky left-0 z-30 shrink-0 border-r border-white/10 bg-obsidian" style={{ width: LABEL_WIDTH }} />
            <div className="relative flex-1">
              {ticks.map((t) => (
                <div key={t} className="absolute top-0 h-full text-[9px] text-ash" style={{ left: t * pxPerSecond }}>
                  <span className="ml-1">{formatTime(t)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Playhead */}
          <div
            className="pointer-events-none absolute top-6 bottom-0 z-20 w-px bg-signal"
            style={{ left: LABEL_WIDTH + displayTime * pxPerSecond }}
          />
          <div
            onPointerDown={handleRulerPointerDown}
            className="absolute top-0 z-30 h-6 w-3 -translate-x-1/2 cursor-ew-resize"
            style={{ left: LABEL_WIDTH + displayTime * pxPerSecond }}
          >
            <div className="mx-auto h-2.5 w-2.5 rotate-45 bg-signal" />
          </div>

          {/* Tracks */}
          {tracks.map((track) => {
            const palette = TRACK_COLORS[track.type];
            return (
              <div key={track.id} className="flex border-b border-white/5">
                <div
                  className="sticky left-0 z-10 flex shrink-0 items-center border-r border-white/10 bg-obsidian px-3 text-[11px] text-ash"
                  style={{ width: LABEL_WIDTH }}
                >
                  {palette.label}
                </div>
                <div className="relative h-14 flex-1">
                  {track.items.map((item) => {
                    const width = Math.max(6, clipDuration(item) * pxPerSecond);
                    const selected = selectedItemId === item.id;
                    return (
                      <div
                        key={item.id}
                        onPointerDown={(e) => handleClipPointerDown(e, track, item)}
                        className={`group absolute top-1.5 bottom-1.5 flex cursor-grab items-center rounded-md border px-2.5 text-[11px] text-bone transition active:cursor-grabbing ${palette.bg} ${palette.border} ${
                          selected ? "ring-1 ring-signal" : ""
                        }`}
                        style={{ left: item.start * pxPerSecond, width }}
                      >
                        <div
                          onPointerDown={(e) => handleTrimPointerDown(e, track, item, "trim-left")}
                          className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize rounded-l-md bg-white/10 opacity-0 group-hover:opacity-100 hover:bg-white/40"
                        />
                        <span className="truncate select-none">{item.label}</span>
                        <div
                          onPointerDown={(e) => handleTrimPointerDown(e, track, item, "trim-right")}
                          className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize rounded-r-md bg-white/10 opacity-0 group-hover:opacity-100 hover:bg-white/40"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
