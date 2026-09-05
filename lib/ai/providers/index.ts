// Central registry. Business logic (agents, API routes) calls
// getTextProvider() / getVideoProvider() / etc. — never `new OpenRouterProvider()`
// directly — so swapping a backend is a one-line change here.
//
// Merge note: this file combines two independently-built tracks (image/video
// via fal.ai, and TTS/STT via ElevenLabs/Groq) — each was handed off with its
// own copy of this file assuming the other's providers were still mocked.
// Combined here; no logic from either track was changed.

import { OpenRouterProvider } from "./openrouter";
import { ElevenLabsProvider, type ElevenLabsModel } from "./elevenlabs";
import { GroqWhisperProvider, type GroqWhisperModel } from "./groq-whisper";
import { FalImageProvider } from "./fal-image";
import { FalVideoProvider } from "./fal-video";
import { isFalConfigured } from "./fal-client";
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

// Real fal.ai provider when FAL_API_KEY is set (FLUX 1.1 Pro Ultra /
// Seedream V4 — see fal-image.ts), otherwise the mock so local dev keeps
// working without a fal.ai account.
let imageProvider: ImageProvider | null = null;

export function getImageProvider(): ImageProvider {
  if (!imageProvider) {
    imageProvider = isFalConfigured() ? new FalImageProvider() : new MockImageProvider();
  }
  return imageProvider;
}

// Real fal.ai provider when FAL_API_KEY is set (Kling 2.1 / Seedance 2.0 /
// Wan 2.6 — see fal-video.ts), otherwise the mock so local dev keeps
// working without a fal.ai account.
let videoProvider: VideoProvider | null = null;

export function getVideoProvider(): VideoProvider {
  if (!videoProvider) {
    videoProvider = isFalConfigured() ? new FalVideoProvider() : new MockVideoProvider();
  }
  return videoProvider;
}

let ttsProvider: TTSProvider | null = null;

// Feature-flagged on ELEVENLABS_API_KEY: falls back to the mock provider so
// the app stays runnable/demoable without the key. VYRO_TTS_MODEL can pin
// "eleven_multilingual_v2" for emotion/accent-heavy narration; defaults to
// the cheaper "eleven_flash_v2_5" otherwise.
export function getTTSProvider(): TTSProvider {
  if (ttsProvider) return ttsProvider;

  if (process.env.ELEVENLABS_API_KEY) {
    const configuredModel = process.env.VYRO_TTS_MODEL;
    const model: ElevenLabsModel | undefined =
      configuredModel === "eleven_multilingual_v2" || configuredModel === "eleven_flash_v2_5"
        ? configuredModel
        : undefined;
    ttsProvider = new ElevenLabsProvider({ model });
  } else {
    ttsProvider = new MockTTSProvider();
  }

  return ttsProvider;
}

let sttProvider: STTProvider | null = null;

// Feature-flagged on GROQ_API_KEY: falls back to the mock provider so
// captioning doesn't hard-fail without the key. VYRO_STT_MODEL can pin
// "whisper-large-v3" for max accuracy; defaults to the faster
// "whisper-large-v3-turbo" otherwise.
export function getSTTProvider(): STTProvider {
  if (sttProvider) return sttProvider;

  if (process.env.GROQ_API_KEY) {
    const configuredModel = process.env.VYRO_STT_MODEL;
    const model: GroqWhisperModel | undefined =
      configuredModel === "whisper-large-v3" || configuredModel === "whisper-large-v3-turbo"
        ? configuredModel
        : undefined;
    sttProvider = new GroqWhisperProvider({ model });
  } else {
    sttProvider = new MockSTTProvider();
  }

  return sttProvider;
}

// TODO: swap for Suno / ElevenLabs Music once available — no track built
// this one yet.
export function getMusicProvider(): MusicProvider {
  return new MockMusicProvider();
}
