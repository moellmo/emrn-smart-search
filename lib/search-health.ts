export const SEARCH_HEALTH_QUERY = "bandage";
export const SEARCH_HEALTH_TIMEOUT_MS = 5_000;

// Keep the same primary product-search fields, weights, visibility filter,
// typo handling, and alias used by /api/search. The one-result page keeps the
// monitoring probe inexpensive while still exercising the real search path.
export const searchHealthParameters = {
  q: SEARCH_HEALTH_QUERY,
  query_by:
    "sku,all_skus,name,parent_name,brand,sold_by,categories,variant_label,option_text,search_text,description,custom_fields_text",
  query_by_weights: "30,24,16,12,8,7,7,6,6,4,2,2",
  filter_by: "is_visible:=true",
  sort_by: "_text_match:desc,popularity_score:desc,product_id:desc",
  per_page: 1,
  page: 1,
  num_typos: 2,
  typo_tokens_threshold: 1,
  prefix: true,
} as const;

type TypesenseHealthResponse = unknown;

type SearchHealthDependencies = {
  search: () => Promise<TypesenseHealthResponse>;
  timeoutMs?: number;
  now?: () => number;
};

export type SearchHealthResult =
  | { ok: true; responseTimeMs: number }
  | { ok: false };

function hasValidHits(result: TypesenseHealthResponse): result is { hits: unknown[] } {
  return Boolean(result) && typeof result === "object" && Array.isArray((result as { hits?: unknown }).hits);
}

function timeoutAfter(timeoutMs: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("search health check timed out")), timeoutMs);
  });

  return {
    promise,
    clear: () => {
      if (timer) clearTimeout(timer);
    },
  };
}

export async function checkSearchHealth({
  search,
  timeoutMs = SEARCH_HEALTH_TIMEOUT_MS,
  now = Date.now,
}: SearchHealthDependencies): Promise<SearchHealthResult> {
  const startedAt = now();
  const timeout = timeoutAfter(timeoutMs);

  try {
    const result = await Promise.race([search(), timeout.promise]);
    if (!hasValidHits(result)) return { ok: false };

    return {
      ok: true,
      responseTimeMs: Math.max(0, now() - startedAt),
    };
  } catch {
    return { ok: false };
  } finally {
    timeout.clear();
  }
}
