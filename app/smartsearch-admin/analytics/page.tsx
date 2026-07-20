"use client";

import { useMemo, useState } from "react";

type MetricRow = {
  value: string;
  sku?: string;
  count: number;
};

type FunnelRow = {
  value: string;
  count: number;
  searches: number;
  noResults: number;
  clicks: number;
  carts: number;
  quotes: number;
  purchases: number;
};

type EventRow = {
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

type AnalyticsSummary = {
  total: number;
  loadedRows: number;
  searchVolume: MetricRow[];
  topEvents: MetricRow[];
  topNoResultQueries: MetricRow[];
  topClickedProducts: MetricRow[];
  topCartProducts: MetricRow[];
  topQuoteProducts: MetricRow[];
  topPurchasedProducts: MetricRow[];
  topCartQueries: MetricRow[];
  topQuoteQueries: MetricRow[];
  topPurchaseQueries: MetricRow[];
  topCartSearchProducts: MetricRow[];
  topQuoteSearchProducts: MetricRow[];
  queryFunnel: FunnelRow[];
  recent: EventRow[];
};

const EVENT_PAGE_SIZE = 100;

export default function SmartSearchAnalyticsPage() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [eventsPage, setEventsPage] = useState(0);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsLoading, setEventsLoading] = useState(false);

  const eventCounts = useMemo(() => {
    const counts = new Map<string, number>();
    (summary?.topEvents || []).forEach((item) => counts.set(item.value, item.count));
    return counts;
  }, [summary]);

  async function loadSummary() {
    setStatus("Loading analytics...");
    try {
      const res = await fetch("/api/search-analytics", {
        headers: { "x-smartsearch-admin-password": password },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error || "Could not load analytics.");
        return;
      }
      setSummary(data);
      setStatus(`Loaded ${data.total || 0} stored event${Number(data.total || 0) === 1 ? "" : "s"}.`);
      await loadEvents(1, false);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load analytics.");
    }
  }

  async function loadEvents(page: number, append: boolean) {
    setEventsLoading(true);
    try {
      const params = new URLSearchParams({
        mode: "events",
        page: String(page),
        per_page: String(EVENT_PAGE_SIZE),
      });
      const res = await fetch(`/api/search-analytics?${params.toString()}`, {
        headers: { "x-smartsearch-admin-password": password },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error || "Could not load event rows.");
        return;
      }
      setEvents(append ? [...events, ...(data.rows || [])] : data.rows || []);
      setEventsPage(page);
      setEventsTotal(Number(data.total || 0));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not load event rows.");
    } finally {
      setEventsLoading(false);
    }
  }

  async function sendTestEvent() {
    setStatus("Sending test analytics event...");
    try {
      const res = await fetch("/api/search-analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "admin_test",
          query: "admin analytics test",
          page_type: "smartsearch_analytics",
          url: window.location.href,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus(data.error || "Could not save test event.");
        return;
      }
      await loadSummary();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not save test event.");
    }
  }

  return (
    <main style={{ fontFamily: "Inter, Arial, sans-serif", background: "#eef3f8", color: "#111827", minHeight: "100vh", padding: 24 }}>
      <section style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={heroStyle}>
          <div style={{ color: "#c34d50", fontWeight: 900, letterSpacing: ".08em", fontSize: 12, textTransform: "uppercase" }}>
            EMRN SmartSearch Admin
          </div>
          <h1 style={{ margin: "8px 0 8px", fontSize: 34 }}>Analytics</h1>
          <p style={{ margin: 0, color: "#64748b" }}>
            Search volume, no-result terms, clicks, add to cart, quote actions, and raw event rows.
          </p>
          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Admin password"
              style={{ ...inputStyle, flex: "1 1 360px", height: 48, borderRadius: 999, padding: "0 16px" }}
            />
            <button onClick={loadSummary} style={buttonStyle("#14365d")}>Load analytics</button>
            <button onClick={sendTestEvent} style={outlineButtonStyle}>Test analytics</button>
            <a href="/smartsearch-admin" style={linkButtonStyle}>Search controls</a>
          </div>
          {status && <p style={{ margin: "12px 0 0", color: /loaded|saved|test/i.test(status) ? "#166534" : "#b91c1c", fontWeight: 800 }}>{status}</p>}
        </div>

        {summary ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 14, marginBottom: 18 }}>
              <Stat label="Stored events" value={summary.total || 0} />
              <Stat label="Loaded rows" value={summary.loadedRows || 0} />
              <Stat label="Searches" value={eventCounts.get("search") || 0} />
              <Stat label="Product clicks" value={eventCounts.get("product_click") || 0} />
              <Stat label="Cart adds" value={eventCounts.get("add_to_cart") || 0} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
              <MetricTable title="Search Term Volume" rows={summary.searchVolume || []} filename="smartsearch-search-volume" />
              <MetricTable title="No-Result Searches" rows={summary.topNoResultQueries || []} filename="smartsearch-no-results" />
              <MetricTable title="Product Clicks" rows={summary.topClickedProducts || []} filename="smartsearch-product-clicks" />
              <MetricTable title="Added To Cart" rows={summary.topCartProducts || []} filename="smartsearch-add-to-cart-products" />
              <MetricTable title="Added To Quote" rows={summary.topQuoteProducts || []} filename="smartsearch-add-to-quote-products" />
              <MetricTable title="Event Types" rows={summary.topEvents || []} filename="smartsearch-event-types" />
              <MetricTable title="Cart Adds By Search" rows={summary.topCartQueries || []} filename="smartsearch-cart-by-search" />
              <MetricTable title="Quote Adds By Search" rows={summary.topQuoteQueries || []} filename="smartsearch-quote-by-search" />
              <MetricTable title="Search To Cart Product" rows={summary.topCartSearchProducts || []} filename="smartsearch-search-to-cart-product" />
              <MetricTable title="Search To Quote Product" rows={summary.topQuoteSearchProducts || []} filename="smartsearch-search-to-quote-product" />
            </div>

            <FunnelTable rows={summary.queryFunnel || []} />

            <RawEventsTable
              rows={events}
              total={eventsTotal}
              loading={eventsLoading}
              onLoadMore={() => void loadEvents(eventsPage + 1, true)}
            />
          </>
        ) : (
          <div style={panelStyle}>
            <h2 style={{ margin: 0, fontSize: 22 }}>Load Analytics</h2>
            <p style={{ color: "#64748b", margin: "8px 0 0" }}>Enter the admin password and load analytics to view table rows and exports.</p>
          </div>
        )}
      </section>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={panelStyle}>
      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <strong style={{ display: "block", marginTop: 6, color: "#14365d", fontSize: 26 }}>{value}</strong>
    </div>
  );
}

