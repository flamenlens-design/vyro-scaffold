// VYRO AI provider abstraction
//
// Every concrete backend (OpenRouter, fal.ai, ElevenLabs, Replicate, ...)
// implements one of these interfaces. Agents and API routes only ever
// depend on these types — never on a specific provider's SDK — so a
// backend can be swapped in lib/ai/providers/index.ts without touching
// business logic anywhere else.

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TextGenerationRequest {
  messages: ChatMessage[];
  model?: string;          // optional override; else provider default
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;      // ask for structured JSON output
}

export interface TextGenerationResult {
  text: string;
  modelUsed: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface TextProvider {
  generate(req: TextGenerationRequest): Promise<TextGenerationResult>;
}

export interface ImageGenerationRequest {
  prompt: string;
  negativePrompt?: string;
  referenceImageUrls?: string[]; // for character/style consistency
  aspectRatio?: string;
  model: string; // required — chosen via the model registry / UI
}

export interface ImageGenerationResult {
  url: string;
  modelUsed: string;
}

export interface ImageProvider {
  generate(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
}

export interface VideoGenerationRequest {
  prompt: string;
  referenceImageUrl?: string; // image-to-video / consistency anchor
  durationSec: number;
  aspectRatio?: string;
  model: string;
}

export interface VideoGenerationResult {
  url: string;
  modelUsed: string;
  durationSec: number;
}

export interface VideoProvider {
  generate(req: VideoGenerationRequest): Promise<VideoGenerationResult>;
}

export interface TTSRequest {
  text: string;
  voiceId: string;
  emotion?: string;
  speed?: number;
}

export interface TTSResult {
  url: string;
  durationSec: number;
}

export interface TTSProvider {
  generate(req: TTSRequest): Promise<TTSResult>;
}

export interface STTRequest {
  audioUrl: string;
}

export interface STTResult {
  text: string;
  words: { word: string; start: number; end: number }[];
}

export interface STTProvider {
  transcribe(req: STTRequest): Promise<STTResult>;
}

export interface MusicGenerationRequest {
  moodPrompt: string;
  durationSec: number;
}

export interface MusicGenerationResult {
  url: string;
  durationSec: number;
}

export interface MusicProvider {
  generate(req: MusicGenerationRequest): Promise<MusicGenerationResult>;
}
