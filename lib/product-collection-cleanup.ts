export const VERSIONED_PRODUCT_COLLECTION_PATTERN = /^emrn_products_(\d{8})_(\d{6})_(\d{3})$/;

type CollectionInfo = { name?: string; num_documents?: number };
type ProductAlias = { collection_name?: string };

export type ProductCollectionCleanupClient = {
  collections: {
    (): { retrieve: () => Promise<CollectionInfo[]> };
    (name: string): { delete: () => Promise<unknown> };
  };
  aliases: (name: string) => { retrieve: () => Promise<ProductAlias> };
};

type CleanupLog = (message: string) => void;

export type ProductCollectionCleanupResult = {
  protectedCollections: string[];
  candidates: string[];
  deleted: string[];
  warnings: string[];
  skipped: boolean;
};

export type FailedProductCollectionCleanupResult = {
  deleted: boolean;
  warnings: string[];
};

export type ProductCollectionCleanupMode = "preflight" | "post-success";

function isVersionedProductCollection(name: string) {
  return VERSIONED_PRODUCT_COLLECTION_PATTERN.test(name);
}

function emptyCleanupResult(skipped = false): ProductCollectionCleanupResult {
  return { protectedCollections: [], candidates: [], deleted: [], warnings: [], skipped };
}

export function shouldRunProductCollectionCleanup({
  reindexSucceeded,
  aliasConfirmed,
  cleanupEnabled,
  dryRun,
}: {
  reindexSucceeded: boolean;
  aliasConfirmed: boolean;
  cleanupEnabled: boolean;
  dryRun: boolean;
}) {
  return reindexSucceeded && aliasConfirmed && (cleanupEnabled || dryRun);
}

export async function cleanupOldProductCollections({
  client,
  aliasName,
  expectedAliasTarget,
  minCompleteDocuments,
  mode = "post-success",
  cleanupEnabled,
  dryRun,
  log = console.log,
}: {
  client: ProductCollectionCleanupClient;
  aliasName: string;
  expectedAliasTarget: string;
  minCompleteDocuments: number;
  mode?: ProductCollectionCleanupMode;
  cleanupEnabled: boolean;
  dryRun: boolean;
  log?: CleanupLog;
}): Promise<ProductCollectionCleanupResult> {
  if (!cleanupEnabled && !dryRun) {
    log("[Typesense cleanup] disabled; no collections inspected or deleted.");
    return emptyCleanupResult(true);
  }

  const result = emptyCleanupResult();
  let collections: CollectionInfo[];
  let alias: ProductAlias;

  try {
    collections = await client.collections().retrieve();
    alias = await client.aliases(aliasName).retrieve();
  } catch {
    const warning = "[Typesense cleanup] skipped because collections or the production alias could not be read.";
    log(warning);
    result.warnings.push(warning);
    result.skipped = true;
    return result;
  }

  const liveTarget = String(alias.collection_name || "");
  if (!liveTarget || liveTarget !== expectedAliasTarget) {
    const warning = "[Typesense cleanup] skipped because the production alias no longer points to the verified target.";
    log(warning);
    result.warnings.push(warning);
    result.skipped = true;
    return result;
  }

  const datedCollections = collections
    .map((collection) => ({
      name: String(collection.name || ""),
      documents: Number(collection.num_documents || 0),
    }))
    .filter((collection) => isVersionedProductCollection(collection.name))
    .sort((a, b) => b.name.localeCompare(a.name));

  // Keep the live target plus one complete previous collection. Incomplete
  // dated collections are never rollback copies and can be cleaned safely.
  const protectedSet = new Set<string>([
    liveTarget,
    ...datedCollections
      .filter((collection) => collection.name !== liveTarget && collection.documents >= minCompleteDocuments)
      .slice(0, 1)
      .map((collection) => collection.name),
  ]);
  result.protectedCollections = Array.from(protectedSet);
  result.candidates = datedCollections
    .map((collection) => collection.name)
    .filter((name) => !protectedSet.has(name));

  log(JSON.stringify({
    event: "typesense_collection_cleanup_summary",
    cleanupEnabled,
    dryRun,
    mode,
    currentAliasTarget: liveTarget,
    protectedCollections: result.protectedCollections,
    candidateCollections: result.candidates,
    totalDatedCollections: datedCollections.length,
    protectedCount: result.protectedCollections.length,
    candidateCount: result.candidates.length,
  }));
  log(`[Typesense cleanup] protected: ${result.protectedCollections.join(", ") || "none"}`);
  log(`[Typesense cleanup] candidates: ${result.candidates.join(", ") || "none"}`);

  if (dryRun) {
    for (const name of result.candidates) log(`[Typesense cleanup] dry run: would delete ${name}`);
    return result;
  }

  for (const name of result.candidates) {
    try {
      await client.collections(name).delete();
      result.deleted.push(name);
      log(`[Typesense cleanup] deleted ${name}`);
    } catch {
      const warning = `[Typesense cleanup] failed to delete ${name}; stopping further cleanup.`;
      log(warning);
      result.warnings.push(warning);
      break;
    }
  }

  return result;
}

export async function cleanupFailedProductCollection({
  client,
  aliasName,
  targetCollection,
  log = console.log,
}: {
  client: ProductCollectionCleanupClient;
  aliasName: string;
  targetCollection: string;
  log?: CleanupLog;
}): Promise<FailedProductCollectionCleanupResult> {
  try {
    const alias = await client.aliases(aliasName).retrieve();
    const liveTarget = String(alias.collection_name || "");
    if (!liveTarget) {
      const warning = "[Typesense cleanup] failed collection was retained because the production alias could not be confirmed.";
      log(warning);
      return { deleted: false, warnings: [warning] };
    }
    if (liveTarget === targetCollection) {
      const warning = "[Typesense cleanup] failed collection was retained because it is the live alias target.";
      log(warning);
      return { deleted: false, warnings: [warning] };
    }
    await client.collections(targetCollection).delete();
    log(`[Typesense cleanup] deleted failed staged collection ${targetCollection}`);
    return { deleted: true, warnings: [] };
  } catch {
    const warning = "[Typesense cleanup] failed collection was retained because the production alias could not be confirmed.";
    log(warning);
    return { deleted: false, warnings: [warning] };
  }
}
