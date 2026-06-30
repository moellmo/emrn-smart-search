import { NextRequest, NextResponse } from "next/server";
import { typesenseAdmin } from "../../../lib/typesense";
import { getAllProductsForSearch } from "../../../lib/bigcommerce";

const COLLECTION_NAME = "emrn_products";

async function recreateCollection() {
  try {
    await typesenseAdmin.collections(COLLECTION_NAME).delete();
  } catch {
    // Collection may not exist yet.
  }

  await typesenseAdmin.collections().create({
    name: COLLECTION_NAME,
    fields: [
      { name: "product_id", type: "int32" },
      { name: "name", type: "string" },
      { name: "sku", type: "string", optional: true },
      { name: "variant_skus", type: "string[]", optional: true },
      { name: "all_skus", type: "string[]", optional: true },
      { name: "brand", type: "string", facet: true, optional: true },
      { name: "categories", type: "string[]", facet: true, optional: true },
      { name: "category_ids", type: "int32[]", facet: true, optional: true },
      { name: "description", type: "string", optional: true },
      { name: "custom_fields_text", type: "string", optional: true },
      { name: "option_text", type: "string", optional: true },
      { name: "search_text", type: "string", optional: true },
      { name: "price", type: "float", facet: true },
      { name: "sale_price", type: "float", optional: true },
      { name: "retail_price", type: "float", optional: true },
      { name: "image", type: "string", optional: true },
      { name: "url", type: "string" },
      { name: "inventory_level", type: "int32", facet: true, optional: true },
      { name: "availability", type: "string", facet: true, optional: true },
      { name: "availability_description", type: "string", optional: true },
      { name: "is_visible", type: "bool", facet: true },
      { name: "date_modified", type: "string", optional: true }
    ],
    default_sorting_field: "product_id"
  });
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-reindex-secret");

  if (!secret || secret !== process.env.REINDEX_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  await recreateCollection();

  const products = await getAllProductsForSearch();

  const result = await typesenseAdmin
    .collections(COLLECTION_NAME)
    .documents()
    .import(products, { action: "upsert" });

  const failed = Array.isArray(result)
    ? result.filter((row: any) => row && row.success === false)
    : String(result)
        .split("\n")
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch {
            return null;
          }
        })
        .filter((row: any) => row && row.success === false);

  return NextResponse.json({
    ok: true,
    collection: COLLECTION_NAME,
    total_products: products.length,
    failed_count: failed.length,
    failed: failed.slice(0, 10),
    ms: Date.now() - startedAt
  });
}