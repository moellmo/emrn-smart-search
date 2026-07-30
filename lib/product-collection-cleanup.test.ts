import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanupOldProductCollections,
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
  aliasTarget = live,
  failDelete = "",
}: {
  collectionNames?: string[];
  aliasTarget?: string;
  failDelete?: string;
} = {}) {
  const deleted: string[] = [];
  const logs: string[] = [];
  const client: ProductCollectionCleanupClient = {
    collections: ((name?: string) => {
      if (!name) return { retrieve: async () => collectionNames.map((collectionName) => ({ name: collectionName })) };
      return {
        delete: async () => {
          if (name === failDelete) throw new Error("delete failed");
          deleted.push(name);
        },
      };
    }) as ProductCollectionCleanupClient["collections"],
    aliases: () => ({ retrieve: async () => ({ collection_name: aliasTarget }) }),
  };
  return { client, deleted, logs };
}

async function run(options: Parameters<typeof clientFor>[0] = {}, extra: { dryRun?: boolean } = {}) {
  const fake = clientFor(options);
  const result = await cleanupOldProductCollections({
    client: fake.client,
    aliasName,
    expectedAliasTarget: options?.aliasTarget || live,
    cleanupEnabled: true,
    dryRun: extra.dryRun || false,
    log: (message) => fake.logs.push(message),
  });
  return { ...fake, result };
}

test("successful cleanup retains the current and previous two dated collections", async () => {
  const { deleted, result } = await run();
  assert.deepEqual(result.protectedCollections, dated.slice(0, 3));
  assert.deepEqual(deleted, dated.slice(3));
});

test("the current alias target stays protected even when it is not one of the newest timestamps", async () => {
  const current = "emrn_products_20260720_070011_366";
  const { result } = await run({ collectionNames: [current, ...dated], aliasTarget: current });
  assert.ok(result.protectedCollections.includes(current));
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
  assert.deepEqual(result.candidates, dated.slice(3));
  const summary = JSON.parse(logs.find((message) => message.includes("typesense_collection_cleanup_summary")) || "{}");
  assert.deepEqual(summary, {
    event: "typesense_collection_cleanup_summary",
    cleanupEnabled: true,
    dryRun: true,
    currentAliasTarget: live,
    protectedCollections: dated.slice(0, 3),
    candidateCollections: dated.slice(3),
    totalDatedCollections: 5,
    protectedCount: 3,
    candidateCount: 2,
  });
  assert.ok(logs.some((message) => message.includes("would delete")));
});

test("a deletion failure is logged and stops further cleanup", async () => {
  const { deleted, result, logs } = await run({ failDelete: dated[3] });
  assert.deepEqual(deleted, []);
  assert.equal(result.warnings.length, 1);
  assert.ok(logs.some((message) => message.includes("stopping further cleanup")));
});
