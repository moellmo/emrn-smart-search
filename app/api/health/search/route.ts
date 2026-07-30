import { NextResponse } from "next/server";
import { typesenseSearch } from "../../../../lib/typesense";
import {
  checkSearchHealth,
  searchHealthParameters,
} from "../../../../lib/search-health";
import { PRODUCT_COLLECTION_ALIAS } from "../../../../lib/search-index";

const headers = { "Cache-Control": "no-store" };

export async function GET() {
  const health = await checkSearchHealth({
    search: () =>
      typesenseSearch
        .collections(PRODUCT_COLLECTION_ALIAS)
        .documents()
        .search(searchHealthParameters),
  });

  if (!health.ok) {
    return NextResponse.json(
      { ok: false, service: "emrn-smart-search" },
      { status: 503, headers }
    );
  }

  return NextResponse.json(
    {
      ok: true,
      service: "emrn-smart-search",
      responseTimeMs: health.responseTimeMs,
    },
    { status: 200, headers }
  );
}
