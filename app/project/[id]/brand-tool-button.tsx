"use client";

import { useState } from "react";
import { Globe } from "lucide-react";

// Local shape, not the generated Prisma `BrandKit` type — same reasoning as
// creative-studio-panel.tsx's ScriptState.
interface BrandKitState {
  name: string;
  logoUrl: string | null;
  colors: unknown;
  fonts: unknown;
  voiceTone: string | null;
  toneKeywords: unknown;
  description: string | null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export default function BrandToolButton({
  projectId,
  initialBrandKit,
}: {
  projectId: string;
  initialBrandKit: BrandKitState | null;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [brandKit, setBrandKit] = useState<BrandKitState | null>(initialBrandKit);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function extract() {
    if (!url.trim() || loading) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/brand-kit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Brand kit extraction failed");
      setBrandKit(body.brandKit);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Brand kit extraction failed");
    } finally {
      setLoading(false);
    }
  }

  const colors = asStringArray(brandKit?.colors);
  const toneKeywords = asStringArray(brandKit?.toneKeywords);

  return (
    <>
      {/* Unlike the other left-rail entries (still layout placeholders with
          no onClick — see page.tsx), this one is a real, working feature:
          paste a URL, colors/fonts/voice get extracted automatically. It
          needs to visually read as "live" rather than blend in with the
          inert icons around it, so it gets a permanent accent border/icon
          instead of only lighting up once a kit exists. */}
      <button
        title="Brand — paste a website URL to auto-extract colors, fonts & voice"
        onClick={() => setOpen(true)}
        className={`flex h-10 w-10 flex-col items-center justify-center gap-0.5 rounded-lg border transition ${
          brandKit
            ? "border-signal/40 bg-signal/10 text-signal"
            : "border-signal/30 text-signal/80 hover:border-signal/60 hover:bg-signal/10 hover:text-signal"
        }`}
      >
        <Globe className="h-4 w-4" />
        <span className="text-[8px] leading-none">Brand</span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-xl2 border border-white/10 bg-void p-5 text-sm text-bone"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display italic">Brand Kit</h2>
              <button onClick={() => setOpen(false)} className="text-ash hover:text-bone">✕</button>
            </div>
            <p className="mt-1 text-xs text-ash">
              Paste a website URL — colors, fonts, and brand voice get extracted automatically.
            </p>

            <div className="mt-4 flex gap-2">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://example.com"
                className="flex-1 rounded-lg border border-white/15 bg-obsidian/60 px-3 py-2 text-xs text-bone placeholder:text-ash"
              />
              <button
                onClick={extract}
                disabled={loading || !url.trim()}
                className="rounded-full bg-signal px-4 text-xs font-medium text-white disabled:opacity-40"
              >
                {loading ? "Extracting…" : "Extract"}
              </button>
            </div>

            {error && (
              <p className="mt-3 rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-xs text-ember">
                {error}
              </p>
            )}

            {brandKit && (
              <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
                <div className="flex items-center gap-3">
                  {brandKit.logoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element -- external, unoptimized brand logo
                    <img src={brandKit.logoUrl} alt="" className="h-8 w-8 rounded bg-white/10 object-contain" />
                  )}
                  <span className="text-sm">{brandKit.name}</span>
                </div>

                {colors.length > 0 && (
                  <div className="flex gap-1.5">
                    {colors.slice(0, 8).map((c) => (
                      <span
                        key={c}
                        title={c}
                        className="h-6 w-6 rounded-full border border-white/20"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                )}

                {brandKit.voiceTone && (
                  <p className="text-xs">
                    <span className="text-ash">Voice: </span>
                    {brandKit.voiceTone}
                  </p>
                )}

                {toneKeywords.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {toneKeywords.map((k) => (
                      <span key={k} className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-ash">
                        {k}
                      </span>
                    ))}
                  </div>
                )}

                {brandKit.description && (
                  <p className="text-xs text-ash">{brandKit.description}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
