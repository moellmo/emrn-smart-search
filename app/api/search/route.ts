import { NextRequest, NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";
import { normalizeSearchText } from "../../../lib/search-language";
import { applyBrandQueryRanking, applyHiddenSkuFilter, applyIntentRanking, applyPinnedSkuRanking, applyPrivateCategoryFilter, explainResult } from "../../../lib/search-ranking";
import { getEffectiveSearchOverrides, getPinnedSkusForQuery } from "../../../lib/search-overrides";
import { STORE_URL, absoluteStoreUrl } from "../../../lib/store-url";

const COLLECTION_NAME = "emrn_products";
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
  return ["patient monitor", "patient monitors", "vital signs monitor", "vital sign monitor", "bedside monitor", "multi parameter monitor", "multi-parameter monitor", "moniteur patient", "moniteur de signes vitaux"].some((term) => query.includes(normalizeSearchText(term)));
}

function prioritizePatientMonitorUnits(hits: any[] = [], originalQuery: string, searchQuery: string) {
  if (!isPatientMonitorFamilyQuery(originalQuery, searchQuery)) return hits;
  const accessoryTerms = ["accessory", "accessories", "cuff", "cuffs", "electrode", "electrodes", "leadwire", "lead wire", "paper", "alarm", "mount", "bracket", "stand", "station", "stations", "tube", "tubing", "hose", "sensor", "probe"];
  const unitTerms = ["patient monitor", "vital signs monitor", "vital sign monitor", "bedside monitor", "spot monitor", "multiparameter monitor", "multi-parameter monitor", "edan x10", "edan x12", "edan im3", "im50 patient monitor", "im60 patient monitor", "m3 vital signs", "m3a vital signs", "connex spot", "spot vital sign", "fetal monitor", "pulse oximeter", "co-oximeter", "holter"];
  const score = (hit: any) => {
    const doc = hit.document || {};
    const name = normalizeSearchText([doc.name, doc.parent_name, doc.variant_label, doc.option_text].filter(Boolean).join(" "));
    const categories = normalizeSearchText(Array.isArray(doc.categories) ? doc.categories.join(" ") : String(doc.categories || ""));
    const hasAccessory = accessoryTerms.some((term) => name.includes(normalizeSearchText(term)));
    const hasUnit = unitTerms.some((term) => name.includes(normalizeSearchText(term)));
    let value = 0;
    if (hasUnit && !hasAccessory) value += 1000;
    if (categories.includes("vital sign monitors") || categories.includes("patient monitors")) value += 100;
    if (hasAccessory) value -= 600;
    if (categories.includes("veterinary")) value -= 300;
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
  if (includesAny(original, ["cpr mask", "cpr masks", "masque rcr", "masques rcr", "rcr mask", "rcr masks"])) {
    add("cpr pocket mask", "pocket mask", "cpr mask", "cpr pocket ventilator", "face shield");
  }
  if (includesAny(query, ["patient monitor", "patient monitors", "patient monitoring", "vital signs monitor", "vital sign monitor", "vitals monitor", "moniteur patient", "moniteur de patient", "moniteur de signes vitaux"])) {
    add("patient monitor", "vital signs monitor", "bedside monitor", "multiparameter monitor", "edan im50", "edan im60");
  }
  if (includesAny(query, ["medical bag", "medical bags", "medic bag", "medic bags", "trauma bag", "trauma bags", "ems bag", "emt bag", "jump bag", "jump bags", "sac medical", "sac médical", "sacs medicaux", "sacs médicaux"])) {
    add("medical bag", "medical bags", "trauma bag", "ems bag", "first aid bag", "rescue bag");
  }
  if (includesAny(query, ["stretcher", "stretchers", "brancard", "brancards", "civiere", "civière"])) {
    add("stretcher", "ambulance cot", "scoop stretcher", "basket stretcher", "rescue stretcher");
  }

  return recalls.slice(0, 8);
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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("q") || "*";
  const page = Number(searchParams.get("page") || 1);
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
  const primaryFetchSize = page === 1 ? Math.min(requestedPerPage * 8, 160) : Math.min(requestedPerPage * 3, 96);
  const supplementalFetchSize = page === 1 ? Math.min(requestedPerPage * 4, 96) : Math.min(requestedPerPage * 2, 60);
  const facetLimit = page === 1 ? 600 : 160;

  const controls = await getEffectiveSearchOverrides();
  const smartQuery = await buildSmartSearchQuery(q);
  const categoryRecallQueries = [
    q,
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
  const primarySearchQuery = selectedCategoryTranslatedQuery ? "*" : smartQuery.search_query || "*";

  const results: any = await typesenseSearch
    .collections(COLLECTION_NAME)
    .documents()
    .search({
      q: primarySearchQuery,
      query_by:
        "sku,all_skus,name,parent_name,brand,sold_by,categories,variant_label,option_text,search_text,description,custom_fields_text",
      query_by_weights: "30,24,16,12,8,7,7,6,6,4,2,2",
      filter_by: filters.join(" && "),
      facet_by: "brand,categories,sold_by,color,price,availability",
      max_facet_values: facetLimit,
      sort_by: normalizeSort(sort),
      per_page: primaryFetchSize,
      limit_hits: SEARCH_HIT_LIMIT,
      page,
      num_typos: 2,
      typo_tokens_threshold: 1,
      prefix: true,
    });

  if (results.hits) {
    const supplementalSearches: Array<{ kind: "aed" | "brand" | "category_family" | "recall"; search: Promise<any> }> = [];
    const supplementalBase = filters.join(" && ");

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
              facet_by: "brand,categories,sold_by,color,price,availability",
              max_facet_values: facetLimit,
              sort_by: normalizeSort(sort),
              per_page: supplementalFetchSize,
              limit_hits: SEARCH_HIT_LIMIT,
              page,
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
              facet_by: "brand,categories,sold_by,color,price,availability",
              max_facet_values: facetLimit,
              sort_by: normalizeSort(sort),
              per_page: supplementalFetchSize,
              limit_hits: SEARCH_HIT_LIMIT,
              page,
            }),
        }
      );
    }

    if (!category && !categoryIds.length) {
      for (const recallQuery of supplementalRecallQueries(q, smartQuery.search_query)) {
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
              facet_by: "brand,categories,sold_by,color,price,availability",
              max_facet_values: Math.min(facetLimit, 300),
              sort_by: normalizeSort(sort),
              per_page: supplementalFetchSize,
              limit_hits: SEARCH_HIT_LIMIT,
              page,
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
              facet_by: "brand,categories,sold_by,color,price,availability",
              max_facet_values: facetLimit,
              sort_by: normalizeSort(sort),
              per_page: supplementalFetchSize,
              limit_hits: SEARCH_HIT_LIMIT,
              page,
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

    const rankedHits = applyPinnedSkuRanking(
      applyBrandQueryRanking(
        applyIntentRanking(
          applyPrivateCategoryFilter(applyHiddenSkuFilter(mergeHits(supplementalHits, results.hits), controls), customerId, controls),
          q,
          smartQuery.search_query
        ),
        q
      ),
      q,
      controls
    );
    const filteredHits = applyClientSort(prioritizePatientMonitorUnits(rankedHits, q, smartQuery.search_query), sort);

    if (fulfilledSupplementalResults.length) {
      const facetBase =
        categoryFamilyResult && Number(categoryFamilyResult.found || 0) >= Number(results.found || 0)
          ? categoryFamilyResult
          : results;
      results.facet_counts = nonCategoryFamilyResults.length
        ? ["brand", "categories", "sold_by", "color", "price", "availability"].map((field) =>
            mergeFacetCounts(field, facetBase, ...nonCategoryFamilyResults)
          )
        : facetBase.facet_counts;
      results.found = Math.max(
        Number(results.found || 0),
        ...fulfilledSupplementalResults.map((result) => Number(result?.found || 0))
      );
    }
    addMissingSingleValueFacetBuckets(results);
    results.hits = filteredHits.slice(0, requestedPerPage).map((hit: any) => ({
      ...hit,
      document: {
        ...hit.document,
        url: absoluteStoreUrl(hit.document?.url),
        sold_by: hit.document?.sold_by || "",
        color: hit.document?.color || "",
        variant_id: hit.document?.variant_id || 0,
        is_variant: Boolean(hit.document?.is_variant),
        popularity_score: Number(hit.document?.popularity_score || 0),
        smart_reasons: explainResult(hit, q, controls),
      },
    }));
  }

  return NextResponse.json(
    {
      ...results,
      ...smartQuery,
      fallback_terms: results.hits?.length ? [] : smartQuery.fallback_terms,
      pinned_skus: getPinnedSkusForQuery(q, controls),
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
    },
    { headers: corsHeaders }
  );
}
