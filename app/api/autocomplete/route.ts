import { after, NextRequest, NextResponse } from "next/server";
import { typesenseAdmin, typesenseSearch } from "../../../lib/typesense";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";
import { buildNaturalLanguageSearchPlan, type NaturalLanguageSearchPlan } from "../../../lib/natural-language-search";
import { normalizeSearchText } from "../../../lib/search-language";
import { applyBrandQueryRanking, applyFastAttributeRanking, applyHiddenSkuFilter, applyIntentRanking, applyPinnedAwareFastAttributeRanking, applyPinnedSkuRanking, applyPrivateCategoryFilter } from "../../../lib/search-ranking";
import { balanceHitsByProductFamily, productFamilyKey } from "../../../lib/search-result-balancing";
import { getEffectiveSearchOverrides, getPinnedSkusForQuery } from "../../../lib/search-overrides";
import { PRODUCT_COLLECTION_ALIAS } from "../../../lib/search-index";
import { STORE_URL, absoluteStoreUrl } from "../../../lib/store-url";

const COLLECTION_NAME = PRODUCT_COLLECTION_ALIAS;
const ANALYTICS_COLLECTION_NAME = "emrn_search_analytics";
const AED_CATEGORY_ID = 160;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function categoryUrlMapFromHits(hits: any[] = []) {
  const map = new Map<string, string>();

  for (const hit of hits) {
    const pairs = hit.document?.category_url_pairs || [];
    for (const pair of pairs) {
      const [name, ...urlParts] = String(pair).split("|");
      const url = urlParts.join("|");
      if (name && url && !map.has(name)) map.set(name, absoluteStoreUrl(url));
    }
  }

  return map;
}

