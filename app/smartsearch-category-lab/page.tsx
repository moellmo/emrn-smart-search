"use client";

import { useEffect, useMemo, useState } from "react";

type Category = { id: number; parent_id: number; name: string; url: string };
type Hit = { document: any };
type FacetCount = { field_name: string; counts: Array<{ value: string; count: number }> };
type SearchResponse = { found?: number; page?: number; hits?: Hit[]; facet_counts?: FacetCount[] };

function money(value?: number) {
  if (!value) return "See product";
  return `$${Number(value).toFixed(2)}`;
}

function sortByName(a: Category, b: Category) {
  return a.name.localeCompare(b.name);
}

function normalize(value: string) {
  return String(value || "").toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
}

export default function SmartSearchCategoryLabPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [selectedId, setSelectedId] = useState<number>(0);
  const [brand, setBrand] = useState("");
  const [sort, setSort] = useState("popularity");
  const [priceMin, setPriceMin] = useState("");
  const [priceMax, setPriceMax] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SearchResponse | null>(null);
  const [allHits, setAllHits] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const [openIds, setOpenIds] = useState<Record<number, boolean>>({});

  const selectedCategory = useMemo(() => categories.find((cat) => cat.id === selectedId), [categories, selectedId]);

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

  const subcategories = useMemo(() => {
    if (!selectedCategory) return [];
    const children = byParent.get(selectedCategory.id) || [];
    if (children.length) return children;
    if (selectedCategory.parent_id) {
      return (byParent.get(selectedCategory.parent_id) || []).filter((cat) => cat.id !== selectedCategory.id);
    }
    return [];
  }, [byParent, selectedCategory]);

  async function loadCategories() {
    const res = await fetch("/api/category-tree");
    const json = await res.json();
    const cats: Category[] = json.categories || [];
    setCategories(cats);

    const params = new URLSearchParams(window.location.search);
    const wanted = params.get("category") || params.get("cat") || "";
    let firstUseful: Category | undefined;

    if (wanted) {
      const wantedNorm = normalize(wanted);
      firstUseful =
        cats.find((cat) => normalize(cat.name) === wantedNorm) ||
        cats.find((cat) => normalize(cat.name).includes(wantedNorm)) ||
        cats.find((cat) => wantedNorm.includes(normalize(cat.name)));
    }

    firstUseful =
      firstUseful ||
      cats.find((cat) => /diagnostics|gloves|masks|oxygen|training|first aid/i.test(cat.name)) ||
      cats[0];

    if (firstUseful) {
      setSelectedId(firstUseful.id);
      openParentPath(firstUseful.id, cats);
    }
  }

  function openParentPath(categoryId: number, sourceCategories = categories) {
    const next: Record<number, boolean> = {};
    let current = sourceCategories.find((cat) => cat.id === categoryId);
    next[categoryId] = true;
    while (current?.parent_id) {
      next[current.parent_id] = true;
      current = sourceCategories.find((cat) => cat.id === current?.parent_id);
    }
    setOpenIds((existing) => ({ ...existing, ...next }));
  }

  async function runCategorySearch(nextPage = 1, append = false, categoryId = selectedId) {
    if (!categoryId) return;
    setLoading(true);

    const params = new URLSearchParams();
    params.set("q", "*");
    params.set("page", String(nextPage));
    params.set("category_id", String(categoryId));
    params.set("sort", sort);
    const chosenCategory = categories.find((cat) => cat.id === categoryId);
    if (chosenCategory?.name) params.set("category", chosenCategory.name);
    if (brand) params.set("brand", brand);
    if (priceMin) params.set("price_min", priceMin);
    if (priceMax) params.set("price_max", priceMax);

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
    if (selectedId) runCategorySearch(1, false, selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, brand, sort]);

  function applyPrice() {
    runCategorySearch(1, false);
  }

  function chooseCategory(id: number) {
    setSelectedId(id);
    setBrand("");
    setPage(1);
    openParentPath(id);
    const cat = categories.find((item) => item.id === id);
    if (cat?.name) {
      const url = new URL(window.location.href);
      url.searchParams.set("category", cat.name);
      window.history.replaceState({}, "", url.toString());
    }
  }

  function renderTree(parentId = 0, level = 0): React.ReactNode {
    const children = byParent.get(parentId) || [];
    return children.map((category) => {
      const hasChildren = Boolean((byParent.get(category.id) || []).length);
      const isSelected = selectedId === category.id;
      return (
        <div key={category.id} style={{ marginLeft: level ? 12 : 0 }}>
          <div style={{ ...treeRowStyle, border: isSelected ? "1px solid #c34d50" : "1px solid #e5e7eb", background: isSelected ? "#fff8f8" : "#fff", color: isSelected ? "#c34d50" : "#1f2937" }}>
            {hasChildren ? (
              <button type="button" onClick={() => setOpenIds((ids) => ({ ...ids, [category.id]: !ids[category.id] }))} style={treeToggleStyle}>
                {openIds[category.id] ? "−" : "+"}
              </button>
            ) : (
              <span style={{ width: 24 }} />
            )}
            <button type="button" onClick={() => chooseCategory(category.id)} title={category.name} style={treeButtonStyle}>
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
        <div style={heroStyle}>
          <div style={{ color: "#c34d50", fontWeight: 900, letterSpacing: ".08em", fontSize: 12, textTransform: "uppercase" }}>
            EMRN SmartSearch Lab
          </div>
          <h1 style={{ margin: "8px 0 8px", fontSize: 34 }}>Category Page Replacement Test</h1>
          <p style={{ margin: 0, color: "#64748b" }}>
            Test a category directly with /smartsearch-category-lab?category=Diagnostics.
          </p>
        </div>

        {subcategories.length > 0 && (
          <div style={bubbleWrapStyle}>
            {subcategories.slice(0, 12).map((cat) => (
              <button key={cat.id} onClick={() => chooseCategory(cat.id)} style={bubbleStyle}>
                <span>{cat.name}</span>
              </button>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "290px 1fr", gap: 18 }}>
          <aside style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <section style={panelStyle}>
              <h2 style={{ fontSize: 18, margin: "0 0 8px" }}>Filters</h2>

              <div style={filterBlockStyle}>
                <div style={filterTitleStyle}>Price</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                  <input value={priceMin} onChange={(e) => setPriceMin(e.target.value)} placeholder="Min" style={inputStyle} />
                  <input value={priceMax} onChange={(e) => setPriceMax(e.target.value)} placeholder="Max" style={inputStyle} />
                </div>
                <button onClick={applyPrice} style={applyButtonStyle}>Apply Price</button>
              </div>

              <div style={filterBlockStyle}>
                <div style={filterTitleStyle}>Brand</div>
                {brand && <button onClick={() => setBrand("")} style={clearButtonStyle}>Clear brand</button>}
                <Facet items={brandFacet} selected={brand} onSelect={setBrand} />
              </div>

              <div style={filterBlockStyle}>
                <div style={filterTitleStyle}>Categories</div>
                <div style={{ maxHeight: 500, overflow: "auto" }}>{renderTree(0)}</div>
              </div>
            </section>
          </aside>

          <section>
            <div style={toolbarStyle}>
              <div>
                <h2 style={{ margin: 0, fontSize: 24 }}>{selectedCategory?.name || "Choose a category"}</h2>
                <p style={{ margin: "5px 0 0", color: "#64748b" }}>
                  {products.length} / {found} shown {brand ? `• Brand: ${brand}` : ""} {loading ? "• Loading..." : ""}
                </p>
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 900 }}>
                View by
                <select value={sort} onChange={(e) => setSort(e.target.value)} style={selectStyle}>
                  <option value="popularity">Popularity</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="price_desc">Price: High to Low</option>
                  <option value="name_asc">Name: A to Z</option>
                  <option value="name_desc">Name: Z to A</option>
                  <option value="newest">Newest</option>
                </select>
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 14 }}>
              {products.map((product) => (
                <article key={product.id} style={cardStyle}>
                  <a href={product.url || "#"} target="_blank" style={imageWrapStyle}>
                    {product.image ? <img src={product.image} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : "No image"}
                  </a>
                  <div style={{ padding: 14 }}>
                    <div style={{ fontSize: 14, fontWeight: 900, minHeight: 38 }}>{product.parent_name || product.name}</div>
                    <div style={{ color: "#c34d50", fontSize: 12, fontWeight: 900, minHeight: 30, marginTop: 8 }}>{product.option_text || product.variant_label || ""}</div>
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
              <button disabled={loading} onClick={() => runCategorySearch(page + 1, true)} style={showMoreStyle}>
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

function Facet({ items, selected, onSelect }: { items: Array<{ value: string; count: number }>; selected: string; onSelect: (value: string) => void }) {
  if (!items.length) return <p style={{ color: "#64748b", fontSize: 13 }}>No filters available.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      {items.slice(0, 30).map((item) => (
        <button key={item.value} onClick={() => onSelect(item.value)} style={{ ...facetButtonStyle, border: selected === item.value ? "1px solid #c34d50" : "1px solid #e5e7eb" }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.value}</span>
          <span style={countStyle}>{item.count}</span>
        </button>
      ))}
    </div>
  );
}

const heroStyle = { background: "linear-gradient(135deg,#fff,#fff7f7)", border: "1px solid #efd6d6", borderRadius: 22, padding: 24, marginBottom: 18 };
const panelStyle = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 16, height: "max-content" };
const toolbarStyle = { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 18, padding: 18, marginBottom: 16, display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" };
const selectStyle = { height: 42, border: "1px solid #e5e7eb", borderRadius: 12, padding: "0 12px", background: "#fff", fontWeight: 800 };
const inputStyle = { height: 38, border: "1px solid #e5e7eb", borderRadius: 12, padding: "0 10px", minWidth: 0 };
const filterBlockStyle = { borderTop: "1px solid #e5e7eb", paddingTop: 14, marginTop: 14 };
const filterTitleStyle = { fontWeight: 900, marginBottom: 8, color: "#c34d50" };
const applyButtonStyle = { width: "100%", height: 38, border: 0, borderRadius: 999, background: "#14365d", color: "#fff", fontWeight: 900, marginTop: 8 };
const clearButtonStyle = { width: "100%", height: 36, border: 0, borderRadius: 999, background: "#c34d50", color: "#fff", fontWeight: 900, marginBottom: 12 };
const facetButtonStyle = { background: "#fff", borderRadius: 12, minHeight: 38, padding: "8px 9px", display: "flex", justifyContent: "space-between", gap: 8, cursor: "pointer", fontWeight: 800 };
const countStyle = { background: "#f3f4f6", color: "#555", borderRadius: 999, padding: "3px 7px", fontSize: 11 };
const treeRowStyle = { display: "flex", alignItems: "center", gap: 6, minHeight: 36, borderRadius: 12, padding: "6px 7px", marginBottom: 6 };
const treeToggleStyle = { border: 0, width: 24, height: 24, borderRadius: 7, background: "#f3f4f6", cursor: "pointer", fontWeight: 900 };
const treeButtonStyle = { flex: 1, minWidth: 0, border: 0, background: "transparent", color: "inherit", cursor: "pointer", textAlign: "left" as const, fontWeight: 850, fontSize: 13, whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis" };
const bubbleWrapStyle = { display: "flex", gap: 14, overflowX: "auto" as const, padding: "4px 0 18px", marginBottom: 2 };
const bubbleStyle = { minWidth: 120, minHeight: 72, border: "1px solid #efd6d6", borderRadius: 18, background: "#fff", padding: "10px 14px", fontWeight: 900, color: "#1f2937", cursor: "pointer" };
const cardStyle = { background: "#fff", border: "1px solid #efd6d6", borderRadius: 18, overflow: "hidden" };
const imageWrapStyle = { height: 160, display: "flex", alignItems: "center", justifyContent: "center", padding: 14, borderBottom: "1px solid #f1eeee" };
const showMoreStyle = { margin: "24px auto 0", display: "block", border: 0, borderRadius: 999, background: "#c34d50", color: "#fff", height: 46, padding: "0 26px", fontWeight: 900 };
