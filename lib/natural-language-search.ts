import { matchesNormalizedTerm, normalizeSearchText } from "./search-language";
import type { SearchOverrides } from "./search-overrides";

export type NaturalLanguageSearchPlan = {
  active: boolean;
  source: "none" | "manual" | "openai" | "manual+openai";
  normalized_query: string;
  category_queries: string[];
  recall_queries: string[];
  rewritten_query: string;
  avoid_terms: string[];
  suggested_query: string;
  confidence: number;
  ai_status: "not_needed" | "missing_key" | "called" | "error";
};

type CacheValue = {
  value: NaturalLanguageSearchPlan;
  expiresAt: number;
};

type IntentPlan = {
  match: string[];
  categoryQueries: string[];
  recallQueries: string[];
  avoidTerms?: string[];
};

const globalCache = globalThis as typeof globalThis & {
  __emrnNaturalLanguageSearchPlanCache?: Map<string, CacheValue>;
};

const cache = globalCache.__emrnNaturalLanguageSearchPlanCache || new Map<string, CacheValue>();
globalCache.__emrnNaturalLanguageSearchPlanCache = cache;

const CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14;

const genericNaturalLanguageTerms = [
  "supplies",
  "supply",
  "stuff",
  "things",
  "equipment",
  "products",
  "items",
  "for",
  "looking for",
  "need",
  "checking",
  "check",
  "office",
  "clinic",
  "hospital",
  "nursing",
  "ems",
  "first responder",
  "medical office",
  "doctor office",
  "cabinet medical",
  "clinique",
  "hopital",
  "hôpital",
  "soins infirmiers",
  "fournitures",
  "materiel",
  "matériel",
];

const exactProductSignals = [
  "sku",
  "model",
  "compatible",
  "compatibility",
  "replacement",
  "replace",
  "fits",
  "fit",
  "works",
  "work with",
];