function MetricTable({ title, rows, filename }: { title: string; rows: MetricRow[]; filename: string }) {
  const [limit, setLimit] = useState(10);
  const visibleRows = rows.slice(0, limit);
  const exportRows = rows.map((row) => ({ value: row.value, sku: row.sku || "", count: row.count }));

  return (
    <div style={panelStyle}>
      <TableHeader title={title} rows={exportRows} filename={filename} />
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={tableHeaderStyle}>Value</th>
            <th style={tableHeaderStyle}>SKU</th>
            <th style={tableHeaderStyle}>Count</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.length ? visibleRows.map((row, index) => (
            <tr key={`${row.value}-${index}`}>
              <td style={wideCellStyle}>{row.value}</td>
              <td style={tableCellStyle}>{row.sku || ""}</td>
              <td style={numberCellStyle}>{row.count}</td>
            </tr>
          )) : (
            <tr><td style={tableCellStyle} colSpan={3}>No data yet.</td></tr>
          )}
        </tbody>
      </table>
      {rows.length > visibleRows.length ? (
        <button onClick={() => setLimit(limit + 10)} style={{ ...outlineButtonStyle, marginTop: 10 }}>
          Load more rows ({visibleRows.length}/{rows.length})
        </button>
      ) : null}
    </div>
  );
}

