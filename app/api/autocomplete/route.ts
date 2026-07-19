import { NextRequest, NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";
import { buildSmartSearchQuery } from "../../../lib/smart-search-translator";
import { applyHiddenSkuFilter, applyIntentRanking, applyPinnedSkuRanking, applyPrivateCategoryFilter } from "../../../lib/search-ranking";
import { getEffectiveSearchOverrides } from "../../../lib/search-overrides";

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

function categoryUrlMapFromHits(hits: any[] = []) {
  const map = new Map<string, string>();

  for (const hit of hits) {
    const pairs = hit.document?.category_url_pairs || [];
    for (const pair of pairs) {
      const [name, ...urlParts] = String(pair).split("|");
      const url = urlParts.join("|");
      if (name && url && !map.has(name)) map.set(name, url);
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
    url: fixUrl(doc.url),
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

  const hits = applyPinnedSkuRanking(
    applyIntentRanking(applyPrivateCategoryFilter(applyHiddenSkuFilter(results.hits || [], controls), customerId, controls), q, smartQuery.search_query),
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
