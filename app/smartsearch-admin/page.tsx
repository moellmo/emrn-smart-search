"use client";

import { useMemo, useState } from "react";

type SearchRedirect = {
  terms: string[];
  url: string;
};

type SearchOverrides = {
  redirects: SearchRedirect[];
  pinnedSkus: Record<string, string[]>;
  hiddenSkus: string[];
  boostTerms: Record<string, string[]>;
  noResultsSuggestions: Record<string, string[]>;
};

const blankControls: SearchOverrides = {
  redirects: [],
  pinnedSkus: {},
  hiddenSkus: [],
  boostTerms: {},
  noResultsSuggestions: {},
};

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinCsv(values: string[] = []) {
  return values.join(", ");
}

function mapToRows(map: Record<string, string[]> = {}) {
  return Object.entries(map).map(([term, values]) => ({
    term,
    values: joinCsv(values),
  }));
}

function rowsToMap(rows: Array<{ term: string; values: string }>) {
  const output: Record<string, string[]> = {};

  for (const row of rows) {
    const term = row.term.trim();
    if (!term) continue;
    output[term] = splitCsv(row.values);
  }

  return output;
}

export default function SmartSearchAdminPage() {
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [hiddenSkus, setHiddenSkus] = useState("");
  const [redirects, setRedirects] = useState<Array<{ terms: string; url: string }>>([]);
  const [pinnedRows, setPinnedRows] = useState<Array<{ term: string; values: string }>>([]);
  const [boostRows, setBoostRows] = useState<Array<{ term: string; values: string }>>([]);
  const [noResultsRows, setNoResultsRows] = useState<Array<{ term: string; values: string }>>([]);

  const runtime = useMemo<SearchOverrides>(
    () => ({
      redirects: redirects
        .map((row) => ({
          terms: splitCsv(row.terms),
          url: row.url.trim(),
        }))
        .filter((row) => row.terms.length && row.url),
      pinnedSkus: rowsToMap(pinnedRows),
      hiddenSkus: splitCsv(hiddenSkus),
      boostTerms: rowsToMap(boostRows),
      noResultsSuggestions: rowsToMap(noResultsRows),
    }),
    [redirects, pinnedRows, boostRows, noResultsRows, hiddenSkus]
  );

  async function loadControls() {
    setStatus("Loading...");
    const res = await fetch("/api/search-controls", {
      headers: {
        "x-smartsearch-admin-password": password,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || "Could not load controls.");
      return;
    }

    const controls: SearchOverrides = data.runtime || blankControls;

    setRedirects(
      (controls.redirects || []).map((redirect) => ({
        terms: joinCsv(redirect.terms),
        url: redirect.url,
      }))
    );
    setPinnedRows(mapToRows(controls.pinnedSkus));
    setBoostRows(mapToRows(controls.boostTerms));
    setNoResultsRows(mapToRows(controls.noResultsSuggestions));
    setHiddenSkus(joinCsv(controls.hiddenSkus));
    setLoaded(true);
    setStatus("Loaded.");
  }

  async function saveControls() {
    setStatus("Saving...");
    const res = await fetch("/api/search-controls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-smartsearch-admin-password": password,
      },
      body: JSON.stringify({ runtime }),
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || "Could not save controls.");
      return;
    }

    setStatus("Saved. SmartSearch will update within about 30 seconds.");
  }

  return (
    <main style={{ fontFamily: "Inter, Arial, sans-serif", background: "#f8fafc", minHeight: "100vh", padding: 24 }}>
      <section style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ background: "linear-gradient(135deg,#fff,#fff7f7)", border: "1px solid #efd6d6", borderRadius: 22, padding: 24, marginBottom: 18 }}>
          <div style={{ color: "#c34d50", fontWeight: 900, letterSpacing: ".08em", fontSize: 12, textTransform: "uppercase" }}>
            EMRN SmartSearch Admin
          </div>
          <h1 style={{ margin: "8px 0 8px", fontSize: 34 }}>Search Controls</h1>
          <p style={{ margin: 0, color: "#64748b" }}>
            Quickly pin SKUs, hide discontinued items, add redirects, improve query boosts, and customize no-results suggestions.
          </p>

          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Admin password"
              style={{ flex: 1, height: 48, border: "1px solid #e5e7eb", borderRadius: 999, padding: "0 16px" }}
            />
            <button onClick={loadControls} style={buttonStyle("#14365d")}>Load</button>
            <button onClick={saveControls} disabled={!loaded} style={buttonStyle("#c34d50")}>Save</button>
          </div>

          {status && <p style={{ margin: "12px 0 0", color: status.includes("Saved") || status.includes("Loaded") ? "#166534" : "#b91c1c", fontWeight: 800 }}>{status}</p>}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <Panel title="Pinned SKUs" help="Put specific SKUs at the top for a search term. Example: term gloves, values AMDI147-9, AMDI147-8.5">
            <Rows rows={pinnedRows} setRows={setPinnedRows} leftLabel="Search term" rightLabel="SKUs, comma separated" />
          </Panel>

          <Panel title="Hidden SKUs" help="Hide discontinued or unwanted SKUs from SmartSearch. Comma separated.">
            <textarea
              value={hiddenSkus}
              onChange={(event) => setHiddenSkus(event.target.value)}
              placeholder="OLD-SKU-123, DISCONTINUED-456"
              style={textareaStyle}
            />
          </Panel>

          <Panel title="Redirects" help="Send exact searches to a landing page. Example: student specials → /student-specials/">
            <RedirectRows rows={redirects} setRows={setRedirects} />
          </Panel>

          <Panel title="Boost Terms" help="Add extra words to improve results. Example: bp cuff → blood pressure cuff, sphygmomanometer">
            <Rows rows={boostRows} setRows={setBoostRows} leftLabel="Search term" rightLabel="Boost terms, comma separated" />
          </Panel>

          <Panel title="No-Results Suggestions" help="Suggestions to show when a search has no results.">
            <Rows rows={noResultsRows} setRows={setNoResultsRows} leftLabel="Search term" rightLabel="Suggestions, comma separated" />
          </Panel>

          <Panel title="Test Links" help="Use these after saving.">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a style={linkButtonStyle} href="/smartsearch-lab" target="_blank">Open Lab</a>
              <a style={linkButtonStyle} href="/api/search?q=gloves" target="_blank">API: gloves</a>
              <a style={linkButtonStyle} href="/api/search?q=gants" target="_blank">API: gants</a>
            </div>
          </Panel>
        </div>
      </section>
    </main>
  );
}

