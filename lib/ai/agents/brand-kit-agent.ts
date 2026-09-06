// Brand Kit extraction agent
//
// Given a website URL, fetches the homepage (+ up to 2 same-origin linked
// pages that look brand/about-related), pulls out deterministic visual-identity
// signals (hex colors, font-family names, a logo URL) with plain regex/string
// parsing, then hands that extracted material to the TextProvider to synthesize
// a brand-voice read and pick the most representative colors/fonts.
//
// Deliberately dependency-free (see "Known limitations" below) — everything
// here runs on Node's built-in `fetch`, matching what's already in package.json.
//
// Known limitations / things this agent does NOT do, on purpose:
//
// 1. No headless rendering. Plain `fetch` only gets server-rendered HTML — a
//    client-side-rendered site (React/Vue app with an empty initial HTML shell)
//    will yield little or no extractable copy/colors/fonts. Playwright would
//    fix this (render the page, read computed styles, take a screenshot) but
//    isn't in package.json — flagged in the handoff summary rather than added
//    here, per the constraints for this task.
//
// 2. "Dominant colors" here means "hex codes that appear most often in the
//    page's inline styles/<style> blocks/meta tags," not true dominant colors
//    of the rendered page (which would require rasterizing the page and
//    running a color-quantization pass, e.g. via a screenshot + node-vibrant/
//    colorthief). Good enough as a first pass; flagged as a follow-up.
//
// 3. No vision input to the LLM. `TextGenerationRequest` (lib/ai/types.ts) only
//    accepts plain-string message content — no image/screenshot support — so
//    this agent extracts *text* (copy, CSS color/font values, logo URLs) and
//    reasons over that, rather than looking at a rendered screenshot the way a
//    human designer would. See the interface-change note at the bottom of this
//    file for what `TextGenerationRequest`/`ChatMessage` would need to support
//    that later.

import { getTextProvider } from "../providers";
import { parseJsonResponse } from "../json-parse";

const MAX_PAGES = 3; // homepage + up to 2 linked pages
const FETCH_TIMEOUT_MS = 10_000;
const MAX_HTML_BYTES = 500_000; // don't pull down an entire huge page
const MAX_COPY_CHARS_PER_PAGE = 4_000; // keep the LLM prompt bounded across pages

const LINK_KEYWORDS = ["about", "brand", "press", "story", "our-story", "company"];

const GENERIC_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "inherit", "initial", "unset", "ui-sans-serif", "ui-serif", "ui-monospace",
  "-apple-system", "blinkmacsystemfont",
]);

const NEAR_GRAYSCALE = new Set([
  "#fff", "#ffffff", "#000", "#000000", "#fefefe", "#fafafa", "#f5f5f5",
  "#f8f8f8", "#eeeeee", "#e5e5e5", "#111111", "#0a0a0a", "#0a0a0f",
]);

export interface BrandKitExtraction {
  // --- Fields that map 1:1 onto prisma/schema.prisma's BrandKit model ---
  name: string;
  logoUrl: string | null;
  colors: string[]; // hex values, most brand-relevant first
  fonts: string[]; // font-family names / short style descriptors

  // --- Extracted, but not yet representable in the BrandKit model ---
  // See the schema-change note in this agent's handoff summary
  // (suggested fields: `voiceTone String?`, `toneKeywords Json?`,
  // `description String?`).
  voiceTone: string;
  toneKeywords: string[];
  description: string;

  // --- Provenance, useful for debugging/audit, not persisted ---
  sourceUrl: string;
  pagesAnalyzed: string[];
}

interface PageData {
  url: string;
  html: string;
  text: string;
}

class BrandKitFetchError extends Error {
  status = 502;
  constructor(message: string) {
    super(message);
    this.name = "BrandKitFetchError";
  }
}

export async function extractBrandKit(inputUrl: string): Promise<BrandKitExtraction> {
  const homepageUrl = normalizeUrl(inputUrl);
  const homepage = await fetchPage(homepageUrl);

  const linkedUrls = findRelevantLinks(homepage.html, homepageUrl).slice(0, MAX_PAGES - 1);
  const linkedPages = await Promise.all(
    linkedUrls.map((url) => fetchPage(url).catch(() => null))
  );
  const pages = [homepage, ...linkedPages.filter((p): p is PageData => p !== null)];

  const candidateColors = rankColors(pages.flatMap((p) => extractHexColors(p.html)));
  const candidateFonts = rankFonts(pages.flatMap((p) => extractFontFamilies(p.html)));
  const logoUrl = extractLogoUrl(homepage.html, homepageUrl);
  const siteName = extractTitle(homepage.html) ?? new URL(homepageUrl).hostname;
  const combinedCopy = pages
    .map((p) => `--- ${p.url} ---\n${p.text.slice(0, MAX_COPY_CHARS_PER_PAGE)}`)
    .join("\n\n");

  const synthesis = await synthesizeBrandKit({
    siteName,
    combinedCopy,
    candidateColors,
    candidateFonts,
  });

  return {
    name: synthesis.name || siteName,
    logoUrl,
    colors: synthesis.colors,
    fonts: synthesis.fonts,
    voiceTone: synthesis.voiceTone,
    toneKeywords: synthesis.toneKeywords,
    description: synthesis.description,
    sourceUrl: homepageUrl,
    pagesAnalyzed: pages.map((p) => p.url),
  };
}

