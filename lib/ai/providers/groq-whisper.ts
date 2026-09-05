// Groq Whisper STT provider — used for caption generation.
//
// Groq hosts `whisper-large-v3` (best accuracy) and `whisper-large-v3-turbo`
// (faster/cheaper, small accuracy trade-off). Defaults to turbo since
// captioning is a high-volume, latency-sensitive path; override via the
// constructor for a higher-accuracy pass if needed.
//
// Docs: https://console.groq.com/docs/speech-to-text

import type { STTProvider, STTRequest, STTResult } from "../types";

const GROQ_TRANSCRIPTION_URL = "https://api.groq.com/openai/v1/audio/transcriptions";

export type GroqWhisperModel = "whisper-large-v3" | "whisper-large-v3-turbo";

const DEFAULT_MODEL: GroqWhisperModel = "whisper-large-v3-turbo";

interface GroqWord {
  word: string;
  start: number;
  end: number;
}

interface GroqVerboseTranscription {
  text: string;
  words?: GroqWord[];
  // Segments are returned even without word-level timestamps; used as a
  // fallback so captions still get coarse timing if `words` is absent.
  segments?: { text: string; start: number; end: number }[];
}

export interface GroqWhisperProviderOptions {
  apiKey?: string;
  model?: GroqWhisperModel;
}

export class GroqWhisperProvider implements STTProvider {
  private apiKey: string;
  private model: GroqWhisperModel;

  constructor(options: GroqWhisperProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not set");
    }
    this.apiKey = apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
  }

  async transcribe(req: STTRequest): Promise<STTResult> {
    const audioBlob = await this.fetchAudio(req.audioUrl);

    const form = new FormData();
    form.append("file", audioBlob, "audio.mp3");
    form.append("model", this.model);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "word");

    const res = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: form,
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Groq Whisper error ${res.status}: ${body}`);
    }

    const data = (await res.json()) as GroqVerboseTranscription;

    return {
      text: data.text ?? "",
      words: this.resolveWords(data),
    };
  }

  private resolveWords(data: GroqVerboseTranscription): STTResult["words"] {
    if (data.words && data.words.length > 0) {
      return data.words.map((w) => ({ word: w.word, start: w.start, end: w.end }));
    }
    // Fall back to segment-level timing (still useful for caption blocks)
    // if the API didn't return word-level timestamps for this request.
    if (data.segments && data.segments.length > 0) {
      return data.segments.map((s) => ({ word: s.text.trim(), start: s.start, end: s.end }));
    }
    return [];
  }

  private async fetchAudio(audioUrl: string): Promise<Blob> {
    if (audioUrl.startsWith("data:")) {
      const res = await fetch(audioUrl);
      return await res.blob();
    }
    const res = await fetch(audioUrl);
    if (!res.ok) {
      throw new Error(`Failed to fetch audio for transcription: ${res.status} ${audioUrl}`);
    }
    return await res.blob();
  }
}
