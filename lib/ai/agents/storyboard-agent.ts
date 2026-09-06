import { getTextProvider } from "../providers";
import { parseJsonResponse } from "../json-parse";

// Storyboard Agent
//
// Turns an approved script into a discrete shot list — the same job a director
// does with a legal pad before a shoot. Like refineScript/detectStructure in
// script-agent.ts, this is a pure function: it calls the TextProvider and
// returns a value. It never touches Prisma and never overwrites anything —
// the caller (the API route) owns all persistence decisions, including the
// "don't clobber an approved script/existing storyboard" guard.

export interface StoryboardStyleContext {
  colorPalette?: string[];
  lighting?: string;
  cameraStyle?: string;
  lensPref?: string;
  texture?: string;
  environment?: string;
  mood?: string;
  visualStyle?: string; // Project.visualStyle free text
  aspectRatio?: string;
}

export interface StoryboardOptions {
  durationSec?: number; // total target runtime, if known — scenes should sum to roughly this
  style?: StoryboardStyleContext;
  characterNames?: string[]; // names only, for cross-scene continuity mentions
}

export interface StoryboardSceneDraft {
  order: number;
  durationSec: number;
  visualDesc: string; // human-readable shot description
  rawPrompt: string; // dense, image-gen-ready prompt (Flux/Kling/Runway-style)
  cameraAngle: string; // e.g. "Close-up", "Wide establishing shot"
  cameraMovement: string; // e.g. "Static", "Slow dolly-in", "Handheld pan"
  lighting?: string;
  mood?: string;
  dialogue?: string;
  voiceoverText?: string;
  soundEffects?: string;
  musicDirection?: string;
}

// Raw shape the model is asked for. OpenRouter's json_object mode requires a
// top-level JSON *object*, so the scene array is wrapped rather than bare.
interface RawStoryboardResponse {
  scenes?: unknown;
}

interface RawScene {
  order?: unknown;
  durationSec?: unknown;
  visualDesc?: unknown;
  rawPrompt?: unknown;
  cameraAngle?: unknown;
  cameraMovement?: unknown;
  lighting?: unknown;
  mood?: unknown;
  dialogue?: unknown;
  voiceoverText?: unknown;
  soundEffects?: unknown;
  musicDirection?: unknown;
}

const MIN_SCENE_SEC = 1;
const MAX_SCENE_SEC = 20;
const DEFAULT_SCENE_SEC = 3;

