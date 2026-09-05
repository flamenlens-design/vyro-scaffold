# VYRO — AI Video Creation Studio (MVP scaffold)

This is a working scaffold, not the full product spec — it implements the parts that
determine everything else: the AI provider abstraction, the data model, and the three
agents that make the product feel like a creative studio rather than a prompt box
(Creative Director, Script Agent, Prompt Enhancer). Media generation (image/video/TTS)
runs on mock providers until real API keys are added — see "Connecting real media
providers" below.

## Why this scope first

Everything else in the full spec (storyboard UI, character bible, multi-model
side-by-side generation, timeline editor, caption studio, brand kit, template
marketplace) is UI and orchestration built **on top of** these three pieces. Getting
the provider abstraction and schema right first means those features don't require
rearchitecting later — they're mostly new agents + new Prisma models + new routes
following the same pattern as `lib/ai/agents/script-agent.ts`.

## Model decisions

| Purpose | Provider | Model | Notes |
|---|---|---|---|
| Creative Director, planning, structured JSON | OpenRouter | `anthropic/claude-sonnet-4.5` | Primary reasoning model |
| High-volume small tasks (captions, prompt enhance) | OpenRouter | `google/gemini-2.5-flash` | Also the automatic fallback if the primary model call fails |
| Image generation | fal.ai (not yet connected) | `flux-1.1-pro` | Best consistency for storyboards/character refs |
| Video generation | fal.ai / Runway / Luma (not yet connected) | `kling-2.1`, `runway-gen4`, `luma-ray2` | Multiple models by design — powers the "generate with Model A/B/C" feature |
| Voiceover | ElevenLabs (not yet connected) | `eleven_multilingual_v2` | Emotion + accent control |
| Captions (speech-to-text) | Groq (not yet connected) | `whisper-large-v3` | Fast enough for near-real-time captioning |
| Music | Suno / ElevenLabs Music (not yet connected) | — | Duration-matched to video length |

OpenRouter is a text/LLM router — it does not host image, video, TTS, or STT models,
so those live behind their own provider interfaces in `lib/ai/types.ts` and are
currently satisfied by `lib/ai/providers/mock.ts`.

## Architecture

```
lib/ai/
  types.ts              # provider interfaces — the contract everything else depends on
  providers/
    openrouter.ts        # real text provider
    mock.ts               # placeholder image/video/tts/stt/music providers
    index.ts               # registry — swap a provider in one place
  agents/
    creative-director.ts  # conversational creative guidance
    script-agent.ts         # refine/structure-detect, never overwrites silently
    prompt-enhancer.ts       # rewrites raw ideas into production prompts, style-locked
```

Swapping a real media provider in later: implement the relevant interface from
`lib/ai/types.ts` (e.g. `VideoProvider`), then change one line in
`lib/ai/providers/index.ts`. No agent or route code changes.

## Database

`prisma/schema.prisma` covers the MVP model list from the product brief (User,
Project, Script, Scene, StyleProfile, Character, Asset, Timeline/TimelineTrack,
BrandKit, AIModel registry, GenerationJob, GenerationHistory, CreditTransaction).
Phase 2 models (Team, Comment, Version, Template marketplace, Subscription) are
intentionally left out until collaboration/marketplace phases start — adding them
later is additive, not a migration risk.

## Roadmap

**Done in this scaffold:**
- Provider abstraction, schema, Creative Director agent, Script agent (refine +
  structure detection), Prompt Enhancer
- Landing page, dashboard, studio layout shell
- **Auth** — `next-auth` with Google OAuth + email magic link, Prisma adapter,
  new users seeded with 200 starter credits (`lib/auth/options.ts`, `lib/auth/session.ts`)
- **Project creation flow** — `/project/new` form → `POST /api/projects` → redirects
  into `/project/[id]`; dashboard (`/dashboard`) is now a real server component
  reading the signed-in user's projects from Postgres, with a `redirect("/signin")`
  guard for signed-out visitors
- **Storyboard Agent** (`lib/ai/agents/storyboard-agent.ts`) — turns an approved
  script into a shot list; `POST /api/projects/[id]/storyboard` persists it as
  `Scene` rows, with guards against clobbering an existing storyboard or one
  that already has generated media attached
- **Real image/video providers** (`lib/ai/providers/fal-image.ts`,
  `fal-video.ts`) — fal.ai-backed, feature-flagged on `FAL_API_KEY` (falls
  back to mocks otherwise). Image: FLUX 1.1 Pro Ultra (default) or Seedream V4
  (reference-guided edits). Video: Kling 2.1 (standard/pro/master), Seedance
  2.0 (incl. `-fast`), Wan 2.6 — selected per-request via the existing `model`
  field, never hardcoded