function Panel({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 18 }}>
      <h2 style={{ margin: 0, fontSize: 22 }}>{title}</h2>
      <p style={{ color: "#64748b", margin: "6px 0 14px", lineHeight: 1.4 }}>{help}</p>
      {children}
    </section>
  );
}

function Rows({
  rows,
  setRows,
  leftLabel,
  rightLabel,
}: {
  rows: Array<{ term: string; values: string }>;
  setRows: (rows: Array<{ term: string; values: string }>) => void;
  leftLabel: string;
  rightLabel: string;
}) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 38px", gap: 8, color: "#64748b", fontWeight: 900, fontSize: 12, marginBottom: 6 }}>
        <div>{leftLabel}</div>
        <div>{rightLabel}</div>
        <div />
      </div>

      {rows.map((row, index) => (
        <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 38px", gap: 8, marginBottom: 8 }}>
          <input
            value={row.term}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, term: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <input
            value={row.values}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, values: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <button onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))} style={smallButtonStyle}>×</button>
        </div>
      ))}

      <button onClick={() => setRows([...rows, { term: "", values: "" }])} style={outlineButtonStyle}>+ Add row</button>
    </div>
  );
}

function RedirectRows({
  rows,
  setRows,
}: {
  rows: Array<{ terms: string; url: string }>;
  setRows: (rows: Array<{ terms: string; url: string }>) => void;
}) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 38px", gap: 8, color: "#64748b", fontWeight: 900, fontSize: 12, marginBottom: 6 }}>
        <div>Search terms</div>
        <div>URL</div>
        <div />
      </div>

      {rows.map((row, index) => (
        <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 38px", gap: 8, marginBottom: 8 }}>
          <input
            value={row.terms}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, terms: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <input
            value={row.url}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, url: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <button onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))} style={smallButtonStyle}>×</button>
        </div>
      ))}

      <button onClick={() => setRows([...rows, { terms: "", url: "" }])} style={outlineButtonStyle}>+ Add redirect</button>
    </div>
  );
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

const inputStyle = {
  height: 40,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "0 10px",
  minWidth: 0,
};

const textareaStyle = {
  width: "100%",
  minHeight: 160,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 12,
  resize: "vertical" as const,
};

const smallButtonStyle = {
  height: 40,
  border: 0,
  borderRadius: 12,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 900,
  cursor: "pointer",
};

const outlineButtonStyle = {
  height: 40,
  border: "1px solid #e5e7eb",
  borderRadius: 999,
  background: "#fff",
  padding: "0 14px",
  fontWeight: 900,
  cursor: "pointer",
};

const linkButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  height: 40,
  border: "1px solid #e5e7eb",
  borderRadius: 999,
  background: "#fff",
  padding: "0 14px",
  fontWeight: 900,
  color: "#14365d",
  textDecoration: "none",
};
