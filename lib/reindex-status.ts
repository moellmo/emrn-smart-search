import { typesenseAdmin } from "./typesense";

const STATUS_COLLECTION = "emrn_search_controls";
const STATUS_DOC_ID = "reindex_status";

export type ReindexStatus = {
  ok: boolean;
  status: "running" | "success" | "failed";
  started_at: number;
  finished_at: number;
  live_alias: string;
  target_collection: string;
  previous_collection: string;
  total_records: number;
  indexed_records: number;
  failed_count: number;
  min_records: number;
  alias_swapped: boolean;
  cleanup_warnings: string[];
  error: string;
  ms: number;
};

export type ReindexStatusUpdate = Partial<ReindexStatus> &
  Pick<ReindexStatus, "status" | "started_at" | "live_alias" | "target_collection">;

export async function ensureReindexStatusCollection() {
  try {
    await typesenseAdmin.collections(STATUS_COLLECTION).retrieve();
  } catch {
    await typesenseAdmin.collections().create({
      name: STATUS_COLLECTION,
      fields: [
        { name: "id", type: "string" },
        { name: "config_json", type: "string" },
        { name: "updated_at", type: "int64" },
      ],
    });
  }
}

export async function saveReindexStatus(update: ReindexStatusUpdate) {
  await ensureReindexStatusCollection();

  const status: ReindexStatus = {
    ok: update.status === "success",
    status: update.status,
    started_at: update.started_at,
    finished_at: update.finished_at || 0,
    live_alias: update.live_alias,
    target_collection: update.target_collection,
    previous_collection: update.previous_collection || "",
    total_records: update.total_records || 0,
    indexed_records: update.indexed_records || 0,
    failed_count: update.failed_count || 0,
    min_records: update.min_records || 0,
    alias_swapped: update.alias_swapped || false,
    cleanup_warnings: update.cleanup_warnings || [],
    error: update.error || "",
    ms: update.ms || 0,
  };

  await typesenseAdmin.collections(STATUS_COLLECTION).documents().upsert({
    id: STATUS_DOC_ID,
    config_json: JSON.stringify(status),
    updated_at: Date.now(),
  });

  return status;
}

export async function getReindexStatus() {
  await ensureReindexStatusCollection();

  try {
    const doc: any = await typesenseAdmin
      .collections(STATUS_COLLECTION)
      .documents(STATUS_DOC_ID)
      .retrieve();

    return JSON.parse(doc.config_json || "{}") as Partial<ReindexStatus>;
  } catch {
    return null;
  }
}
