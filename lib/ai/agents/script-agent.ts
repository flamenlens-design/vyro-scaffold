import { getTextProvider } from "../providers";
import { parseJsonResponse } from "../json-parse";

export interface ScriptBriefContext {
  purpose?: string | null;
  platform?: string | null;
  aspectRatio?: string | null;
  durationSec?: number | null;
  tone?: string | null;
  visualStyle?: string | null;
}

export interface GeneratedScript {
  script: string;
  hook: string;
}

// Turns the free-text creative brief from the new-project form into a first
// draft script. This is the piece that was missing end-to-end: refineScript
// below can only transform an *existing* script, and the Creative Director
// agent only chats — nothing previously produced an initial draft.
export async function generateScript(
  brief: string,
  context: ScriptBriefContext = {}
): Promise<GeneratedScript> {
  const provider = getTextProvider();
  const contextLines = [
    context.purpose && `Purpose: ${context.purpose}`,
    context.platform && `Platform: ${context.platform}`,
    context.aspectRatio && `Aspect ratio: ${context.aspectRatio}`,
    context.durationSec && `Target duration: ${context.durationSec}s`,
    context.tone && `Tone: ${context.tone}`,
    context.visualStyle && `Visual style: ${context.visualStyle}`,
  ].filter(Boolean).join("\n");

  const result = await provider.generate({
    messages: [
      {
        role: "system",
        content:
          "You are a professional commercial/film scriptwriter. Given a creative brief, write a " +
          "first-draft script/voiceover for a short video. Return ONLY valid JSON matching exactly " +
          '{"script": "...", "hook": "..."} where "script" is the full script text (scene ' +
          'directions in brackets are fine) and "hook" is just the opening line, isolated, since ' +
          "the first few seconds get evaluated separately. No markdown, no commentary.",
      },
      {
        role: "user",
        content: contextLines ? `${contextLines}\n\nBrief:\n${brief}` : `Brief:\n${brief}`,
      },
    ],
    jsonMode: true,
    temperature: 0.8,
  });

  return parseJsonResponse<GeneratedScript>(result.text);
}

export type ScriptTransform =
  | "cinematic" | "emotional" | "viral" | "concise" | "storytelling"
  | "dialogue" | "hooks" | "pacing" | "luxury" | "humorous" | "dramatic";

const TRANSFORM_INSTRUCTIONS: Record<ScriptTransform, string> = {
  cinematic: "Make it more cinematic — visual, sensory, evocative language.",
  emotional: "Deepen the emotional resonance without becoming sentimental or cliché.",
  viral: "Sharpen the hook and pacing for short-form social virality; front-load tension.",
  concise: "Tighten the language, cut anything that doesn't earn its place.",
  storytelling: "Strengthen the narrative arc — setup, tension, payoff.",
  dialogue: "Improve dialogue naturalism and character voice.",
  hooks: "Strengthen the opening hook so the first 3 seconds earn attention.",
  pacing: "Fix pacing — vary sentence/shot rhythm, remove dead air.",
  luxury: "Elevate tone toward understated luxury — restraint over hype.",
  humorous: "Add wit and comic timing without undercutting the message.",
  dramatic: "Raise the emotional stakes and dramatic tension.",
};

export interface ScriptSuggestion {
  original: string;
  suggestion: string;
  transform: ScriptTransform;
}

export async function refineScript(
  original: string,
  transform: ScriptTransform
): Promise<ScriptSuggestion> {
  const provider = getTextProvider();
  const result = await provider.generate({
    messages: [
      {
        role: "system",
        content:
          "You are a professional commercial/film scriptwriter. You will be given a script " +
          "and a specific transform to apply. Return ONLY the revised script text — no preamble, " +
          "no explanation, no markdown formatting. Preserve the user's core idea and structure " +
          "unless the transform specifically requires restructuring.",
      },
      {
        role: "user",
        content: `Transform: ${TRANSFORM_INSTRUCTIONS[transform]}\n\nScript:\n${original}`,
      },
    ],
    temperature: 0.7,
  });

  return { original, suggestion: result.text.trim(), transform };
}

export interface ScriptStructure {
  hook: [number, number];
  context: [number, number];
  story: [number, number];
  climax: [number, number];
  cta: [number, number];
}

export async function detectStructure(script: string, durationSec: number): Promise<ScriptStructure> {
  const provider = getTextProvider();
  const result = await provider.generate({
    messages: [
      {
        role: "system",
        content:
          `You analyze video scripts for pacing structure. Given a script and total duration ` +
          `of ${durationSec} seconds, return ONLY valid JSON matching this exact shape: ` +
          `{"hook":[start,end],"context":[start,end],"story":[start,end],"climax":[start,end],"cta":[start,end]} ` +
          `where all numbers are seconds and segments are sequential covering the full duration.`,
      },
      { role: "user", content: script },
    ],
    jsonMode: true,
    temperature: 0.3,
  });

  return parseJsonResponse<ScriptStructure>(result.text);
}
