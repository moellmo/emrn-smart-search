import { NextRequest, NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";
import { normalizeSearchText } from "../../../lib/search-language";
import { applyBrandQueryRanking, applyHiddenSkuFilter, applyIntentRanking, applyPinnedSkuRanking, applyPrivateCategoryFilter } from "../../../lib/search-ranking";
import { getEffectiveSearchOverrides } from "../../../lib/search-overrides";
import { STORE_URL, absoluteStoreUrl } from "../../../lib/store-url";

const COLLECTION_NAME = "emrn_products";
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

function autocompleteRecallQueries(originalQuery: string, translatedQuery: string) {
  const query = normalizeSearchText(`${originalQuery} ${translatedQuery}`);
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
  if (includesAny(query, ["pansement", "pansements", "wound dressing", "wound dressings", "dressing", "dressings"])) {
    add("wound dressing", "bandage", "gauze", "dressings");
  }
  if (includesAny(query, ["scalpel", "scalpels", "knife", "knives"])) {
    add("scalpel", "scalpel blade", "surgical blade");
  }
  if (includesAny(query, ["ceinture", "ceintures", "belt", "belts"])) {
    add("gait belt", "transfer belt", "safety belt", "stretcher belt", "belt");
  }
  if (includesAny(query, ["qcpr", "q cpr", "little baby", "little family", "little junior", "little anne", "baby qcpr", "family qcpr", "junior qcpr"])) {
    add(originalQuery, "little baby qcpr", "little family qcpr", "little junior qcpr", "little anne qcpr", "qcpr manikin");
  }
  if (includesAny(query, ["cpr mask", "cpr masks", "masque rcr", "masques rcr", "rcr mask", "rcr masks"])) {
    add("cpr pocket mask", "pocket mask", "cpr mask", "face shield");
  }

  return recalls.slice(0, 6);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";
  const customerId = searchParams.get("customer_id") || "";

  if (q.trim().length < 2) {
    return NextResponse.json({ products: [], facets: [] }, { headers: corsHeaders });
  }

  const controls = await getEffectiveSearchOverrides();
  const smartQuery = await buildSmartSearchQuery(q);

  const results: any = await typesenseSearch
    .collections(COLLECTION_NAME)
    .documents()
    .search({
      q: smartQuery.search_query,
      query_by: "sku,all_skus,name,parent_name,brand,sold_by,categories,variant_label,option_text,search_text",
      query_by_weights: "30,24,16,12,8,7,6,5,5,3",
      filter_by: "is_visible:=true",
      facet_by: "brand,categories",
      max_facet_values: 24,
      per_page: 48,
      num_typos: 2,
      typo_tokens_threshold: 1,
      prefix: true,
      highlight_full_fields: "name,sku,brand,sold_by,categories,variant_label,option_text",
    });

  const supplementalSearches: Promise<any>[] = [];

  if (isAedUnitQuery(q)) {
    supplementalSearches.push(
      typesenseSearch
        .collections(COLLECTION_NAME)
        .documents()
        .search({
          q: "*",
          query_by: "sku,all_skus,name,parent_name,brand,categories,search_text",
          filter_by: `is_visible:=true && category_ids:=[${AED_CATEGORY_ID}]`,
          facet_by: "brand,categories",
          max_facet_values: 24,
          per_page: 48,
        })
    );
  }

  for (const categoryName of categoryFacetNamesForQuery(results, q, smartQuery.search_query)) {
    supplementalSearches.push(
      typesenseSearch
        .collections(COLLECTION_NAME)
        .documents()
        .search({
          q: "*",
          query_by: "sku,all_skus,name,parent_name,brand,categories,search_text",
          filter_by: `is_visible:=true && categories:=${JSON.stringify(categoryName)}`,
          facet_by: "brand,categories",
          max_facet_values: 24,
          per_page: 48,
        })
    );
  }

  for (const recallQuery of autocompleteRecallQueries(q, smartQuery.search_query)) {
    supplementalSearches.push(
      typesenseSearch
        .collections(COLLECTION_NAME)
        .documents()
        .search({
          q: recallQuery,
          query_by: "name,parent_name,categories,variant_label,option_text,search_text,sku,all_skus,brand",
          query_by_weights: "26,22,14,8,8,6,4,3,2",
          filter_by: "is_visible:=true",
          facet_by: "brand,categories",
          max_facet_values: 24,
          per_page: 36,
          num_typos: 1,
          typo_tokens_threshold: 1,
          prefix: true,
          highlight_full_fields: "name,parent_name,categories,variant_label,option_text",
        })
    );
  }

  if (isLikelyBrandQuery(q)) {
    supplementalSearches.push(
      typesenseSearch
        .collections(COLLECTION_NAME)
        .documents()
        .search({
          q,
          query_by: "brand",
          query_by_weights: "10",
          filter_by: "is_visible:=true",
          facet_by: "brand,categories",
          max_facet_values: 24,
          per_page: 48,
          num_typos: 1,
          typo_tokens_threshold: 1,
          prefix: true,
          highlight_full_fields: "brand",
        })
    );
  }

  const supplementalResults = supplementalSearches.length
    ? await Promise.allSettled(supplementalSearches)
    : [];
  const supplementalHits = supplementalResults.flatMap((result) =>
    result.status === "fulfilled" ? result.value?.hits || [] : []
  );

  const hits = applyPinnedSkuRanking(
    applyBrandQueryRanking(
      applyIntentRanking(
        applyPrivateCategoryFilter(applyHiddenSkuFilter(mergeHits(supplementalHits, results.hits || []), controls), customerId, controls),
        q,
        smartQuery.search_query
      ),
      q
    ),
    q,
    controls
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
      values: facetCountsFromHits(hits, "categories").map((item) => ({
        ...item,
        url: categoryUrls.get(item.value) || "",
      })),
    },
  ];

  return NextResponse.json(
    {
      products,
      facets,
      ...smartQuery,
      fallback_terms: products.length ? [] : smartQuery.fallback_terms,
    },
    { headers: corsHeaders }
  );
}
