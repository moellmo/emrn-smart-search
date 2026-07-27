import { NextRequest, NextResponse } from "next/server";
import { typesenseAdmin } from "../../../lib/typesense";

const COLLECTION_NAME = "emrn_search_analytics";

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get("origin") || "";
  const allowedOrigin = ["https://emrn.ca", "https://www.emrn.ca", "http://localhost:3000"].includes(origin) || /^https:\/\/store-[a-z0-9-]+\.mybigcommerce\.com$/i.test(origin)
    ? origin
    : "https://emrn.ca";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-smartsearch-admin-password",
  };
}

type AnalyticsDocument = {
  id?: string;
  event?: string;
  query?: string;
  sku?: string;
  product_name?: string;
  product_id?: number;
  customer_id?: string;
  page_type?: string;
  url?: string;
  created_at?: number;
};

type AnalyticsHit = {
  document?: AnalyticsDocument;
};

type AnalyticsSearchResult = {
  hits?: AnalyticsHit[];
  found?: number;
};

function isAuthorized(req: NextRequest) {
  const configuredPassword = process.env.SMARTSEARCH_ADMIN_PASSWORD;
  const suppliedPassword = req.headers.get("x-smartsearch-admin-password") || "";
  return Boolean(configuredPassword && suppliedPassword === configuredPassword);
}

async function ensureAnalyticsCollection() {
  try {
    await typesenseAdmin.collections(COLLECTION_NAME).retrieve();
  } catch {
    await typesenseAdmin.collections().create({
      name: COLLECTION_NAME,
      fields: [
        { name: "id", type: "string" },
        { name: "event", type: "string", facet: true },
        { name: "query", type: "string", facet: true, optional: true },
        { name: "sku", type: "string", facet: true, optional: true },
        { name: "product_name", type: "string", optional: true },
        { name: "product_id", type: "int64", optional: true },
        { name: "customer_id", type: "string", facet: true, optional: true },
        { name: "page_type", type: "string", facet: true, optional: true },
        { name: "url", type: "string", optional: true },
        { name: "created_at", type: "int64", facet: true },
      ],
      default_sorting_field: "created_at",
    });
  }
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function POST(req: NextRequest) {
  await ensureAnalyticsCollection();

  const body = await req.json().catch(() => ({}));
  const now = Date.now();
  const event = String(body?.event || "").trim().slice(0, 80);
  if (!event) {
    return NextResponse.json({ ok: false, error: "Missing event." }, { status: 400, headers: corsHeaders(req) });
  }

  await typesenseAdmin.collections(COLLECTION_NAME).documents().create({
    id: `${now}-${Math.random().toString(36).slice(2)}`,
    event,
    query: String(body?.query || "").trim().slice(0, 180),
    sku: String(body?.sku || "").trim().slice(0, 100),
    product_name: String(body?.product_name || "").trim().slice(0, 240),
    product_id: Number(body?.product_id || 0) || undefined,
    customer_id: String(body?.customer_id || "").trim().slice(0, 80),
    page_type: String(body?.page_type || "").trim().slice(0, 80),
    url: String(body?.url || "").trim().slice(0, 500),
    created_at: now,
  });

  return NextResponse.json({ ok: true }, { headers: corsHeaders(req) });
}

function documentValue(document: AnalyticsDocument | undefined, key: keyof AnalyticsDocument) {
  return String(document?.[key] || "").trim();
}

function countBy(rows: AnalyticsHit[], key: keyof AnalyticsDocument) {
  const map = new Map<string, number>();
  rows.forEach((row) => {
    const value = documentValue(row.document, key);
    if (!value) return;
    map.set(value, (map.get(value) || 0) + 1);
  });
  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
}

function eventMatches(row: AnalyticsHit, events: string[]) {
  return events.includes(String(row.document?.event || ""));
}

function cleanQuery(row: AnalyticsHit) {
  return String(row.document?.query || "").trim();
}

function countQueriesForEvents(rows: AnalyticsHit[], events: string[]) {
  const map = new Map<string, number>();
  rows.filter((row) => eventMatches(row, events)).forEach((row) => {
    const query = cleanQuery(row);
    if (!query) return;
    map.set(query, (map.get(query) || 0) + 1);
  });

  return Array.from(map.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 25);
}

function countQueryProductEvents(rows: AnalyticsHit[], event: string) {
  const map = new Map<string, { value: string; sku: string; count: number }>();
  rows
    .filter((row) => row.document?.event === event)
    .forEach((row) => {
      const query = cleanQuery(row);
      const sku = String(row.document?.sku || "").trim();
      const name = String(row.document?.product_name || sku || "Unknown").trim();
      if (!query && !name && !sku) return;
      const value = `${query || "No query"} -> ${name || sku}`;
      const key = `${query}|${sku || name}`;
      const current = map.get(key) || { value, sku, count: 0 };
      current.count += 1;
      map.set(key, current);
    });

  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 25);
}