function facetCountsFromHits(hits: any[] = [], field: "brand" | "categories", limit = 10) {
  const counts = new Map<string, number>();

  for (const hit of hits) {
    const value = hit.document?.[field];
    const values = Array.isArray(value) ? value : [value];

    for (const item of values) {
      const clean = String(item || "").trim();
      if (!clean) continue;
      counts.set(clean, (counts.get(clean) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .slice(0, limit);
}

function reorderFacetValues(values: Array<{ value: string; count: number; url?: string }>, priorityValues: string[] = []) {
  const priority = new Map(priorityValues.map((value, index) => [normalizeSearchText(value), index]));
  return [...values].sort((a, b) => {
    const aPriority = priority.has(normalizeSearchText(a.value)) ? priority.get(normalizeSearchText(a.value))! : 999;
    const bPriority = priority.has(normalizeSearchText(b.value)) ? priority.get(normalizeSearchText(b.value))! : 999;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return Number(b.count || 0) - Number(a.count || 0) || String(a.value || "").localeCompare(String(b.value || ""));
  });
}

function normalizeHit(doc: any) {
  return {
    id: doc.id,
    product_id: doc.product_id,
    variant_id: doc.variant_id || 0,
    is_variant: Boolean(doc.is_variant),
    parent_name: doc.parent_name || "",
    name: doc.name,
    sku: doc.sku,
    brand: doc.brand,
    sold_by: doc.sold_by || "",
    price: doc.price,
    sale_price: doc.sale_price,
    retail_price: doc.retail_price,
    image: doc.image,
    url: absoluteStoreUrl(doc.url),
    option_text: doc.option_text || "",
    variant_label: doc.variant_label || "",
    availability: doc.availability,
    availability_description: doc.availability_description,
    purchasable: doc.purchasable !== false && doc.quote_only !== true,
    quote_only: doc.quote_only === true,
    purchase_action: doc.purchase_action || (doc.quote_only ? "quote_only" : "cart"),
    purchase_message: doc.purchase_message || "",
  };
}

function hitKey(hit: any) {
  const doc = hit.document || {};
  return String(doc.id || `${doc.product_id || ""}:${doc.variant_id || ""}:${doc.sku || ""}`);
}

function mergeHits(...groups: any[][]) {
  const seen = new Set<string>();
  const merged: any[] = [];

  for (const group of groups) {
    for (const hit of group || []) {
      const key = hitKey(hit);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      merged.push(hit);
    }
  }

  return merged;
}

function productParentKey(hit: any) {
  const doc = hit?.document || {};
  return normalizeSearchText(String(doc.parent_name || doc.name || doc.product_id || doc.sku || ""));
}

function preferredAutocompleteFamilies(categoryQueries: string[] = [], recallQueries: string[] = []) {
  const text = normalizeSearchText([...categoryQueries, ...recallQueries].join(" "));
  const preferred = [
    ["gloves", ["glove", "gloves"]],
    ["masks", ["mask", "masks", "ppe", "infection control"]],
    ["diagnostic-ear", ["otoscope", "ear", "diagnostic"]],
    ["diagnostic-heart", ["stethoscope", "diagnostic"]],
    ["diagnostic-vitals", ["thermometer", "oximeter", "pulse oximeter", "diagnostic", "patient monitor"]],
    ["wound-dressings", ["wound", "dressing", "gauze", "bandage"]],
    ["sharps", ["sharp", "sharps"]],
    ["needles-syringes", ["needle", "syringe"]],
    ["first-aid", ["first aid", "trauma"]],
    ["infection-control", ["alcohol", "swab", "wipe", "infection control"]],
  ] as Array<[string, string[]]>;

  return preferred
    .filter(([, signals]) => signals.some((signal) => text.includes(normalizeSearchText(signal))))
    .map(([family]) => family);
}

function diversifyAutocompleteHits(hits: any[] = [], naturalLanguagePlan: { active?: boolean; category_queries?: string[]; recall_queries?: string[] }) {
  if (!naturalLanguagePlan.active || hits.length < 4) return hits;

  const balanced = balanceHitsByProductFamily(hits, 48);
  const preferredFamilies = preferredAutocompleteFamilies(naturalLanguagePlan.category_queries || [], naturalLanguagePlan.recall_queries || []);
  const parentCounts = new Map<string, number>();
  const familyCounts = new Map<string, number>();

  const score = (hit: any, index: number) => {
    const family = productFamilyKey(hit);
    const preferredIndex = preferredFamilies.indexOf(family);
    let value = 10000 - index;
    if (preferredIndex >= 0) value += 5000 - preferredIndex * 250;
    value -= (familyCounts.get(family) || 0) * 1600;
    value -= (parentCounts.get(productParentKey(hit)) || 0) * 2600;
    return value;
  };

  const remaining = balanced.map((hit, index) => ({ hit, index }));
  const selected: any[] = [];

  while (remaining.length && selected.length < balanced.length) {
    remaining.sort((a, b) => score(b.hit, b.index) - score(a.hit, a.index));
    const next = remaining.shift()!;
    selected.push(next.hit);
    const family = productFamilyKey(next.hit);
    const parent = productParentKey(next.hit);
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
    parentCounts.set(parent, (parentCounts.get(parent) || 0) + 1);
  }

  return selected;
}

function emptyAutocompleteNaturalLanguagePlan(query: string): NaturalLanguageSearchPlan {
  return {
    active: false,
    source: "none",
    normalized_query: query,
    category_queries: [],
    recall_queries: [],
    rewritten_query: "",
    avoid_terms: [],
    suggested_query: "",
    confidence: 0,
    ai_status: "not_needed",
  };
}

function isFocusedAutocompleteQuery(query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized || normalized === "*") return false;

  const broadPhrases = [
    "clinic supplies",
    "clinic supply",
    "doctor office supplies",
    "medical office supplies",
    "hospital supplies",
    "nursing supplies",
    "ems supplies",
    "first responder supplies",
    "wound supplies",
    "wound care stuff",
    "wound care supplies",
    "checking ears",
    "look inside ears",
    "fournitures clinique",
    "fournitures de clinique",
    "materiel clinique",
    "matériel clinique",
    "fournitures cabinet medical",
    "fournitures cabinet médical",
    "fournitures hopital",
    "fournitures hôpital",
    "fournitures soins infirmiers",
    "fournitures ems",
    "fournitures soins plaies",
    "materiel soins plaies",
    "matériel soins plaies",
  ];
  if (broadPhrases.some((phrase) => normalized.includes(normalizeSearchText(phrase)))) return false;
  if (/\b(supplies|supply|stuff|things|equipment|products|items|fournitures|materiel|matériel)\b/.test(normalized)) return false;

  const focusedTerms = [
    "oxygen mask",
    "oxygen masks",
    "masque oxygene",
    "masque oxygène",
    "masques oxygene",
    "masques oxygène",
    "masque d oxygene",
    "masque d oxygène",
    "masque d’oxygène",
    "non rebreather",
    "non-rebreather",
    "masque avec reservoir",
    "masque avec réservoir",
    "bag valve mask",
    "ballon masque",
    "sac ambu",
    "bvm",
    "oximeter",
    "oximeters",
    "oxymeter",
    "oxymeters",
    "pulse oximeter",
    "pulse ox",
    "spo2",
    "spo2 monitor",
    "ecg",
    "ekg",
    "ecg machine",
    "ekg machine",
    "ecg monitor",
    "ekg monitor",
    "electrocardiograph",
    "electrocardiographe",
    "électrocardiographe",
    "machine ecg",
    "moniteur ecg",
    "oximetre",
    "oximètre",
    "saturometre",
    "saturomètre",
    "stethoscope",
    "stetoscope",
    "stethascope",
    "otoscope",
    "otoscop",
    "glove",
    "gloves",
    "gants",
    "mask",
    "masks",
    "masque",
    "masques",
    "n95",
    "syringe",
    "syringes",
    "seringue",
    "seringues",
    "needle",
    "needles",
    "aiguille",
    "aiguilles",
    "sharps container",
    "wound dressing",
    "pansement",
    "pansements",
    "gauze",
    "gaze",
    "bandage",
    "thermometer",
    "thermometre",
    "thermomètre",
    "blood pressure cuff",
    "bp cuff",
    "brassard",
    "tensiometre",
    "tensiomètre",
    "nasal cannula",
    "nasal canula",
    "oxygen cannula",
    "canule nasale",
    "blue phantom",
    "stretcher",
    "stretchers",
    "brancard",
    "brancards",
    "civiere",
    "civière",
    "catheter",
    "cathéter",
    "aed pads",
    "electrode",
    "electrodes",
  ];
  if (focusedTerms.some((term) => normalized.includes(normalizeSearchText(term)))) return true;

  const words = normalized.split(/\s+/).filter(Boolean);
  return words.length <= 2;
}

function withAutocompleteTimeout<T>(promise: Promise<T>, timeoutMs = 650): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);
}

function compactAutocompleteQuery(originalQuery: string, naturalLanguagePlan: NaturalLanguageSearchPlan, smartSearchQuery: string) {
  const normalized = normalizeSearchText(originalQuery);
  if ([
    "masque oxygene",
    "masque oxygène",
    "masques oxygene",
    "masques oxygène",
    "masque d oxygene",
    "masque d oxygène",
    "masque d’oxygène",
  ].some((term) => normalized.includes(normalizeSearchText(term)))) {
    return "oxygen masks aerosol mask oxygen therapy mask non-rebreather mask adult pediatric";
  }

  if (!naturalLanguagePlan.active) return smartSearchQuery;
  return [
    originalQuery,
    ...(naturalLanguagePlan.recall_queries || []).slice(0, 4),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

function isOxygenMaskAutocompleteQuery(query: string) {
  const normalized = normalizeSearchText(query);
  return [
    "oxygen mask",
    "oxygen masks",
    "masque oxygene",
    "masque oxygène",
    "masques oxygene",
    "masques oxygène",
    "masque d oxygene",
    "masque d oxygène",
    "masque d’oxygène",
  ].some((term) => normalized.includes(normalizeSearchText(term)));
}

function applyAutocompleteOxygenMaskRanking(hits: any[] = [], query: string) {
  if (!isOxygenMaskAutocompleteQuery(query)) return hits;

  const preferred = [
    "aerosol mask",
    "oxygen mask",
    "oxygen masks",
    "oxygen therapy mask",
    "non-rebreather",
    "non rebreather",
    "high concentration",
    "medium concentration",
    "air cushion disposable masks",
    "air soft mask",
    "mask with tubing",
    "nebulizer mask",
  ];
  const genericFaceMasks = [
    "n95",
    "kn95",
    "particulate respirator",
    "respirator",
    "procedure mask",
    "surgical mask",
    "face mask",
    "paper face mask",
    "earloop",
  ];

  const score = (hit: any) => {
    const doc = hit?.document || {};
    const name = normalizeSearchText([doc.name, doc.parent_name, doc.variant_label, doc.option_text].filter(Boolean).join(" "));
    let value = 0;
    if (preferred.some((term) => name.includes(normalizeSearchText(term)))) value += 1000;
    if (genericFaceMasks.some((term) => name.includes(normalizeSearchText(term)))) value -= 1200;
    return value;
  };

  return [...hits].sort((a, b) => score(b) - score(a));
}

function applyAutocompleteFocusedFamilyRanking(hits: any[] = [], query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized || /\b(supplies|supply|stuff|things|equipment|products|items|fournitures|materiel|matériel)\b/.test(normalized)) return hits;
  const explicitAccessory = includesAny(normalized, ["accessory", "accessories", "replacement", "part", "parts", "paper", "electrode", "lead", "cable", "bag", "software", "viewer", "sensor", "probe", "strap", "straps"]);

  const families = [
    {
      active: includesAny(normalized, ["patient monitor", "patient monitors", "patient monitoring", "vital signs monitor", "vital sign monitor", "vitals monitor", "heart rate", "heart reate", "heart monitor", "cardiac monitor", "heart rate machine", "moniteur cardiaque", "moniteur patient", "moniteur de patient", "moniteur de signes vitaux"]) && !explicitAccessory,
      prefer: ["patient monitor", "vital signs monitor", "vital sign monitor", "bedside monitor", "spot monitor", "multiparameter monitor", "multi-parameter monitor", "heart rate monitor", "heart monitor", "cardiac monitor", "ecg monitor", "edan x10", "edan x12", "edan im3", "im50 patient monitor", "im60 patient monitor", "m3 vital signs", "m3a vital signs", "connex spot", "spot vital sign"],
      demote: ["accessory", "accessories", "recording paper", "thermal paper", "electrode", "lead", "leadwire", "cable", "bag", "software", "viewer", "usb", "sentinel", "sensor", "probe", "cuff", "mount", "mounting", "stand", "holder", "bracket"],
      force: 1100,
    },
    {
      active: includesAny(normalized, ["ecg", "ekg", "ecg machine", "ekg machine", "ecg monitor", "ekg monitor", "electrocardiograph", "electrocardiographe", "électrocardiographe", "machine ecg", "moniteur ecg"]) && !explicitAccessory,
      prefer: ["ecg machine", "ekg machine", "diagnostic ecg", "resting ecg", "resting ekg", "electrocardiograph", "edan se", "se-1200", "se1200", "se-1201", "se1201", "se-1202", "se1202", "se-301", "se301", "se-601", "se601", "se-1515", "se1515"],
      demote: ["accessory", "accessories", "recording paper", "thermal paper", "electrode", "lead", "leadwire", "cable", "bag", "pouch", "case", "software", "viewer", "usb", "sentinel", "mount", "mounting", "stand", "holder", "bracket"],
      force: 1400,
    },
    {
      active: includesAny(normalized, ["bag valve mask", "bag valve masks", "bvm", "ambu bag", "sac ambu", "ballon masque", "ballon autoremplisseur"]),
      prefer: ["bag-valve-mask", "bag valve mask", "bvm", "manual resuscitator", "resuscitator", "ambu bag"],
      demote: ["n95", "kn95", "procedure mask", "surgical mask", "face mask", "paper face mask", "respirator", "earloop"],
      force: 1200,
    },
    {
      active: includesAny(normalized, ["blood pressure cuff", "bp cuff", "brassard", "brassard de tension"]),
      prefer: ["blood pressure cuff", "bp cuff", "sphygmomanometer", "one piece cuffs", "flexiport blood pressure cuff"],
      demote: ["replacement", "training", "trainer", "manikin", "simulator", "assembly"],
      force: 800,
    },
    {
      active: includesAny(normalized, ["blue phantom"]),
      prefer: ["blue phantom"],
      demote: ["refill", "refill fluid", "fluid", "gel"],
      force: 900,
    },
    {
      active: includesAny(normalized, ["oximeter", "oximeters", "oxymeter", "oxymeters", "pulse oximeter", "pulse ox", "spo2 monitor", "oximetre", "oximètre"]),
      prefer: ["pulse oximeter", "finger pulse oximeter", "fingertip pulse oximeter", "spo2 deluxe pulse oximeter", "co-oximeter", "oximeter"],
      demote: ["accessory", "accessories", "sensor", "probe", "cable"],
      force: 700,
    },
    {
      active: includesAny(normalized, ["nasal cannula", "nasal canula", "oxygen cannula", "canule nasale", "line onner cannula", "liner cannula"]),
      prefer: ["nasal cannula", "oxygen nasal cannula", "oxygen cannula", "cannula"],
      demote: ["catheter", "dressing", "wipe", "prep", "sodium chloride"],
      force: 650,
    },
  ].filter((family) => family.active);
  if (!families.length) return hits;

  const score = (hit: any) => {
    const doc = hit.document || {};
    const name = normalizeSearchText([doc.name, doc.parent_name, doc.variant_label, doc.option_text].filter(Boolean).join(" "));
    const looseName = name.replace(/[./-]/g, " ");
    let value = 0;
    for (const family of families) {
      const prefer = family.prefer.some((term) => name.includes(normalizeSearchText(term)) || looseName.includes(normalizeSearchText(term).replace(/[./-]/g, " ")));
      const demote = family.demote.some((term) => name.includes(normalizeSearchText(term)) || looseName.includes(normalizeSearchText(term).replace(/[./-]/g, " ")));
      if (prefer && !demote) value += family.force;
      if (demote) value -= family.force;
    }
    return value;
  };

  return [...hits].sort((a, b) => score(b) - score(a));
}

async function ensureSearchAnalyticsCollection() {
  try {
    await typesenseAdmin.collections(ANALYTICS_COLLECTION_NAME).retrieve();
  } catch {
    await typesenseAdmin.collections().create({
      name: ANALYTICS_COLLECTION_NAME,
      fields: [
        { name: "id", type: "string" },
        { name: "event", type: "string", facet: true },
        { name: "query", type: "string", facet: true, optional: true },
        { name: "sku", type: "string", facet: true, optional: true },
        { name: "product_name", type: "string", optional: true },
        { name: "product_id", type: "int64", optional: true },
        { name: "customer_id", type: "string", facet: true, optional: true },
        { name: "page_type", type: "string", facet: true, optional: true },
        { name: "url", type: "string", optional: true },
        { name: "created_at", type: "int64", facet: true },
      ],
      default_sorting_field: "created_at",
    });
  }
}

function scheduleAutocompleteAnalytics({
  query,
  customerId,
  durationMs,
  mappedQuery,
}: {
  query: string;
  customerId: string;
  durationMs: number;
  mappedQuery?: string;
}) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery || cleanQuery === "*") return;
  const cleanMappedQuery = String(mappedQuery || "").trim();
  const speedBucket =
    durationMs < 250 ? "autocomplete <250ms" :
    durationMs < 500 ? "autocomplete 250-500ms" :
    durationMs < 1000 ? "autocomplete 500-1000ms" :
    durationMs < 2000 ? "autocomplete 1-2s" :
    "autocomplete >2s";

  after(async () => {
    try {
      const now = Date.now();
      await ensureSearchAnalyticsCollection();
      await typesenseAdmin.collections(ANALYTICS_COLLECTION_NAME).documents().create({
        id: `${now}-${Math.random().toString(36).slice(2)}-autocomplete-speed`,
        event: "server_autocomplete_speed",
        query: cleanQuery.slice(0, 180),
        product_name: speedBucket,
        product_id: Math.max(1, Math.round(durationMs)),
        customer_id: String(customerId || "").trim().slice(0, 80),
        page_type: "autocomplete_api",
        created_at: now,
      });
      if (cleanMappedQuery && normalizeSearchText(cleanMappedQuery) !== normalizeSearchText(cleanQuery)) {
        await typesenseAdmin.collections(ANALYTICS_COLLECTION_NAME).documents().create({
          id: `${now}-${Math.random().toString(36).slice(2)}-autocomplete-mapping`,
          event: "server_query_mapping",
          query: cleanQuery.slice(0, 180),
          product_name: cleanMappedQuery.slice(0, 240),
          customer_id: String(customerId || "").trim().slice(0, 80),
          page_type: "autocomplete_api",
          created_at: now,
        });
      }
    } catch (error) {
      console.warn("[SmartSearch analytics] could not record autocomplete timing", error);
    }
  });
}

