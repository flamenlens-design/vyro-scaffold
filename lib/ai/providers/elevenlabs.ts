// ElevenLabs TTS provider.
//
// Supports both `eleven_multilingual_v2` (emotion/accent control, higher
// latency + cost) and `eleven_flash_v2_5` (cheaper, ~75ms latency, slightly
// lower expressiveness). Defaults to flash since most VYRO voiceover calls
// are high-volume/draft-quality; callers can opt into multilingual_v2 for
// final-pass narration via the `model` param.
//
// Docs: https://elevenlabs.io/docs/api-reference/text-to-speech

import type { TTSProvider, TTSRequest, TTSResult } from "../types";

const ELEVENLABS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

export type ElevenLabsModel = "eleven_multilingual_v2" | "eleven_flash_v2_5";

const DEFAULT_MODEL: ElevenLabsModel = "eleven_flash_v2_5";

// Rough, model-specific chars-per-second used only as a fallback duration
// estimate when ElevenLabs doesn't hand back timing metadata. Not exact —
// good enough until an actual audio-duration probe (e.g. via ffprobe) sits
// downstream of this provider.
const CHARS_PER_SECOND: Record<ElevenLabsModel, number> = {
  eleven_multilingual_v2: 15,
  eleven_flash_v2_5: 15,
};

export interface ElevenLabsProviderOptions {
  apiKey?: string;
  model?: ElevenLabsModel;
}

export class ElevenLabsProvider implements TTSProvider {
  private apiKey: string;
  private model: ElevenLabsModel;

  constructor(options: ElevenLabsProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      throw new Error("ELEVENLABS_API_KEY is not set");
    }
    this.apiKey = apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async generate(req: TTSRequest): Promise<TTSResult> {
    const model = this.resolveModel(req);

    const res = await fetch(`${ELEVENLABS_URL}/${encodeURIComponent(req.voiceId)}`, {
      method: "POST",
      headers: {
        "xi-api-key": this.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({
        text: req.text,
        model_id: model,
        voice_settings: {
          // ElevenLabs has no first-class "emotion" knob; style pushes
          // delivery toward more expressive (higher) or flatter (lower).
          style: req.emotion ? 0.6 : 0.3,
          stability: req.emotion ? 0.4 : 0.5,
          similarity_boost: 0.75,
          speed: req.speed ?? 1.0,
        },
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ElevenLabs error ${res.status}: ${body}`);
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const durationSec = this.estimateDurationSec(req.text, model, res.headers);

    return {
      // Callers are expected to persist this to object storage (S3/R2) and
      // swap in the resulting public URL; returning a data URL keeps this
      // provider self-contained without taking a hard dependency on the
      // storage layer.
      url: `data:audio/mpeg;base64,${buffer.toString("base64")}`,
      durationSec,
    };
  }

  private resolveModel(req: TTSRequest & { model?: string }): ElevenLabsModel {
    const requested = req.model;
    if (requested === "eleven_multilingual_v2" || requested === "eleven_flash_v2_5") {
      return requested;
    }
    return this.model;
  }

  private estimateDurationSec(text: string, model: ElevenLabsModel, headers: Headers): number {
    const headerSeconds = headers.get("x-audio-duration-seconds");
    if (headerSeconds) {
      const parsed = Number(headerSeconds);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return Math.max(1, text.length / CHARS_PER_SECOND[model]);
  }
}