// ---------- Fetching ----------

function normalizeUrl(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  return new URL(withProtocol).toString();
}

async function fetchPage(url: string): Promise<PageData> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        // A generic browser UA — some sites 403 non-browser requests.
        "User-Agent":
          "Mozilla/5.0 (compatible; VyroBrandKitBot/1.0; +https://vyro.app/bot)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    if (!res.ok) {
      throw new BrandKitFetchError(`Failed to fetch ${url}: HTTP ${res.status}`);
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      throw new BrandKitFetchError(`${url} did not return HTML (got "${contentType}")`);
    }

    const raw = await res.text();
    const html = raw.slice(0, MAX_HTML_BYTES);
    return { url, html, text: htmlToText(html) };
  } catch (err) {
    if (err instanceof BrandKitFetchError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new BrandKitFetchError(`Timed out fetching ${url}`);
    }
    throw new BrandKitFetchError(
      `Failed to fetch ${url}: ${err instanceof Error ? err.message : "unknown error"}`
    );
  } finally {
    clearTimeout(timeout);
  }
}

// ---------- HTML parsing helpers (no HTML parser lib available — see summary) ----------

function htmlToText(html: string): string {
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, " ");
  return decodeHtmlEntities(withoutTags).replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!match) return null;
  const title = decodeHtmlEntities(match[1]).trim();
  // Strip common " | Tagline" / " - Tagline" suffixes to get a bare brand name.
  return title.split(/\s[|\-–]\s/)[0].trim() || null;
}

function findRelevantLinks(html: string, baseUrl: string): string[] {
  const base = new URL(baseUrl);
  const found = new Set<string>();

  const linkRegex = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const [, href, innerText] = match;
    const haystack = `${href} ${htmlToText(innerText)}`.toLowerCase();
    if (!LINK_KEYWORDS.some((kw) => haystack.includes(kw))) continue;

    try {
      const resolved = new URL(href, base);
      if (resolved.hostname !== base.hostname) continue; // same-origin only
      resolved.hash = "";
      found.add(resolved.toString());
    } catch {
      // ignore unparsable hrefs (mailto:, javascript:, etc.)
    }
  }

  return Array.from(found);
}

function extractHexColors(html: string): string[] {
  const matches = html.match(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g) ?? [];
  return matches.map((c) => c.toLowerCase());
}

function rankColors(colors: string[]): string[] {
  const counts = new Map<string, number>();
  for (const c of colors) counts.set(c, (counts.get(c) ?? 0) + 1);

  const ranked = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const nonGrayscale = ranked.filter(([hex]) => !NEAR_GRAYSCALE.has(hex));
  const ordered = nonGrayscale.length > 0 ? nonGrayscale : ranked;

  return ordered.slice(0, 8).map(([hex]) => hex);
}

