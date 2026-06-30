"use client";

import { useEffect, useState } from "react";

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

type FacetItem = {
  value: string;
  count: number;
};

type Facets = {
  brands: FacetItem[];
  categories: FacetItem[];
};

export default function SmartSearchPage() {
  const [query, setQuery] = useState("gloves");
  const [products, setProducts] = useState<Product[]>([]);
  const [facets, setFacets] = useState<Facets>({ brands: [], categories: [] });
  const [selectedBrand, setSelectedBrand] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [searched, setSearched] = useState(false);
  const [loading, setLoading] = useState(false);
  const [qtyById, setQtyById] = useState<Record<string, number>>({});

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) {
      setQuery(q);
      runSearch(q);
    } else {
      runSearch("gloves");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function runSearch(searchQuery = query, brand = selectedBrand, category = selectedCategory) {
    setLoading(true);
    setSearched(true);

    const params = new URLSearchParams();
    params.set("q", searchQuery || "*");
    if (brand) params.set("brand", brand);
    if (category) params.set("category", category);

    const res = await fetch(`/api/search?${params.toString()}`);
    const data = await res.json();

    const docs =
      data.hits?.map((hit: any) => {
        const doc = hit.document;
        return {
          id: doc.id,
          product_id: doc.product_id,
          name: doc.name,
          sku: doc.sku,
          brand: doc.brand,
          price: doc.price,
          sale_price: doc.sale_price,
          image: doc.image,
          url: doc.url,
          availability: doc.availability,
          availability_description: doc.availability_description,
        };
      }) || [];

    const brandFacet =
      data.facet_counts?.find((facet: any) => facet.field_name === "brand")?.counts || [];

    const categoryFacet =
      data.facet_counts?.find((facet: any) => facet.field_name === "categories")?.counts || [];

    setProducts(docs);
    setFacets({
      brands: brandFacet.slice(0, 18),
      categories: categoryFacet.slice(0, 24),
    });
    setLoading(false);

    const recent = JSON.parse(localStorage.getItem("emrn_recent_searches") || "[]");
    const nextRecent = [searchQuery, ...recent.filter((x: string) => x !== searchQuery)].slice(0, 6);
    localStorage.setItem("emrn_recent_searches", JSON.stringify(nextRecent));
  }

  function selectBrand(brand: string) {
    const next = selectedBrand === brand ? "" : brand;
    setSelectedBrand(next);
    runSearch(query, next, selectedCategory);
  }

  function selectCategory(category: string) {
    const next = selectedCategory === category ? "" : category;
    setSelectedCategory(next);
    runSearch(query, selectedBrand, next);
  }

  function clearFilters() {
    setSelectedBrand("");
    setSelectedCategory("");
    runSearch(query, "", "");
  }

  function updateQty(id: string, nextQty: number) {
    setQtyById((current) => ({
      ...current,
      [id]: Math.max(1, nextQty),
    }));
  }

  function getQty(id: string) {
    return qtyById[id] || 1;
  }

  const hasFilters = Boolean(selectedBrand || selectedCategory);

  return (
    <main className="emrn-search-page">
      <style>{styles}</style>

      <section className="emrn-search-hero">
        <div>
          <div className="eyebrow">EMRN SmartSearch</div>
          <h1>Search results built for medical supplies</h1>
          <p>
            Real EMRN product results from Typesense with SKU-first matching, brand/category filters,
            and product cards ready for Add to Cart, Choose Options, and Add to Quote.
          </p>
        </div>

        <div className="search-box">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                setSelectedBrand("");
                setSelectedCategory("");
                runSearch(query, "", "");
              }
            }}
            placeholder="Search products, brands, categories, or SKUs..."
          />
          <button
            onClick={() => {
              setSelectedBrand("");
              setSelectedCategory("");
              runSearch(query, "", "");
            }}
          >
            Search
          </button>
        </div>

        <div className="quick-searches">
          {["gloves", "masks", "LF03670", "AED", "oxygen", "Bard", "wound dressing"].map((term) => (
            <button
              key={term}
              onClick={() => {
                setQuery(term);
                setSelectedBrand("");
                setSelectedCategory("");
                runSearch(term, "", "");
              }}
            >
              {term}
            </button>
          ))}
        </div>
      </section>

      <section className="results-shell">
        <aside className="filters">
          <div className="filter-top">
            <div>
              <div className="filter-heading">Refine by</div>
              <div className="filter-note">
                {hasFilters ? "Filters applied" : "No filters applied"}
              </div>
            </div>

            {hasFilters && (
              <button className="clear-btn" onClick={clearFilters}>
                Clear
              </button>
            )}
          </div>

          {selectedBrand && (
            <div className="selected-pill">
              Brand: <strong>{selectedBrand}</strong>
              <button onClick={() => selectBrand(selectedBrand)}>×</button>
            </div>
          )}

          {selectedCategory && (
            <div className="selected-pill">
              Category: <strong>{selectedCategory}</strong>
              <button onClick={() => selectCategory(selectedCategory)}>×</button>
            </div>
          )}

          <FilterGroup
            title="Brands"
            items={facets.brands}
            selected={selectedBrand}
            onSelect={selectBrand}
            emptyText="Search first to see brands"
          />

          <FilterGroup
            title="Categories"
            items={facets.categories}
            selected={selectedCategory}
            onSelect={selectCategory}
            emptyText="Search first to see categories"
          />
        </aside>

        <div className="results-main">
          <div className="results-top">
            <div>
              <h2>{searched ? `Results for “${query}”` : "Search EMRN"}</h2>
              <p>
                {loading
                  ? "Searching..."
                  : `${products.length} products shown${
                      selectedBrand ? ` • ${selectedBrand}` : ""
                    }${selectedCategory ? ` • ${selectedCategory}` : ""}`}
              </p>
            </div>

            <select>
              <option>Featured Items</option>
              <option>Price: Low to High</option>
              <option>Price: High to Low</option>
              <option>Newest</option>
            </select>
          </div>

          {!loading && searched && products.length === 0 && (
            <div className="empty-state">
              <h3>No exact results found.</h3>
              <p>Try a different keyword, SKU, brand, or request a quote for help sourcing this item.</p>
              <button>Request a Quote</button>
            </div>
          )}

          <div className="product-grid">
            {products.map((product) => {
              const qty = getQty(product.id);
              const hasPrice = Number(product.price || 0) > 0;
              const price = Number(product.price || 0);
              const sale = Number(product.sale_price || 0);
              const name = product.name.toLowerCase();
              const needsOptions =
                name.includes("stethoscope") ||
                name.includes("littmann") ||
                name.includes("select") ||
                name.includes("choice");

              return (
                <article className="product-card" key={product.id}>
                  <a className="image-wrap" href={product.url || "#"} target="_blank">
                    {product.image ? (
                      <img src={product.image} alt={product.name} />
                    ) : (
                      <span>No image</span>
                    )}
                  </a>

                  <div className="card-body">
                    <div className="stars">★ ★ ★ ★ ★</div>
                    <a className="product-name" href={product.url || "#"} target="_blank">
                      {product.name}
                    </a>

                    <div className="meta-row">
                      {product.brand && <span>{product.brand}</span>}
                      {product.sku && <span>SKU: {product.sku}</span>}
                    </div>

                    <div className="availability">
                      {product.availability_description || product.availability || "Available to order"}
                    </div>

                    <div className="price">
                      {sale > 0 && sale < price ? (
                        <>
                          <span className="sale">${sale.toFixed(2)}</span>
                          <span className="was">${price.toFixed(2)}</span>
                        </>
                      ) : hasPrice ? (
                        `$${price.toFixed(2)}`
                      ) : (
                        "See product"
                      )}
                    </div>

                    <div className="qty-row">
                      <button onClick={() => updateQty(product.id, qty - 1)}>−</button>
                      <span>{qty}</span>
                      <button onClick={() => updateQty(product.id, qty + 1)}>+</button>
                    </div>

                    <button
                      className="cart-btn"
                      onClick={() => {
                        alert(
                          "Local preview only. On EMRN, this button will use BigCommerce add-to-cart and open the cart drawer."
                        );
                      }}
                    >
                      {needsOptions ? "Choose Options" : "Add to Cart"}
                    </button>

                    <button
                      className="quote-btn"
                      onClick={() => {
                        alert("Local preview only. On EMRN, this will connect to Add to Quote.");
                      }}
                    >
                      Add to quote
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>
    </main>
  );
}

function FilterGroup({
  title,
  items,
  selected,
  onSelect,
  emptyText,
}: {
  title: string;
  items: FacetItem[];
  selected: string;
  onSelect: (value: string) => void;
  emptyText: string;
}) {
  return (
    <div className="filter-group">
      <h3>{title}</h3>

      {items.length === 0 && <div className="empty-filter">{emptyText}</div>}

      <div className="facet-list">
        {items.map((item) => (
          <button
            key={item.value}
            className={selected === item.value ? "facet active" : "facet"}
            onClick={() => onSelect(item.value)}
            title={item.value}
          >
            <span className="facet-name">{item.value}</span>
            <span className="facet-count">{item.count}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

const styles = `
.emrn-search-page{
  min-height:100vh;
  background:#f7f7f8;
  color:#1f2937;
  font-family:Arial, sans-serif;
}
.emrn-search-hero{
  max-width:1180px;
  margin:0 auto;
  padding:32px 20px 22px;
}
.eyebrow{
  color:#c34d50;
  font-size:12px;
  font-weight:900;
  text-transform:uppercase;
  letter-spacing:.08em;
  margin-bottom:8px;
}
.emrn-search-hero h1{
  margin:0 0 8px;
  font-size:34px;
  letter-spacing:-.8px;
}
.emrn-search-hero p{
  margin:0 0 20px;
  color:#5f6673;
  max-width:800px;
  line-height:1.5;
}
.search-box{
  display:flex;
  gap:12px;
  margin-bottom:14px;
}
.search-box input{
  flex:1;
  height:58px;
  border:2px solid #c34d50;
  border-radius:999px;
  padding:0 22px;
  outline:none;
  background:#fff;
  font-size:17px;
  box-shadow:0 8px 22px rgba(195,77,80,.10);
}
.search-box button{
  border:0;
  border-radius:999px;
  background:#c34d50;
  color:#fff;
  padding:0 30px;
  font-weight:900;
  cursor:pointer;
}
.quick-searches{
  display:flex;
  gap:9px;
  flex-wrap:wrap;
}
.quick-searches button{
  border:1px solid #ddd;
  background:#fff;
  border-radius:999px;
  padding:10px 15px;
  font-weight:800;
  cursor:pointer;
}
.quick-searches button:hover{
  border-color:#c34d50;
  color:#c34d50;
}
.results-shell{
  max-width:1180px;
  margin:0 auto;
  padding:12px 20px 60px;
  display:grid;
  grid-template-columns:260px 1fr;
  gap:28px;
}
.filters{
  background:#fff;
  border:1px solid #e8e8e8;
  border-radius:18px;
  padding:18px;
  height:max-content;
  position:sticky;
  top:20px;
}
.filter-top{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  gap:12px;
  margin-bottom:12px;
}
.filter-heading{
  font-size:18px;
  font-weight:900;
}
.filter-note{
  color:#777;
  font-size:13px;
  margin-top:5px;
}
.clear-btn{
  border:1px solid #c34d50;
  background:#fff;
  color:#c34d50;
  border-radius:999px;
  padding:7px 10px;
  font-weight:900;
  cursor:pointer;
}
.selected-pill{
  display:flex;
  align-items:center;
  gap:5px;
  background:#fff6f6;
  border:1px solid #f0dada;
  color:#333;
  border-radius:12px;
  padding:9px 10px;
  margin:8px 0;
  font-size:13px;
}
.selected-pill button{
  margin-left:auto;
  border:0;
  background:#c34d50;
  color:#fff;
  width:20px;
  height:20px;
  border-radius:50%;
  cursor:pointer;
}
.filter-group{
  border-top:1px solid #eee;
  padding:16px 0;
}
.filter-group h3{
  margin:0 0 12px;
  font-size:15px;
}
.empty-filter{
  color:#8a8a8a;
  font-size:13px;
  line-height:1.4;
}
.facet-list{
  display:flex;
  flex-direction:column;
  gap:7px;
  max-height:360px;
  overflow:auto;
  padding-right:3px;
}
.facet{
  width:100%;
  border:1px solid #e5e7eb;
  background:#fff;
  border-radius:12px;
  min-height:38px;
  padding:8px 9px;
  display:flex;
  align-items:center;
  gap:8px;
  cursor:pointer;
  text-align:left;
  transition:all .14s ease;
}
.facet:hover{
  border-color:#c34d50;
  background:#fff8f8;
}
.facet.active{
  border-color:#c34d50;
  background:#c34d50;
  color:#fff;
}
.facet-name{
  flex:1;
  min-width:0;
  overflow:hidden;
  text-overflow:ellipsis;
  white-space:nowrap;
  font-weight:800;
  font-size:13px;
}
.facet-count{
  background:#f3f4f6;
  color:#555;
  border-radius:999px;
  padding:4px 7px;
  font-size:11px;
  font-weight:900;
}
.facet.active .facet-count{
  background:#fff;
  color:#c34d50;
}
.results-top{
  display:flex;
  align-items:center;
  justify-content:space-between;
  margin-bottom:18px;
}
.results-top h2{
  margin:0;
  font-size:24px;
}
.results-top p{
  margin:4px 0 0;
  color:#777;
}
.results-top select{
  height:42px;
  border:1px solid #ccc;
  border-radius:7px;
  background:#fff;
  padding:0 13px;
}
.product-grid{
  display:grid;
  grid-template-columns:repeat(3, minmax(0, 1fr));
  gap:20px;
}
.product-card{
  background:#fff;
  border:1px solid #f0dada;
  border-radius:18px;
  overflow:hidden;
  box-shadow:0 8px 22px rgba(0,0,0,.04);
  transition:transform .16s ease, box-shadow .16s ease, border-color .16s ease;
}
.product-card:hover{
  transform:translateY(-3px);
  border-color:#e7bfc0;
  box-shadow:0 16px 32px rgba(0,0,0,.09);
}
.image-wrap{
  height:230px;
  display:flex;
  align-items:center;
  justify-content:center;
  padding:22px;
  background:#fff;
  border-bottom:1px solid #f1eeee;
  text-decoration:none;
}
.image-wrap img{
  max-width:100%;
  max-height:100%;
  object-fit:contain;
}
.image-wrap span{
  color:#999;
}
.card-body{
  padding:18px;
}
.stars{
  color:#999;
  letter-spacing:2px;
  font-size:15px;
  margin-bottom:12px;
}
.product-name{
  display:block;
  min-height:58px;
  color:#252735;
  text-decoration:none;
  font-size:16px;
  font-weight:900;
  line-height:1.36;
}
.product-name:hover{
  color:#c34d50;
}
.meta-row{
  display:flex;
  gap:8px;
  flex-wrap:wrap;
  margin:10px 0 8px;
}
.meta-row span{
  background:#f3f4f6;
  border-radius:999px;
  padding:6px 8px;
  color:#555;
  font-size:11px;
  font-weight:800;
}
.availability{
  color:#087a52;
  font-size:12px;
  font-weight:900;
  margin:6px 0 14px;
  min-height:16px;
}
.price{
  font-size:24px;
  font-weight:400;
  color:#252735;
  min-height:32px;
  margin-bottom:14px;
}
.sale{
  color:#c34d50;
  font-weight:900;
  margin-right:10px;
}
.was{
  color:#777;
  font-size:15px;
  text-decoration:line-through;
}
.qty-row{
  height:42px;
  border:1px solid #f0dada;
  background:#fffafa;
  border-radius:999px;
  display:grid;
  grid-template-columns:42px 1fr 42px;
  align-items:center;
  text-align:center;
  margin-bottom:10px;
  overflow:hidden;
}
.qty-row button{
  height:100%;
  border:0;
  background:transparent;
  font-size:22px;
  font-weight:900;
  color:#555;
  cursor:pointer;
}
.qty-row span{
  font-weight:800;
}
.cart-btn,
.quote-btn{
  width:100%;
  height:48px;
  border-radius:999px;
  font-weight:900;
  cursor:pointer;
  transition:all .14s ease;
}
.cart-btn{
  border:2px solid #c34d50;
  background:#fff;
  color:#c34d50;
  margin-bottom:10px;
}
.cart-btn:hover{
  background:#c34d50;
  color:#fff;
}
.quote-btn{
  border:1px solid #f0dada;
  background:#fffafa;
  color:#333;
}
.quote-btn:hover{
  border-color:#c34d50;
  color:#c34d50;
}
.empty-state{
  background:#fff;
  border:1px solid #eee;
  border-radius:18px;
  padding:26px;
  margin-bottom:20px;
}
.empty-state button{
  border:0;
  background:#c34d50;
  color:#fff;
  border-radius:999px;
  padding:12px 18px;
  font-weight:900;
}
@media(max-width:960px){
  .results-shell{grid-template-columns:1fr;}
  .filters{position:static;}
  .product-grid{grid-template-columns:repeat(2, minmax(0, 1fr));}
}
@media(max-width:620px){
  .search-box{flex-direction:column;}
  .search-box button{height:50px;}
  .product-grid{grid-template-columns:1fr;}
}
`;