function countEventProducts(rows: AnalyticsHit[], event: string) {
  const map = new Map<string, { value: string; sku: string; count: number }>();
  rows
    .filter((row) => row.document?.event === event)
    .forEach((row) => {
      const sku = String(row.document?.sku || "").trim();
      const name = String(row.document?.product_name || sku || "Unknown").trim();
      if (!name && !sku) return;
      const key = sku || name;
      const current = map.get(key) || { value: name, sku, count: 0 };
      current.count += 1;
      map.set(key, current);
    });
  return Array.from(map.values()).sort((a, b) => b.count - a.count).slice(0, 25);
}

function noClickQueries(rows: AnalyticsHit[]) {
  return funnelByQuery(rows)
    .filter((row) => row.searches > 0 && row.clicks === 0 && row.carts === 0 && row.quotes === 0 && row.purchases === 0)
    .map(({ value, searches }) => ({ value, count: searches }))
    .slice(0, 25);
}

function funnelByQuery(rows: AnalyticsHit[]) {
  const map = new Map<
    string,
    { value: string; count: number; searches: number; noResults: number; clicks: number; carts: number; quotes: number; purchases: number }
  >();

  rows.forEach((row) => {
    const query = cleanQuery(row);
    if (!query) return;
    const event = String(row.document?.event || "");
    const current =
      map.get(query) ||
      {
        value: query,
        count: 0,
        searches: 0,
        noResults: 0,
        clicks: 0,
        carts: 0,
        quotes: 0,
        purchases: 0,
      };

    if (event === "search" || event === "results_view" || event === "server_search") current.searches += 1;
    if (event === "no_results" || event === "server_no_results") current.noResults += 1;
    if (event === "product_click") current.clicks += 1;
    if (event === "add_to_cart") current.carts += 1;
    if (event === "add_to_quote") current.quotes += 1;
    if (event === "purchase") current.purchases += 1;
    current.count = current.searches + current.noResults + current.clicks + current.carts + current.quotes + current.purchases;
    map.set(query, current);
  });

  return Array.from(map.values())
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

function analyticsDocument(row: AnalyticsHit) {
  return row.document || {};
}

function analyticsDateFilter(req: NextRequest) {
  const range = String(req.nextUrl.searchParams.get("range") || "all").trim().toLowerCase();
  if (range === "all") return "";

  const now = Date.now();
  if (range === "this_week") {
    const start = new Date(now);
    const day = start.getDay();
    const daysSinceMonday = day === 0 ? 6 : day - 1;
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - daysSinceMonday);
    return `created_at:>=${start.getTime()} && created_at:<=${now}`;
  }

  const days = range === "7d" ? 7 : range === "30d" ? 30 : range === "3m" ? 92 : range === "90d" ? 90 : 0;
  if (!days) return "";

  return `created_at:>=${now - days * 24 * 60 * 60 * 1000} && created_at:<=${now}`;
}

