"use client";

import { useEffect, useMemo, useState } from "react";

type Category = {
  id: number;
  parent_id: number;
  name: string;
  url: string;
};

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
    smart_reasons?: string[];
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
};

function money(value?: number) {
  if (!value) return "See product";
  return `$${Number(value).toFixed(2)}`;
}

function sortByName(a: Category, b: Category) {
  return a.name.localeCompare(b.name);
}

export default function SmartSearchCategoryLabPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<number>(0);
  const [brand, setBrand] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [allHits, setAllHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [openIds, setOpenIds] = useState<Record<number, boolean>>({});

  const selectedCategory = useMemo(
    () => categories.find((cat) => Number(cat.id) === Number(selectedId)),
    [categories, selectedId]
  );

  const byParent = useMemo(() => {
    const map = new Map<number, Category[]>();
    for (const category of categories) {
      const parent = Number(category.parent_id || 0);
      if (!map.has(parent)) map.set(parent, []);
      map.get(parent)!.push(category);
    }
    for (const list of map.values()) list.sort(sortByName);
    return map;
  }, [categories]);

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

  const relevantCategoryNames = useMemo(() => {
    return new Set(categoryFacet.map((item) => item.value.toLowerCase()));
  }, [categoryFacet]);

  async function loadCategories() {
    const res = await fetch("/api/category-tree");
    const json = await res.json();
    const cats: Category[] = json.categories || [];
    setCategories(cats);

    if (!selectedId && cats.length) {
      const firstUseful =
        cats.find((cat) => /gloves|masks|oxygen|training|first aid/i.test(cat.name)) || cats[0];
      setSelectedId(firstUseful.id);
      openParentPath(firstUseful.id, cats);
    }
  }

  function openParentPath(categoryId: number, sourceCategories = categories) {
    const next: Record<number, boolean> = {};
    let current = sourceCategories.find((cat) => Number(cat.id) === Number(categoryId));

    while (current?.parent_id) {
      next[current.parent_id] = true;
      current = sourceCategories.find((cat) => Number(cat.id) === Number(current?.parent_id));
    }

    setOpenIds((existing) => ({ ...existing, ...next }));
  }

  async function runCategorySearch(nextPage = 1, append = false, categoryId = selectedId, nextBrand = brand) {
    if (!categoryId) return;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("q", "*");
    params.set("page", String(nextPage));
    params.set("category_id", String(categoryId));
    if (nextBrand) params.set("brand", nextBrand);

    const res = await fetch(`/api/search?${params.toString()}`);
    const json: SearchResponse = await res.json();

    setData(json);
    setPage(nextPage);
    setAllHits((current) => (append ? [...current, ...(json.hits || [])] : json.hits || []));
    setLoading(false);
  }

  useEffect(() => {
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedId) runCategorySearch(1, false, selectedId, brand);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, brand]);

  function chooseCategory(id: number) {
    setSelectedId(id);
    setBrand("");
    setPage(1);
    openParentPath(id);
  }

  function renderTree(parentId = 0, level = 0): React.ReactNode {
    const children = byParent.get(parentId) || [];

    return children.map((category) => {
      const hasChildren = Boolean((byParent.get(category.id) || []).length);
      const isSelected = Number(selectedId) === Number(category.id);
      const isRelevant = relevantCategoryNames.has(category.name.toLowerCase());

      return (
        <div key={category.id} style={{ marginLeft: level ? 12 : 0 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              minHeight: 36,
              border: isSelected ? "1px solid #c34d50" : "1px solid #e5e7eb",
              background: isSelected ? "#fff8f8" : isRelevant ? "#ffffff" : "#fafafa",
              color: isSelected ? "#c34d50" : "#1f2937",
              borderRadius: 12,
              padding: "6px 7px",
              marginBottom: 6,
              opacity: isRelevant || isSelected || !categoryFacet.length ? 1 : 0.68,
            }}
          >
            {hasChildren ? (
              <button
                type="button"
                onClick={() => setOpenIds((ids) => ({ ...ids, [category.id]: !ids[category.id] }))}
                style={{
                  border: 0,
                  width: 24,
                  height: 24,
                  borderRadius: 7,
                  background: "#f3f4f6",
                  cursor: "pointer",
                  fontWeight: 900,
                }}
              >
                {openIds[category.id] ? "−" : "+"}
              </button>
            ) : (
              <span style={{ width: 24 }} />
            )}

            <button
              type="button"
              onClick={() => chooseCategory(category.id)}
              title={category.name}
              style={{
                flex: 1,
                minWidth: 0,
                border: 0,
                background: "transparent",
                color: "inherit",
                cursor: "pointer",
                textAlign: "left",
                fontWeight: 850,
                fontSize: 13,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {category.name}
            </button>
          </div>

          {hasChildren && openIds[category.id] && renderTree(category.id, level + 1)}
        </div>
      );
    });
  }

  return (
    <main style={{ fontFamily: "Inter, Arial, sans-serif", background: "#f8fafc", minHeight: "100vh", padding: 24 }}>
      <section style={{ maxWidth: 1320, margin: "0 auto" }}>
        <div style={{ background: "linear-gradient(135deg,#fff,#fff7f7)", border: "1px solid #efd6d6", borderRadius: 22, padding: 24, marginBottom: 18 }}>
          <div style={{ color: "#c34d50", fontWeight: 900, letterSpacing: ".08em", fontSize: 12, textTransform: "uppercase" }}>
            EMRN SmartSearch Lab
          </div>
          <h1 style={{ margin: "8px 0 8px", fontSize: 34 }}>Category Page Replacement Test</h1>
          <p style={{ margin: 0, color: "#64748b" }}>
            Test SmartSearch category pages before replacing Fast Simon category grids on EMRN.
          </p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <a href="/smartsearch-lab" style={linkButtonStyle}>Search Lab</a>
            {selectedCategory?.url && (
              <a href={selectedCategory.url} target="_blank" style={linkButtonStyle}>
                Open real category page
              </a>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "310px 1fr", gap: 18 }}>
          <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <section style={panelStyle}>
              <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Category Tree</h2>
              <p style={{ color: "#64748b", fontSize: 13, marginTop: 0 }}>
                Pick a category to preview the replacement grid.
              </p>
              <div style={{ maxHeight: 620, overflow: "auto" }}>{renderTree(0)}</div>
            </section>

            <section style={panelStyle}>
              <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Brand Filters</h2>
              {brand && (
                <button
                  onClick={() => setBrand("")}
                  style={{ width: "100%", height: 38, border: 0, borderRadius: 999, background: "#c34d50", color: "#fff", fontWeight: 900, marginBottom: 14 }}
                >
                  Clear brand
                </button>
              )}
              <Facet items={brandFacet} selected={brand} onSelect={setBrand} />
            </section>

            <section style={panelStyle}>
              <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Relevant Categories</h2>
              <Facet
                items={categoryFacet}
                selected={selectedCategory?.name || ""}
                onSelect={(name) => {
                  const match = categories.find((cat) => cat.name === name);
                  if (match) chooseCategory(match.id);
                }}
              />
            </section>
          </aside>

          <section>
            <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 18, marginBottom: 16 }}>
              <div style={{ color: "#c34d50", fontWeight: 900, fontSize: 12, textTransform: "uppercase", letterSpacing: ".08em" }}>
                Selected Category
              </div>
              <h2 style={{ margin: "6px 0 6px", fontSize: 28 }}>{selectedCategory?.name || "Choose a category"}</h2>
              <p style={{ margin: 0, color: "#64748b" }}>
                {products.length} / {found} shown {brand ? `• Brand: ${brand}` : ""} {loading ? "• Loading..." : ""}
              </p>
            </div>

            {!loading && products.length === 0 && (
              <div style={{ background: "#fff", border: "1px solid #efd6d6", borderRadius: 18, padding: 24, marginBottom: 16 }}>
                <h2 style={{ marginTop: 0 }}>No products found for this category/filter.</h2>
                <p>Try clearing brand filters or choosing a parent category.</p>
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
                      <Tag>PID: {product.product_id}</Tag>
                      <Tag>VID: {product.variant_id || 0}</Tag>
                    </div>
                    <div style={{ marginTop: 10, fontSize: 20 }}>{money(product.price)}</div>
                  </div>
                </article>
              ))}
            </div>

            {products.length < found && (
              <button
                disabled={loading}
                onClick={() => runCategorySearch(page + 1, true)}
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

function Tag({ children }: { children: React.ReactNode }) {
  return <span style={{ background: "#f3f4f6", borderRadius: 999, padding: "5px 7px", fontSize: 10, fontWeight: 800 }}>{children}</span>;
}

function Facet({
  items,
  selected,
  onSelect,
}: {
  items: Array<{ value: string; count: number }>;
  selected: string;
  onSelect: (value: string) => void;
}) {
  if (!items.length) return <p style={{ color: "#64748b" }}>No filters available yet.</p>;

  return (
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
  );
}

const panelStyle = {
  background: "#fff",
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  padding: 16,
  height: "max-content",
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