function extractFontFamilies(html: string): string[] {
  const matches = html.match(/font-family\s*:\s*([^;"'}<]+)/gi) ?? [];
  const names: string[] = [];

  for (const m of matches) {
    const value = m.replace(/font-family\s*:\s*/i, "");
    const first = value.split(",")[0].trim().replace(/^["']|["']$/g, "");
    if (first && !GENERIC_FONT_FAMILIES.has(first.toLowerCase())) {
      names.push(first);
    }
  }

  return names;
}

function rankFonts(fonts: string[]): string[] {
  const counts = new Map<string, number>();
  for (const f of fonts) counts.set(f, (counts.get(f) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name]) => name);
}

function extractLogoUrl(html: string, baseUrl: string): string | null {
  const base = new URL(baseUrl);
  const candidates: string[] = [];

  // <img> tags whose src/alt/class mention "logo"
  const imgRegex = /<img\s[^>]*>/gi;
  const imgTags = html.match(imgRegex) ?? [];
  for (const tag of imgTags) {
    const src = tag.match(/src=["']([^"']+)["']/i)?.[1];
    if (!src) continue;
    const signal = tag.toLowerCase();
    if (signal.includes("logo")) candidates.push(src);
  }

  // <link rel="icon"> / apple-touch-icon as a fallback
  const linkRegex = /<link\s[^>]*rel=["'][^"']*(?:icon)[^"']*["'][^>]*>/gi;
  const linkTags = html.match(linkRegex) ?? [];
  for (const tag of linkTags) {
    const href = tag.match(/href=["']([^"']+)["']/i)?.[1];
    if (href) candidates.push(href);
  }

  // og:image as a last resort (often the logo or a brand hero image)
  const ogImage = html.match(
    /<meta\s[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
  )?.[1];
  if (ogImage) candidates.push(ogImage);

  for (const candidate of candidates) {
    try {
      return new URL(candidate, base).toString();
    } catch {
      continue;
    }
  }

  return null;
}

// ---------- LLM synthesis ----------

interface SynthesisInput {
  siteName: string;
  combinedCopy: string;
  candidateColors: string[];
  candidateFonts: string[];
}

interface SynthesisResult {
  name: string;
  colors: string[];
  fonts: string[];
  voiceTone: string;
  toneKeywords: string[];
  description: string;
}

async function synthesizeBrandKit(input: SynthesisInput): Promise<SynthesisResult> {
  const provider = getTextProvider();

  const result = await provider.generate({
    messages: [
      {
        role: "system",
        content:
          "You are a brand strategist and designer distilling a brand kit from a website's " +
          "extracted copy and CSS. You will be given: the site name, extracted body copy from " +
          "one or more pages, a list of candidate hex colors found in the site's CSS, and a list " +
          "of candidate font-family names found in the site's CSS.\n\n" +
          "Return ONLY valid JSON matching this exact shape, no markdown, no preamble:\n" +
          '{"name": string, "colors": string[], "fonts": string[], "voiceTone": string, ' +
          '"toneKeywords": string[], "description": string}\n\n' +
          "Rules:\n" +
          "- \"colors\": pick up to 5 of the MOST brand-relevant hex codes, ordered most " +
          "  dominant/important first. You MUST only choose values from the provided candidate " +
          "  color list — do not invent hex codes. If the candidate list is empty, return [].\n" +
          "- \"fonts\": pick up to 3 entries. Each entry should be the font name from the " +
          "  candidate list plus a short style descriptor, e.g. \"Inter — modern, geometric " +
          "  sans-serif\". If the candidate list is empty, infer 1-2 general style descriptors " +
          "  from the copy's tone instead (e.g. \"clean sans-serif, minimal\"), without naming a " +
          "  specific typeface you weren't given.\n" +
          "- \"voiceTone\": a short (3-6 word) descriptor of the brand's voice, e.g. " +
          "  \"confident, minimal, premium\".\n" +
          "- \"toneKeywords\": 3-6 single-word or short-phrase adjectives describing the brand voice.\n" +
          "- \"description\": 1-2 sentences summarizing the brand's positioning and voice, based " +
          "  only on the copy provided.\n" +
          "- \"name\": the brand/company name, cleaned up (no taglines).",
      },
      {
        role: "user",
        content:
          `Site name (from <title>): ${input.siteName}\n\n` +
          `Candidate colors (from CSS): ${JSON.stringify(input.candidateColors)}\n\n` +
          `Candidate fonts (from CSS): ${JSON.stringify(input.candidateFonts)}\n\n` +
          `Extracted site copy:\n${input.combinedCopy || "(no readable copy extracted)"}`,
      },
    ],
    jsonMode: true,
    temperature: 0.4,
  });

  const parsed = safeParseSynthesis(result.text);

  // Never trust the model's colors more than the deterministic candidate
  // list — filter to valid hex values that were actually found on the site.
  const candidateSet = new Set(input.candidateColors);
  const validColors = parsed.colors.filter(
    (c) => /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c) && candidateSet.has(c.toLowerCase())
  );

  return {
    name: parsed.name || input.siteName,
    colors: validColors.length > 0 ? validColors : input.candidateColors.slice(0, 5),
    fonts: parsed.fonts.length > 0 ? parsed.fonts : input.candidateFonts,
    voiceTone: parsed.voiceTone,
    toneKeywords: parsed.toneKeywords,
    description: parsed.description,
  };
}

function safeParseSynthesis(text: string): SynthesisResult {
  const fallback: SynthesisResult = {
    name: "",
    colors: [],
    fonts: [],
    voiceTone: "",
    toneKeywords: [],
    description: "",
  };

  try {
    const parsed = parseJsonResponse<Partial<SynthesisResult>>(text);
    return {
      name: typeof parsed.name === "string" ? parsed.name : fallback.name,
      colors: Array.isArray(parsed.colors) ? parsed.colors.filter((c) => typeof c === "string") : [],
      fonts: Array.isArray(parsed.fonts) ? parsed.fonts.filter((f) => typeof f === "string") : [],
      voiceTone: typeof parsed.voiceTone === "string" ? parsed.voiceTone : fallback.voiceTone,
      toneKeywords: Array.isArray(parsed.toneKeywords)
        ? parsed.toneKeywords.filter((t) => typeof t === "string")
        : [],
      description: typeof parsed.description === "string" ? parsed.description : fallback.description,
    };
  } catch {
    return fallback;
  }
}

// ---------- Interface-change note (not applied here, per task constraints) ----------
//
// `TextGenerationRequest`/`ChatMessage` in lib/ai/types.ts only support plain-string
// message content. To let this (or any future) agent pass a screenshot for real
// vision-based extraction, that interface would need something like:
//
//   export interface ChatMessage {
//     role: "system" | "user" | "assistant";
//     content: string | Array<
//       | { type: "text"; text: string }
//       | { type: "image_url"; imageUrl: string }
//     >;
//   }
//
// ...plus an OpenRouterProvider.generate() update to pass multimodal content through
// to a vision-capable model (OpenRouter supports this on many models already), and a
// capability flag (e.g. `TextProvider.supportsVision?: boolean`) so callers can check
// before sending image content to a provider that can't use it.