function FunnelTable({ rows }: { rows: FunnelRow[] }) {
  const [limit, setLimit] = useState(20);
  const visibleRows = rows.slice(0, limit);

  return (
    <div style={{ ...panelStyle, marginTop: 18 }}>
      <TableHeader title="Search Term Funnel" rows={rows} filename="smartsearch-search-funnel" />
      <div style={{ overflowX: "auto" }}>
        <table style={{ ...tableStyle, minWidth: 820 }}>
          <thead>
            <tr>
              <th style={tableHeaderStyle}>Search term</th>
              <th style={tableHeaderStyle}>Searches</th>
              <th style={tableHeaderStyle}>No results</th>
              <th style={tableHeaderStyle}>Clicks</th>
              <th style={tableHeaderStyle}>Carts</th>
              <th style={tableHeaderStyle}>Quotes</th>
              <th style={tableHeaderStyle}>Purchases</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length ? visibleRows.map((row) => (
              <tr key={row.value}>
                <td style={wideCellStyle}>{row.value}</td>
                <td style={numberCellStyle}>{row.searches || 0}</td>
                <td style={{ ...numberCellStyle, color: row.noResults ? "#b91c1c" : "#334155" }}>{row.noResults || 0}</td>
                <td style={numberCellStyle}>{row.clicks || 0}</td>
                <td style={numberCellStyle}>{row.carts || 0}</td>
                <td style={numberCellStyle}>{row.quotes || 0}</td>
                <td style={numberCellStyle}>{row.purchases || 0}</td>
              </tr>
            )) : (
              <tr><td style={tableCellStyle} colSpan={7}>No data yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length > visibleRows.length ? (
        <button onClick={() => setLimit(limit + 20)} style={{ ...outlineButtonStyle, marginTop: 10 }}>
          Load more rows ({visibleRows.length}/{rows.length})
        </button>
      ) : null}
    </div>
  );
}

function RawEventsTable({
  rows,
  total,
  loading,
  onLoadMore,
}: {
  rows: EventRow[];
  total: number;
  loading: boolean;
  onLoadMore: () => void;
}) {
  const exportRows = rows.map((row) => ({
    created_at: formatDate(row.created_at),
    event: row.event || "",
    query: row.query || "",
    sku: row.sku || "",
    product_name: row.product_name || "",
    product_id: row.product_id || "",
    customer_id: row.customer_id || "",
    page_type: row.page_type || "",
    url: row.url || "",
  }));

  return (
    <div style={{ ...panelStyle, marginTop: 18 }}>
      <TableHeader title={`Raw Event Rows (${rows.length}/${total || rows.length})`} rows={exportRows} filename="smartsearch-raw-events" />
      <div style={{ overflowX: "auto" }}>
        <table style={{ ...tableStyle, minWidth: 1180 }}>
          <thead>
            <tr>
              <th style={tableHeaderStyle}>Created</th>
              <th style={tableHeaderStyle}>Event</th>
              <th style={tableHeaderStyle}>Query</th>
              <th style={tableHeaderStyle}>SKU</th>
              <th style={tableHeaderStyle}>Product</th>
              <th style={tableHeaderStyle}>Page type</th>
              <th style={tableHeaderStyle}>URL</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => (
              <tr key={`${row.id || row.created_at}-${index}`}>
                <td style={tableCellStyle}>{formatDate(row.created_at)}</td>
                <td style={tableCellStyle}>{row.event || ""}</td>
                <td style={wideCellStyle}>{row.query || ""}</td>
                <td style={tableCellStyle}>{row.sku || ""}</td>
                <td style={wideCellStyle}>{row.product_name || ""}</td>
                <td style={tableCellStyle}>{row.page_type || ""}</td>
                <td style={urlCellStyle}>{row.url || ""}</td>
              </tr>
            )) : (
              <tr><td style={tableCellStyle} colSpan={7}>No raw events loaded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {rows.length < total ? (
        <button onClick={onLoadMore} disabled={loading} style={{ ...outlineButtonStyle, marginTop: 10 }}>
          {loading ? "Loading..." : `Load more event rows (${rows.length}/${total})`}
        </button>
      ) : null}
    </div>
  );
}

