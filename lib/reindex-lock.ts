const LOCK_DOCUMENT_ID = "reindex_lock";
const LOCK_TTL_MS = 10 * 60 * 1000;

type LockDocument = { config_json?: string };

export type ReindexLockClient = {
  collections: (name: string) => any;
};

export type ReindexLock = { acquired: boolean; token?: string };

function lockPayload(token: string, now: number) {
  return {
    token,
    expiresAt: now + LOCK_TTL_MS,
  };
}

function parseLock(document: LockDocument) {
  try {
    const payload = JSON.parse(String(document.config_json || "{}"));
    return {
      token: String(payload.token || ""),
      expiresAt: Number(payload.expiresAt || 0),
    };
  } catch {
    return { token: "", expiresAt: 0 };
  }
}

async function tryCreateLock(client: ReindexLockClient, token: string, now: number) {
  await client.collections("emrn_search_controls").documents().create({
    id: LOCK_DOCUMENT_ID,
    config_json: JSON.stringify(lockPayload(token, now)),
    updated_at: now,
  });
}

export async function acquireReindexLock({
  client,
  now = Date.now(),
  token = crypto.randomUUID(),
  ensureCollection = async () => {},
}: {
  client: ReindexLockClient;
  now?: number;
  token?: string;
  ensureCollection?: () => Promise<void>;
}): Promise<ReindexLock> {
  await ensureCollection();

  try {
    await tryCreateLock(client, token, now);
    return { acquired: true, token };
  } catch {
    // A duplicate document means a reindex is active. Only expired locks may
    // be replaced, and the final create remains the atomic winner check.
    let existing: LockDocument;
    try {
      existing = await client.collections("emrn_search_controls").documents(LOCK_DOCUMENT_ID).retrieve();
    } catch {
      return { acquired: false };
    }

    const lock = parseLock(existing);
    if (!lock.expiresAt || lock.expiresAt > now) return { acquired: false };

    try {
      await client.collections("emrn_search_controls").documents(LOCK_DOCUMENT_ID).delete();
      await tryCreateLock(client, token, now);
      return { acquired: true, token };
    } catch {
      return { acquired: false };
    }
  }
}

export async function releaseReindexLock({
  client,
  token,
}: {
  client: ReindexLockClient;
  token: string;
}) {
  try {
    const existing = await client.collections("emrn_search_controls").documents(LOCK_DOCUMENT_ID).retrieve();
    if (parseLock(existing).token !== token) return false;
    await client.collections("emrn_search_controls").documents(LOCK_DOCUMENT_ID).delete();
    return true;
  } catch {
    return false;
  }
}
