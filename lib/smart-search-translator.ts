import { detectQueryLanguage, expandSearchQuery, getFallbackTerms } from "./search-language";
import { findSearchRedirect, searchOverrides } from "./search-overrides";

type SmartQueryResult = {
  original_query: string;
  search_query: string;
  language: "en" | "fr";
  expanded_query: string;
  expansions: string[];
  translated_query: string;
  translator: "none" | "manual" | "openai" | "manual+openai";
  fallback_terms: string[];
  redirect_url?: string;
};

type CacheValue = {
  value: SmartQueryResult;
  expiresAt: number;
};

const globalCache = globalThis as typeof globalThis & {
  __emrnSmartSearchTranslatorCache?: Map<string, CacheValue>;
};

const cache = globalCache.__emrnSmartSearchTranslatorCache || new Map<string, CacheValue>();
globalCache.__emrnSmartSearchTranslatorCache = cache;

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

function cleanSearchQuery(query: string) {
  return String(query || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function extractOutputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;

  const parts: string[] = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (typeof content?.text === "string") parts.push(content.text);
    }
  }

  return parts.join("\n").trim();
}

function safeParseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

async function translateWithOpenAI(query: string, language: "en" | "fr") {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return "";

  const model = process.env.OPENAI_SEARCH_TRANSLATOR_MODEL || "gpt-5.5";
  const input = [
    {
      role: "system",
      content:
        "You translate healthcare ecommerce search queries into concise English search keywords for a Canadian medical supply website. Return ONLY JSON with keys english_query and alternatives. Do not include explanations. Preserve brand names, SKU-like strings, model numbers, sizes, French medical intent, and product category meaning. Use common North American medical supply terms: manikin not mannequin, AED, CPR, blood pressure cuff, oxygen mask, wound dressing, syringe, catheter, gloves.",
    },
    {
      role: "user",
      content: `Query language: ${language}\nCustomer search query: ${query}\nReturn English search keywords that should match product names/SKUs/categories.`,
    },
  ];

  const res = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input,
    }),
  });

  if (!res.ok) {
    console.error("[EMRN SmartSearch] OpenAI translator error", res.status, await res.text());
    return "";
  }

  const payload = await res.json();
  const text = extractOutputText(payload);
  const parsed = safeParseJson(text);
  const englishQuery = cleanSearchQuery(parsed?.english_query || "");

  return englishQuery;
}

export async function buildSmartSearchQuery(query: string): Promise<SmartQueryResult> {
  const original = cleanSearchQuery(query || "*");
  const cacheKey = original.toLowerCase();
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const redirect = findSearchRedirect(original);
  const manual = expandSearchQuery(original);
  const language = manual.language || detectQueryLanguage(original);

  let translated = "";
  let translator: SmartQueryResult["translator"] = "none";

  if (manual.expansions.length) {
    translated = manual.expansions[0];
    translator = "manual";
  }

  const shouldUseAI =
    original !== "*" &&
    original.length >= 3 &&
    (language === "fr" || manual.expansions.length === 0);

  if (shouldUseAI) {
    const aiQuery = await translateWithOpenAI(original, language);
    if (aiQuery) {
      translated = aiQuery;
      translator = translator === "manual" ? "manual+openai" : "openai";
    }
  }

  const fallbackTerms = Array.from(
    new Set([
      ...getFallbackTerms(original),
      ...(searchOverrides.noResultsSuggestions[translated.toLowerCase()] || []),
    ])
  ).slice(0, 8);

  const result: SmartQueryResult = {
    original_query: original,
    search_query: translated || original,
    language,
    expanded_query: manual.expanded,
    expansions: manual.expansions,
    translated_query: translated,
    translator,
    fallback_terms: fallbackTerms,
    redirect_url: redirect?.url,
  };

  cache.set(cacheKey, {
    value: result,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return result;
}

export function applyHiddenSkuFilter(hits: any[] = []) {
  if (!searchOverrides.hiddenSkus.length) return hits;
  const hidden = new Set(searchOverrides.hiddenSkus.map((sku) => sku.toLowerCase()));
  return hits.filter((hit) => !hidden.has(String(hit.document?.sku || "").toLowerCase()));
}