const manualIntentPlans: IntentPlan[] = [
  {
    match: [
      "clinic supplies",
      "clici supplesi",
      "clinc supplies",
      "clinic suplies",
      "clinic supllies",
      "clinic supples",
      "clinic supply",
      "medical clinic supplies",
      "medical office supplies",
      "doctor office supplies",
      "doctor supplies",
      "physician office supplies",
      "fournitures clinique",
      "fournitures de clinique",
      "materiel clinique",
      "matériel clinique",
      "fournitures cabinet medical",
      "fournitures cabinet médical",
      "materiel cabinet medical",
      "matériel cabinet médical",
      "fournitures bureau medecin",
      "fournitures bureau médecin",
    ],
    categoryQueries: [
      "Nursing Supplies",
      "Diagnostics",
      "Wound Care",
      "PPE & Infection Control",
      "Needles & Syringes",
      "First Aid Kits & Supplies",
      "Gloves",
      "Masks",
      "Sterile Alcohol Prep Pads",
      "Sharps Containers",
      "Patient Care & Pharmacy",
      "Infection Control",
    ],
    recallQueries: [
      "exam gloves",
      "procedure masks",
      "n95 masks",
      "wound dressing",
      "gauze",
      "medical tape",
      "syringe",
      "needle",
      "sharps container",
      "otoscope",
      "stethoscope",
      "blood pressure cuff",
      "thermometer",
      "pulse oximeter",
      "alcohol swabs",
    ],
    avoidTerms: ["office binder", "copy paper", "marker"],
  },
  {
    match: ["hospital supplies", "hospital supply", "hosptial supllies", "hosptial supplies", "hospital suplies", "hospital supllies", "fournitures hopital", "fournitures hôpital", "fournitures pour hopital", "fournitures pour hôpital", "materiel hospitalier", "matériel hospitalier"],
    categoryQueries: [
      "Nursing Supplies",
      "Diagnostics",
      "Wound Care",
      "Patient Care & Pharmacy",
      "IV Administration",
      "Needles & Syringes",
      "Incontinence",
      "Equipment & Furnishings",
      "Infection Control",
    ],
    recallQueries: [
      "hospital bed",
      "bed pad",
      "iv set",
      "catheter",
      "syringe",
      "needle",
      "blood pressure cuff",
      "patient monitor",
      "wound dressing",
      "medical gown",
      "sharps container",
    ],
    avoidTerms: ["office binder", "copy paper"],
  },
  {
    match: ["nursing supplies", "nursing supply", "nurse supplies", "nusing suplies", "nusing supplies", "nursing suplies", "nursing supllies", "fournitures infirmieres", "fournitures infirmières", "fournitures soins infirmiers", "materiel infirmier", "matériel infirmier", "soins infirmiers"],
    categoryQueries: [
      "Nursing Supplies",
      "Patient Care & Pharmacy",
      "IV Administration",
      "Needles & Syringes",
      "Wound Care",
      "Diagnostics",
    ],
    recallQueries: [
      "iv administration",
      "syringe",
      "needle",
      "catheter",
      "blood pressure cuff",
      "stethoscope",
      "thermometer",
      "pulse oximeter",
      "wound dressing",
      "alcohol swabs",
    ],
  },
  {
    match: [
      "ems supplies",
      "ems supply",
      "emt supplies",
      "paramedic supplies",
      "first responder supplies",
      "ambulance supplies",
      "fournitures ems",
      "fournitures ambulancier",
      "fournitures ambulanciers",
      "fournitures paramedic",
      "fournitures paramedicaux",
      "fournitures paramédicaux",
      "premiers repondants",
      "premiers répondants",
      "materiel ambulance",
      "matériel ambulance",
    ],
    categoryQueries: [
      "First Aid Kits & Supplies",
      "Search & Rescue",
      "Medical Bags",
      "Oxygen Therapy",
      "Airway Management",
      "Stretchers",
      "Immobilization",
      "Tourniquets",
      "Bandage Shears",
      "Wound Care",
    ],
    recallQueries: [
      "trauma bag",
      "medical bag",
      "tourniquet",
      "trauma dressing",
      "chest seal",
      "oxygen mask",
      "bag valve mask",
      "stretcher",
      "cervical collar",
      "splint",
      "bandage shears",
      "emergency blanket",
    ],
  },
  {
    match: [
      "wound care stuff",
      "stuff for wound care",
      "things for wound care",
      "wound supplies",
      "wound care supplies",
      "fournitures soins plaies",
      "fournitures soins des plaies",
      "materiel soins plaies",
      "matériel soins plaies",
      "choses pour plaies",
    ],
    categoryQueries: ["Wound Care", "Gauze & Absorbent Dressings", "Adhesive Bandages", "Bandages", "Medical Tape", "First Aid Kits & Supplies"],
    recallQueries: ["wound dressing", "gauze", "adhesive bandage", "medical tape", "sterile dressing", "emergency bandage", "burn dressing", "saline"],
  },
  {
    match: [
      "things for checking ears",
      "check ears",
      "checking ears",
      "look inside ears",
      "ear wax checker",
      "ear scope",
      "ear supplies",
      "verifier oreilles",
      "vérifier oreilles",
      "regarder dans les oreilles",
      "voir dans les oreilles",
      "cire oreille",
      "cerumen",
      "cérumen",
    ],
    categoryQueries: ["Otoscope & Ear Specula Tips", "Diagnostics"],
    recallQueries: ["otoscope", "ear specula", "ear speculum", "diagnostic otoscope"],
  },
];

