export type AliasResponse = {
  name?: string;
  collection_name?: string;
  message?: string;
};

export type AliasPutResult = { status: number; body: AliasResponse };
export type AliasReadResult = { status: number; body: AliasResponse };

export type AliasSwitchTransport = {
  putAlias: (aliasName: string, collectionName: string) => Promise<AliasPutResult>;
  readAlias: (aliasName: string) => Promise<AliasReadResult>;
};

export type AliasSwitchLog = (entry: Record<string, unknown>) => void;

export type AliasSwitchResult =
  | { state: "confirmed"; attempts: number }
  | { state: "rejected"; attempts: number; put: AliasPutResult }
  | { state: "ambiguous"; attempts: number; reason: string }
  | { state: "rolled_back"; attempts: number; reason: string }
  | { state: "rollback_failed"; attempts: number; reason: string };

// Initial read happens immediately. The retry delays total 10 seconds, which
// gives a load-balanced HA cluster time to converge without reissuing the PUT.
const DEFAULT_READBACK_DELAYS_MS = [0, 250, 500, 750, 1_000, 1_500, 2_000, 2_000, 2_000];

function safeAliasBody(value: unknown): AliasResponse {
  if (!value || typeof value !== "object") return {};
  const body = value as Record<string, unknown>;
  const get = (field: "name" | "collection_name" | "message") =>
    typeof body[field] === "string" ? body[field] : undefined;
  return { name: get("name"), collection_name: get("collection_name"), message: get("message") };
}

function logAliasEvent(log: AliasSwitchLog, entry: Record<string, unknown>) {
  log({ event: "typesense_alias_switch", ...entry });
}

function wait(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * A one-off stale read is not evidence that an alias PUT failed. This waits
 * through a short bounded confirmation window before considering rollback.
 */
export async function switchAliasAfterValidation({
  transport,
  aliasName,
  targetCollection,
  previousCollection,
  readbackDelaysMs = DEFAULT_READBACK_DELAYS_MS,
  waitForReadback = wait,
  log = (entry) => console.log(JSON.stringify(entry)),
}: {
  transport: AliasSwitchTransport;
  aliasName: string;
  targetCollection: string;
  previousCollection: string;
  readbackDelaysMs?: number[];
  waitForReadback?: (ms: number) => Promise<void>;
  log?: AliasSwitchLog;
}): Promise<AliasSwitchResult> {
  let put: AliasPutResult;
  try {
    put = await transport.putAlias(aliasName, targetCollection);
  } catch {
    logAliasEvent(log, { phase: "put", aliasName, targetCollection, outcome: "network_error" });
    return { state: "ambiguous", attempts: 0, reason: "alias PUT could not be completed" };
  }

  logAliasEvent(log, { phase: "put", aliasName, targetCollection, status: put.status, response: put.body });
  if (put.status < 200 || put.status >= 300 || put.body.collection_name !== targetCollection) {
    return { state: "rejected", attempts: 0, put };
  }

  const confirmedWrongTargets: string[] = [];
  let sawReadError = false;
  for (let index = 0; index < readbackDelaysMs.length; index += 1) {
    const delayMs = readbackDelaysMs[index];
    if (delayMs > 0) await waitForReadback(delayMs);
    try {
      const readback = await transport.readAlias(aliasName);
      const collectionName = readback.body.collection_name || "";
      logAliasEvent(log, {
        phase: "readback", aliasName, targetCollection, attempt: index + 1,
        status: readback.status, response: readback.body,
      });
      if (readback.status >= 200 && readback.status < 300 && collectionName === targetCollection) {
        return { state: "confirmed", attempts: index + 1 };
      }
      if (readback.status >= 200 && readback.status < 300 && collectionName) confirmedWrongTargets.push(collectionName);
      else sawReadError = true;
    } catch {
      sawReadError = true;
      logAliasEvent(log, { phase: "readback", aliasName, targetCollection, attempt: index + 1, outcome: "network_error" });
    }
  }

  const uniqueWrongTargets = [...new Set(confirmedWrongTargets)];
  const repeatedlyConfirmedWrong = !sawReadError
    && uniqueWrongTargets.length === 1
    && confirmedWrongTargets.length === readbackDelaysMs.length;
  if (!repeatedlyConfirmedWrong || !previousCollection) {
    return { state: "ambiguous", attempts: readbackDelaysMs.length, reason: "alias readback did not consistently confirm either target" };
  }

  logAliasEvent(log, {
    phase: "rollback", aliasName, targetCollection, previousCollection,
    reason: "readback repeatedly confirmed a different target", confirmedWrongTarget: uniqueWrongTargets[0],
  });
  try {
    const rollback = await transport.putAlias(aliasName, previousCollection);
    logAliasEvent(log, {
      phase: "rollback", aliasName, targetCollection, previousCollection,
      status: rollback.status, response: rollback.body,
    });
    if (rollback.status >= 200 && rollback.status < 300 && rollback.body.collection_name === previousCollection) {
      return { state: "rolled_back", attempts: readbackDelaysMs.length, reason: "alias repeatedly confirmed the wrong target" };
    }
  } catch {
    logAliasEvent(log, { phase: "rollback", aliasName, targetCollection, previousCollection, outcome: "network_error" });
  }
  return { state: "rollback_failed", attempts: readbackDelaysMs.length, reason: "confirmed wrong target could not be restored" };
}

export function createTypesenseAliasSwitchTransport(): AliasSwitchTransport {
  const protocol = process.env.TYPESENSE_PROTOCOL || "https";
  const host = process.env.TYPESENSE_HOST;
  const port = process.env.TYPESENSE_PORT || "443";
  const apiKey = process.env.TYPESENSE_ADMIN_API_KEY;
  if (!host || !apiKey) throw new Error("Typesense alias transport is not configured.");

  const request = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${protocol}://${host}:${port}${path}`, {
      ...init,
      headers: { "X-TYPESENSE-API-KEY": apiKey, "Content-Type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(5_000),
    });
    const raw = await response.text();
    let body: unknown = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = { message: "Typesense returned a non-JSON alias response." }; }
    return { status: response.status, body: safeAliasBody(body) };
  };

  return {
    putAlias: (aliasName, collectionName) => request(`/aliases/${encodeURIComponent(aliasName)}`, {
      method: "PUT", body: JSON.stringify({ collection_name: collectionName }),
    }),
    readAlias: (aliasName) => request(`/aliases/${encodeURIComponent(aliasName)}`),
  };
}
