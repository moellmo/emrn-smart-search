import { after, NextRequest, NextResponse } from "next/server";
import { typesenseAdmin, typesenseSearch } from "../../../lib/typesense";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";
import { buildNaturalLanguageSearchPlan } from "../../../lib/natural-language-search";
import { normalizeSearchText } from "../../../lib/search-language";
import { applyBrandQueryRanking, applyFastAttributeRanking, applyHiddenSkuFilter, applyIntentRanking, applyPinnedSkuListRanking, applyPrivateCategoryFilter, explainResult } from "../../../lib/search-ranking";
import { balanceHitsByProductFamily } from "../../../lib/search-result-balancing";
import { getEffectiveSearchOverrides, getPinnedSkusForContext } from "../../../lib/search-overrides";
import { PRODUCT_COLLECTION_ALIAS } from "../../../lib/search-index";
import { STORE_URL, absoluteStoreUrl } from "../../../lib/store-url";

const COLLECTION_NAME = PRODUCT_COLLECTION_ALIAS;
const ANALYTICS_COLLECTION_NAME = "emrn_search_analytics";
const STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH!;
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN!;
const BIGCOMMERCE_API_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3`;
const AED_CATEGORY_ID = 160;
const SEARCH_HIT_LIMIT = 10000;
const MISSING_BRAND_LABEL = "No brand";
const MISSING_SOLD_BY_LABEL = "No Sold By";
const CATEGORY_CACHE_MS = 1000 * 60 * 10;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type BCCategory = {
  id: number;
  parent_id?: number;
  name: string;
  is_visible?: boolean;
};

let categoryCache: { expiresAt: number; categories: BCCategory[] } | null = null;

function normalizeSort(sort: string | null) {
  switch (sort) {
    case "price_asc":
      return "price:asc";
    case "price_desc":
      return "price:desc";
    case "name_asc":
    case "name_desc":
      return "_text_match:desc,popularity_score:desc,product_id:desc";
    case "newest":
      return "product_id:desc";
    case "popularity":
    default:
      return "_text_match:desc,popularity_score:desc,product_id:desc";
  }
}

async function fetchSearchCategories() {
  if (categoryCache && categoryCache.expiresAt > Date.now()) return categoryCache.categories;

  const all: BCCategory[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetch(`${BIGCOMMERCE_API_BASE}/catalog/categories?limit=250&page=${page}`, {
      headers: {
        "X-Auth-Token": ACCESS_TOKEN,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      cache: "no-store",
    });

    if (!res.ok) throw new Error(`BigCommerce category API error ${res.status}: ${await res.text()}`);
    const data = await res.json();
    all.push(...(data.data || []));
    totalPages = data.meta?.pagination?.total_pages || 1;
    page++;
  } while (page <= totalPages);

  categoryCache = {
    categories: all.filter((cat) => cat.is_visible !== false),
    expiresAt: Date.now() + CATEGORY_CACHE_MS,
  };

  return categoryCache.categories;
}

function singularize(value: string) {
  return value.endsWith("s") && value.length > 3 ? value.slice(0, -1) : value;
}

function categoryFamilyIdsForQuery(query: string, categories: BCCategory[]) {
  const normalized = normalizeSearchText(query);
  if (!normalized || normalized === "*" || normalized.length < 3 || /\d/.test(normalized)) return [];

  const genericWords = new Set(["and", "for", "the", "with", "medical", "supply", "supplies", "product", "products"]);
  const words = normalized.split(/\s+/).filter((word) => word.length >= 3 && !genericWords.has(word));
  const phraseTerms = new Set<string>([normalized, singularize(normalized)]);
  const wordTerms = new Set<string>();
  const wordsForWordMatch = words.length > 1 ? [] : words;

  for (let index = 0; index < words.length; index++) {
    for (const size of [2, 3]) {
      const phrase = words.slice(index, index + size).join(" ");
      if (phrase.split(" ").length === size) {
        phraseTerms.add(phrase);
        phraseTerms.add(singularize(phrase));
      }
    }
  }
  wordsForWordMatch.forEach((word) => {
    wordTerms.add(word);
    wordTerms.add(singularize(word));
  });

  const byParent = new Map<number, BCCategory[]>();
  const matched = new Set<number>();
  const ids = new Set<number>();

  for (const category of categories) {
    const parent = Number(category.parent_id || 0);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(category);

    const categoryName = normalizeSearchText(category.name);
    const categorySingular = singularize(categoryName);
    const phraseMatches = Array.from(phraseTerms).some(
      (term) => categoryName === term || categorySingular === term || categoryName.includes(term) || term.includes(categoryName)
    );
    const wordMatches = Array.from(wordTerms).some((term) => {
      const root = singularize(term);
      const categoryWords = categoryName.split(/\s+/).filter(Boolean);
      const categoryRoots = categoryWords.map(singularize);
      return categoryName === term || categorySingular === term || categorySingular === root || categoryWords.includes(term) || categoryRoots.includes(root);
    });
    if (phraseMatches || wordMatches) {
      matched.add(Number(category.id));
    }
  }

  function addBranch(id: number) {
    if (!id || ids.has(id)) return;
    ids.add(id);
    for (const child of byParent.get(id) || []) addBranch(Number(child.id));
  }

  matched.forEach(addBranch);
  return Array.from(ids).slice(0, 120);
}

function isShortCategoryStyleQuery(query: string) {
  const normalized = normalizeSearchText(query);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 2) return false;
  const productWords = new Set(["test", "strip", "strips", "bandelette", "bandelettes", "contour", "accu", "chek", "model", "battery", "batteries"]);
  return !words.some((word) => productWords.has(word));
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

function isPatientMonitorFamilyQuery(originalQuery: string, searchQuery: string) {
  const query = normalizeSearchText(String(originalQuery || "") + " " + String(searchQuery || ""));
  return ["patient monitor", "patient monitors", "vital signs monitor", "vital sign monitor", "bedside monitor", "multi parameter monitor", "multi-parameter monitor", "heart rate", "heart reate", "heart monitor", "cardiac monitor", "heart rate machine", "moniteur cardiaque", "ecg", "ekg", "ecg machine", "ekg machine", "ecg monitor", "ekg monitor", "electrocardiograph", "electrocardiographe", "électrocardiographe", "machine ecg", "moniteur ecg", "moniteur patient", "moniteur de signes vitaux"].some((term) => query.includes(normalizeSearchText(term)));
}

function prioritizePatientMonitorUnits(hits: any[] = [], originalQuery: string, searchQuery: string) {
  if (!isPatientMonitorFamilyQuery(originalQuery, searchQuery)) return hits;
  const query = normalizeSearchText(String(originalQuery || "") + " " + String(searchQuery || ""));
  const explicitAccessoryQuery = ["accessory", "accessories", "electrode", "electrodes", "lead", "leads", "leadwire", "lead wire", "paper", "recording paper", "thermal paper", "cable", "cables", "bag", "software", "viewer", "usb", "sentinel", "cuff", "cuffs", "sensor", "probe", "mount", "stand"].some((term) => query.includes(normalizeSearchText(term)));
  if (explicitAccessoryQuery) return hits;
  const isEcgQuery = ["ecg", "ekg", "ecg machine", "ekg machine", "ecg monitor", "ekg monitor", "electrocardiograph", "electrocardiographe", "électrocardiographe", "machine ecg", "moniteur ecg"].some((term) => query.includes(normalizeSearchText(term)));
  const accessoryTerms = ["accessory", "accessories", "cuff", "cuffs", "electrode", "electrodes", "leadwire", "lead wire", "lead wires", "lead", "leads", "cable", "cables", "paper", "recording paper", "thermal paper", "software", "viewer", "usb", "sentinel", "carrying bag", "bag", "pouch", "case", "alarm", "mount", "mounting", "bracket", "stand", "station", "stations", "holder", "tube", "tubing", "hose", "sensor", "probe"];
  const unitTerms = ["patient monitor", "vital signs monitor", "vital sign monitor", "bedside monitor", "spot monitor", "multiparameter monitor", "multi-parameter monitor", "heart rate monitor", "heart monitor", "cardiac monitor", "moniteur cardiaque", "ecg machine", "ekg machine", "ecg monitor", "ekg monitor", "electrocardiograph", "electrocardiographe", "électrocardiographe", "machine ecg", "moniteur ecg", "diagnostic ecg", "resting ecg", "resting ekg", "edan ecg", "edan se", "se-1200", "se1200", "se-1201", "se1201", "se-1202", "se1202", "se-301", "se301", "edan x10", "edan x12", "edan im3", "im50 patient monitor", "im60 patient monitor", "m3 vital signs", "m3a vital signs", "connex spot", "spot vital sign", "fetal monitor", "pulse oximeter", "co-oximeter", "holter"];
  const ecgUnitTerms = ["ecg machine", "ekg machine", "diagnostic ecg", "resting ecg", "resting ekg", "electrocardiograph", "electrocardiographe", "électrocardiographe", "machine ecg", "moniteur ecg", "edan se", "se-1200", "se1200", "se-1201", "se1201", "se-1202", "se1202", "se-301", "se301", "se-601", "se601", "se-1515", "se1515"];
  const score = (hit: any) => {
    const doc = hit.document || {};
    const name = normalizeSearchText([doc.name, doc.parent_name, doc.variant_label, doc.option_text].filter(Boolean).join(" "));
    const text = normalizeSearchText([doc.name, doc.parent_name, doc.variant_label, doc.option_text, doc.search_text, doc.description, doc.custom_fields_text].filter(Boolean).join(" "));
    const categories = normalizeSearchText(Array.isArray(doc.categories) ? doc.categories.join(" ") : String(doc.categories || ""));
    const hasAccessory = accessoryTerms.some((term) => name.includes(normalizeSearchText(term)));
    const hasUnit = unitTerms.some((term) => name.includes(normalizeSearchText(term)));
    const hasUnitInText = unitTerms.some((term) => text.includes(normalizeSearchText(term)));
    const hasEcgUnit = ecgUnitTerms.some((term) => name.includes(normalizeSearchText(term)) || text.includes(normalizeSearchText(term)));
    let value = 0;
    if (isEcgQuery && !hasAccessory) {
      if (["se-1200", "se1200", "se-1201", "se1201", "se-1202", "se1202"].some((term) => name.includes(term) || text.includes(term))) value += 1800;
      else if (["se-301", "se301"].some((term) => name.includes(term) || text.includes(term))) value += 1400;
      else if (["se-1515", "se1515", "se-601", "se601"].some((term) => name.includes(term) || text.includes(term))) value += 1200;
    }
    if (isEcgQuery && hasEcgUnit && !hasAccessory) value += 1200;
    if (hasUnit && !hasAccessory) value += 1000;
    else if (hasUnitInText && !hasAccessory) value += 400;
    if (categories.includes("vital sign monitors") || categories.includes("patient monitors")) value += 100;
    if (hasAccessory) value -= 600;
    if (categories.includes("veterinary")) value -= 300;
    return value;
  };
  return [...hits].sort((a, b) => score(b) - score(a));
}

function prioritizeFocusedProductFamilies(hits: any[] = [], originalQuery: string, searchQuery: string) {
  const original = normalizeSearchText(String(originalQuery || ""));
  if (!original || original === "*") return hits;
  if (/\b(supplies|supply|stuff|things|equipment|products|items|fournitures|materiel|matériel)\b/.test(original)) return hits;
  const query = normalizeSearchText(`${originalQuery} ${searchQuery}`);
  const includes = (terms: string[]) => terms.some((term) => query.includes(normalizeSearchText(term)));
  const originalIncludes = (terms: string[]) => terms.some((term) => original.includes(normalizeSearchText(term)));
  const explicitAccessory = originalIncludes(["accessory", "accessories", "replacement", "part", "parts", "paper", "electrode", "lead", "cable", "bag", "software", "viewer", "sensor", "probe", "strap", "straps"]);

  const families: Array<{ active: boolean; prefer: string[]; demote: string[]; textPrefer?: string[]; force?: number }> = [
    {
      active: originalIncludes(["patient monitor", "patient monitors", "patient monitoring", "vital signs monitor", "vital sign monitor", "vitals monitor", "heart rate", "heart reate", "heart monitor", "cardiac monitor", "heart rate machine", "moniteur cardiaque", "moniteur patient", "moniteur de patient", "moniteur de signes vitaux"]) && !explicitAccessory,
      prefer: ["patient monitor", "vital signs monitor", "vital sign monitor", "bedside monitor", "spot monitor", "multiparameter monitor", "multi-parameter monitor", "heart rate monitor", "heart monitor", "cardiac monitor", "ecg monitor", "edan x10", "edan x12", "edan im3", "im50 patient monitor", "im60 patient monitor", "m3 vital signs", "m3a vital signs", "connex spot", "spot vital sign"],
      textPrefer: ["heart rate", "heart-rate", "ecg", "ekg", "vital signs", "patient monitor", "monitoring"],
      demote: ["accessory", "accessories", "recording paper", "thermal paper", "electrode", "lead", "leadwire", "cable", "bag", "software", "viewer", "usb", "sentinel", "sensor", "probe", "cuff", "mount", "mounting", "stand", "holder", "bracket"],
      force: 1100,
    },
    {
      active: includes(["ecg", "ekg", "ecg machine", "ekg machine", "ecg monitor", "ekg monitor", "electrocardiograph", "electrocardiographe", "électrocardiographe", "machine ecg", "moniteur ecg"]) && !explicitAccessory,
      prefer: ["ecg machine", "ekg machine", "diagnostic ecg", "resting ecg", "resting ekg", "electrocardiograph", "edan se", "se-1200", "se1200", "se-1201", "se1201", "se-1202", "se1202", "se-301", "se301", "se-601", "se601", "se-1515", "se1515"],
      textPrefer: ["ecg", "ekg", "electrocardiograph", "heart rate", "heart-rate", "vital signs", "patient monitor"],
      demote: ["accessory", "accessories", "recording paper", "thermal paper", "electrode", "lead", "leadwire", "cable", "bag", "pouch", "case", "software", "viewer", "usb", "sentinel", "mount", "mounting", "stand", "holder", "bracket"],
      force: 1400,
    },
    {
      active: originalIncludes(["bag valve mask", "bag valve masks", "bvm", "ambu bag", "sac ambu", "ballon masque", "ballon autoremplisseur"]),
      prefer: ["bag-valve-mask", "bag valve mask", "bvm", "manual resuscitator", "resuscitator", "ambu bag"],
      textPrefer: ["bag-valve-mask", "bag valve mask", "manual resuscitator", "resuscitator"],
      demote: ["n95", "kn95", "procedure mask", "surgical mask", "face mask", "paper face mask", "respirator", "earloop"],
      force: 1200,
    },
    {
      active: originalIncludes(["blood pressure cuff", "bp cuff", "brassard", "brassard de tension"]) && !explicitAccessory,
      prefer: ["blood pressure cuff", "bp cuff", "sphygmomanometer", "one piece cuffs", "flexiport blood pressure cuff"],
      demote: ["replacement", "training", "trainer", "manikin", "simulator", "assembly"],
      force: 800,
    },
    {
      active: originalIncludes(["blue phantom"]) && !explicitAccessory,
      prefer: ["blue phantom"],
      demote: ["refill", "refill fluid", "fluid", "gel"],
      force: 900,
    },
    {
      active: includes(["oximeter", "oximeters", "oxymeter", "oxymeters", "pulse oximeter", "pulse ox", "spo2 monitor", "oximetre", "oximètre"]) && !explicitAccessory,
      prefer: ["pulse oximeter", "finger pulse oximeter", "fingertip pulse oximeter", "spo2 deluxe pulse oximeter", "co-oximeter", "oximeter"],
      demote: ["accessory", "accessories", "sensor", "probe", "cable"],
      force: 700,
    },
    {
      active: originalIncludes(["nasal cannula", "nasal canula", "oxygen cannula", "canule nasale", "line onner cannula", "liner cannula"]),
      prefer: ["nasal cannula", "oxygen nasal cannula", "oxygen cannula", "cannula"],
      demote: ["catheter", "dressing", "wipe", "prep", "sodium chloride"],
      force: 650,
    },
  ];
  const activeFamilies = families.filter((family) => family.active);
  if (!activeFamilies.length) return hits;

  const score = (hit: any) => {
    const doc = hit.document || {};
    const name = normalizeSearchText([doc.name, doc.parent_name, doc.variant_label, doc.option_text].filter(Boolean).join(" "));
    const looseName = name.replace(/[./-]/g, " ");
    const text = normalizeSearchText([doc.name, doc.parent_name, doc.variant_label, doc.option_text, doc.search_text].filter(Boolean).join(" "));
    const looseText = text.replace(/[./-]/g, " ");
    let value = 0;
    for (const family of activeFamilies) {
      const preferName = family.prefer.some((term) => name.includes(normalizeSearchText(term)) || looseName.includes(normalizeSearchText(term).replace(/[./-]/g, " ")));
      const preferText = (family.textPrefer || family.prefer).some((term) => text.includes(normalizeSearchText(term)) || looseText.includes(normalizeSearchText(term).replace(/[./-]/g, " ")));
      const demoteName = family.demote.some((term) => name.includes(normalizeSearchText(term)) || looseName.includes(normalizeSearchText(term).replace(/[./-]/g, " ")));
      if (preferName && !demoteName) value += family.force || 600;
      else if (preferText && !demoteName) value += Math.round((family.force || 600) * 0.45);
      if (demoteName && !explicitAccessory) value -= family.force || 600;
    }
    return value;
  };

  return [...hits].sort((a, b) => score(b) - score(a));
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

function supplementalRecallQueries(originalQuery: string, translatedQuery: string) {
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

  if (includesAny(query, ["qcpr", "q cpr", "little baby", "little family", "little junior", "little anne", "baby qcpr", "family qcpr", "junior qcpr"])) {
    add("little baby qcpr", "little family qcpr", "little junior qcpr", "little anne qcpr", "qcpr manikin");
  }
  if (includesAny(query, ["dummy", "dummies", "manikin", "manikins", "mannequin", "mannequins"])) {
    add("cpr manikin", "training manikin", "patient simulator", "rescue dummy", "manikin");
  }
  if (isScissorsQuery) {
    add("scissor", "medical scissors", "bandage scissor", "bandage shears");
  }
  if (!isScissorsQuery && includesAny(query, ["bandaid", "bandaids", "band aid", "band aids", "band-aid", "band-aids", "bandage", "bandages", "pansement", "pansements", "wound dressing", "wound dressings", "dressing", "dressings"])) {
    add("adhesive bandage", "bandage", "wound dressing", "gauze", "dressings");
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
  if (includesAny(original, ["cpr mask", "cpr masks", "masque rcr", "masques rcr", "rcr mask", "rcr masks"])) {
    add("cpr pocket mask", "pocket mask", "cpr mask", "cpr pocket ventilator", "face shield");
  }
  if (includesAny(query, ["patient monitor", "patient monitors", "patient monitoring", "vital signs monitor", "vital sign monitor", "vitals monitor", "heart rate", "heart reate", "heart monitor", "cardiac monitor", "heart rate machine", "moniteur cardiaque", "moniteur patient", "moniteur de patient", "moniteur de signes vitaux"])) {
    add("patient monitor", "vital signs monitor", "bedside monitor", "multiparameter monitor", "heart rate monitor", "ECG monitor", "edan im50", "edan im60");
  }
  if (includesAny(query, ["ecg", "ekg", "ecg machine", "ekg machine", "ecg monitor", "ekg monitor", "electrocardiograph", "electrocardiographe", "électrocardiographe", "machine ecg", "moniteur ecg"])) {
    const accessoryQuery = includesAny(original, ["accessory", "accessories", "paper", "recording paper", "electrode", "electrodes", "lead", "leads", "leadwire", "lead wire", "cable", "bag", "software", "viewer"]);
    if (!accessoryQuery) add("ECG machine", "EKG machine", "electrocardiograph", "resting ECG", "EDAN SE", "SE-1200", "SE-1202", "SE-301", "SE-601", "patient monitor", "vital signs monitor", "ECG monitor");
  }
  if (includesAny(query, ["medical bag", "medical bags", "medic bag", "medic bags", "trauma bag", "trauma bags", "ems bag", "emt bag", "jump bag", "jump bags", "sac medical", "sac médical", "sacs medicaux", "sacs médicaux"])) {
    add("medical bag", "medical bags", "trauma bag", "ems bag", "first aid bag", "rescue bag");
  }
  if (includesAny(query, ["stretcher", "stretchers", "brancard", "brancards", "civiere", "civière"])) {
    add("stretcher", "ambulance cot", "scoop stretcher", "basket stretcher", "rescue stretcher");
  }

  return recalls.slice(0, 8);
}

function applyNaturalLanguageAvoidTermRanking(hits: any[] = [], avoidTerms: string[] = []) {
  const normalizedAvoidTerms = avoidTerms.map((term) => normalizeSearchText(term)).filter(Boolean);
  if (!normalizedAvoidTerms.length) return hits;

  const score = (hit: any) => {
    const doc = hit.document || {};
    const categories = Array.isArray(doc.categories) ? doc.categories.join(" ") : String(doc.categories || "");
    const text = normalizeSearchText(
      [doc.name, doc.parent_name, categories, doc.search_text].filter(Boolean).join(" ")
    );
    return normalizedAvoidTerms.some((term) => text.includes(term)) ? -500 : 0;
  };

  return [...hits].sort((a, b) => score(b) - score(a));
}

function hitCategoryText(hit: any) {
  const doc = hit.document || {};
  return normalizeSearchText(Array.isArray(doc.categories) ? doc.categories.join(" ") : String(doc.categories || ""));
}

function naturalLanguageCategoryIndex(hit: any, categoryQueries: string[] = []) {
  const categoryText = hitCategoryText(hit);
  if (!categoryText) return -1;
  return categoryQueries
    .map((category, index) => ({ category: normalizeSearchText(category), index }))
    .find((item) => item.category && (categoryText.includes(item.category) || item.category.includes(categoryText)))?.index ?? -1;
}

function applyNaturalLanguageBalancedRanking(hits: any[] = [], categoryQueries: string[] = []) {
  const cleanCategories = categoryQueries.map((category) => normalizeSearchText(category)).filter(Boolean);
  if (!hits.length || cleanCategories.length < 2) return hits;

  const buckets = new Map<number, any[]>();
  const other: any[] = [];

  for (const hit of hits) {
    const index = naturalLanguageCategoryIndex(hit, categoryQueries);
    if (index >= 0) {
      if (!buckets.has(index)) buckets.set(index, []);
      buckets.get(index)!.push(hit);
    } else {
      other.push(hit);
    }
  }

  const score = (hit: any) => Number(hit.document?.popularity_score || 0);
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => score(b) - score(a));
    const balancedBucket = balanceHitsByProductFamily(bucket, bucket.length);
    bucket.splice(0, bucket.length, ...balancedBucket);
  }

  const balanced: any[] = [];
  const bucketIndexes = Array.from(buckets.keys()).sort((a, b) => a - b);
  let added = true;
  while (added && balanced.length < Math.min(hits.length, 48)) {
    added = false;
    for (const index of bucketIndexes) {
      const next = buckets.get(index)?.shift();
      if (next) {
        balanced.push(next);
        added = true;
      }
    }
  }

  return mergeHits(balanced, bucketIndexes.flatMap((index) => buckets.get(index) || []), other);
}

function reorderCategoryFacetCounts(result: any, categoryQueries: string[] = []) {
  const facet = facetByField(result, "categories");
  if (!facet?.counts?.length || !categoryQueries.length) return;

  const priority = new Map(categoryQueries.map((category, index) => [normalizeSearchText(category), index]));
  facet.counts = [...facet.counts].sort((a: any, b: any) => {
    const aValue = normalizeSearchText(a.value);
    const bValue = normalizeSearchText(b.value);
    const aPriority = priority.has(aValue) ? priority.get(aValue)! : 999;
    const bPriority = priority.has(bValue) ? priority.get(bValue)! : 999;
    if (aPriority !== bPriority) return aPriority - bPriority;
    return Number(b.count || 0) - Number(a.count || 0) || String(a.value || "").localeCompare(String(b.value || ""));
  });
}

function cleanCategoryIds(value: string | null) {
  return Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isInteger(id) && id > 0)
    )
  ).slice(0, 80);
}

function facetCountsFromHits(hits: any[] = [], field: string, limit = 80) {
  const counts = new Map<string, number>();
  const numericValues: number[] = [];

  for (const hit of hits) {
    const value = hit.document?.[field];
    const values = Array.isArray(value) ? value : [value];

    for (const item of values) {
      if (item === undefined || item === null || item === "") continue;
      if (field === "price") {
        const numberValue = Number(item);
        if (Number.isFinite(numberValue)) numericValues.push(numberValue);
      }
      const clean = String(item).trim();
      counts.set(clean, (counts.get(clean) || 0) + 1);
    }
  }

  const facet: any = {
    field_name: field,
    counts: Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, limit),
  };

  if (field === "price" && numericValues.length) {
    facet.stats = {
      min: Math.min(...numericValues),
      max: Math.max(...numericValues),
    };
  }

  return facet;
}

function facetByField(result: any, field: string) {
  return (result?.facet_counts || []).find((facet: any) => facet.field_name === field);
}

function mergeFacetCounts(field: string, ...groups: any[]) {
  const counts = new Map<string, number>();
  let stats: any = null;

  for (const group of groups) {
    const facet = facetByField(group, field);
    for (const item of facet?.counts || []) {
      const value = String(item.value || "").trim();
      if (!value) continue;
      counts.set(value, (counts.get(value) || 0) + Number(item.count || 0));
    }
    if (field === "price" && facet?.stats) {
      stats = stats
        ? {
            min: Math.min(Number(stats.min || 0), Number(facet.stats.min || 0)),
            max: Math.max(Number(stats.max || 0), Number(facet.stats.max || 0)),
          }
        : facet.stats;
    }
  }

  return {
    field_name: field,
    counts: Array.from(counts.entries())
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, 1000),
    ...(stats ? { stats } : {}),
  };
}

function applyClientSort(hits: any[] = [], sort: string) {
  if (sort !== "name_asc" && sort !== "name_desc") return hits;

  const direction = sort === "name_desc" ? -1 : 1;
  const displayName = (hit: any) =>
    String(hit.document?.parent_name || hit.document?.name || hit.document?.sku || "").trim();

  return [...hits].sort((a, b) => {
    const nameCompare = displayName(a).localeCompare(displayName(b), undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (nameCompare) return nameCompare * direction;
    return String(hitKey(a)).localeCompare(String(hitKey(b))) * direction;
  });
}

function addMissingFacetBucket(result: any, field: string, label: string) {
  const facet = facetByField(result, field);
  if (!facet) return;

  const found = Number(result?.found || 0);
  const counted = (facet.counts || []).reduce((sum: number, item: any) => sum + Number(item.count || 0), 0);
  const missing = found - counted;
  if (missing > 0) {
    facet.counts = [...(facet.counts || []), { value: label, count: missing }];
  }
}

function addMissingSingleValueFacetBuckets(result: any) {
  addMissingFacetBucket(result, "brand", MISSING_BRAND_LABEL);
  addMissingFacetBucket(result, "sold_by", MISSING_SOLD_BY_LABEL);
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

function scheduleSearchAnalytics({
  query,
  page,
  hitCount,
  customerId,
  referer,
  durationMs,
  mappedQuery,
}: {
  query: string;
  page: number;
  hitCount: number;
  customerId: string;
  referer: string;
  durationMs: number;
  mappedQuery?: string;
}) {
  const cleanQuery = String(query || "").trim();
  if (!cleanQuery || cleanQuery === "*" || page !== 1) return;
  const cleanMappedQuery = String(mappedQuery || "").trim();
  const speedBucket =
    durationMs < 250 ? "search <250ms" :
    durationMs < 500 ? "search 250-500ms" :
    durationMs < 1000 ? "search 500-1000ms" :
    durationMs < 2000 ? "search 1-2s" :
    "search >2s";

  after(async () => {
    try {
      const now = Date.now();
      await ensureSearchAnalyticsCollection();
      await typesenseAdmin.collections(ANALYTICS_COLLECTION_NAME).documents().create({
        id: `${now}-${Math.random().toString(36).slice(2)}`,
        event: hitCount > 0 ? "server_search" : "server_no_results",
        query: cleanQuery.slice(0, 180),
        customer_id: String(customerId || "").trim().slice(0, 80),
        page_type: "smartsearch_api",
        url: String(referer || "").trim().slice(0, 500),
        created_at: now,
      });
      if (hitCount > 0 && hitCount <= 5) {
        await typesenseAdmin.collections(ANALYTICS_COLLECTION_NAME).documents().create({
          id: `${now}-${Math.random().toString(36).slice(2)}-few`,
          event: "server_few_results",
          query: cleanQuery.slice(0, 180),
          customer_id: String(customerId || "").trim().slice(0, 80),
          page_type: "smartsearch_api",
          url: String(referer || "").trim().slice(0, 500),
          created_at: now,
        });
      }
      await typesenseAdmin.collections(ANALYTICS_COLLECTION_NAME).documents().create({
        id: `${now}-${Math.random().toString(36).slice(2)}-speed`,
        event: "server_search_speed",
        query: cleanQuery.slice(0, 180),
        product_name: speedBucket,
        product_id: Math.max(1, Math.round(durationMs)),
        customer_id: String(customerId || "").trim().slice(0, 80),
        page_type: "smartsearch_api",
        url: String(referer || "").trim().slice(0, 500),
        created_at: now,
      });
      if (cleanMappedQuery && normalizeSearchText(cleanMappedQuery) !== normalizeSearchText(cleanQuery)) {
        await typesenseAdmin.collections(ANALYTICS_COLLECTION_NAME).documents().create({
          id: `${now}-${Math.random().toString(36).slice(2)}-mapping`,
          event: "server_query_mapping",
          query: cleanQuery.slice(0, 180),
          product_name: cleanMappedQuery.slice(0, 240),
          customer_id: String(customerId || "").trim().slice(0, 80),
          page_type: "smartsearch_api",
          url: String(referer || "").trim().slice(0, 500),
          created_at: now,
        });
      }
    } catch (error) {
      console.warn("[SmartSearch analytics] could not record server search", error);
    }
  });
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("q") || "*";
  const page = Math.max(1, Math.floor(Number(searchParams.get("page") || 1)) || 1);
  const perPage = Number(searchParams.get("per_page") || 24);
  const brand = searchParams.get("brand");
  const category = searchParams.get("category");
  const categoryId = searchParams.get("category_id");
  const categoryIds = cleanCategoryIds(searchParams.get("category_ids") || categoryId);
  const availability = searchParams.get("availability");
  const soldBy = searchParams.get("sold_by");
  const color = searchParams.get("color");
  const priceMin = searchParams.get("price_min");
  const priceMax = searchParams.get("price_max");
  const sort = searchParams.get("sort") || "popularity";
  const customerId = searchParams.get("customer_id") || "";
  const requestedPerPage = Math.min(Math.max(perPage, 1), 48);
  const pageEnd = page * requestedPerPage;
  const normalizedQuery = normalizeSearchText(q);
  const primaryFetchSize = Math.min(Math.max(pageEnd * 4, requestedPerPage * 8), 250);
  const supplementalFetchSize = Math.min(Math.max(pageEnd * 2, requestedPerPage * 4), 160);
  const facetLimit = page === 1 ? 600 : 160;

  const controls = await getEffectiveSearchOverrides();
  const naturalLanguagePlan = await buildNaturalLanguageSearchPlan(q, controls);
  const smartQuery = await buildSmartSearchQuery(q, { skipOpenAI: naturalLanguagePlan.active && naturalLanguagePlan.source === "manual" });
  const categoryRecallQueries = [
    q,
    ...(naturalLanguagePlan.category_queries || []),
    ...(smartQuery.expansions || []),
    ...(smartQuery.translated_query ? [smartQuery.translated_query] : []),
    smartQuery.search_query,
  ];
  const searchCategories = !categoryIds.length && !category && q !== "*" ? await fetchSearchCategories() : [];
  const categoryFamilyIds =
    !categoryIds.length && !category && q !== "*"
      ? Array.from(
          new Set([
            ...categoryRecallQueries.flatMap((query) => categoryFamilyIdsForQuery(query, searchCategories)),
          ])
        ).filter((id) => id !== AED_CATEGORY_ID)
      : [];
  const filters: string[] = ["is_visible:=true"];

  if (brand) filters.push(brand === MISSING_BRAND_LABEL ? `brand:=""` : `brand:=${JSON.stringify(brand)}`);
  if (category && !categoryIds.length) filters.push(`categories:=${JSON.stringify(category)}`);
  if (categoryIds.length) filters.push(`category_ids:=[${categoryIds.join(",")}]`);
  if (availability) filters.push(`availability:=${JSON.stringify(availability)}`);
  if (soldBy) filters.push(soldBy === MISSING_SOLD_BY_LABEL ? `sold_by:=""` : `sold_by:=${JSON.stringify(soldBy)}`);
  if (color) filters.push(`color:=${JSON.stringify(color)}`);
  if (priceMin && !Number.isNaN(Number(priceMin))) filters.push(`price:>=${Number(priceMin)}`);
  if (priceMax && !Number.isNaN(Number(priceMax))) filters.push(`price:<=${Number(priceMax)}`);

  const selectedCategoryTranslatedQuery = categoryIds.length > 0 && smartQuery.language === "fr" && isShortCategoryStyleQuery(q);
  const filteredNaturalLanguageQuery =
    naturalLanguagePlan.active && (brand || category || categoryIds.length || availability || soldBy || color || priceMin || priceMax);
  const primarySearchQuery = selectedCategoryTranslatedQuery
    ? "*"
    : filteredNaturalLanguageQuery
      ? naturalLanguagePlan.rewritten_query || smartQuery.search_query || "*"
      : smartQuery.search_query || "*";

  const results: any = await typesenseSearch
    .collections(COLLECTION_NAME)
    .documents()
    .search({
      q: primarySearchQuery,
      query_by:
        "sku,all_skus,name,parent_name,brand,sold_by,categories,variant_label,option_text,search_text,description,custom_fields_text",
      query_by_weights: "30,24,16,12,8,7,7,6,6,4,2,2",
      filter_by: filters.join(" && "),
      facet_by: "brand,categories,category_ids,sold_by,color,price,availability",
      max_facet_values: facetLimit,
      sort_by: normalizeSort(sort),
      per_page: primaryFetchSize,
      limit_hits: SEARCH_HIT_LIMIT,
      page: 1,
      num_typos: 2,
      typo_tokens_threshold: 1,
      prefix: true,
    });

  if (results.hits) {
    const supplementalSearches: Array<{ kind: "aed" | "brand" | "category_family" | "recall" | "pinned"; search: Promise<any> }> = [];
    const supplementalBase = filters.join(" && ");
    const pinnedSkus = getPinnedSkusForContext({ query: q, brand, category, categoryId, categoryIds }, controls);

    for (const sku of pinnedSkus.slice(0, pageEnd)) {
      supplementalSearches.push({
        kind: "pinned",
        search: typesenseSearch
          .collections(COLLECTION_NAME)
          .documents()
          .search({
            q: sku,
            query_by: "sku,all_skus",
            query_by_weights: "30,24",
            filter_by: supplementalBase,
            facet_by: "brand,categories,category_ids,sold_by,color,price,availability",
            max_facet_values: facetLimit,
            sort_by: normalizeSort(sort),
            per_page: 4,
            limit_hits: SEARCH_HIT_LIMIT,
            page: 1,
            num_typos: 0,
            prefix: false,
          }),
      });
    }

    if (isAedUnitQuery(q) && !category && !categoryIds.length) {
      supplementalSearches.push(
        {
          kind: "aed",
          search: typesenseSearch
            .collections(COLLECTION_NAME)
            .documents()
            .search({
              q: "*",
              query_by: "sku,all_skus,name,parent_name,brand,categories,search_text",
              filter_by: [supplementalBase, `category_ids:=[${AED_CATEGORY_ID}]`].filter(Boolean).join(" && "),
              facet_by: "brand,categories,category_ids,sold_by,color,price,availability",
              max_facet_values: facetLimit,
              sort_by: normalizeSort(sort),
              per_page: supplementalFetchSize,
              limit_hits: SEARCH_HIT_LIMIT,
              page: 1,
            }),
        }
      );
    }

    if (categoryFamilyIds.length) {
      supplementalSearches.push(
        {
          kind: "category_family",
          search: typesenseSearch
            .collections(COLLECTION_NAME)
            .documents()
            .search({
              q: "*",
              query_by: "sku,all_skus,name,parent_name,brand,categories,search_text",
              filter_by: [supplementalBase, `category_ids:=[${categoryFamilyIds.join(",")}]`].filter(Boolean).join(" && "),
              facet_by: "brand,categories,category_ids,sold_by,color,price,availability",
              max_facet_values: facetLimit,
              sort_by: normalizeSort(sort),
              per_page: supplementalFetchSize,
              limit_hits: SEARCH_HIT_LIMIT,
              page: 1,
            }),
        }
      );
    }

    if ((!category && !categoryIds.length) || naturalLanguagePlan.active) {
      const exactSyringeRecall = /\b(?:syringes?)\b/.test(normalizedQuery) &&
        /\b\d+(?:\.\d+)?\s*(?:ml|cc)\b/.test(normalizedQuery)
        ? [`${normalizedQuery.match(/\b\d+(?:\.\d+)?\s*(?:ml|cc)\b/)?.[0] || ""} syringe`, "luer lock syringe"]
        : [];
      const recallQueries = Array.from(
        new Set([
          ...(naturalLanguagePlan.recall_queries || []),
          ...exactSyringeRecall,
          ...supplementalRecallQueries(q, smartQuery.search_query),
        ])
      ).slice(0, 12);

      for (const recallQuery of recallQueries) {
        supplementalSearches.push({
          kind: "recall",
          search: typesenseSearch
            .collections(COLLECTION_NAME)
            .documents()
            .search({
              q: recallQuery,
              query_by:
                "sku,all_skus,name,parent_name,brand,sold_by,categories,variant_label,option_text,search_text,description,custom_fields_text",
              query_by_weights: "30,24,16,12,8,7,7,6,6,4,2,2",
              filter_by: supplementalBase,
              facet_by: "brand,categories,category_ids,sold_by,color,price,availability",
              max_facet_values: Math.min(facetLimit, 300),
              sort_by: normalizeSort(sort),
              per_page: supplementalFetchSize,
              limit_hits: SEARCH_HIT_LIMIT,
              page: 1,
              num_typos: 1,
              typo_tokens_threshold: 1,
              prefix: true,
            }),
        });
      }
    }

    if (isLikelyBrandQuery(q) && !brand) {
      supplementalSearches.push(
        {
          kind: "brand",
          search: typesenseSearch
            .collections(COLLECTION_NAME)
            .documents()
            .search({
              q,
              query_by: "brand",
              query_by_weights: "10",
              filter_by: supplementalBase,
              facet_by: "brand,categories,category_ids,sold_by,color,price,availability",
              max_facet_values: facetLimit,
              sort_by: normalizeSort(sort),
              per_page: supplementalFetchSize,
              limit_hits: SEARCH_HIT_LIMIT,
              page: 1,
              num_typos: 1,
              typo_tokens_threshold: 1,
              prefix: true,
            }),
        }
      );
    }

    const supplementalResults = supplementalSearches.length
      ? await Promise.allSettled(supplementalSearches.map((item) => item.search))
      : [];
    const fulfilledSupplementalItems = supplementalResults.flatMap((result, index) =>
      result.status === "fulfilled" ? [{ kind: supplementalSearches[index].kind, result: result.value }] : []
    );
    const fulfilledSupplementalResults = fulfilledSupplementalItems.map((item) => item.result);
    const categoryFamilyResult = fulfilledSupplementalItems.find((item) => item.kind === "category_family")?.result;
    const nonCategoryFamilyResults = fulfilledSupplementalItems
      .filter((item) => item.kind !== "category_family")
      .map((item) => item.result);
    const supplementalHits = fulfilledSupplementalResults.flatMap((result) => result?.hits || []);

    const rankedHits = applyBrandQueryRanking(
      applyNaturalLanguageBalancedRanking(
        applyNaturalLanguageAvoidTermRanking(
          applyIntentRanking(
            applyPrivateCategoryFilter(applyHiddenSkuFilter(mergeHits(supplementalHits, results.hits), controls), customerId, controls),
            q,
            smartQuery.search_query
          ),
          naturalLanguagePlan.avoid_terms
        ),
        naturalLanguagePlan.active ? naturalLanguagePlan.category_queries : []
      ),
      q
    );
    const filteredHits = applyPinnedSkuListRanking(
      applyFastAttributeRanking(
        prioritizeFocusedProductFamilies(
          prioritizePatientMonitorUnits(applyClientSort(rankedHits, sort), q, smartQuery.search_query),
          q,
          smartQuery.search_query
        ),
        q
      ),
      pinnedSkus
    );

    if (fulfilledSupplementalResults.length) {
      const facetBase =
        categoryFamilyResult && Number(categoryFamilyResult.found || 0) >= Number(results.found || 0)
          ? categoryFamilyResult
          : results;
      results.facet_counts = nonCategoryFamilyResults.length
        ? ["brand", "categories", "category_ids", "sold_by", "color", "price", "availability"].map((field) =>
            mergeFacetCounts(field, facetBase, ...nonCategoryFamilyResults)
          )
        : facetBase.facet_counts;
      results.found = Math.max(
        Number(results.found || 0),
        ...fulfilledSupplementalResults.map((result) => Number(result?.found || 0))
      );
    }
    reorderCategoryFacetCounts(results, naturalLanguagePlan.active ? naturalLanguagePlan.category_queries : []);
    addMissingSingleValueFacetBuckets(results);
    const pageStart = (page - 1) * requestedPerPage;
    results.hits = filteredHits.slice(pageStart, pageStart + requestedPerPage).map((hit: any) => ({
      ...hit,
      document: {
        ...hit.document,
        url: absoluteStoreUrl(hit.document?.url),
        sold_by: hit.document?.sold_by || "",
        color: hit.document?.color || "",
        variant_id: hit.document?.variant_id || 0,
        is_variant: Boolean(hit.document?.is_variant),
        popularity_score: Number(hit.document?.popularity_score || 0),
        smart_reasons: explainResult(hit, q, controls, pinnedSkus),
      },
    }));
  }

  const responsePinnedSkus = getPinnedSkusForContext({ query: q, brand, category, categoryId, categoryIds }, controls);

  const suggestedQuery = normalizeSuggestedQuery(naturalLanguagePlan.suggested_query) || normalizeSuggestedQuery(smartQuery.suggested_query);
  const responseBody = {
    ...results,
    ...smartQuery,
    fallback_terms: results.hits?.length ? [] : smartQuery.fallback_terms,
    pinned_skus: responsePinnedSkus,
    natural_language_plan: { ...naturalLanguagePlan, suggested_query: normalizeSuggestedQuery(naturalLanguagePlan.suggested_query) },
    suggested_query: suggestedQuery,
    active_filters: {
      brand,
      category,
      category_id: categoryId,
      availability,
      sold_by: soldBy,
      color,
      price_min: priceMin,
      price_max: priceMax,
      sort,
    },
  };

  scheduleSearchAnalytics({
    query: q,
    page,
    hitCount: Array.isArray(results.hits) ? results.hits.length : Number(results.found || 0),
    customerId,
    referer: req.headers.get("referer") || "",
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
