import { NextRequest, NextResponse } from "next/server";
import { typesenseAdmin } from "../../../lib/typesense";
import { getAllProductsForSearch } from "../../../lib/bigcommerce";
import {
  MIN_REINDEX_RECORDS,
  PRODUCT_COLLECTION_ALIAS,
  versionedProductCollectionName,
} from "../../../lib/search-index";
import { ensureReindexStatusCollection, saveReindexStatus } from "../../../lib/reindex-status";
import { cleanupFailedProductCollection, cleanupOldProductCollections, shouldRunProductCollectionCleanup } from "../../../lib/product-collection-cleanup";
import { acquireReindexLock, releaseReindexLock } from "../../../lib/reindex-lock";

const IMPORT_BATCH_SIZE = 250;

export const maxDuration = 300;

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

async function createProductCollection(collectionName: string) {
  const schema: any = {
    name: collectionName,
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
  };

  await typesenseAdmin.collections().create(schema);
}

async function cleanupFailedTargetCollection(targetCollection: string, warnings: string[]) {
  const cleanup = await cleanupFailedProductCollection({
    client: typesenseAdmin,
    aliasName: PRODUCT_COLLECTION_ALIAS,
    targetCollection,
  });
  warnings.push(...cleanup.warnings);
}

async function runReindexWithLock() {
  const startedAt = Date.now();
  const targetCollection = versionedProductCollectionName();
  let targetCollectionCreated = false;
  const cleanupEnabled = process.env.TYPESENSE_COLLECTION_CLEANUP_ENABLED === "true";
  const dryRun = process.env.TYPESENSE_COLLECTION_CLEANUP_DRY_RUN === "true";

  try {
    // Confirm the live alias before touching collection retention. If this
    // cannot be read, no preflight deletion or new import may begin.
    const initialAlias = await typesenseAdmin.aliases(PRODUCT_COLLECTION_ALIAS).retrieve();
    const initialLiveTarget = String(initialAlias.collection_name || "");
    if (!initialLiveTarget) throw new Error("Reindex aborted before import: production alias could not be confirmed.");

    if (cleanupEnabled || dryRun) {
      const preflight = await cleanupOldProductCollections({
        client: typesenseAdmin,
        aliasName: PRODUCT_COLLECTION_ALIAS,
        expectedAliasTarget: initialLiveTarget,
        minCompleteDocuments: MIN_REINDEX_RECORDS,
        mode: "preflight",
        cleanupEnabled,
        dryRun,
      });
      if (preflight.skipped) throw new Error("Reindex aborted before import: preflight collection cleanup could not confirm the production alias.");
    }

    await saveReindexStatus({
      status: "running",
      started_at: startedAt,
      live_alias: PRODUCT_COLLECTION_ALIAS,
      target_collection: targetCollection,
      min_records: MIN_REINDEX_RECORDS,
    });

    const products = await getAllProductsForSearch();
    if (products.length < MIN_REINDEX_RECORDS) {
      const payload = await saveReindexStatus({
        status: "failed",
        started_at: startedAt,
        finished_at: Date.now(),
        live_alias: PRODUCT_COLLECTION_ALIAS,
        target_collection: targetCollection,
        total_records: products.length,
        min_records: MIN_REINDEX_RECORDS,
        error: "Reindex aborted before import: product count below safety threshold.",
        ms: Date.now() - startedAt,
      });

      return NextResponse.json(payload, { status: 500 });
    }

  await createProductCollection(targetCollection);
  targetCollectionCreated = true;

  const importRows: unknown[] = [];
  for (let index = 0; index < products.length; index += IMPORT_BATCH_SIZE) {
    const batch = products.slice(index, index + IMPORT_BATCH_SIZE);
    const result = await typesenseAdmin
      .collections(targetCollection)
      .documents()
      .import(batch, { action: "upsert" });

    importRows.push(...parseImportResult(result));
  }

  const failed = importRows.filter((row: any) => row && row.success === false);
  if (failed.length) {
    const cleanupWarnings: string[] = [];
    await cleanupFailedTargetCollection(targetCollection, cleanupWarnings);
    const payload = await saveReindexStatus({
      status: "failed",
      started_at: startedAt,
      finished_at: Date.now(),
      live_alias: PRODUCT_COLLECTION_ALIAS,
      target_collection: targetCollection,
      total_records: products.length,
      failed_count: failed.length,
      min_records: MIN_REINDEX_RECORDS,
      error: "Reindex aborted before alias swap: one or more imports failed.",
      cleanup_warnings: cleanupWarnings,
      ms: Date.now() - startedAt,
    });

    return NextResponse.json({ ...payload, failed: failed.slice(0, 10) }, { status: 500 });
  }

  const collection: any = await typesenseAdmin.collections(targetCollection).retrieve();
  if (Number(collection.num_documents || 0) < MIN_REINDEX_RECORDS) {
    const cleanupWarnings: string[] = [];
    await cleanupFailedTargetCollection(targetCollection, cleanupWarnings);
    const payload = await saveReindexStatus({
      status: "failed",
      started_at: startedAt,
      finished_at: Date.now(),
      live_alias: PRODUCT_COLLECTION_ALIAS,
      target_collection: targetCollection,
      total_records: products.length,
      indexed_records: Number(collection.num_documents || 0),
      min_records: MIN_REINDEX_RECORDS,
      error: "Reindex aborted before alias swap: indexed document count below safety threshold.",
      cleanup_warnings: cleanupWarnings,
      ms: Date.now() - startedAt,
    });

    return NextResponse.json(payload, { status: 500 });
  }

  const smokeSearch: any = await typesenseAdmin
    .collections(targetCollection)
    .documents()
    .search({
      q: "bandage",
      query_by: "sku,all_skus,name,parent_name,brand,categories,search_text",
      filter_by: "is_visible:=true",
      per_page: 1,
    });

  if (Number(smokeSearch.found || 0) <= 0) {
    const cleanupWarnings: string[] = [];
    await cleanupFailedTargetCollection(targetCollection, cleanupWarnings);
    const payload = await saveReindexStatus({
      status: "failed",
      started_at: startedAt,
      finished_at: Date.now(),
      live_alias: PRODUCT_COLLECTION_ALIAS,
      target_collection: targetCollection,
      total_records: products.length,
      indexed_records: Number(collection.num_documents || 0),
      min_records: MIN_REINDEX_RECORDS,
      error: "Reindex aborted before alias swap: smoke search returned no results.",
      cleanup_warnings: cleanupWarnings,
      ms: Date.now() - startedAt,
    });

    return NextResponse.json(payload, { status: 500 });
  }

  const previousAlias = await typesenseAdmin
    .aliases(PRODUCT_COLLECTION_ALIAS)
    .retrieve()
    .catch(() => null);

  await typesenseAdmin.aliases().upsert(PRODUCT_COLLECTION_ALIAS, {
    collection_name: targetCollection,
  });

  const confirmedAlias = await typesenseAdmin
    .aliases(PRODUCT_COLLECTION_ALIAS)
    .retrieve()
    .catch(() => null);

  if (confirmedAlias?.collection_name !== targetCollection) {
    // If the write could not be confirmed, keep cleanup off and restore the
    // prior live target when one existed. Search never intentionally moves to
    // an unverified collection.
    if (previousAlias?.collection_name) {
      await typesenseAdmin.aliases().upsert(PRODUCT_COLLECTION_ALIAS, {
        collection_name: previousAlias.collection_name,
      }).catch(() => null);
    }

    const cleanupWarnings: string[] = [];
    await cleanupFailedTargetCollection(targetCollection, cleanupWarnings);
    const payload = await saveReindexStatus({
      status: "failed",
      started_at: startedAt,
      finished_at: Date.now(),
      live_alias: PRODUCT_COLLECTION_ALIAS,
      previous_collection: previousAlias?.collection_name || "",
      target_collection: targetCollection,
      total_records: products.length,
      indexed_records: Number(collection.num_documents || 0),
      failed_count: 0,
      min_records: MIN_REINDEX_RECORDS,
      error: "Reindex aborted after alias swap: production alias could not be confirmed.",
      cleanup_warnings: cleanupWarnings,
      ms: Date.now() - startedAt,
    });

    return NextResponse.json(payload, { status: 500 });
  }

  let cleanupWarnings: string[] = [];
  const shouldCleanup = shouldRunProductCollectionCleanup({
    reindexSucceeded: true,
    aliasConfirmed: true,
    cleanupEnabled,
    dryRun,
  });

  if (shouldCleanup) {
    try {
      const cleanup = await cleanupOldProductCollections({
        client: typesenseAdmin,
        aliasName: PRODUCT_COLLECTION_ALIAS,
        expectedAliasTarget: targetCollection,
        minCompleteDocuments: MIN_REINDEX_RECORDS,
        mode: "post-success",
        cleanupEnabled,
        dryRun,
      });
      cleanupWarnings = cleanup.warnings;
    } catch {
      const warning = "[Typesense cleanup] unexpected cleanup failure; completed reindex remains live.";
      console.warn(warning);
      cleanupWarnings = [warning];
    }
  }

  const payload = await saveReindexStatus({
    status: "success",
    started_at: startedAt,
    finished_at: Date.now(),
    live_alias: PRODUCT_COLLECTION_ALIAS,
    previous_collection: previousAlias?.collection_name || "",
    target_collection: targetCollection,
    total_records: products.length,
    indexed_records: Number(collection.num_documents || 0),
    failed_count: 0,
    min_records: MIN_REINDEX_RECORDS,
    alias_swapped: true,
    cleanup_warnings: cleanupWarnings,
    ms: Date.now() - startedAt,
  });

  return NextResponse.json({
    ...payload,
    collection: targetCollection,
  });
  } catch (error) {
    const cleanupWarnings: string[] = [];
    if (targetCollectionCreated) await cleanupFailedTargetCollection(targetCollection, cleanupWarnings);
    const payload = await saveReindexStatus({
      status: "failed",
      started_at: startedAt,
      finished_at: Date.now(),
      live_alias: PRODUCT_COLLECTION_ALIAS,
      target_collection: targetCollection,
      min_records: MIN_REINDEX_RECORDS,
      error: error instanceof Error ? error.message : "Unexpected reindex error.",
      cleanup_warnings: cleanupWarnings,
      ms: Date.now() - startedAt,
    });

    return NextResponse.json(payload, { status: 500 });
  }
}

async function runReindex() {
  const lock = await acquireReindexLock({ client: typesenseAdmin, ensureCollection: ensureReindexStatusCollection });
  if (!lock.acquired || !lock.token) {
    return NextResponse.json({ error: "A reindex is already running." }, { status: 409 });
  }

  try {
    return await runReindexWithLock();
  } finally {
    await releaseReindexLock({ client: typesenseAdmin, token: lock.token });
  }
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const hasCronSecret = Boolean(
    process.env.CRON_SECRET &&
      authHeader === `Bearer ${process.env.CRON_SECRET}`
  );

  if (!hasCronSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return runReindex();
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

  return runReindex();
}