function cleanQuery(query: string, maxLength = 180) {
  return String(query || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanList(values: unknown, limit: number) {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const output: string[] = [];

  for (const value of values) {
    const clean = cleanQuery(String(value || ""), 80);
    const key = normalizeSearchText(clean);
    if (!clean || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= limit) break;
  }

  return output;
}

function uniqueList(values: string[], limit: number) {
  return cleanList(values, limit);
}

function matchingTerm(normalizedQuery: string, terms: string[]) {
  return terms.find((term) => {
    const normalizedTerm = normalizeSearchText(term);
    return matchesNormalizedTerm(normalizedQuery, normalizedTerm) || matchesNormalizedTerm(normalizedTerm, normalizedQuery);
  });
}

function hasPinnedSearchRule(query: string, controls?: SearchOverrides) {
  const normalized = normalizeSearchText(query);
  if (!normalized) return false;
  return Object.keys(controls?.pinnedSkus || {}).some((term) => {
    const normalizedTerm = normalizeSearchText(term);
    return normalized === normalizedTerm;
  });
}

function looksLikeSkuOrModel(query: string) {
  const value = query.trim();
  if (!value || value === "*") return false;
  if (/\b[A-Z]{1,6}[-]?\d{2,}[A-Z0-9+-]*\b/.test(value)) return true;
  if (/\b\d{4,}[A-Z0-9+-]*\b/i.test(value)) return true;
  return false;
}

function shouldPlanNaturalLanguage(query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized || normalized === "*" || normalized.length < 4) return false;
  if (looksLikeSkuOrModel(query)) return false;
  if (exactProductSignals.some((signal) => normalized.includes(signal))) return false;

  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length >= 3 || genericNaturalLanguageTerms.some((term) => normalized.includes(normalizeSearchText(term)));
}

function runtimePlanFor(query: string, controls?: SearchOverrides) {
  const normalized = normalizeSearchText(query);
  const matches = Object.entries(controls?.naturalLanguageRules || {}).filter(([term]) => matchingTerm(normalized, [term]));
  if (!matches.length) return null;
  const hasExactMatch = matches.some(([term]) => normalizeSearchText(term) === normalized);
  const suggestedQuery = hasExactMatch ? "" : matches.map(([term]) => term).find((term) => normalizeSearchText(term) !== normalized) || "";

  return {
    categoryQueries: uniqueList(matches.flatMap(([, rule]) => rule.categoryQueries), 18),
    recallQueries: uniqueList(matches.flatMap(([, rule]) => rule.recallQueries), 24),
    avoidTerms: uniqueList(matches.flatMap(([, rule]) => rule.avoidTerms || []), 12),
    suggestedQuery,
  };
}

function manualPlanFor(query: string, controls?: SearchOverrides) {
  const runtime = runtimePlanFor(query, controls);
  if (runtime && (runtime.categoryQueries.length || runtime.recallQueries.length)) return runtime;

  const normalized = normalizeSearchText(query);
  const matches = manualIntentPlans.filter((plan) => matchingTerm(normalized, plan.match));
  if (!matches.length) return null;
  const suggestedQuery = matches
    .map((plan) => {
      const matched = matchingTerm(normalized, plan.match);
      const canonical = plan.match[0] || "";
      if (!matched || normalizeSearchText(canonical) === normalized) return "";
      if (normalizeSearchText(matched) === normalized) return canonical;
      return matched;
    })
    .find(Boolean) || "";

  return {
    categoryQueries: uniqueList(matches.flatMap((plan) => plan.categoryQueries), 18),
    recallQueries: uniqueList(matches.flatMap((plan) => plan.recallQueries), 24),
    avoidTerms: uniqueList(matches.flatMap((plan) => plan.avoidTerms || []), 12),
    suggestedQuery,
  };
}

function emptyPlan(query: string): NaturalLanguageSearchPlan {
  return {
    active: false,
    source: "none",
    normalized_query: cleanQuery(query),
    category_queries: [],
    recall_queries: [],
    rewritten_query: "",
    avoid_terms: [],
    suggested_query: "",
    confidence: 0,
    ai_status: "not_needed",
  };
}

function extractOutputText(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const response = payload as {
    output_text?: unknown;
    output?: Array<{ content?: Array<{ text?: unknown }> }>;
  };
  if (typeof response.output_text === "string") return response.output_text;
  const parts: string[] = [];
  for (const item of response.output || []) {
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

async function planWithOpenAI(query: string) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { plan: null, status: "missing_key" as const };

  const model = process.env.OPENAI_SEARCH_TRANSLATOR_MODEL || "gpt-4.1-nano";
  const input = [
    {
      role: "system",
      content:
        "You are a query planner for EMRN Medical Supplies ecommerce search. Return ONLY JSON with keys normalized_query, category_queries, recall_queries, avoid_terms, confidence. Convert broad natural-language healthcare shopping requests into concise catalog category names and product search terms. Do not invent products. Prefer common medical supply categories such as Nursing Supplies, Diagnostics, Wound Care, First Aid Kits & Supplies, Medical Bags, Oxygen Therapy, Airway Management, Gloves, Masks, Needles & Syringes, Sharps Containers, Otoscope & Ear Specula Tips, Patient Care & Pharmacy, IV Administration. If the query is exact SKU/model/brand/product, return empty category_queries and recall_queries with confidence 0.",
    },
    {
      role: "user",
      content: `Customer search query: ${query}`,
    },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1600);

  try {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
      body: JSON.stringify({ model, input }),
    });

    if (!res.ok) {
      console.error("[EMRN SmartSearch] OpenAI natural-language planner error", res.status, await res.text());
      return { plan: null, status: "error" as const };
    }

    const payload = await res.json();
    const parsed = safeParseJson(extractOutputText(payload));
    if (!parsed || typeof parsed !== "object") return { plan: null, status: "error" as const };

    return {
      plan: {
        normalizedQuery: cleanQuery(String(parsed.normalized_query || query)),
        categoryQueries: cleanList(parsed.category_queries, 18),
        recallQueries: cleanList(parsed.recall_queries, 24),
        avoidTerms: cleanList(parsed.avoid_terms, 12),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence || 0))),
      },
      status: "called" as const,
    };
  } catch (error) {
    console.error("[EMRN SmartSearch] OpenAI natural-language planner request failed", error);
    return { plan: null, status: "error" as const };
  } finally {
    clearTimeout(timeout);
  }
}

