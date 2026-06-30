import { NextRequest, NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";

const COLLECTION_NAME = "emrn_products";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q") || "";

  if (q.trim().length < 2) {
    return NextResponse.json({ products: [], facets: [] });
  }

  const results = await typesenseSearch
    .collections(COLLECTION_NAME)
    .documents()
    .search({
      q,
      query_by: "sku,all_skus,name,brand,categories,search_text",
      query_by_weights: "25,20,12,8,6,3",
      filter_by: "is_visible:=true",
      facet_by: "brand,categories",
      per_page: 8,
      num_typos: 2,
      typo_tokens_threshold: 1,
      prefix: true,
      highlight_full_fields: "name,sku,brand,categories"
    });

  const products =
    results.hits?.map((hit: any) => {
      const doc = hit.document;
      return {
        id: doc.id,
        product_id: doc.product_id,
        name: doc.name,
        sku: doc.sku,
        brand: doc.brand,
        price: doc.price,
        sale_price: doc.sale_price,
        image: doc.image,
        url: doc.url,
        availability: doc.availability,
        availability_description: doc.availability_description
      };
    }) || [];

  const facets =
    results.facet_counts?.map((facet: any) => ({
      field: facet.field_name,
      values: facet.counts?.slice(0, 5) || []
    })) || [];

  return NextResponse.json({ products, facets });
}
