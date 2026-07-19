import { NextRequest, NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";
import { applyHiddenSkuFilter, applyIntentRanking, applyPinnedSkuRanking, applyPrivateCategoryFilter, explainResult } from "../../../lib/search-ranking";
import { getEffectiveSearchOverrides, getPinnedSkusForQuery } from "../../../lib/search-overrides";

const COLLECTION_NAME = "emrn_products";
const STORE_URL = process.env.EMRN_STORE_URL || "https://emrn.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

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
  const filters: string[] = ["is_visible:=true"];

  if (brand) filters.push(`brand:=${JSON.stringify(brand)}`);
  if (category) filters.push(`categories:=${JSON.stringify(category)}`);
  if (categoryId && Number(categoryId) > 0) filters.push(`category_ids:=[${Number(categoryId)}]`);
  if (availability) filters.push(`availability:=${JSON.stringify(availability)}`);
  if (soldBy) filters.push(`sold_by:=${JSON.stringify(soldBy)}`);
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
      max_facet_values: 80,
      sort_by: normalizeSort(sort),
      per_page: Math.min(requestedPerPage * 3, 100),
      page,
      num_typos: 2,
      typo_tokens_threshold: 1,
      prefix: true,
    });

  if (results.hits) {
    const filteredHits = applyPinnedSkuRanking(
      applyIntentRanking(applyPrivateCategoryFilter(applyHiddenSkuFilter(results.hits, controls), customerId, controls), q, smartQuery.search_query),
      q,
      controls
    );

    results.facet_counts = ["brand", "categories", "sold_by", "color", "price", "availability"].map((field) =>
      facetCountsFromHits(filteredHits, field)
    );
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
