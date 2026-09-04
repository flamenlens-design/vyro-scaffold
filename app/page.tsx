import Link from "next/link";

const WORKFLOW = [
  { step: "Script", detail: "Paste a rough idea. The AI refines it into a structured, paced script — you accept or reject every change." },
  { step: "Storyboard", detail: "Each scene gets a shot, camera move, lighting note, and generation prompt — before a single frame renders." },
  { step: "Generation", detail: "Compare the same scene across multiple models, side by side, and keep the one that's actually right." },
  { step: "Edit", detail: "A real timeline with captions, music, and branding — plus an AI editor that can act on a plain-language note." },
];

export default function LandingPage() {
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-white/5">
        <div className="mx-auto max-w-6xl px-6 pt-28 pb-24 md:pt-36 md:pb-32">
          <div className="grid gap-16 md:grid-cols-[1.1fr_0.9fr] md:items-end">
            <div>
              <h1 className="font-display text-[13vw] leading-[0.95] italic tracking-tight text-bone md:text-7xl">
                From an idea<br />to a film.
              </h1>
              <p className="mt-8 max-w-md text-lg text-ash">
                Write, direct, generate, edit, and publish cinematic videos with AI —
                with a creative director in the loop at every decision.
              </p>
              <div className="mt-10 flex items-center gap-5">
                <Link
                  href="/dashboard"
                  className="rounded-full bg-signal px-7 py-3 text-sm font-medium text-white transition hover:brightness-110"
                >
                  Start a project
                </Link>
                <Link href="#workflow" className="text-sm text-ash transition hover:text-bone">
                  See how it works
                </Link>
              </div>
            </div>

            {/* Filmstrip motif — ties to the subject matter rather than decorating */}
            <div className="flex flex-col gap-2" aria-hidden>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="relative h-28 rounded-xl2 border border-white/10 bg-gradient-to-br from-obsidian to-void md:h-32"
                  style={{ opacity: 1 - i * 0.18 }}
                >
                  <div className="absolute inset-y-0 left-0 flex w-4 flex-col justify-around py-3">
                    {Array.from({ length: 5 }).map((_, j) => (
                      <span key={j} className="mx-auto h-2 w-2 rounded-sm bg-white/10" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section id="workflow" className="mx-auto max-w-6xl px-6 py-24">
        <h2 className="font-display text-3xl italic text-bone md:text-4xl">
          The path from brief to broadcast.
        </h2>
        <div className="mt-14 grid gap-px overflow-hidden rounded-xl2 border border-white/10 bg-white/5 md:grid-cols-4">
          {WORKFLOW.map((w) => (
            <div key={w.step} className="bg-void p-7">
              <h3 className="font-display text-xl text-bone">{w.step}</h3>
              <p className="mt-3 text-sm leading-relaxed text-ash">{w.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Creative Director callout */}
      <section className="border-y border-white/5 bg-obsidian/40">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <div className="grid gap-12 md:grid-cols-2 md:items-center">
            <h2 className="font-display text-3xl italic text-bone md:text-4xl">
              A creative director,<br />not a prompt box.
            </h2>
            <div className="space-y-4 rounded-xl2 border border-white/10 bg-void p-6">
              <p className="text-sm text-ash">You</p>
              <p className="text-bone">I want an ad for my coffee brand.</p>
              <div className="h-px bg-white/10" />
              <p className="text-sm text-signal">Creative Director</p>
              <p className="text-bone">
                Who are we trying to make fall in love with this coffee? I&apos;d open on the
                quiet ritual of the morning, not the product — it earns the reveal.
              </p>
            </div>
          </div>
        </div>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-16 text-sm text-ash">
        VYRO — an AI film studio.
      </footer>
    </main>
  );
}
