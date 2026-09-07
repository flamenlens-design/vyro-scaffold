// MOCK PROVIDERS
//
// These stand in for image/video/TTS/STT/music backends that require paid
// API keys (fal.ai, Replicate, ElevenLabs, Runway, Suno...) not yet
// configured. They implement the exact same interfaces as the real
// providers so routes/agents never know the difference — flip the
// PROVIDER env vars in lib/ai/providers/index.ts once real keys exist.
//
// Do not ship these to production; they exist so the MVP is runnable and
// demoable end-to-end before every paid integration is connected.

import type {
  ImageProvider, ImageGenerationRequest, ImageGenerationResult,
  VideoProvider, VideoGenerationRequest, VideoGenerationResult,
  TTSProvider, TTSRequest, TTSResult,
  STTProvider, STTResult,
  MusicProvider, MusicGenerationRequest, MusicGenerationResult,
} from "../types";

const PLACEHOLDER_IMG = "https://placehold.co/1024x1024/0a0a0f/e5e5e5?text=VYRO+Preview";
// A real, tiny, CC0-licensed sample clip (MDN's public dev-testing assets) —
// not another placehold.co image URL like before. That mattered once the
// timeline/preview actually got wired to play `url` in a real <video>
// element: an image URL there just shows a broken-video icon, which would
// have made mock-mode testing of the player itself impossible.
const PLACEHOLDER_VIDEO = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";
const PLACEHOLDER_AUDIO = "data:audio/mp3;base64,"; // empty stub

export class MockImageProvider implements ImageProvider {
  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    return { url: PLACEHOLDER_IMG, modelUsed: `mock:${req.model}` };
  }
}

export class MockVideoProvider implements VideoProvider {
  async generate(req: VideoGenerationRequest): Promise<VideoGenerationResult> {
    return { url: PLACEHOLDER_VIDEO, modelUsed: `mock:${req.model}`, durationSec: req.durationSec };
  }
}

export class MockTTSProvider implements TTSProvider {
  async generate(req: TTSRequest): Promise<TTSResult> {
    return { url: PLACEHOLDER_AUDIO, durationSec: Math.max(2, req.text.length / 15) };
  }
}

export class MockSTTProvider implements STTProvider {
  async transcribe(): Promise<STTResult> {
    return { text: "", words: [] };
  }
}

export class MockMusicProvider implements MusicProvider {
  async generate(req: MusicGenerationRequest): Promise<MusicGenerationResult> {
    return { url: PLACEHOLDER_AUDIO, durationSec: req.durationSec };
  }
}
