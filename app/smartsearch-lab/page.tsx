"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Hit = {
  document: {
    id: string;
    product_id: number;
    variant_id?: number;
    parent_name?: string;
    name: string;
    sku?: string;
    brand?: string;
    sold_by?: string;
    price?: number;
    image?: string;
    url?: string;
    option_text?: string;
    variant_label?: string;
  };
};

type FacetCount = {
  field_name: string;
  counts: Array<{ value: string; count: number }>;
};

type SearchResponse = {
  found?: number;
  page?: number;
  hits?: Hit[];
  facet_counts?: FacetCount[];
  original_query?: string;
  search_query?: string;
  expanded_query?: string;
  translated_query?: string;
  translator?: string;
  expansions?: string[];
  fallback_terms?: string[];
  language?: string;
  redirect_url?: string;
};

const examples = [
  "gloves",
  "gants",
  "masks",
  "masques",
  "manikin",
  "mannequin",
  "mannequin pédiatrique de formation",
  "pansement pour plaie",
  "seringue 3 ml",
  "masque avec réservoir",
  "brassard de tension artérielle",
  "fauteuil de douche",
];

function money(value?: number) {
  if (!value) return "See product";
  return `$${Number(value).toFixed(2)}`;
}

export default function SmartSearchLabPage() {
  const [query, setQuery] = useState("gants");
  const [brand, setBrand] = useState("");
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [allHits, setAllHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);

  const products = allHits.map((hit) => hit.document);
  const found = data?.found || products.length;
  const brandFacet = useMemo(
    () => data?.facet_counts?.find((facet) => facet.field_name === "brand")?.counts || [],
    [data]
  );
  const categoryFacet = useMemo(
    () => data?.facet_counts?.find((facet) => facet.field_name === "categories")?.counts || [],
    [data]
  );

  async function runSearch(nextPage = 1, append = false, overrideQuery?: string, nextBrand = brand, nextCategory = category) {
    const q = overrideQuery ?? query;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("q", q || "*");
    params.set("page", String(nextPage));
    if (nextBrand) params.set("brand", nextBrand);
    if (nextCategory) params.set("category", nextCategory);

    const res = await fetch(`/api/search?${params.toString()}`);
    const json: SearchResponse = await res.json();

    setData(json);
    setPage(nextPage);
    setAllHits((current) => (append ? [...current, ...(json.hits || [])] : json.hits || []));
    setLoading(false);
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    setBrand("");
    setCategory("");
    setPage(1);
    runSearch(1, false, query, "", "");
  }

  useEffect(() => {
    runSearch(1, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main style={{ fontFamily: "Inter, Arial, sans-serif", background: "#f8fafc", minHeight: "100vh", padding: 24 }}>
      <section style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ background: "linear-gradient(135deg,#fff,#fff7f7)", border: "1px solid #efd6d6", borderRadius: 22, padding: 24, marginBottom: 18 }}>
          <div style={{ color: "#c34d50", fontWeight: 900, letterSpacing: ".08em", fontSize: 12, textTransform: "uppercase" }}>
            EMRN SmartSearch Lab
          </div>
          <h1 style={{ margin: "8px 0 8px", fontSize: 34 }}>AI Search Translator Test</h1>
          <p style={{ margin: 0, color: "#64748b" }}>
            Test French phrases, AI translation, manual synonyms, filters, and pagination before putting the storefront script back on.
          </p>

          <form onSubmit={submit} style={{ display: "flex", gap: 10, marginTop: 20 }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search products, French terms, SKU, brand..."
              style={{ flex: 1, height: 52, border: "2px solid #c34d50", borderRadius: 999, padding: "0 18px", fontSize: 16 }}
            />
            <button type="submit" style={{ border: 0, borderRadius: 999, background: "#c34d50", color: "#fff", fontWeight: 900, padding: "0 24px" }}>
              Search
            </button>
          </form>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            {examples.map((term) => (
              <button
                key={term}
                type="button"
                onClick={() => {
                  setQuery(term);
                  setBrand("");
                  setCategory("");
                  setPage(1);
                  runSearch(1, false, term, "", "");
                }}
                style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 999, padding: "8px 11px", fontWeight: 800, cursor: "pointer" }}
              >
                {term}
              </button>
            ))}
          </div>

          {data && (
            <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(5,minmax(0,1fr))", gap: 10 }}>
              <Info label="Found" value={String(found)} />
              <Info label="Language" value={data.language || "-"} />
              <Info label="Translator" value={data.translator || "-"} />
              <Info label="Search query used" value={data.search_query || "-"} />
              <Info label="AI translated" value={data.translated_query || "-"} />
            </div>
          )}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 18 }}>
          <aside style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 16, height: "max-content", position: "sticky", top: 18 }}>
            <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Filters</h2>
            {(brand || category) && (
              <button
                onClick={() => {
                  setBrand("");
                  setCategory("");
                  runSearch(1, false, query, "", "");
                }}
                style={{ width: "100%", height: 38, border: 0, borderRadius: 999, background: "#c34d50", color: "#fff", fontWeight: 900, marginBottom: 14 }}
              >
                Clear filters
              </button>
            )}

            <Facet title="Brands" items={brandFacet} selected={brand} onSelect={(value) => { setBrand(value); runSearch(1, false, query, value, category); }} />
            <Facet title="Categories" items={categoryFacet} selected={category} onSelect={(value) => { setCategory(value); runSearch(1, false, query, brand, value); }} />
          </aside>

          <section>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", marginBottom: 14 }}>
              <div>
                <h2 style={{ margin: 0, fontSize: 24 }}>Products</h2>
                <p style={{ margin: "4px 0 0", color: "#64748b" }}>
                  {products.length} / {found} shown {loading ? " • Loading..." : ""}
                </p>
              </div>
            </div>

            {!loading && products.length === 0 && (
              <div style={{ background: "#fff", border: "1px solid #efd6d6", borderRadius: 18, padding: 24 }}>
                <h2 style={{ marginTop: 0 }}>No exact results found</h2>
                <p>Try one of these suggestions.</p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {(data?.fallback_terms || examples.slice(0, 6)).map((term) => (
                    <button
                      key={term}
                      onClick={() => {
                        setQuery(term);
                        setBrand("");
                        setCategory("");
                        runSearch(1, false, term, "", "");
                      }}
                      style={{ border: "1px solid #e5e7eb", background: "#fff", borderRadius: 999, padding: "9px 12px", fontWeight: 900 }}
                    >
                      {term}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14 }}>
              {products.map((product) => (
                <article key={product.id} style={{ background: "#fff", border: "1px solid #efd6d6", borderRadius: 18, overflow: "hidden" }}>
                  <a href={product.url || "#"} target="_blank" style={{ height: 160, display: "flex", alignItems: "center", justifyContent: "center", padding: 14, borderBottom: "1px solid #f1eeee" }}>
                    {product.image ? <img src={product.image} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : "No image"}
                  </a>
                  <div style={{ padding: 14 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, minHeight: 38 }}>{product.parent_name || product.name}</div>
                    <div style={{ color: "#c34d50", fontSize: 12, fontWeight: 900, minHeight: 32, marginTop: 8, overflow: "hidden" }}>
                      {product.option_text || product.variant_label || ""}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                      {product.brand && <Tag>{product.brand}</Tag>}
                      {product.sold_by && <Tag>{product.sold_by}</Tag>}
                      {product.sku && <Tag>SKU: {product.sku}</Tag>}
                    </div>
                    <div style={{ marginTop: 10, fontSize: 20 }}>{money(product.price)}</div>
                  </div>
                </article>
              ))}
            </div>

            {products.length < found && (
              <button
                disabled={loading}
                onClick={() => runSearch(page + 1, true)}
                style={{ margin: "24px auto 0", display: "block", border: 0, borderRadius: 999, background: "#c34d50", color: "#fff", height: 46, padding: "0 26px", fontWeight: 900 }}
              >
                {loading ? "Loading..." : "Show more products"}
              </button>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: 12, minWidth: 0 }}>
      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontWeight: 800, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function Tag({ children }: { children: React.ReactNode }) {
  return <span style={{ background: "#f3f4f6", borderRadius: 999, padding: "5px 7px", fontSize: 10, fontWeight: 800 }}>{children}</span>;
}

function Facet({
  title,
  items,
  selected,
  onSelect,
}: {
  title: string;
  items: Array<{ value: string; count: number }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  if (!items.length) return null;

  return (
    <div style={{ borderTop: "1px solid #e5e7eb", paddingTop: 14, marginTop: 14 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>{title}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 7, maxHeight: 310, overflow: "auto" }}>
        {items.slice(0, 30).map((item) => (
          <button
            key={item.value}
            onClick={() => onSelect(item.value)}
            style={{
              border: selected === item.value ? "1px solid #c34d50" : "1px solid #e5e7eb",
              background: selected === item.value ? "#fff8f8" : "#fff",
              color: selected === item.value ? "#c34d50" : "#1f2937",
              borderRadius: 12,
              minHeight: 38,
              padding: "8px 9px",
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.value}</span>
            <span style={{ background: "#f3f4f6", color: "#555", borderRadius: 999, padding: "3px 7px", fontSize: 11 }}>{item.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