export async function buildNaturalLanguageSearchPlan(query: string, controls?: SearchOverrides): Promise<NaturalLanguageSearchPlan> {
  const original = cleanQuery(query || "");
  if (hasPinnedSearchRule(original, controls)) return emptyPlan(original);
  const manual = manualPlanFor(original, controls);
  if (!manual && !shouldPlanNaturalLanguage(original)) return emptyPlan(original);

  const runtimeRulesKey = JSON.stringify(controls?.naturalLanguageRules || {});
  const cacheKey = `${normalizeSearchText(original)}::${runtimeRulesKey}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  let aiStatus: NaturalLanguageSearchPlan["ai_status"] = "not_needed";
  let ai: Awaited<ReturnType<typeof planWithOpenAI>>["plan"] = null;

  if (!manual) {
    const aiResult = await planWithOpenAI(original);
    aiStatus = aiResult.status;
    ai = aiResult.plan;
  }

  const categoryQueries = uniqueList([...(manual?.categoryQueries || []), ...(ai?.categoryQueries || [])], 18);
  const recallQueries = uniqueList([...(manual?.recallQueries || []), ...(ai?.recallQueries || [])], 24);
  const avoidTerms = uniqueList([...(manual?.avoidTerms || []), ...(ai?.avoidTerms || [])], 12);
  const source =
    manual && ai && (categoryQueries.length || recallQueries.length)
      ? "manual+openai"
      : manual && (categoryQueries.length || recallQueries.length)
        ? "manual"
        : ai && (categoryQueries.length || recallQueries.length)
          ? "openai"
          : "none";

  const result: NaturalLanguageSearchPlan = {
    active: Boolean(categoryQueries.length || recallQueries.length),
    source,
    normalized_query: ai?.normalizedQuery || original,
    category_queries: categoryQueries,
    recall_queries: recallQueries,
    rewritten_query: cleanQuery([original, ...recallQueries.slice(0, 12)].join(" "), 260),
    avoid_terms: avoidTerms,
    suggested_query: manual?.suggestedQuery || (ai?.normalizedQuery && normalizeSearchText(ai.normalizedQuery) !== normalizeSearchText(original) ? ai.normalizedQuery : ""),
    confidence: source === "manual" ? 0.95 : ai?.confidence || 0,
    ai_status: aiStatus,
  };

  cache.set(cacheKey, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
  return result;
}
