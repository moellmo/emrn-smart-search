import { NextRequest, NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";
import { applyHiddenSkuFilter, applyPinnedSkuRanking, explainResult } from "../../../lib/search-ranking";
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
      return "_text_match:desc,product_id:desc";
  }
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
  const priceMin = searchParams.get("price_min");
  const priceMax = searchParams.get("price_max");
  const sort = searchParams.get("sort") || "popularity";

  const controls = await getEffectiveSearchOverrides();
  const smartQuery = await buildSmartSearchQuery(q);
  const filters: string[] = ["is_visible:=true"];

  if (brand) filters.push(`brand:=${JSON.stringify(brand)}`);
  if (category) filters.push(`categories:=${JSON.stringify(category)}`);
  if (categoryId && Number(categoryId) > 0) filters.push(`category_ids:=[${Number(categoryId)}]`);
  if (availability) filters.push(`availability:=${JSON.stringify(availability)}`);
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
      facet_by: "brand,categories,availability",
      sort_by: normalizeSort(sort),
      per_page: Math.min(Math.max(perPage, 1), 48),
      page,
      num_typos: 2,
      typo_tokens_threshold: 1,
      prefix: true,
    });

  if (results.hits) {
    results.hits = applyPinnedSkuRanking(applyHiddenSkuFilter(results.hits, controls), q, controls).map((hit: any) => ({
      ...hit,
      document: {
        ...hit.document,
        url: fixUrl(hit.document?.url),
        sold_by: hit.document?.sold_by || "",
        variant_id: hit.document?.variant_id || 0,
        is_variant: Boolean(hit.document?.is_variant),
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
        price_min: priceMin,
        price_max: priceMax,
        sort,
      },
    },
    { headers: corsHeaders }
  );
}
