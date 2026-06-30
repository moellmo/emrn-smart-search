"use client";

import { useEffect, useRef, useState } from "react";

type Product = {
  id: string;
  product_id: number;
  name: string;
  sku?: string;
  brand?: string;
  price?: number;
  sale_price?: number;
  image?: string;
  url?: string;
  availability?: string;
  availability_description?: string;
};

type Facet = {
  field: string;
  values: Array<{
    value: string;
    count: number;
  }>;
};

const POPULAR_SEARCHES = [
  "gloves",
  "masks",
  "AED",
  "oxygen",
  "foley catheter",
  "wound dressing",
  "stethoscope",
  "CPR manikin",
];

export default function AutocompletePreviewPage() {
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [facets, setFacets] = useState<Facet[]>([]);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [open, setOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setRecentSearches(JSON.parse(localStorage.getItem("emrn_recent_searches") || "[]"));
  }, []);

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    if (query.trim().length < 2) {
      setProducts([]);
      setFacets([]);
      setOpen(true);
      return;
    }

    timeoutRef.current = setTimeout(async () => {
      setLoading(true);
      setOpen(true);

      const res = await fetch(`/api/autocomplete?q=${encodeURIComponent(query)}`);
      const data = await res.json();

      setProducts(data.products || []);
      setFacets(data.facets || []);
      setLoading(false);
    }, 150);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [query]);

  function submitSearch(term = query) {
    const clean = term.trim();
    if (!clean) return;

    const recent = JSON.parse(localStorage.getItem("emrn_recent_searches") || "[]");
    const nextRecent = [clean, ...recent.filter((x: string) => x !== clean)].slice(0, 6);
    localStorage.setItem("emrn_recent_searches", JSON.stringify(nextRecent));
    setRecentSearches(nextRecent);

    window.location.href = `/smartsearch?q=${encodeURIComponent(clean)}`;
  }

  const brandFacet = facets.find((facet) => facet.field === "brand");
  const categoryFacet = facets.find((facet) => facet.field === "categories");

  return (
    <main className="auto-page">
      <style>{styles}</style>

      <div className="auto-wrap">
        <div className="auto-header">
          <div className="eyebrow">EMRN SmartSearch</div>
          <h1>Autocomplete preview</h1>
          <p>Products, brands, categories, popular searches, and recent searches in one clear dropdown.</p>
        </div>

        <div className="search-row">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitSearch();
            }}
            placeholder="Search EMRN products, brands, categories, or SKUs..."
          />
          <button onClick={() => submitSearch()}>Search</button>
        </div>

        {open && (
          <section className="dropdown">
            <div className="dropdown-products">
              <div className="section-title">Products</div>

              {query.trim().length < 2 && (
                <StarterPanel
                  recentSearches={recentSearches}
                  onSearch={(term) => {
                    setQuery(term);
                    submitSearch(term);
                  }}
                />
              )}

              {query.trim().length >= 2 && loading && <div className="loading">Searching...</div>}

              {query.trim().length >= 2 && !loading && products.length === 0 && (
                <div className="no-results">
                  <h3>No product suggestions found.</h3>
                  <p>Try another keyword, SKU, brand, or request a quote.</p>
                </div>
              )}

              {query.trim().length >= 2 &&
                !loading &&
                products.map((product) => (
                  <a key={product.id} href={product.url || "#"} target="_blank" className="suggestion">
                    <div className="sugg-img">
                      {product.image ? <img src={product.image} alt={product.name} /> : <span>No image</span>}
                    </div>

                    <div className="sugg-info">
                      <div className="sugg-name">{product.name}</div>
                      <div className="sugg-meta">
                        {product.brand || "EMRN"}
                        {product.sku ? ` • SKU: ${product.sku}` : ""}
                      </div>
                    </div>

                    <div className="sugg-action">View</div>
                  </a>
                ))}

              {query.trim().length >= 2 && products.length > 0 && (
                <button className="view-all" onClick={() => submitSearch()}>
                  View all results for “{query}”
                </button>
              )}
            </div>

            <aside className="dropdown-side">
              {query.trim().length >= 2 ? (
                <>
                  <SideSection
                    title="Suggested Brands"
                    items={brandFacet?.values || []}
                    onClick={(term) => {
                      setQuery(term);
                      submitSearch(term);
                    }}
                  />

                  <SideSection
                    title="Suggested Categories"
                    items={categoryFacet?.values || []}
                    onClick={(term) => {
                      setQuery(term);
                      submitSearch(term);
                    }}
                  />
                </>
              ) : (
                <>
                  <ChipBox title="Popular Searches" items={POPULAR_SEARCHES} onClick={(term) => setQuery(term)} />
                  <ChipBox title="Recent Searches" items={recentSearches} onClick={(term) => setQuery(term)} />
                </>
              )}

              <div className="quote-help">
                <span>Can’t find the item?</span>
                <strong>Request a quote and EMRN can help source it.</strong>
              </div>
            </aside>
          </section>
        )}

        <div className="tips">
          Try: <button onClick={() => setQuery("masks")}>masks</button>
          <button onClick={() => setQuery("LF03670")}>LF03670</button>
          <button onClick={() => setQuery("Bard")}>Bard</button>
          <button onClick={() => setQuery("oxygen")}>oxygen</button>
        </div>
      </div>
    </main>
  );
}

