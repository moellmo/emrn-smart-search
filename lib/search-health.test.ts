import assert from "node:assert/strict";
import test from "node:test";
import { checkSearchHealth } from "./search-health";

test("returns a healthy status with response time when Typesense returns hits", async () => {
  const clock = [100, 142];
  const result = await checkSearchHealth({
    search: async () => ({ hits: [] }),
    now: () => clock.shift() ?? 142,
  });

  assert.deepEqual(result, { ok: true, responseTimeMs: 42 });
});

test("returns unhealthy when Typesense does not respond before the timeout", async () => {
  const result = await checkSearchHealth({
    search: () => new Promise(() => undefined),
    timeoutMs: 5,
  });

  assert.deepEqual(result, { ok: false });
});

test("returns unhealthy when Typesense rejects", async () => {
  const result = await checkSearchHealth({
    search: async () => {
      throw new Error("Typesense unavailable");
    },
  });

  assert.deepEqual(result, { ok: false });
});

test("returns unhealthy when Typesense returns an invalid response", async () => {
  const result = await checkSearchHealth({
    search: async () => ({ found: 1 }),
  });

  assert.deepEqual(result, { ok: false });
});