function isAedUnitQuery(query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized || normalized === "*") return false;
  const accessoryWords = ["pad", "pads", "electrode", "electrodes", "battery", "batteries", "cabinet", "case", "sign", "trainer", "training", "accessory", "accessories", "bracket", "mount"];
  if (accessoryWords.some((word) => normalized.includes(word))) return false;
  return [
    "aed",
    "defib",
    "defibrillator",
    "defibrillators",
    "defibrillation",
    "dea",
    "defibrillateur",
    "défibrillateur",
  ].some((term) => normalized === normalizeSearchText(term) || normalized.includes(normalizeSearchText(term)));
}

function singularCategoryPhrase(value: string) {
  return value.endsWith("s") && value.length > 3 ? value.slice(0, -1) : value;
}

function categoryFacetNamesForQuery(result: any, originalQuery: string, searchQuery: string) {
  const queries = Array.from(
    new Set(
      [originalQuery, searchQuery]
        .map((value) => normalizeSearchText(value))
        .filter((value) => value && value !== "*" && value.length >= 3)
    )
  );
  if (!queries.length) return [];

  const categories = (result?.facet_counts || [])
    .find((facet: any) => facet.field_name === "categories")
    ?.counts || [];

  return categories
    .map((item: any) => String(item.value || "").trim())
    .filter(Boolean)
    .filter((category: string) => {
      const normalizedCategory = normalizeSearchText(category);
      const categorySingular = singularCategoryPhrase(normalizedCategory);
      return queries.some((query) => {
        const querySingular = singularCategoryPhrase(query);
        return normalizedCategory === query || categorySingular === querySingular ||
          (query.length >= 5 && (normalizedCategory.includes(query) || query.includes(normalizedCategory) || categorySingular.includes(querySingular) || querySingular.includes(categorySingular)));
      });
    })
    .slice(0, 3);
}