function StarterPanel({
  recentSearches,
  onSearch,
}: {
  recentSearches: string[];
  onSearch: (term: string) => void;
}) {
  return (
    <div className="starter-panel">
      <h3>Start typing to search EMRN</h3>
      <p>Try product names, SKUs, brands, categories, or common medical terms.</p>
      <div className="starter-grid">
        {POPULAR_SEARCHES.slice(0, 6).map((term) => (
          <button key={term} onClick={() => onSearch(term)}>
            {term}
          </button>
        ))}
      </div>
      {recentSearches.length > 0 && (
        <>
          <div className="mini-title">Recent</div>
          <div className="starter-grid">
            {recentSearches.map((term) => (
              <button key={term} onClick={() => onSearch(term)}>
                {term}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function SideSection({
  title,
  items,
  onClick,
}: {
  title: string;
  items: Array<{ value: string; count: number }>;
  onClick: (term: string) => void;
}) {
  if (!items.length) return null;

  return (
    <div className="side-card">
      <h3>{title}</h3>
      <div className="chips">
        {items.slice(0, 7).map((item) => (
          <button key={item.value} onClick={() => onClick(item.value)}>
            {item.value} <span>({item.count})</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function ChipBox({
  title,
  items,
  onClick,
}: {
  title: string;
  items: string[];
  onClick: (term: string) => void;
}) {
  if (!items.length) return null;

  return (
    <div className="side-card">
      <h3>{title}</h3>
      <div className="chips">
        {items.map((item) => (
          <button key={item} onClick={() => onClick(item)}>
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

const styles = `
.auto-page{
  min-height:100vh;
  background:linear-gradient(180deg,#fff 0%,#fbf6f6 100%);
  font-family:Arial,sans-serif;
  color:#1f2937;
  padding:38px 20px;
}
.auto-wrap{
  max-width:1050px;
  margin:0 auto;
}
.auto-header{
  margin-bottom:20px;
}
.eyebrow{
  color:#c34d50;
  font-size:12px;
  font-weight:900;
  text-transform:uppercase;
  letter-spacing:.08em;
}
.auto-header h1{
  margin:8px 0;
  font-size:34px;
}
.auto-header p{
  margin:0;
  color:#666;
}
.search-row{
  display:flex;
  gap:12px;
  position:relative;
  z-index:2;
}
.search-row input{
  flex:1;
  height:60px;
  border:2px solid #c34d50;
  border-radius:999px;
  outline:none;
  padding:0 24px;
  background:#fff;
  font-size:17px;
  box-shadow:0 10px 24px rgba(195,77,80,.12);
}
.search-row button{
  border:0;
  background:#c34d50;
  color:#fff;
  border-radius:999px;
  padding:0 34px;
  font-weight:900;
  cursor:pointer;
}
.dropdown{
  margin-top:12px;
  display:grid;
  grid-template-columns:1.55fr .85fr;
  background:#fff;
  border:1px solid #ead7d8;
  border-radius:24px;
  overflow:hidden;
  box-shadow:0 24px 60px rgba(20,30,55,.14);
}
.dropdown-products{
  padding:22px;
  border-right:1px solid #eee;
}
.dropdown-side{
  padding:22px;
  background:#fff8f8;
}
.section-title{
  color:#c34d50;
  font-size:12px;
  font-weight:900;
  text-transform:uppercase;
  letter-spacing:.08em;
  margin-bottom:14px;
}
.suggestion{
  display:grid;
  grid-template-columns:62px 1fr auto;
  gap:14px;
  align-items:center;
  padding:10px;
  border:1px solid transparent;
  border-radius:16px;
  color:#1f2937;
  text-decoration:none;
  transition:background .14s ease,border-color .14s ease, transform .14s ease;
}
.suggestion:hover{
  background:#fff6f6;
  border-color:#efcccc;
  transform:translateX(2px);
}
.sugg-img{
  width:62px;
  height:62px;
  border:1px solid #eee;
  border-radius:14px;
  background:#fafafa;
  display:flex;
  align-items:center;
  justify-content:center;
  overflow:hidden;
}
.sugg-img img{
  max-width:100%;
  max-height:100%;
  object-fit:contain;
}
.sugg-img span{
  font-size:10px;
  color:#999;
}
.sugg-name{
  font-size:15px;
  font-weight:900;
  line-height:1.3;
}
.sugg-meta{
  color:#666;
  font-size:12px;
  margin-top:5px;
}
.sugg-action{
  background:#f3f4f6;
  border-radius:999px;
  padding:8px 11px;
  font-size:12px;
  font-weight:900;
}
.suggestion:hover .sugg-action{
  background:#c34d50;
  color:#fff;
}
.view-all{
  margin-top:16px;
  width:100%;
  height:46px;
  border:0;
  background:#c34d50;
  color:#fff;
  border-radius:999px;
  font-weight:900;
  cursor:pointer;
}
.side-card{
  background:#fff;
  border:1px solid #eee;
  border-radius:18px;
  padding:16px;
  margin-bottom:14px;
}
.side-card h3{
  margin:0 0 12px;
  font-size:16px;
}
.chips{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
}
.chips button{
  border:1px solid #e5e7eb;
  background:#f5f6f8;
  border-radius:999px;
  padding:8px 10px;
  font-weight:900;
  font-size:12px;
  cursor:pointer;
}
.chips button:hover{
  border-color:#c34d50;
  color:#c34d50;
  background:#fff;
}
.chips span{
  color:#666;
}
.quote-help{
  background:#14365d;
  color:#fff;
  border-radius:18px;
  padding:16px;
  line-height:1.4;
}
.quote-help span{
  display:block;
  opacity:.9;
  font-size:13px;
}
.quote-help strong{
  display:block;
  margin-top:3px;
}
.starter-panel{
  background:#fffafa;
  border:1px solid #f0dada;
  border-radius:18px;
  padding:20px;
}
.starter-panel h3{
  margin:0 0 6px;
}
.starter-panel p{
  color:#666;
  margin:0 0 14px;
}
.starter-grid{
  display:flex;
  gap:9px;
  flex-wrap:wrap;
}
.starter-grid button,
.tips button{
  border:1px solid #ddd;
  background:#fff;
  border-radius:999px;
  padding:9px 13px;
  font-weight:900;
  cursor:pointer;
}
.starter-grid button:hover,
.tips button:hover{
  border-color:#c34d50;
  color:#c34d50;
}
.mini-title{
  margin:16px 0 8px;
  font-weight:900;
  font-size:13px;
  color:#666;
  text-transform:uppercase;
  letter-spacing:.06em;
}
.loading,
.no-results{
  color:#666;
  background:#fffafa;
  border:1px solid #f0dada;
  border-radius:16px;
  padding:18px;
}
.no-results h3{
  margin:0 0 6px;
}
.no-results p{
  margin:0;
}
.tips{
  margin-top:24px;
  color:#666;
  display:flex;
  align-items:center;
  gap:8px;
  flex-wrap:wrap;
}
@media(max-width:850px){
  .dropdown{
    grid-template-columns:1fr;
  }
  .dropdown-products{
    border-right:0;
    border-bottom:1px solid #eee;
  }
}
@media(max-width:560px){
  .search-row{
    flex-direction:column;
  }
  .search-row button{
    height:50px;
  }
  .suggestion{
    grid-template-columns:54px 1fr;
  }
  .sugg-action{
    display:none;
  }
}
`;