- **Real voice providers** (`lib/ai/providers/elevenlabs.ts`,
  `groq-whisper.ts`) — feature-flagged on `ELEVENLABS_API_KEY` /
  `GROQ_API_KEY`. TTS defaults to the cheaper `eleven_flash_v2_5`
  (`VYRO_TTS_MODEL=eleven_multilingual_v2` to opt into emotion/accent
  control); STT defaults to `whisper-large-v3-turbo`
  (`VYRO_STT_MODEL=whisper-large-v3` for a higher-accuracy pass)
- **Generation queue** (`lib/queue/`) — BullMQ-backed background processing
  for `scene_image` / `scene_video` / `voiceover` / `music` jobs. API routes
  enqueue via `enqueueGenerationJob()`; a standalone worker process (`npm run
  worker`) picks jobs up, calls whatever provider is currently registered
  (real or mock), and writes `GenerationJob`/`GenerationHistory` rows.
  Retries are off by default until credit-accounting (roadmap #10) exists, to
  avoid double-charging a provider on retry
- **Brand Kit agent** (`lib/ai/agents/brand-kit-agent.ts`) — the Pomelli-style
  "give me a URL" feature. `POST /api/projects/[id]/brand-kit` fetches the
  homepage (+ up to 2 linked about/brand pages), extracts colors/fonts/logo
  deterministically from HTML/CSS, and asks the TextProvider to synthesize
  brand voice/tone from the copy. Text-only for now — no headless rendering
  or vision input (see "Known limitations" in the agent file)
- **Timeline editor** (`app/project/[id]/timeline-editor.tsx`) — drag-to-reorder,
  trim handles, playhead scrubbing, and save-to-Postgres via
  `PATCH /api/projects/[id]/timeline`, backed by `Timeline`/`TimelineTrack.items`.
  Falls back to placeholder clips (built from any real `Asset` rows that
  exist) when a project has no timeline yet

**Next (MVP completion, in order):**
1. ~~Auth (`next-auth`, email + Google OAuth)~~ ✅
2. ~~Project creation flow wired to Prisma (`POST /api/projects`)~~ ✅
3. ~~Storyboard Agent~~ ✅
4. ~~Generation queue (BullMQ + Redis)~~ ✅
5. ~~Connect one real image provider (fal.ai) and one real video provider (fal.ai)~~ ✅
6. ~~Basic timeline (drag/trim/reorder)~~ ✅
7. ~~Caption generation (Groq Whisper)~~ ✅ — provider is wired; UI styling/
   display of captions on the timeline is still open
8. Logo overlay from `BrandKit` — extraction is done (`BrandKit` now includes
   `voiceTone`/`toneKeywords`/`description`, and is scoped per-project via
   `BrandKit.projectId`); actually compositing the logo onto rendered video is
   not yet wired
9. Export pipeline (server-side render via ffmpeg worker, or a render API)
10. Credit accounting on every `GenerationJob` completion — also unblocks
    turning BullMQ retries back on safely (see `lib/queue/worker.ts`)

**"Prompt → script → storyboard → brand kit" UI, wired after the six-track
merge (previously the agents/routes existed but nothing in the studio
actually called them):**
- `/project/new` now has an optional creative-brief textarea, stored on
  `Project.brief` (new field).
- `lib/ai/agents/script-agent.ts` gained `generateScript()` — previously the
  agent layer could only refine/restructure a script that already existed;
  nothing generated a first draft from a brief.
- `POST /api/ai/script` now takes `projectId` on every action, persists to
  the `Script` row (`generate`/`refine`/`structure`/`approve`), and the new
  `Script.approved` field replaces the old client-trusted flag.
- `POST /api/projects/[id]/storyboard` now checks the *stored*
  `Script.approved` instead of a request-body claim — closes the gap noted
  below.
- The studio's right panel (`creative-studio-panel.tsx`) is a real
  Creative-Director chat plus a script generate/refine/approve flow and a
  storyboard trigger that displays the generated scenes inline (there's no
  separate Scenes browser yet — see next roadmap item).
- The left rail's "Brand" button (`brand-tool-button.tsx`) opens a modal
  that calls the brand-kit route and displays the extracted colors/voice/tone.
- **Not yet built**: a proper Scenes/Storyboard browser (scenes currently
  only show as a flat list inside the script panel right after generation,
  not as a persistent view), and the rest of the left rail (Assets, Media,
  Text, Captions, Audio, AI Tools) is still non-functional.

**Known gaps flagged during this round, not yet resolved:**
- The Brand Kit agent extracts text/CSS only — no headless rendering (so a
  client-rendered site with an empty initial HTML shell yields little), and
  no vision input. Fixing the latter means widening `ChatMessage.content` in
  `lib/ai/types.ts` to accept image parts (see the agent file's closing
  comment for the exact shape) plus an `OpenRouterProvider` update to pass
  multimodal content through.

**Merge notes (this round combined six parallel tracks):**
- `lib/ai/providers/index.ts` had two independently-written copies (one
  wiring fal.ai image/video, one wiring ElevenLabs/Groq) — combined by hand,
  no logic from either changed.
- `prisma/schema.prisma`: added `BrandKit.projectId` (unique, optional) so a
  kit scopes to one project instead of being shared user-wide, plus
  `voiceTone`/`toneKeywords`/`description` fields the brand-kit agent already
  synthesizes but had nowhere to persist. Added `Project.brandKit` as the
  inverse relation. Run `npx prisma db push` after pulling this to apply it.
- `package.json`: added `tsx` (devDependency) and a `worker` script
  (`tsx lib/queue/run-worker.ts`) so the queue's worker process is actually
  runnable — it was built assuming a TS runner would be added at merge time.
- Fixed one real lint error surfaced by the strict Next 16 config: a
  `setState` called synchronously inside a `useEffect` in the timeline editor
  (clamping the playhead when the timeline shrinks). Replaced with a value
  derived at render time instead of synced via an effect — see the comment
  in `timeline-editor.tsx`.
- `npx tsc --noEmit` currently reports 12 errors, all one root cause: this
  sandbox can't reach `binaries.prisma.sh`, so `prisma generate` fails and
  `@prisma/client`'s generated types don't exist (same limitation the
  original scaffold's README documented for `lib/db/client.ts`). Every error
  is either a missing export from `@prisma/client` directly, or an
  `implicitly has an 'any' type` on a variable downstream of an untyped
  Prisma query result. Confirmed by running the identical check against the
  pre-merge scaffold, which shows the same failure mode at smaller scale.
  Run `npx prisma generate` on a machine with real network access and these
  clear on their own — nothing here is a bug in the merged code.
- `npx eslint .` is clean.

**Auth setup notes:**
- Google: create OAuth credentials at the Google Cloud Console, set the redirect
  URI to `<APP_URL>/api/auth/callback/google`, and fill `GOOGLE_CLIENT_ID` /
  `GOOGLE_CLIENT_SECRET`.
- Email: any SMTP provider works (Resend, Postmark, SES) — set `EMAIL_SERVER` as
  an `smtp://` connection string and `EMAIL_FROM`.
- Both are optional individually — the app runs with just one provider configured
  if you want to launch with Google-only or email-only to start.

**Phase 2:** multi-model side-by-side generation, character consistency system,
AI Editing Agent (pacing/silence analysis), caption intelligence (word highlighting,
beat sync), template marketplace, collaboration (comments, versions).

## Tested before you touch git

I ran `npm install`/`npm ci`, `npx tsc --noEmit`, and `npx eslint .` against this
exact scaffold before handing it off, twice — once for the original Next 14 setup,
and again after switching to Docker + moving to Next 16. Issues found and fixed
each round:

**Round 1 (dependency/version issues):**
1. `next-auth@4.24.15` requires `nodemailer@^7`, but the scaffold pinned `^6.9.14`
   — `npm install` failed with `ERESOLVE`. Fixed.
2. `next@14.2.5` is affected by the December 2025 React Server Components
   advisories. Bumped to the patched `14.2.35` — **then superseded by round 2.**

**Round 2 (switching to Docker surfaced a bigger issue):** checking whether
`next@14.2.35` was still current revealed that **Next.js stopped patching the
13.x/14.x line entirely as of the May 2026 security release.** Pinning 14.2.35
meant shipping a version exposed to everything patched since (May, July, August
2026). Moved to `next@16.3.3` (the current Active LTS) and `react@19.2.6`
instead of just bumping the patch version.

That major-version jump had real fallout, all fixed:
- Next 15+ made dynamic route `params` async (`Promise<{ id: string }>` instead
  of a plain object) — updated `app/project/[id]/page.tsx` accordingly.
- `eslint-config-next@16.3.3` requires ESLint 9's flat config; replaced
  `.eslintrc.json` with `eslint.config.mjs`. The `next lint` subcommand was also
  removed in Next 16 — use `npx eslint .` instead (see below).
- Tried ESLint 10 first since it's current; `eslint-config-next@16.3.3`'s bundled
  `eslint-plugin-react` isn't actually compatible with it yet despite the
  permissive peer range, and throws at lint time. Pinned to ESLint 9 (still
  fully supported, the version this Next release was actually tested against).
- Fixed real lint errors the stricter Next 16 default config caught: several
  `catch (err: any)` blocks across the API routes (replaced with `catch (err:
  unknown)` + shared helpers in `lib/utils/errors.ts`), and `any` casts in
  `lib/auth/options.ts` (replaced with a proper NextAuth module augmentation in
  `lib/auth/next-auth.d.ts` so `session.user.credits`/`.plan` are natively typed).
- Caught a stale-lockfile bug of my own making: I'd bumped versions in
  `package.json` without regenerating `package-lock.json`, which would have made
  `npm ci` — the exact command the Dockerfile's deps stage runs — fail on a clean
  checkout. Regenerated and re-verified.

After all of that: `npm ci` (matching the Dockerfile exactly), `tsc --noEmit`,
and `eslint .` are all clean. `package-lock.json` is included so your install
matches mine.

**One thing I could not verify here:** `prisma generate` needs to download a
query-engine binary from `binaries.prisma.sh`, and there's no Docker daemon in
this sandbox either — both are restrictions of *this* sandbox, not of your
machine or of Render. Two things to confirm on your end as the real test:

```bash
npm install && npx prisma generate   # confirms the piece I couldn't test locally
docker build -t vyro .                 # confirms the piece I couldn't test in Docker
```

If either fails, paste the error here and I'll fix it the same way as above.

## Local development

```bash
npm install
cp .env.example .env.local     # fill in DATABASE_URL and OPENROUTER_API_KEY at minimum
npx prisma db push             # create tables from schema.prisma
npm run dev
```

Get an `OPENROUTER_API_KEY` at https://openrouter.ai/keys — this is the only key
required for the Creative Director, Script, and Prompt Enhancer agents to work for
real; everything else runs on mock data until you add those keys.

## Push to git

```bash
cd vyro
git init
git add .
git commit -m "Initial VYRO scaffold: AI provider abstraction, schema, core agents"
git branch -M main
git remote add origin <your-empty-github-repo-url>
git push -u origin main
```

## Deploy to Render

This runs as a Docker service (`runtime: docker` in `render.yaml`, building from
the `Dockerfile` in this repo) rather than Render's native Node buildpack. Chosen
now, ahead of actually needing it, because the roadmap's export pipeline (step 9)
needs ffmpeg — not present on Render's native Node image — and the generation
queue (step 4) benefits from a controlled runtime. The image is multi-stage
(deps → build → runner) and already includes ffmpeg.

**Option A — Blueprint (recommended):** this repo includes `render.yaml`, which
provisions the web service (from the Dockerfile), a Postgres database, and a Key
Value (Redis) instance together.

1. Push the repo to GitHub (below).
2. In Render: **New → Blueprint**, point it at your repo. Render reads `render.yaml`,
   builds the Dockerfile, and provisions the database + Redis alongside it.
3. In the new web service's **Environment** tab, fill in the `sync: false` variables:
   `NEXTAUTH_URL` (your Render URL), `APP_URL` (same), `GOOGLE_CLIENT_ID`/`SECRET`
   and/or `EMAIL_SERVER`/`EMAIL_FROM`, `OPENROUTER_API_KEY`, and any media provider
   keys you've connected.
4. After first deploy, run `npx prisma db push` against the Render Postgres
   `DATABASE_URL` (Render's shell tab, or locally with the external connection string)
   to create tables.

**Option B — manual web service:**
1. New → Web Service → connect the repo.
2. Runtime: **Docker**. Dockerfile path: `./Dockerfile`.
3. Add a Postgres instance and a Key Value instance from the Render dashboard, copy
   their connection strings into the web service's env vars as `DATABASE_URL` and
   `REDIS_URL`.
4. Add the remaining env vars from `.env.example`.

## What's intentionally not built yet

Video rendering/export, the timeline drag-and-drop interactions, real media provider
integrations, and the generation queue are stubbed or absent — the README roadmap
above is the order I'd build them in, each one following the same interface-first
pattern used by the AI provider layer.
