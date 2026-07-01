import { NextRequest, NextResponse } from "next/server";
import { typesenseAdmin } from "../../../lib/typesense";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";
import { applyHiddenSkuFilter, applyPinnedSkuRanking, explainResult } from "../../../lib/search-ranking";
import { getEffectiveSearchOverrides, getPinnedSkusForQuery } from "../../../lib/search-overrides";

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
      return "";
  }
}

function buildFilter({
  brand,
  categoryId,
  categoryName,
  priceMin,
  priceMax,
}: {
  brand: string;
  categoryId: string;
  categoryName: string;
  priceMin: string;
  priceMax: string;
}) {
  const filters: string[] = [];

  if (brand) filters.push(`brand:=${escapeFilterValue(brand)}`);

  // Prefer category_ids when available. If the schema does not support it,
  // the catch block below will retry category name only.
  if (categoryId) filters.push(`category_ids:=[${Number(categoryId)}]`);
  else if (categoryName) filters.push(`categories:=${escapeFilterValue(categoryName)}`);

  if (priceMin && !Number.isNaN(Number(priceMin))) filters.push(`price:>=${Number(priceMin)}`);
  if (priceMax && !Number.isNaN(Number(priceMax))) filters.push(`price:<=${Number(priceMax)}`);

  return filters.join(" && ");
}

function getCollectionName() {
  return (
    process.env.TYPESENSE_COLLECTION ||
    process.env.TYPESENSE_COLLECTION_NAME ||
    process.env.TYPESENSE_PRODUCTS_COLLECTION ||
    "products"
  );
}

async function runTypesenseSearch(collectionName: string, params: any) {
  return typesenseAdmin.collections(collectionName).documents().search(params);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  try {
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

    const collectionName = getCollectionName();
    const sortBy = normalizeSort(sort);

    const searchParameters: any = {
      q: smartQuery.search_query || "*",
      query_by: "name,parent_name,sku,brand,categories,description,option_text,variant_label,sold_by",
      query_by_weights: "8,8,10,5,4,2,7,7,3",
      page,
      per_page: Math.min(Math.max(perPage, 1), 48),
      facet_by: "brand,categories",
      max_facet_values: 60,
      filter_by: buildFilter({ brand, categoryId, categoryName, priceMin, priceMax }),
      typo_tokens_threshold: 1,
      num_typos: 2,
    };

    if (sortBy) searchParameters.sort_by = sortBy;

    let results: any;

    try {
      results = await runTypesenseSearch(collectionName, searchParameters);
    } catch (firstError: any) {
      // If category_ids is not in the schema, retry with category name when we have one.
      if (categoryId && categoryName) {
        searchParameters.filter_by = buildFilter({
          brand,
          categoryId: "",
          categoryName,
          priceMin,
          priceMax,
        });
        results = await runTypesenseSearch(collectionName, searchParameters);
      } else {
        throw firstError;
      }
    }

    const rankedHits = applyPinnedSkuRanking(applyHiddenSkuFilter(results.hits || [], controls), q, controls).map(
      (hit: any) => ({
        ...hit,
        document: {
          ...hit.document,
          smart_reasons: explainResult(hit, q, controls),
        },
      })
    );

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
  } catch (error: any) {
    console.error("SmartSearch API error", error);

    return NextResponse.json(
      {
        found: 0,
        hits: [],
        error: error?.message || "SmartSearch API error",
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
