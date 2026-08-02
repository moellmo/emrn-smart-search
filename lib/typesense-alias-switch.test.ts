import assert from "node:assert/strict";
import test from "node:test";
import { switchAliasAfterValidation, type AliasSwitchTransport } from "./typesense-alias-switch";

const alias = "emrn_products_live";
const previous = "emrn_products_20260731_120729_417";
const target = "emrn_products_20260801_070020_551";

function transportFor({
  put = [{ status: 200, body: { name: alias, collection_name: target } }],
  reads = [{ status: 200, body: { name: alias, collection_name: target } }],
}: {
  put?: Array<{ status: number; body: { name?: string; collection_name?: string; message?: string } }>;
  reads?: Array<{ status: number; body: { name?: string; collection_name?: string; message?: string } | Error }>;
} = {}) {
  const putCalls: Array<{ aliasName: string; collectionName: string }> = [];
  let putIndex = 0;
  let readIndex = 0;
  const client: AliasSwitchTransport = {
    putAlias: async (aliasName, collectionName) => {
      putCalls.push({ aliasName, collectionName });
      return put[Math.min(putIndex++, put.length - 1)];
    },
    readAlias: async () => {
      const next = reads[Math.min(readIndex++, reads.length - 1)];
      if (next.body instanceof Error) throw next.body;
      return { status: next.status, body: next.body };
    },
  };
  return { client, putCalls };
}

function run(client: AliasSwitchTransport) {
  return switchAliasAfterValidation({
    transport: client,
    aliasName: alias,
    targetCollection: target,
    previousCollection: previous,
    readbackDelaysMs: [0, 0, 0],
    waitForReadback: async () => {},
    log: () => {},
  });
}

test("accepts a successful alias PUT and confirmed readback", async () => {
  const fake = transportFor();
  assert.deepEqual(await run(fake.client), { state: "confirmed", attempts: 1 });
  assert.deepEqual(fake.putCalls, [{ aliasName: alias, collectionName: target }]);
});

test("reports a rejected alias PUT without attempting rollback", async () => {
  const fake = transportFor({ put: [{ status: 403, body: { message: "forbidden" } }] });
  assert.equal((await run(fake.client)).state, "rejected");
  assert.equal(fake.putCalls.length, 1);
});

test("waits through stale readback before accepting the new target", async () => {
  const fake = transportFor({
    reads: [
      { status: 200, body: { collection_name: previous } },
      { status: 200, body: { collection_name: target } },
    ],
  });
  assert.deepEqual(await run(fake.client), { state: "confirmed", attempts: 2 });
  assert.equal(fake.putCalls.length, 1);
});

test("accepts confirmation near the end of the full ten-second verification window", async () => {
  const fake = transportFor({
    reads: [
      ...Array.from({ length: 8 }, () => ({ status: 200, body: { collection_name: previous } })),
      { status: 200, body: { collection_name: target } },
    ],
  });
  const result = await switchAliasAfterValidation({
    transport: fake.client,
    aliasName: alias,
    targetCollection: target,
    previousCollection: previous,
    waitForReadback: async () => {},
    log: () => {},
  });
  assert.deepEqual(result, { state: "confirmed", attempts: 9 });
  assert.equal(fake.putCalls.length, 1);
});

test("waits through a temporary readback network failure", async () => {
  const fake = transportFor({
    reads: [
      { status: 0, body: new Error("temporary network failure") },
      { status: 200, body: { collection_name: target } },
    ],
  });
  assert.deepEqual(await run(fake.client), { state: "confirmed", attempts: 2 });
  assert.equal(fake.putCalls.length, 1);
});

test("rolls back only after every readback confidently confirms one wrong target", async () => {
  const fake = transportFor({
    put: [
      { status: 200, body: { collection_name: target } },
      { status: 200, body: { collection_name: previous } },
    ],
    reads: Array.from({ length: 3 }, () => ({ status: 200, body: { collection_name: previous } })),
  });
  assert.deepEqual(await run(fake.client), {
    state: "rolled_back", attempts: 3, reason: "alias repeatedly confirmed the wrong target",
  });
  assert.deepEqual(fake.putCalls.map((call) => call.collectionName), [target, previous]);
});

test("does not prematurely roll back ambiguous readback", async () => {
  const fake = transportFor({
    reads: [
      { status: 200, body: { collection_name: previous } },
      { status: 0, body: new Error("network failure") },
      { status: 200, body: { collection_name: previous } },
    ],
  });
  assert.equal((await run(fake.client)).state, "ambiguous");
  assert.equal(fake.putCalls.length, 1);
});