function asOptionalString(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function clampDuration(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_SCENE_SEC;
  return Math.min(MAX_SCENE_SEC, Math.max(MIN_SCENE_SEC, n));
}

// The model's JSON output is untrusted input from the storyboard agent's
// perspective too — durationSec in particular feeds a non-null Float column,
// so it gets validated/coerced here rather than cast straight through like
// detectStructure() does for the (lower-stakes) script structure JSON.
function normalizeScenes(raw: unknown): StoryboardSceneDraft[] {
  if (!Array.isArray(raw)) {
    throw new Error("Storyboard agent response did not contain a scenes array");
  }
  if (raw.length === 0) {
    throw new Error("Storyboard agent returned zero scenes");
  }

  return raw.map((entry, i): StoryboardSceneDraft => {
    const s = entry as RawScene;
    const visualDesc = asOptionalString(s.visualDesc);
    const rawPrompt = asOptionalString(s.rawPrompt);
    if (!visualDesc || !rawPrompt) {
      throw new Error(`Storyboard scene ${i + 1} is missing visualDesc/rawPrompt`);
    }

    return {
      order: i + 1, // always re-sequenced — never trust model-provided ordering
      durationSec: clampDuration(s.durationSec),
      visualDesc,
      rawPrompt,
      cameraAngle: asOptionalString(s.cameraAngle) ?? "Medium shot",
      cameraMovement: asOptionalString(s.cameraMovement) ?? "Static",
      lighting: asOptionalString(s.lighting),
      mood: asOptionalString(s.mood),
      dialogue: asOptionalString(s.dialogue),
      voiceoverText: asOptionalString(s.voiceoverText),
      soundEffects: asOptionalString(s.soundEffects),
      musicDirection: asOptionalString(s.musicDirection),
    };
  });
}

function buildStyleLines(style?: StoryboardStyleContext): string {
  if (!style) return "";
  return Object.entries(style)
    .filter(([, v]) => v && (!Array.isArray(v) || v.length > 0))
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(", ") : v}`)
    .join("\n");
}

export async function generateStoryboard(
  scriptText: string,
  opts: StoryboardOptions = {}
): Promise<StoryboardSceneDraft[]> {
  const provider = getTextProvider();

  const styleLines = buildStyleLines(opts.style);
  const durationLine = opts.durationSec
    ? `Target total runtime: ${opts.durationSec} seconds. Scene durations should sum to roughly this.`
    : "No fixed target runtime was given — choose scene count/pacing that fits the script naturally.";
  const characterLine = opts.characterNames?.length
    ? `Established characters (keep appearance/wardrobe consistent across scenes when they appear): ${opts.characterNames.join(", ")}.`
    : "";

  const result = await provider.generate({
    messages: [
      {
        role: "system",
        content:
          "You are VYRO's Storyboard Agent — a director of photography breaking an approved " +
          "script into a shot list for AI image/video generation. Split the script into a " +
          "sequence of discrete scenes (one continuous shot or beat each). For every scene " +
          "produce: a short human-readable visual description, a single dense image-generation-" +
          "ready prompt (camera shot type, subject, action, lighting, lens feel, mood, " +
          "composition — written as one paragraph, no labels), a realistic on-screen duration " +
          "in seconds, and a camera angle + camera movement note. Typical scenes run 1.5-8 " +
          "seconds for short-form content. Return ONLY valid JSON matching this exact shape, " +
          "no preamble, no markdown: " +
          '{"scenes":[{"order":1,"durationSec":3,"visualDesc":"...","rawPrompt":"...",' +
          '"cameraAngle":"...","cameraMovement":"...","lighting":"...","mood":"...",' +
          '"dialogue":"...","voiceoverText":"...","soundEffects":"...","musicDirection":"..."}]} ' +
          "dialogue/voiceoverText/soundEffects/musicDirection are optional per scene — omit the " +
          "key (do not invent placeholder text) when a scene has none.",
      },
      {
        role: "user",
        content: [
          `Script:\n${scriptText}`,
          durationLine,
          styleLines ? `Style profile (weave into every rawPrompt for visual consistency):\n${styleLines}` : "",
          characterLine,
        ]
          .filter(Boolean)
          .join("\n\n"),
      },
    ],
    jsonMode: true,
    temperature: 0.6,
    // No maxTokens here defaulted to the provider's 2000-token fallback,
    // which truncates mid-JSON for anything beyond ~4-5 scenes (each scene
    // has 9 text fields including a full prompt paragraph) — that's a
    // genuine truncation, not a fence issue, so json-parse.ts's
    // fence-stripping can't repair it. This is what was actually causing
    // "Storyboard agent returned invalid JSON" after the fence fix.
    maxTokens: 6000,
  });

  let parsed: RawStoryboardResponse;
  try {
    parsed = parseJsonResponse<RawStoryboardResponse>(result.text);
  } catch (err) {
    // Log the raw response server-side (Render logs / worker logs) so a
    // future failure — truncation, a model returning prose instead of JSON,
    // etc. — is diagnosable without another round of guessing. The client-
    // facing error stays generic; the useful detail goes to the log only.
    console.error("[storyboard-agent] failed to parse LLM response:", err, "\nraw text:", result.text);
    throw new Error("Storyboard agent returned invalid JSON");
  }

  return normalizeScenes(parsed.scenes);
}