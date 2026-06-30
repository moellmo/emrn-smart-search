import { NextRequest, NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";

const COLLECTION_NAME = "emrn_products";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const q = searchParams.get("q") || "*";
  const page = Number(searchParams.get("page") || 1);
  const brand = searchParams.get("brand");
  const category = searchParams.get("category");
  const availability = searchParams.get("availability");

  const filters: string[] = ["is_visible:=true"];

  if (brand) filters.push(`brand:=${JSON.stringify(brand)}`);
  if (category) filters.push(`categories:=${JSON.stringify(category)}`);
  if (availability) filters.push(`availability:=${JSON.stringify(availability)}`);

  const results = await typesenseSearch
    .collections(COLLECTION_NAME)
    .documents()
    .search({
      q,
      query_by: "sku,all_skus,name,brand,categories,search_text,description,custom_fields_text,option_text",
      query_by_weights: "20,18,12,8,7,4,2,2,2",
      filter_by: filters.join(" && "),
      facet_by: "brand,categories,availability",
      sort_by: "_text_match:desc,product_id:desc",
      per_page: 24,
      page,
      num_typos: 2,
      typo_tokens_threshold: 1,
      prefix: true
    });

  return NextResponse.json(results);
}
