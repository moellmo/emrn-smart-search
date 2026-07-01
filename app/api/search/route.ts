import { NextRequest, NextResponse } from "next/server";
import { typesenseAdmin } from "../../../lib/typesense";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";
import { applyHiddenSkuFilter, applyPinnedSkuRanking, explainResult } from "../../../lib/search-ranking";
import { getEffectiveSearchOverrides, getPinnedSkusForQuery } from "../../../lib/search-overrides";

const COLLECTION = process.env.TYPESENSE_COLLECTION || "products";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function escapeFilterValue(value: string) {
  return String(value || "").replace(/`/g, "\\`");
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
      return undefined;
  }
}

function toProduct(hit: any, q: string, controls: any) {
  return {
    ...hit,
    document: {
      ...hit.document,
      smart_reasons: explainResult(hit, q, controls),
    },
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("q") || "";
  const page = Number(searchParams.get("page") || "1");
  const perPage = Number(searchParams.get("per_page") || "24");
  const brand = searchParams.get("brand") || "";
  const categoryId = searchParams.get("category_id") || "";
  const categoryName = searchParams.get("category") || "";
  const priceMin = searchParams.get("price_min") || "";
  const priceMax = searchParams.get("price_max") || "";
  const sort = searchParams.get("sort") || "popularity";

  const controls = await getEffectiveSearchOverrides();
  const smartQuery = await buildSmartSearchQuery(q);

  if (smartQuery.redirect_url) {
    return NextResponse.json(
      {
        redirect_url: smartQuery.redirect_url,
        original_query: smartQuery.original_query,
        search_query: smartQuery.search_query,
        language: smartQuery.language,
        translator: smartQuery.translator,
        ai_status: smartQuery.ai_status,
      },
      { headers: corsHeaders }
    );
  }

  const filters: string[] = [];

  if (brand) {
    filters.push(`brand:=${escapeFilterValue(brand)}`);
  }

  if (categoryId) {
    filters.push(`category_ids:=[${Number(categoryId)}]`);
  } else if (categoryName) {
    filters.push(`categories:=${escapeFilterValue(categoryName)}`);
  }

  if (priceMin && !Number.isNaN(Number(priceMin))) {
    filters.push(`price:>=${Number(priceMin)}`);
  }

  if (priceMax && !Number.isNaN(Number(priceMax))) {
    filters.push(`price:<=${Number(priceMax)}`);
  }

  const sortBy = normalizeSort(sort);

  const searchParameters: any = {
    q: smartQuery.search_query || "*",
    query_by: "name,parent_name,sku,brand,categories,description,option_text,variant_label,sold_by",
    query_by_weights: "8,8,10,5,4,2,7,7,3",
    page,
    per_page: Math.min(Math.max(perPage, 1), 48),
    facet_by: "brand,categories",
    max_facet_values: 60,
    filter_by: filters.join(" && "),
    typo_tokens_threshold: 1,
    num_typos: 2,
  };

  if (sortBy) searchParameters.sort_by = sortBy;

  const results: any = await typesenseAdmin.collections(COLLECTION).documents().search(searchParameters);

  const rankedHits = applyPinnedSkuRanking(applyHiddenSkuFilter(results.hits || [], controls), q, controls)
    .map((hit: any) => toProduct(hit, q, controls));

  return NextResponse.json(
    {
      ...results,
      hits: rankedHits,
      original_query: smartQuery.original_query,
      search_query: smartQuery.search_query,
      expanded_query: smartQuery.expanded_query,
      expansions: smartQuery.expansions,
      translated_query: smartQuery.translated_query,
      language: smartQuery.language,
      translator: smartQuery.translator,
      ai_status: smartQuery.ai_status,
      fallback_terms: rankedHits.length ? [] : smartQuery.fallback_terms,
      pinned_skus: getPinnedSkusForQuery(q, controls),
      active_filters: {
        brand,
        category_id: categoryId,
        category: categoryName,
        price_min: priceMin,
        price_max: priceMax,
        sort,
      },
    },
    { headers: corsHeaders }
  );
}