function TableHeader({ title, rows, filename }: { title: string; rows: Array<Record<string, unknown>>; filename: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
      <h2 style={{ margin: 0, fontSize: 20 }}>{title}</h2>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => downloadCsv(filename, rows)} style={smallOutlineButtonStyle}>CSV</button>
        <button onClick={() => downloadExcel(filename, rows)} style={smallOutlineButtonStyle}>Excel</button>
      </div>
    </div>
  );
}

function formatDate(value?: number) {
  if (!value) return "";
  return new Date(value).toLocaleString();
}

function downloadCsv(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(",")),
  ].join("\n");
  downloadBlob(`${filename}.csv`, "text/csv;charset=utf-8", csv);
}

function downloadExcel(filename: string, rows: Array<Record<string, unknown>>) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const html = `
    <html>
      <head><meta charset="utf-8" /></head>
      <body>
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(String(row[header] ?? ""))}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </body>
    </html>`;
  downloadBlob(`${filename}.xls`, "application/vnd.ms-excel;charset=utf-8", html);
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function downloadBlob(filename: string, type: string, content: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buttonStyle(background: string) {
  return {
    height: 48,
    border: 0,
    borderRadius: 999,
    background,
    color: "#fff",
    padding: "0 22px",
    fontWeight: 900,
    cursor: "pointer",
  };
}

const heroStyle = {
  background: "linear-gradient(135deg,#fff,#fff7f7)",
  border: "1px solid #efd6d6",
  borderRadius: 22,
  padding: 24,
  marginBottom: 18,
};

const panelStyle = {
  background: "#fff",
  border: "1px solid #d8e1ea",
  borderRadius: 18,
  padding: 16,
  boxShadow: "0 10px 24px rgba(15,23,42,.05)",
};

const inputStyle = {
  height: 40,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "0 10px",
  minWidth: 0,
  color: "#111827",
  background: "#fff",
};

const tableStyle = {
  width: "100%",
  borderCollapse: "collapse" as const,
};

const tableHeaderStyle = {
  borderBottom: "1px solid #e2e8f0",
  padding: "9px 8px",
  fontWeight: 900,
  color: "#64748b",
  textAlign: "left" as const,
  fontSize: 12,
};

const tableCellStyle = {
  borderBottom: "1px solid #e2e8f0",
  padding: "9px 8px",
  color: "#334155",
  fontWeight: 700,
  verticalAlign: "top" as const,
};

const wideCellStyle = {
  ...tableCellStyle,
  color: "#14365d",
  fontWeight: 900,
  overflowWrap: "anywhere" as const,
};

const urlCellStyle = {
  ...tableCellStyle,
  maxWidth: 280,
  overflowWrap: "anywhere" as const,
  fontSize: 12,
};

const numberCellStyle = {
  ...tableCellStyle,
  fontWeight: 900,
};

const outlineButtonStyle = {
  height: 48,
  border: "1px solid #e5e7eb",
  borderRadius: 999,
  background: "#fff",
  padding: "0 18px",
  fontWeight: 900,
  color: "#14365d",
  cursor: "pointer",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
};

const smallOutlineButtonStyle = {
  ...outlineButtonStyle,
  height: 34,
  padding: "0 12px",
  fontSize: 12,
};

const linkButtonStyle = {
  ...outlineButtonStyle,
};