function analyticsFilter(req: NextRequest, extra: string[] = []) {
  return [analyticsDateFilter(req), ...extra].filter(Boolean).join(" && ");
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Invalid admin password." }, { status: 401, headers: corsHeaders(req) });
  }

  try {
    await ensureAnalyticsCollection();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not prepare analytics storage." },
      { status: 500, headers: corsHeaders(req) }
    );
  }

  const mode = req.nextUrl.searchParams.get("mode") || "summary";
  if (mode === "events") {
    const page = Math.max(1, Number(req.nextUrl.searchParams.get("page") || 1) || 1);
    const perPage = Math.min(250, Math.max(25, Number(req.nextUrl.searchParams.get("per_page") || 100) || 100));
    const event = String(req.nextUrl.searchParams.get("event") || "").trim();
    const query = String(req.nextUrl.searchParams.get("query") || "").trim();
    const filterParts = [];
    if (event) filterParts.push(`event:=${JSON.stringify(event)}`);
    if (query) filterParts.push(`query:=${JSON.stringify(query)}`);
    const filterBy = analyticsFilter(req, filterParts);

    try {
      const results = (await typesenseAdmin.collections(COLLECTION_NAME).documents().search({
        q: "*",
        query_by: "query,event,sku,product_name",
        sort_by: "created_at:desc",
        per_page: perPage,
        page,
        ...(filterBy ? { filter_by: filterBy } : {}),
      })) as AnalyticsSearchResult;

      const rows = (results.hits || []).map(analyticsDocument);
      return NextResponse.json(
        {
          total: Number(results.found || rows.length || 0),
          page,
          perPage,
          hasMore: page * perPage < Number(results.found || 0),
          rows,
        },
        { headers: corsHeaders(req) }
      );
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "Could not load analytics events." },
        { status: 500, headers: corsHeaders(req) }
      );
    }
  }

  const pageSize = 250;
  const pageCount = 4;
  const rows: AnalyticsHit[] = [];
  let total = 0;

  try {
    for (let page = 1; page <= pageCount; page += 1) {
      const results = (await typesenseAdmin.collections(COLLECTION_NAME).documents().search({
        q: "*",
        query_by: "query,event,sku,product_name",
        sort_by: "created_at:desc",
        per_page: pageSize,
        page,
        ...(analyticsDateFilter(req) ? { filter_by: analyticsDateFilter(req) } : {}),
      })) as AnalyticsSearchResult;

      total = Math.max(total, Number(results.found || 0));
      rows.push(...(results.hits || []));
      if ((results.hits || []).length < pageSize) break;
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load analytics." },
      { status: 500, headers: corsHeaders(req) }
    );
  }

  const searchVolume = countQueriesForEvents(rows, ["search", "results_view", "server_search"]);
  return NextResponse.json(
    {
      total: total || rows.length,
      loadedRows: rows.length,
      topQueries: searchVolume,
      searchVolume,
      topEvents: countBy(rows, "event"),
      topNoResultQueries: countQueriesForEvents(rows, ["no_results", "server_no_results"]),
      noClickQueries: noClickQueries(rows),
      fewResultQueries: countQueriesForEvents(rows, ["server_few_results"]),
      topRefinedQueries: countQueriesForEvents(rows, ["search_refined"]),
      autocompleteShownQueries: countQueriesForEvents(rows, ["autocomplete_shown"]),
      autocompleteEnterQueries: countQueriesForEvents(rows, ["autocomplete_enter"]),
      typoMappingSuggestions: countQueryProductEvents(rows, "server_query_mapping"),
      searchSpeedBuckets: countEventProducts(rows, "server_search_speed"),
      autocompleteSpeedBuckets: countEventProducts(rows, "server_autocomplete_speed"),
      slowSearchQueries: countQueryProductEvents(rows, "server_search_speed").filter((row) => /1-2s|>2s/.test(row.value)),
      slowAutocompleteQueries: countQueryProductEvents(rows, "server_autocomplete_speed").filter((row) => /1-2s|>2s/.test(row.value)),
      categoryClicks: countEventProducts(rows, "category_click"),
      topClickedProducts: countEventProducts(rows, "product_click"),
      topCartProducts: countEventProducts(rows, "add_to_cart"),
      topQuoteProducts: countEventProducts(rows, "add_to_quote"),
      topPurchasedProducts: countEventProducts(rows, "purchase"),
      topCartQueries: countQueriesForEvents(rows, ["add_to_cart"]),
      topQuoteQueries: countQueriesForEvents(rows, ["add_to_quote"]),
      topPurchaseQueries: countQueriesForEvents(rows, ["purchase"]),
      topCartSearchProducts: countQueryProductEvents(rows, "add_to_cart"),
      topQuoteSearchProducts: countQueryProductEvents(rows, "add_to_quote"),
      queryFunnel: funnelByQuery(rows),
      recent: rows.slice(0, 50).map((row) => row.document),
    },
    { headers: corsHeaders(req) }
  );
}
