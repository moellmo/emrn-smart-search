import assert from "node:assert/strict";
import test from "node:test";
import { INTERRUPTED_REINDEX_MESSAGE, reconcileStaleReindexStatus } from "./reindex-status-state";

const running = { status: "running" as const, started_at: 100 };

test("missing or expired locks mark a running status interrupted", () => {
  for (const lock of [{ checked: true, active: false }, { checked: true, active: false }]) {
    const result = reconcileStaleReindexStatus({ status: running, lock, now: 200 });
    assert.equal(result.interrupted, true);
    assert.equal(result.status?.status, "failed");
    assert.equal(result.status?.error, INTERRUPTED_REINDEX_MESSAGE);
    assert.equal(result.status?.finished_at, 200);
  }
});

test("a valid active lock keeps running status active", () => {
  const result = reconcileStaleReindexStatus({ status: running, lock: { checked: true, active: true }, now: 200 });
  assert.equal(result.interrupted, false);
  assert.equal(result.status?.status, "running");
});

test("timeout, OOM, and unexpected failures remain failed", () => {
  for (const error of ["Request timed out", "OUT_OF_MEMORY", "Unexpected reindex error."]) {
    const result = reconcileStaleReindexStatus({
      status: { status: "failed", error },
      lock: { checked: true, active: false },
      now: 200,
    });
    assert.equal(result.interrupted, false);
    assert.equal(result.status?.error, error);
  }
});
