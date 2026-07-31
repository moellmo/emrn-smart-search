export type ReindexStatusState = {
  status?: "running" | "success" | "failed";
  started_at?: number;
  finished_at?: number;
  error?: string;
  interrupted?: boolean;
  ms?: number;
  [key: string]: unknown;
};

export type ReindexLockSnapshot = {
  checked: boolean;
  active: boolean;
};

export const INTERRUPTED_REINDEX_MESSAGE = "Previous reindex was interrupted and is no longer running.";

export function reconcileStaleReindexStatus({
  status,
  lock,
  now = Date.now(),
}: {
  status: ReindexStatusState | null;
  lock: ReindexLockSnapshot;
  now?: number;
}) {
  if (!status || status.status !== "running" || !lock.checked || lock.active) {
    return { status, interrupted: false };
  }

  const startedAt = Number(status.started_at || now);
  return {
    interrupted: true,
    status: {
      ...status,
      status: "failed" as const,
      interrupted: true,
      finished_at: now,
      error: INTERRUPTED_REINDEX_MESSAGE,
      ms: Math.max(0, now - startedAt),
    },
  };
}
