import { NextRequest, NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";

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
    availability_description: doc.availability_description
  };
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";

  if (q.trim().length < 2) {
    return NextResponse.json({ products: [], facets: [] }, { headers: corsHeaders });
  }

  const results = await typesenseSearch
    .collections(COLLECTION_NAME)
    .documents()
    .search({
      q,
      query_by: "sku,all_skus,name,parent_name,brand,sold_by,categories,variant_label,option_text,search_text",
      query_by_weights: "30,24,16,12,8,7,6,5,5,3",
      filter_by: "is_visible:=true",
      facet_by: "brand,categories",
      per_page: 8,
      num_typos: 2,
      typo_tokens_threshold: 1,
      prefix: true,
      highlight_full_fields: "name,sku,brand,sold_by,categories,variant_label,option_text"
    });

  const hits = results.hits || [];
  const products = hits.map((hit: any) => normalizeHit(hit.document));

  const categoryUrls = categoryUrlMapFromHits(hits);

  const facets =
    results.facet_counts?.map((facet: any) => ({
      field: facet.field_name,
      values:
        facet.field_name === "categories"
          ? (facet.counts?.slice(0, 7) || []).map((item: any) => ({
              ...item,
              url: categoryUrls.get(item.value) || ""
            }))
          : facet.counts?.slice(0, 7) || []
    })) || [];

  return NextResponse.json({ products, facets }, { headers: corsHeaders });
}
