import type { TextProvider, TextGenerationRequest, TextGenerationResult } from "../types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Model routing: primary → fallback, so a single provider outage doesn't
// take down every AI feature in the app.
const DEFAULT_MODEL = "anthropic/claude-sonnet-4.5";
const FALLBACK_MODEL = "google/gemini-2.5-flash";

export class OpenRouterProvider implements TextProvider {
  private apiKey: string;

  constructor(apiKey = process.env.OPENROUTER_API_KEY!) {
    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is not set");
    }
    this.apiKey = apiKey;
  }

  async generate(req: TextGenerationRequest): Promise<TextGenerationResult> {
    const model = req.model ?? DEFAULT_MODEL;
    try {
      return await this.call(model, req);
    } catch (err) {
      // one automatic fallback on primary-model failure
      if (model !== FALLBACK_MODEL) {
        console.warn(`OpenRouter model ${model} failed, retrying with ${FALLBACK_MODEL}`, err);
        return await this.call(FALLBACK_MODEL, req);
      }
      throw err;
    }
  }

  private async call(model: string, req: TextGenerationRequest): Promise<TextGenerationResult> {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        // Required by OpenRouter for attribution / rate-limit tiers
        "HTTP-Referer": process.env.APP_URL ?? "https://vyro.app",
        "X-Title": "VYRO",
      },
      body: JSON.stringify({
        model,
        messages: req.messages,
        temperature: req.temperature ?? 0.7,
        max_tokens: req.maxTokens ?? 2000,
        ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`OpenRouter error ${res.status}: ${body}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? "",
      modelUsed: model,
      promptTokens: data.usage?.prompt_tokens,
      completionTokens: data.usage?.completion_tokens,
    };
  }
}