function isLikelyBrandQuery(query: string) {
  const normalized = normalizeSearchText(query);
  if (!normalized || normalized === "*") return false;
  if (isAedUnitQuery(query)) return false;
  const words = normalized.split(" ").filter(Boolean);
  return words.length <= 3 && normalized.length <= 40 && /^[a-z0-9 &.'+-]+$/.test(normalized);
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(normalizeSearchText(term)));
}

function hitText(hit: any) {
  const doc = hit.document || {};
  return normalizeSearchText(
    [
      doc.name,
      doc.parent_name,
      doc.brand,
      doc.sold_by,
      Array.isArray(doc.categories) ? doc.categories.join(" ") : doc.categories,
      doc.variant_label,
      doc.option_text,
      doc.search_text,
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function applyAutocompleteIvGuard(hits: any[] = [], originalQuery: string, translatedQuery: string) {
  const query = normalizeSearchText(`${originalQuery} ${translatedQuery}`);
  const isIvQuery = includesAny(query, [
    "fournitures pour perfusion intraveineuse",
    "fourniture pour perfusion intraveineuse",
    "fournitures intraveineuses",
    "intraveineuse",
    "intraveineux",
    "perfusion",
    "iv supplies",
    "iv administration",
    "iv catheter",
    "iv solution",
    "intravenous",
  ]);

  if (!isIvQuery) return hits;

  const score = (hit: any) => {
    const text = hitText(hit);
    let value = 0;
    if (includesAny(text, ["iv administration", "iv catheter", "iv catheters", "iv solution", "intravenous", "nexiva", "vacutainer", "saline", "sodium chloride"])) value += 700;
    if (includesAny(text, ["catheter", "catheters", "needle-free", "needle free", "injection", "connector", "extension set", "infusion"])) value += 240;
    if (includesAny(text, ["furniture", "furnishings", "dresser", "drawer", "chest", "bookcase", "wardrobe", "bedside", "cabinet"])) value -= 900;
    return value;
  };

  return [...hits].sort((a, b) => score(b) - score(a));
}

function autocompleteRecallQueries(originalQuery: string, translatedQuery: string) {
  const original = normalizeSearchText(originalQuery);
  const query = normalizeSearchText(`${originalQuery} ${translatedQuery}`);
  const isScissorsQuery = includesAny(original, ["scissors", "scissor", "ciseaux", "ciseau", "ciseaux a pansements", "ciseaux à pansements"]);
  const recalls: string[] = [];
  const add = (...terms: string[]) => {
    for (const term of terms) {
      const clean = term.trim();
      if (clean && !recalls.includes(clean)) recalls.push(clean);
    }
  };

  if (includesAny(query, ["glove", "gloves", "gant", "gants"])) {
    add("nitrile gloves", "exam gloves", "surgical gloves", "medical gloves", "glove");
  }
  if (isScissorsQuery) {
    add("scissor", "medical scissors", "bandage scissor", "bandage shears");
  }
  if (!isScissorsQuery && includesAny(query, ["bandaid", "bandaids", "band aid", "band aids", "band-aid", "band-aids", "bandage", "bandages", "pansement", "pansements", "wound dressing", "wound dressings", "dressing", "dressings"])) {
    add("adhesive bandage", "bandage", "wound dressing", "gauze", "dressings");
  }
  if (includesAny(query, ["scalpel", "scalpels", "knife", "knives"])) {
    add("scalpel", "scalpel blade", "surgical blade");
  }
  if (includesAny(query, ["ceinture", "ceintures", "belt", "belts"])) {
    add("gait belt", "transfer belt", "safety belt", "stretcher belt", "belt");
  }
  if (includesAny(query, ["oxygen mask", "oxygen masks", "masque oxygene", "masque oxygène", "masque d oxygene", "masque d’oxygène", "masques oxygene", "masques oxygène"])) {
    add("oxygen mask", "oxygen masks", "non-rebreather mask", "high concentration oxygen mask");
  }
  if (includesAny(query, ["bag valve mask", "bag valve masks", "bvm", "ambu bag", "sac ambu", "ballon masque", "ballon autoremplisseur"])) {
    add("bag valve mask", "manual resuscitator", "resuscitator", "BVM", "ambu bag");
  }
  if (includesAny(query, ["nasal cannula", "nasal canula", "oxygen cannula", "canule nasale", "line onner cannula", "liner cannula"])) {
    add("nasal cannula", "oxygen nasal cannula", "oxygen cannula");
  }
  if (includesAny(query, ["patient monitor", "patient monitors", "patient monitoring", "vital signs monitor", "vital sign monitor", "vitals monitor", "heart rate", "heart reate", "heart monitor", "cardiac monitor", "heart rate machine", "moniteur cardiaque", "moniteur patient", "moniteur de patient", "moniteur de signes vitaux"])) {
    add("patient monitor", "vital signs monitor", "bedside monitor", "multiparameter monitor", "heart rate monitor", "ECG monitor");
  }
  if (includesAny(query, ["ecg", "ekg", "ecg machine", "ekg machine", "ecg monitor", "ekg monitor", "electrocardiograph", "electrocardiographe", "électrocardiographe", "machine ecg", "moniteur ecg"])) {
    const accessoryQuery = includesAny(original, ["accessory", "accessories", "paper", "recording paper", "electrode", "electrodes", "lead", "leads", "leadwire", "lead wire", "cable", "bag", "software", "viewer"]);
    if (!accessoryQuery) add("ECG machine", "EKG machine", "electrocardiograph", "resting ECG", "EDAN SE", "SE-1200", "SE-1202", "SE-301", "SE-601", "patient monitor", "vital signs monitor", "ECG monitor");
  }
  if (includesAny(query, ["medical bag", "medical bags", "medic bag", "medic bags", "trauma bag", "trauma bags", "ems bag", "emt bag", "jump bag", "jump bags", "sac medical", "sac médical", "sacs medicaux", "sacs médicaux"])) {
    add("medical bag", "trauma bag", "ems bag", "medical backpack");
  }
  if (includesAny(query, ["stretcher", "stretchers", "brancard", "brancards", "civiere", "civière"])) {
    add("stretcher", "ambulance cot", "transport stretcher", "scoop stretcher", "basket stretcher", "rescue stretcher");
  }
  if (includesAny(query, ["fournitures pour perfusion intraveineuse", "fourniture pour perfusion intraveineuse", "fournitures intraveineuses", "intraveineuse", "intraveineux", "perfusion", "iv supplies", "iv administration", "iv catheter", "iv solution", "intravenous"])) {
    add("IV catheter", "IV administration", "IV solution", "intravenous");
  }
  if (includesAny(query, ["qcpr", "q cpr", "little baby", "little family", "little junior", "little anne", "baby qcpr", "family qcpr", "junior qcpr"])) {
    add(originalQuery, "little baby qcpr", "little family qcpr", "little junior qcpr", "little anne qcpr", "qcpr manikin");
  }
  if (includesAny(original, ["cpr mask", "cpr masks", "masque rcr", "masques rcr", "rcr mask", "rcr masks"])) {
    add("cpr pocket mask", "pocket mask", "cpr mask", "cpr pocket ventilator", "face shield");
  }

  return recalls.slice(0, original.split(" ").length > 2 ? 4 : 5);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const customerId = searchParams.get("customer_id") || "";

  if (q.trim().length < 2) {
    return NextResponse.json({ products: [], facets: [] }, { headers: corsHeaders });
  }

  const controls = await getEffectiveSearchOverrides();
  const naturalLanguagePlan = isFocusedAutocompleteQuery(q)
    ? emptyAutocompleteNaturalLanguagePlan(q)
    : await buildNaturalLanguageSearchPlan(q, controls);
  const smartQuery = await buildSmartSearchQuery(q, { skipOpenAI: naturalLanguagePlan.active && naturalLanguagePlan.source === "manual" });
  const primaryQuery = compactAutocompleteQuery(q, naturalLanguagePlan, smartQuery.search_query);

  const results: any = await typesenseSearch
    .collections(COLLECTION_NAME)
    .documents()
    .search({
      q: primaryQuery,
      query_by: "sku,all_skus,name,parent_name,brand,sold_by,categories,variant_label,option_text,search_text",
      query_by_weights: "30,24,16,12,8,7,6,5,5,3",
      filter_by: "is_visible:=true",
      facet_by: "brand,categories",
      max_facet_values: 16,
      per_page: 32,
      num_typos: 2,
      typo_tokens_threshold: 1,
      prefix: true,
      highlight_full_fields: "name,sku,brand,sold_by,categories,variant_label,option_text",
    });

  const supplementalSearches: Promise<any>[] = [];
  const pinnedSkus = getPinnedSkusForQuery(q, controls);

  if (isOxygenMaskAutocompleteQuery(q)) {
    supplementalSearches.push(
      withAutocompleteTimeout(typesenseSearch
        .collections(COLLECTION_NAME)
        .documents()
        .search({
          q: "oxygen masks",
          query_by: "sku,all_skus,name,parent_name,brand,sold_by,categories,variant_label,option_text,search_text",
          query_by_weights: "30,24,16,12,8,7,6,5,5,3",
          filter_by: "is_visible:=true",
          facet_by: "brand,categories",
          max_facet_values: 16,
          per_page: 16,
          num_typos: 1,
          typo_tokens_threshold: 1,
          prefix: true,
          highlight_full_fields: "name,parent_name,categories,variant_label,option_text",
        }))
    );
  }

  for (const sku of pinnedSkus.slice(0, 12)) {
    supplementalSearches.push(
      withAutocompleteTimeout(typesenseSearch
        .collections(COLLECTION_NAME)
        .documents()
        .search({
          q: sku,
          query_by: "sku,all_skus",
          query_by_weights: "30,24",
          filter_by: "is_visible:=true",
          facet_by: "brand,categories",
          max_facet_values: 16,
          per_page: 4,
          num_typos: 0,
          prefix: false,
        }))
    );
  }

  if (isAedUnitQuery(q)) {
    supplementalSearches.push(
      withAutocompleteTimeout(typesenseSearch
        .collections(COLLECTION_NAME)
        .documents()
        .search({
          q: "*",
          query_by: "sku,all_skus,name,parent_name,brand,categories,search_text",
          filter_by: `is_visible:=true && category_ids:=[${AED_CATEGORY_ID}]`,
          facet_by: "brand,categories",
          max_facet_values: 16,
          per_page: 28,
        }))
    );
  }

  const categoryNames = Array.from(
    new Set([
      ...(naturalLanguagePlan.category_queries || []),
      ...categoryFacetNamesForQuery(results, q, smartQuery.search_query),
    ])
  ).slice(0, naturalLanguagePlan.active ? 3 : 6);

  for (const categoryName of categoryNames) {
    supplementalSearches.push(
      withAutocompleteTimeout(typesenseSearch
        .collections(COLLECTION_NAME)
        .documents()
        .search({
          q: "*",
          query_by: "sku,all_skus,name,parent_name,brand,categories,search_text",
          filter_by: `is_visible:=true && categories:=${JSON.stringify(categoryName)}`,
          facet_by: "brand,categories",
          max_facet_values: 16,
          per_page: 28,
        }))
    );
  }

  const normalizedAutocompleteQuery = normalizeSearchText(q);
  const exactSyringeRecall = /\b(?:syringes?)\b/.test(normalizedAutocompleteQuery) &&
    /\b\d+(?:\.\d+)?\s*(?:ml|cc)\b/.test(normalizedAutocompleteQuery)
    ? [`${normalizedAutocompleteQuery.match(/\b\d+(?:\.\d+)?\s*(?:ml|cc)\b/)?.[0] || ""} syringe`, "luer lock syringe"]
    : [];
  const frenchAttributeRecall = /\b(?:gants?|grand|grands|grande|grandes|petit|petite|petits|petites|moyen|moyenne|moyens|moyennes)\b/.test(normalizedAutocompleteQuery)
    ? [normalizedAutocompleteQuery
        .replace(/\bgants?\b/g, "gloves")
        .replace(/\bgrand(?:s|e|es)?\b/g, "large")
        .replace(/\bpetit(?:s|e|es)?\b/g, "small")
        .replace(/\bmoyen(?:s|ne|nes)?\b/g, "medium")]
    : [];
  const recallQueries = Array.from(
    new Set([
      ...(naturalLanguagePlan.recall_queries || []),
      ...exactSyringeRecall,
      ...frenchAttributeRecall,
      ...autocompleteRecallQueries(q, smartQuery.search_query),
    ])
  ).slice(0, naturalLanguagePlan.active ? 3 : 6);

  for (const recallQuery of recallQueries) {
    supplementalSearches.push(
      withAutocompleteTimeout(typesenseSearch
        .collections(COLLECTION_NAME)
        .documents()
        .search({
          q: recallQuery,
          query_by: "name,parent_name,categories,variant_label,option_text,search_text,sku,all_skus,brand",
          query_by_weights: "26,22,14,8,8,6,4,3,2",
          filter_by: "is_visible:=true",
          facet_by: "brand,categories",
          max_facet_values: 16,
          per_page: 24,
          num_typos: 1,
          typo_tokens_threshold: 1,
          prefix: true,
          highlight_full_fields: "name,parent_name,categories,variant_label,option_text",
        }))
    );
  }

  if (isLikelyBrandQuery(q)) {
    supplementalSearches.push(
      withAutocompleteTimeout(typesenseSearch
        .collections(COLLECTION_NAME)
        .documents()
        .search({
          q,
          query_by: "brand",
          query_by_weights: "10",
          filter_by: "is_visible:=true",
          facet_by: "brand,categories",
          max_facet_values: 16,
          per_page: 28,
          num_typos: 1,
          typo_tokens_threshold: 1,
          prefix: true,
          highlight_full_fields: "brand",
        }))
    );
  }

  const supplementalResults = supplementalSearches.length
    ? await Promise.allSettled(supplementalSearches)
    : [];
  const supplementalHits = supplementalResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value?.hits || [] : []
  );

  const rankedHits = applyBrandQueryRanking(
    applyAutocompleteIvGuard(
      applyFastAttributeRanking(applyIntentRanking(
        applyPrivateCategoryFilter(applyHiddenSkuFilter(mergeHits(supplementalHits, results.hits || []), controls), customerId, controls),
        q,
        smartQuery.search_query
      ), q),
      q,
      smartQuery.search_query
    ),
    q
  );
  const hits = applyPinnedAwareFastAttributeRanking(
    applyPinnedSkuRanking(
      applyAutocompleteFocusedFamilyRanking(
        applyAutocompleteOxygenMaskRanking(diversifyAutocompleteHits(rankedHits, naturalLanguagePlan), q),
        q
      ),
      q,
      controls
    ),
    q,
    pinnedSkus
  );
  const products = hits.slice(0, 12).map((hit: any) => normalizeHit(hit.document));
  const categoryUrls = categoryUrlMapFromHits(hits);

  const facets = [
    {
      field: "brand",
      values: facetCountsFromHits(hits, "brand"),
    },
    {
      field: "categories",
      values: reorderFacetValues(facetCountsFromHits(hits, "categories"), naturalLanguagePlan.category_queries).map((item) => ({
        ...item,
        url: categoryUrls.get(item.value) || "",
      })),
    },
  ];

  const suggestedQuery = normalizeSuggestedQuery(naturalLanguagePlan.suggested_query) || normalizeSuggestedQuery(smartQuery.suggested_query);
  const responseBody = {
      products,
      facets,
      ...smartQuery,
      natural_language_plan: { ...naturalLanguagePlan, suggested_query: normalizeSuggestedQuery(naturalLanguagePlan.suggested_query) },
      suggested_query: suggestedQuery,
      fallback_terms: products.length ? [] : smartQuery.fallback_terms,
    };

  scheduleAutocompleteAnalytics({
    query: q,
    customerId,
    durationMs: Date.now() - startedAt,
    mappedQuery: suggestedQuery,
  });

  return NextResponse.json(responseBody, { headers: corsHeaders });
}

function normalizeSuggestedQuery(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.replace(/\s+/g, " ").trim();
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    return normalizeSuggestedQuery(
      item.suggested_query ||
        item.corrected_query ||
        item.correctedQuery ||
        item.normalized_query ||
        item.normalizedQuery ||
        item.query ||
        item.value ||
        item.label ||
        item.text ||
        item.corrected ||
        item.en ||
        item.fr
    );
  }
  return "";
}
