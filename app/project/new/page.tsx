"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const PURPOSES = ["Commercial", "Social Media", "Documentary", "Film", "Explainer"];
const PLATFORMS = ["TikTok", "Instagram", "YouTube", "LinkedIn", "Custom"];
const ASPECTS = ["9:16", "1:1", "16:9"];

export default function NewProjectPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [platform, setPlatform] = useState(PLATFORMS[0]);
  const [aspectRatio, setAspectRatio] = useState(ASPECTS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, purpose, platform, aspectRatio }),
      });
      if (!res.ok) {
        const body = await res.json();
        throw new Error(body.error ?? "Could not create project");
      }
      const { project } = await res.json();
      router.push(`/project/${project.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not create project");
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <h1 className="font-display text-3xl italic text-bone">Start a project</h1>
      <p className="mt-2 text-sm text-ash">
        A few basics — the Creative Director will refine the rest with you inside the studio.
      </p>

      <form onSubmit={handleSubmit} className="mt-10 flex flex-col gap-6">
        <label className="flex flex-col gap-2">
          <span className="text-sm text-ash">Project name</span>
          <input
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Luxury perfume launch"
            className="rounded-lg border border-white/15 bg-obsidian/60 px-4 py-2.5 text-sm text-bone placeholder:text-ash"
          />
        </label>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm text-ash">Purpose</legend>
          <div className="flex flex-wrap gap-2">
            {PURPOSES.map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setPurpose(p)}
                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                  purpose === p
                    ? "border-signal bg-signal/10 text-bone"
                    : "border-white/15 text-ash hover:text-bone"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm text-ash">Platform</legend>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map((p) => (
              <button
                type="button"
                key={p}
                onClick={() => setPlatform(p)}
                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                  platform === p
                    ? "border-signal bg-signal/10 text-bone"
                    : "border-white/15 text-ash hover:text-bone"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm text-ash">Aspect ratio</legend>
          <div className="flex gap-2">
            {ASPECTS.map((a) => (
              <button
                type="button"
                key={a}
                onClick={() => setAspectRatio(a)}
                className={`rounded-full border px-4 py-1.5 text-sm transition ${
                  aspectRatio === a
                    ? "border-signal bg-signal/10 text-bone"
                    : "border-white/15 text-ash hover:text-bone"
                }`}
              >
                {a}
              </button>
            ))}
          </div>
        </fieldset>

        {error && <p className="text-sm text-ember">{error}</p>}

        <button
          type="submit"
          disabled={loading}
          className="mt-2 rounded-full bg-signal px-5 py-2.5 text-sm font-medium text-white transition hover:brightness-110 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create project"}
        </button>
      </form>
    </main>
  );
}
