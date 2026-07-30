export const VERSIONED_PRODUCT_COLLECTION_PATTERN = /^emrn_products_(\d{8})_(\d{6})_(\d{3})$/;

type CollectionInfo = { name?: string };
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
  cleanupEnabled,
  dryRun,
  log = console.log,
}: {
  client: ProductCollectionCleanupClient;
  aliasName: string;
  expectedAliasTarget: string;
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
    .map((collection) => String(collection.name || ""))
    .filter(isVersionedProductCollection)
    .sort((a, b) => b.localeCompare(a));

  // Always protect the current live target, then retain the two most recent
  // other dated collections as rollback points.
  const protectedSet = new Set<string>([
    liveTarget,
    ...datedCollections.filter((name) => name !== liveTarget).slice(0, 2),
  ]);
  result.protectedCollections = Array.from(protectedSet);
  result.candidates = datedCollections.filter((name) => !protectedSet.has(name));

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
