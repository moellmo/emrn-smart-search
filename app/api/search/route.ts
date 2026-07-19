import { NextRequest, NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";
import { normalizeSearchText } from "../../../lib/search-language";
import { applyBrandQueryRanking, applyHiddenSkuFilter, applyIntentRanking, applyPinnedSkuRanking, applyPrivateCategoryFilter, explainResult } from "../../../lib/search-ranking";
import { getEffectiveSearchOverrides, getPinnedSkusForQuery } from "../../../lib/search-overrides";

const COLLECTION_NAME = "emrn_products";
const STORE_URL = process.env.EMRN_STORE_URL || "https://emrn.ca";
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

function fixUrl(url: string | undefined) {
  if (!url) return STORE_URL;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${STORE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function normalizeSort(sort: string | null) {
  switch (sort) {
    case "price_asc":
      return "price:asc";
    case "price_desc":
      return "price:desc";
    case "name_asc":
      return "name:asc";
    case "name_desc":
      return "name:desc";
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

  const normalizedSingular = singularize(normalized);
  const byParent = new Map<number, BCCategory[]>();
  const matched = new Set<number>();
  const ids = new Set<number>();

  for (const category of categories) {
    const parent = Number(category.parent_id || 0);
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent)!.push(category);

    const categoryName = normalizeSearchText(category.name);
    const categorySingular = singularize(categoryName);
    if (
      categoryName === normalized ||
      categorySingular === normalizedSingular ||
      categoryName.includes(normalized) ||
      categoryName.includes(normalizedSingular)
    ) {
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

  const controls = await getEffectiveSearchOverrides();
  const smartQuery = await buildSmartSearchQuery(q);
  const categoryFamilyIds =
    !categoryIds.length && !category && q !== "*"
      ? categoryFamilyIdsForQuery(q, await fetchSearchCategories()).filter((id) => id !== AED_CATEGORY_ID)
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

  const results: any = await typesenseSearch
    .collections(COLLECTION_NAME)
    .documents()
    .search({
      q: smartQuery.search_query || "*",
      query_by:
        "sku,all_skus,name,parent_name,brand,sold_by,categories,variant_label,option_text,search_text,description,custom_fields_text",
      query_by_weights: "30,24,16,12,8,7,7,6,6,4,2,2",
      filter_by: filters.join(" && "),
      facet_by: "brand,categories,sold_by,color,price,availability",
      max_facet_values: 1000,
      sort_by: normalizeSort(sort),
      per_page: Math.min(requestedPerPage * 3, 100),
      limit_hits: SEARCH_HIT_LIMIT,
      page,
      num_typos: 2,
      typo_tokens_threshold: 1,
      prefix: true,
    });

  if (results.hits) {
    const supplementalSearches: Promise<any>[] = [];
    const supplementalBase = filters.join(" && ");

    if (isAedUnitQuery(q) && !category && !categoryIds.length) {
      supplementalSearches.push(
        typesenseSearch
          .collections(COLLECTION_NAME)
          .documents()
          .search({
            q: "*",
            query_by: "sku,all_skus,name,parent_name,brand,categories,search_text",
            filter_by: [supplementalBase, `category_ids:=[${AED_CATEGORY_ID}]`].filter(Boolean).join(" && "),
            facet_by: "brand,categories,sold_by,color,price,availability",
            max_facet_values: 1000,
            sort_by: normalizeSort(sort),
            per_page: Math.min(requestedPerPage * 3, 100),
            limit_hits: SEARCH_HIT_LIMIT,
            page,
          })
      );
    }

    if (categoryFamilyIds.length) {
      supplementalSearches.push(
        typesenseSearch
          .collections(COLLECTION_NAME)
          .documents()
          .search({
            q: "*",
            query_by: "sku,all_skus,name,parent_name,brand,categories,search_text",
            filter_by: [supplementalBase, `category_ids:=[${categoryFamilyIds.join(",")}]`].filter(Boolean).join(" && "),
            facet_by: "brand,categories,sold_by,color,price,availability",
            max_facet_values: 1000,
            sort_by: normalizeSort(sort),
            per_page: Math.min(requestedPerPage * 3, 100),
            limit_hits: SEARCH_HIT_LIMIT,
            page,
          })
      );
    }

    if (isLikelyBrandQuery(q) && !brand) {
      supplementalSearches.push(
        typesenseSearch
          .collections(COLLECTION_NAME)
          .documents()
          .search({
            q,
            query_by: "brand",
            query_by_weights: "10",
            filter_by: supplementalBase,
            facet_by: "brand,categories,sold_by,color,price,availability",
            max_facet_values: 1000,
            sort_by: normalizeSort(sort),
            per_page: Math.min(requestedPerPage * 3, 100),
            limit_hits: SEARCH_HIT_LIMIT,
            page,
            num_typos: 1,
            typo_tokens_threshold: 1,
            prefix: true,
          })
      );
    }

    const supplementalResults = supplementalSearches.length
      ? await Promise.allSettled(supplementalSearches)
      : [];
    const fulfilledSupplementalResults = supplementalResults.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    const supplementalHits = fulfilledSupplementalResults.flatMap((result) => result?.hits || []);

    const filteredHits = applyPinnedSkuRanking(
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

    if (fulfilledSupplementalResults.length) {
      results.facet_counts = ["brand", "categories", "sold_by", "color", "price", "availability"].map((field) =>
        mergeFacetCounts(field, results, ...fulfilledSupplementalResults)
      );
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
        url: fixUrl(hit.document?.url),
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
