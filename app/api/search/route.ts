import { NextRequest, NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";
import { applyHiddenSkuFilter, applyPinnedSkuRanking, explainResult } from "../../../lib/search-ranking";
import { getPinnedSkusForQuery } from "../../../lib/search-overrides";

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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("q") || "*";
  const page = Number(searchParams.get("page") || 1);
  const brand = searchParams.get("brand");
  const category = searchParams.get("category");
  const categoryId = searchParams.get("category_id");
  const availability = searchParams.get("availability");

  const smartQuery = await buildSmartSearchQuery(q);
  const filters: string[] = ["is_visible:=true"];

  if (brand) filters.push(`brand:=${JSON.stringify(brand)}`);
  if (category) filters.push(`categories:=${JSON.stringify(category)}`);
  if (categoryId && Number(categoryId) > 0) filters.push(`category_ids:=[${Number(categoryId)}]`);
  if (availability) filters.push(`availability:=${JSON.stringify(availability)}`);

  const results: any = await typesenseSearch
    .collections(COLLECTION_NAME)
    .documents()
    .search({
      q: smartQuery.search_query,
      query_by:
        "sku,all_skus,name,parent_name,brand,sold_by,categories,variant_label,option_text,search_text,description,custom_fields_text",
      query_by_weights: "30,24,16,12,8,7,7,6,6,4,2,2",
      filter_by: filters.join(" && "),
      facet_by: "brand,categories,availability",
      sort_by: "_text_match:desc,product_id:desc",
      per_page: 24,
      page,
      num_typos: 2,
      typo_tokens_threshold: 1,
      prefix: true,
    });

  if (results.hits) {
    results.hits = applyPinnedSkuRanking(applyHiddenSkuFilter(results.hits), q).map((hit: any) => ({
      ...hit,
      document: {
        ...hit.document,
        url: fixUrl(hit.document?.url),
        sold_by: hit.document?.sold_by || "",
        variant_id: hit.document?.variant_id || 0,
        is_variant: Boolean(hit.document?.is_variant),
        smart_reasons: explainResult(hit, q),
      },
    }));
  }

  return NextResponse.json(
    {
      ...results,
      ...smartQuery,
      fallback_terms: results.hits?.length ? [] : smartQuery.fallback_terms,
      pinned_skus: getPinnedSkusForQuery(q),
    },
    { headers: corsHeaders }
  );
}
