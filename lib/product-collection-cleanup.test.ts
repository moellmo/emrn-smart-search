import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupOldProductCollections,
  cleanupFailedProductCollection,
  shouldRunProductCollectionCleanup,
  type ProductCollectionCleanupClient,
} from "./product-collection-cleanup";

const aliasName = "emrn_products_live";
const live = "emrn_products_20260730_070011_366";
const dated = [
  live,
  "emrn_products_20260729_070011_366",
  "emrn_products_20260728_070011_366",
  "emrn_products_20260727_070011_366",
  "emrn_products_20260726_070011_366",
];

function clientFor({
  collectionNames = dated,
  documentCounts = {},
  aliasTarget = live,
  failDelete = "",
  failAlias = false,
}: {
  collectionNames?: string[];
  documentCounts?: Record<string, number>;
  aliasTarget?: string;
  failDelete?: string;
  failAlias?: boolean;
} = {}) {
  const deleted: string[] = [];
  const logs: string[] = [];
  const client: ProductCollectionCleanupClient = {
    collections: ((name?: string) => {
      if (!name) return { retrieve: async () => collectionNames.map((collectionName) => ({ name: collectionName, num_documents: documentCounts[collectionName] ?? 22787 })) };
      return {
        delete: async () => {
          if (name === failDelete) throw new Error("delete failed");
          deleted.push(name);
        },
      };
    }) as ProductCollectionCleanupClient["collections"],
    aliases: () => ({ retrieve: async () => {
      if (failAlias) throw new Error("alias unavailable");
      return { collection_name: aliasTarget };
    } }),
  };
  return { client, deleted, logs };
}

async function run(options: Parameters<typeof clientFor>[0] = {}, extra: { dryRun?: boolean } = {}) {
  const fake = clientFor(options);
  const result = await cleanupOldProductCollections({
    client: fake.client,
    aliasName,
    expectedAliasTarget: options?.aliasTarget || live,
    minCompleteDocuments: 20000,
    cleanupEnabled: true,
    dryRun: extra.dryRun || false,
    log: (message) => fake.logs.push(message),
  });
  return { ...fake, result };
}

test("successful cleanup retains the current and one previous complete dated collection", async () => {
  const { deleted, result } = await run();
  assert.deepEqual(result.protectedCollections, dated.slice(0, 2));
  assert.deepEqual(deleted, dated.slice(2));
});

test("the current alias target stays protected even when it is not one of the newest timestamps", async () => {
  const current = "emrn_products_20260720_070011_366";
  const { result } = await run({ collectionNames: [current, ...dated], aliasTarget: current });
  assert.ok(result.protectedCollections.includes(current));
});

test("incomplete dated collections are not retained as the rollback copy", async () => {
  const incomplete = dated[1];
  const { deleted, result } = await run({ documentCounts: { [incomplete]: 100 } });
  assert.deepEqual(result.protectedCollections, [live, dated[2]]);
  assert.ok(deleted.includes(incomplete));
});

test("preflight cleanup retains the live target plus one complete rollback", async () => {
  const fake = clientFor();
  const result = await cleanupOldProductCollections({
    client: fake.client,
    aliasName,
    expectedAliasTarget: live,
    minCompleteDocuments: 20000,
    mode: "preflight",
    cleanupEnabled: true,
    dryRun: false,
  });
  assert.deepEqual(result.protectedCollections, dated.slice(0, 2));
  assert.deepEqual(fake.deleted, dated.slice(2));
});

test("successful alias switching retains the previous live collection as rollback", async () => {
  const newLive = "emrn_products_20260731_070011_366";
  const fake = clientFor({ collectionNames: [newLive, ...dated], aliasTarget: newLive });
  const result = await cleanupOldProductCollections({
    client: fake.client,
    aliasName,
    expectedAliasTarget: newLive,
    minCompleteDocuments: 20000,
    mode: "post-success",
    cleanupEnabled: true,
    dryRun: false,
  });
  assert.deepEqual(result.protectedCollections, [newLive, live]);
  assert.ok(!fake.deleted.includes(live));
});

test("alias uncertainty aborts cleanup without deleting collections", async () => {
  const fake = clientFor({ failAlias: true });
  const result = await cleanupOldProductCollections({
    client: fake.client,
    aliasName,
    expectedAliasTarget: live,
    minCompleteDocuments: 20000,
    cleanupEnabled: true,
    dryRun: false,
  });
  assert.equal(result.skipped, true);
  assert.deepEqual(fake.deleted, []);
});

test("failed staged collections are deleted only after confirming they are not live", async () => {
  const staged = "emrn_products_20260731_120000_000";
  const safe = clientFor({ aliasTarget: live });
  const removed = await cleanupFailedProductCollection({ client: safe.client, aliasName, targetCollection: staged });
  assert.equal(removed.deleted, true);
  assert.deepEqual(safe.deleted, [staged]);

  const liveTarget = clientFor({ aliasTarget: staged });
  const retained = await cleanupFailedProductCollection({ client: liveTarget.client, aliasName, targetCollection: staged });
  assert.equal(retained.deleted, false);
  assert.deepEqual(liveTarget.deleted, []);
});

test("failed reindex or alias confirmation never starts cleanup", () => {
  assert.equal(shouldRunProductCollectionCleanup({ reindexSucceeded: false, aliasConfirmed: true, cleanupEnabled: true, dryRun: false }), false);
  assert.equal(shouldRunProductCollectionCleanup({ reindexSucceeded: true, aliasConfirmed: false, cleanupEnabled: true, dryRun: false }), false);
  assert.equal(shouldRunProductCollectionCleanup({ reindexSucceeded: true, aliasConfirmed: true, cleanupEnabled: false, dryRun: false }), false);
});

test("analytics, controls, plain products, and malformed collection names are never candidates", async () => {
  const { result } = await run({
    collectionNames: [...dated, "emrn_search_analytics", "emrn_search_controls", "emrn_products", "emrn_products_20260730_bad", "other_collection"],
  });
  assert.ok(result.candidates.every((name) => name.startsWith("emrn_products_20")));
  assert.ok(!result.candidates.includes("emrn_products"));
});

test("dry run identifies candidates without deleting", async () => {
  const { deleted, result, logs } = await run({}, { dryRun: true });
  assert.deepEqual(deleted, []);
  assert.deepEqual(result.candidates, dated.slice(2));
  const summary = JSON.parse(logs.find((message) => message.includes("typesense_collection_cleanup_summary")) || "{}");
  assert.deepEqual(summary, {
    event: "typesense_collection_cleanup_summary",
    cleanupEnabled: true,
    dryRun: true,
    currentAliasTarget: live,
    mode: "post-success",
    protectedCollections: dated.slice(0, 2),
    candidateCollections: dated.slice(2),
    totalDatedCollections: 5,
    protectedCount: 2,
    candidateCount: 3,
  });
  assert.ok(logs.some((message) => message.includes("would delete")));
});

test("a deletion failure is logged and stops further cleanup", async () => {
  const { deleted, result, logs } = await run({ failDelete: dated[2] });
  assert.deepEqual(deleted, []);
  assert.equal(result.warnings.length, 1);
  assert.ok(logs.some((message) => message.includes("stopping further cleanup")));
});
