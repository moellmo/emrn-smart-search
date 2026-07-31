import assert from "node:assert/strict";
import test from "node:test";
import { acquireReindexLock, getReindexLockState, releaseReindexLock, removeExpiredReindexLock, type ReindexLockClient } from "./reindex-lock";

function clientFor(initialConfig = "") {
  let config = initialConfig;
  const client: ReindexLockClient = {
    collections: () => ({
      documents: () => ({
        create: async (document) => {
          if (config) throw new Error("already exists");
          config = String(document.config_json || "");
        },
        retrieve: async () => {
          if (!config) throw new Error("not found");
          return { config_json: config };
        },
        delete: async () => {
          if (!config) throw new Error("not found");
          config = "";
        },
      }),
    }),
  };
  return { client, config: () => config };
}

test("overlapping reindex is rejected while a valid lock exists", async () => {
  const fake = clientFor();
  const first = await acquireReindexLock({ client: fake.client, token: "first", now: 100, ensureCollection: async () => {} });
  const second = await acquireReindexLock({ client: fake.client, token: "second", now: 101, ensureCollection: async () => {} });
  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
});

test("only the lock owner can release the lock", async () => {
  const fake = clientFor();
  await acquireReindexLock({ client: fake.client, token: "owner", now: 100, ensureCollection: async () => {} });
  assert.equal(await releaseReindexLock({ client: fake.client, token: "other" }), false);
  assert.equal(await releaseReindexLock({ client: fake.client, token: "owner" }), true);
  assert.equal(fake.config(), "");
});

test("expired locks can be removed while valid locks are preserved", async () => {
  const fake = clientFor(JSON.stringify({ token: "expired", acquiredAt: 1, expiresAt: 2 }));
  const expired = await getReindexLockState({ client: fake.client, now: 3 });
  assert.equal(expired.active, false);
  assert.equal(await removeExpiredReindexLock({ client: fake.client, now: 3 }), true);
  assert.equal(fake.config(), "");

  const active = clientFor(JSON.stringify({ token: "active", acquiredAt: 1, expiresAt: 10 }));
  assert.equal(await removeExpiredReindexLock({ client: active.client, now: 3 }), false);
  assert.notEqual(active.config(), "");
});
