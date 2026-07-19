import { NextRequest, NextResponse } from "next/server";
import { typesenseAdmin } from "../../../lib/typesense";
import { getAllProductsForSearch } from "../../../lib/bigcommerce";

const COLLECTION_NAME = "emrn_products";
const IMPORT_BATCH_SIZE = 250;

function parseImportResult(result: unknown) {
  if (Array.isArray(result)) return result;
  if (result && typeof result === "object") return Object.values(result as Record<string, unknown>);

  return String(result || "")
    .split(/\n|(?<=\})\s*(?=\{)/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return {
          success: false,
          error: `Could not parse import response line: ${line.slice(0, 180)}`,
        };
      }
    });
}

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
      { name: "variant_id", type: "int32", facet: true, optional: true },
      { name: "is_variant", type: "bool", facet: true, optional: true },
      { name: "parent_name", type: "string", optional: true },
      { name: "name", type: "string" },
      { name: "sku", type: "string", optional: true },
      { name: "variant_skus", type: "string[]", optional: true },
      { name: "all_skus", type: "string[]", optional: true },
      { name: "brand", type: "string", facet: true, optional: true },
      { name: "sold_by", type: "string", facet: true, optional: true },
      { name: "categories", type: "string[]", facet: true, optional: true },
      { name: "category_url_pairs", type: "string[]", optional: true },
      { name: "category_ids", type: "int32[]", facet: true, optional: true },
      { name: "description", type: "string", optional: true },
      { name: "custom_fields_text", type: "string", optional: true },
      { name: "option_text", type: "string", optional: true },
      { name: "variant_label", type: "string", optional: true },
      { name: "color", type: "string", facet: true, optional: true },
      { name: "search_text", type: "string", optional: true },
      { name: "price", type: "float", facet: true },
      { name: "sale_price", type: "float", optional: true },
      { name: "retail_price", type: "float", optional: true },
      { name: "image", type: "string", optional: true },
      { name: "url", type: "string" },
      { name: "inventory_level", type: "int32", facet: true, optional: true },
      { name: "popularity_score", type: "int32", facet: true },
      { name: "availability", type: "string", facet: true, optional: true },
      { name: "availability_description", type: "string", optional: true },
      { name: "purchasable", type: "bool", facet: true, optional: true },
      { name: "quote_only", type: "bool", facet: true, optional: true },
      { name: "purchase_action", type: "string", facet: true, optional: true },
      { name: "purchase_message", type: "string", optional: true },
      { name: "is_visible", type: "bool", facet: true },
      { name: "date_modified", type: "string", optional: true }
    ],
    default_sorting_field: "popularity_score"
  });
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-reindex-secret");
  const adminPassword = req.headers.get("x-smartsearch-admin-password");
  const hasReindexSecret = Boolean(process.env.REINDEX_SECRET && secret === process.env.REINDEX_SECRET);
  const hasAdminPassword = Boolean(
    process.env.SMARTSEARCH_ADMIN_PASSWORD &&
      adminPassword === process.env.SMARTSEARCH_ADMIN_PASSWORD
  );

  if (!hasReindexSecret && !hasAdminPassword) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  await recreateCollection();

  const products = await getAllProductsForSearch();

  const importRows: unknown[] = [];
  for (let index = 0; index < products.length; index += IMPORT_BATCH_SIZE) {
    const batch = products.slice(index, index + IMPORT_BATCH_SIZE);
    const result = await typesenseAdmin
      .collections(COLLECTION_NAME)
      .documents()
      .import(batch, { action: "upsert" });

    importRows.push(...parseImportResult(result));
  }

  const failed = importRows.filter((row: any) => row && row.success === false);

  return NextResponse.json({
    ok: true,
    collection: COLLECTION_NAME,
    total_records: products.length,
    failed_count: failed.length,
    failed: failed.slice(0, 10),
    ms: Date.now() - startedAt
  });
}
