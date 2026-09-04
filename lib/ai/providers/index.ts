// Central registry. Business logic (agents, API routes) calls
// getTextProvider() / getVideoProvider() / etc. — never `new OpenRouterProvider()`
// directly — so swapping a backend is a one-line change here.

import { OpenRouterProvider } from "./openrouter";
import {
  MockImageProvider,
  MockVideoProvider,
  MockTTSProvider,
  MockSTTProvider,
  MockMusicProvider,
} from "./mock";
import type {
  TextProvider, ImageProvider, VideoProvider, TTSProvider, STTProvider, MusicProvider,
} from "../types";

let textProvider: TextProvider | null = null;

export function getTextProvider(): TextProvider {
  if (!textProvider) textProvider = new OpenRouterProvider();
  return textProvider;
}

// TODO: swap for a real fal.ai / Replicate implementation once
// FAL_API_KEY is set. Interfaces already match — see lib/ai/types.ts.
export function getImageProvider(): ImageProvider {
  return new MockImageProvider();
}

// TODO: swap for fal.ai (Kling) / Runway / Luma once keys exist.
export function getVideoProvider(): VideoProvider {
  return new MockVideoProvider();
}

// TODO: swap for ElevenLabsProvider once ELEVENLABS_API_KEY is set.
export function getTTSProvider(): TTSProvider {
  return new MockTTSProvider();
}

// TODO: swap for Groq Whisper once GROQ_API_KEY is set.
export function getSTTProvider(): STTProvider {
  return new MockSTTProvider();
}

// TODO: swap for Suno / ElevenLabs Music once available.
export function getMusicProvider(): MusicProvider {
  return new MockMusicProvider();
}
