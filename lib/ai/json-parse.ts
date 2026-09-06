// Defensive JSON parsing for LLM output. Even with jsonMode: true
// (OpenRouterProvider's `response_format: { type: "json_object" }`), some
// models — especially non-OpenAI models proxied through OpenRouter, where
// strict JSON mode isn't always natively honored — still wrap their answer
// in a markdown code fence (```json ... ```) or add a stray line before/
// after the object. A raw JSON.parse() on that throws
// "Unexpected token '`'" and surfaces as an opaque 500. Every agent that
// expects structured JSON back from an LLM call should go through this
// instead.
export function parseJsonResponse<T>(text: string): T {
  let cleaned = text.trim();

  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Fall back to slicing between the first { or [ and the last matching
    // } or ] — covers a stray fence on only one side, or a short preamble
    // like "Here's the JSON:" the model added despite instructions not to.
    const start = cleaned.search(/[{[]/);
    const end = Math.max(cleaned.lastIndexOf("}"), cleaned.lastIndexOf("]"));
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        // fall through to the error below with full context
      }
    }
    throw new Error(
      `Model returned invalid JSON even after fence-stripping. First 200 chars: ${cleaned.slice(0, 200)}`
    );
  }
}
