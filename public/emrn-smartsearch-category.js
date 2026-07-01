(() => {
  const DEFAULT_CONFIG = {
    enabled: true,
    apiBase: "",
    storeUrl: "https://emrn.ca",
    categoryMode: true,
    replaceCategoryPages: false,
    requireSmartCategoryParam: true,
    addToCartEnabled: true
  };

  const config = Object.assign({}, DEFAULT_CONFIG, window.EMRNSmartSearchConfig || {});
  const paramsOnLoad = new URLSearchParams(window.location.search);
  const allowedByUrl = paramsOnLoad.get("smartcategory") === "1";

  if (!config.enabled || !config.categoryMode || !config.replaceCategoryPages) return;
  if (config.requireSmartCategoryParam !== false && !allowedByUrl) return;

  const apiBase = (config.apiBase || "").replace(/\/$/, "");
  if (!apiBase) return;

  const state = {
    categories: [],
    currentCategory: null,
    products: [],
    found: 0,
    page: 1,
    brand: "",
    sort: "popularity",
    priceMin: "",
    priceMax: "",
    loading: false,
    openIds: {},
    data: null
  };

  function money(value) {
    const n = Number(value || 0);
    if (!n) return "See product";
    return "$" + n.toFixed(2);
  }

  function normalizePath(url) {
    try {
      const u = new URL(url, window.location.origin);
      return u.pathname.replace(/\/+$/, "") || "/";
    } catch {
      return String(url || "").replace(/\/+$/, "") || "/";
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function fetchJson(url, options) {
    const res = await fetch(url, options || { credentials: "omit" });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  function matchCurrentCategory(categories) {
    const currentPath = normalizePath(window.location.href);
    let match = categories.find((cat) => normalizePath(cat.url) === currentPath);
    if (match) return match;

    const title = (document.querySelector("h1")?.textContent || "").trim().toLowerCase();
    if (title) {
      match = categories.find((cat) => cat.name.toLowerCase() === title);
      if (match) return match;
    }

    return null;
  }

  function getChildren(parentId) {
    return state.categories
      .filter((cat) => Number(cat.parent_id || 0) === Number(parentId || 0))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  function getSiblingOrChildrenBubbles() {
    const cat = state.currentCategory;
    if (!cat) return [];
    const children = getChildren(cat.id);
    if (children.length) return children;
    if (cat.parent_id) return getChildren(cat.parent_id).filter((item) => item.id !== cat.id);
    return [];
  }

  function openParentPath(categoryId) {
    let current = state.categories.find((cat) => Number(cat.id) === Number(categoryId));
    state.openIds[categoryId] = true;
    while (current && current.parent_id) {
      state.openIds[current.parent_id] = true;
      current = state.categories.find((cat) => Number(cat.id) === Number(current.parent_id));
    }
  }

  function findMount() {
    return (
      document.querySelector("[data-smartsearch-category-mount]") ||
      document.querySelector(".productGrid")?.parentElement ||
      document.querySelector("#product-listing-container") ||
      document.querySelector(".page-content") ||
      document.querySelector("main")
    );
  }

  function hideOldProductGrid() {
    const selectors = [
      ".productGrid",
      ".pagination",
      ".facetedSearch",
      "#faceted-search-container",
      "#product-listing-container",
      ".fs-results",
      ".fast-simon-serp"
    ];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        if (!el.closest("#emrn-smart-category-root")) {
          el.setAttribute("data-emrn-smart-hidden", "1");
          el.style.display = "none";
        }
      });
    });
  }

  function renderTree(parentId = 0, level = 0) {
    return getChildren(parentId)
      .map((cat) => {
        const children = getChildren(cat.id);
        const isOpen = Boolean(state.openIds[cat.id]);
        const isSelected = state.currentCategory && Number(state.currentCategory.id) === Number(cat.id);
        return `
          <div class="emrn-smart-tree-row-wrap" style="margin-left:${level ? 12 : 0}px">
            <div class="emrn-smart-tree-row ${isSelected ? "is-selected" : ""}">
              ${
                children.length
                  ? `<button class="emrn-smart-tree-toggle" data-toggle-category="${cat.id}" type="button">${isOpen ? "−" : "+"}</button>`
                  : `<span class="emrn-smart-tree-spacer"></span>`
              }
              <button class="emrn-smart-tree-link" data-category-id="${cat.id}" type="button" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</button>
            </div>
            ${children.length && isOpen ? renderTree(cat.id, level + 1) : ""}
          </div>
        `;
      })
      .join("");
  }

  function productCard(product) {
    const pid = Number(product.product_id || product.id || 0);
    const vid = Number(product.variant_id || 0);
    return `
      <article class="emrn-smart-card" data-product-id="${pid}" data-variant-id="${vid}">
        <a class="emrn-smart-card-image" href="${escapeHtml(product.url || "#")}">
          ${product.image ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.parent_name || product.name || "")}">` : ""}
        </a>
        <div class="emrn-smart-card-body">
          <a class="emrn-smart-card-title" href="${escapeHtml(product.url || "#")}">${escapeHtml(product.parent_name || product.name || "")}</a>
          <div class="emrn-smart-card-variant">${escapeHtml(product.option_text || product.variant_label || "")}</div>
          <div class="emrn-smart-tags">
            ${product.brand ? `<span>${escapeHtml(product.brand)}</span>` : ""}
            ${product.sold_by ? `<span>${escapeHtml(product.sold_by)}</span>` : ""}
            ${product.sku ? `<span>SKU: ${escapeHtml(product.sku)}</span>` : ""}
          </div>
          <div class="emrn-smart-price">${money(product.price)}</div>
          <div class="emrn-smart-actions">
            <button class="emrn-smart-add-cart" type="button" data-product-id="${pid}" data-variant-id="${vid}">Add</button>
            <input class="emrn-smart-qty" type="number" min="1" value="1" inputmode="numeric">
            <a class="emrn-smart-view" href="${escapeHtml(product.url || "#")}">View</a>
          </div>
          <div class="emrn-smart-cart-msg" aria-live="polite"></div>
        </div>
      </article>
    `;
  }

  function render() {
    const root = document.querySelector("#emrn-smart-category-root");
    if (!root || !state.currentCategory) return;

    const bubbles = getSiblingOrChildrenBubbles();
    const brandFacet = (state.data?.facet_counts || []).find((facet) => facet.field_name === "brand")?.counts || [];

    root.innerHTML = `
      <div class="emrn-smart-cat">
        ${
          bubbles.length
            ? `<div class="emrn-smart-bubbles">
                ${bubbles
                  .slice(0, 12)
                  .map((cat) => `<button data-category-id="${cat.id}" class="emrn-smart-bubble" type="button">${escapeHtml(cat.name)}</button>`)
                  .join("")}
              </div>`
            : ""
        }

        <div class="emrn-smart-layout">
          <aside class="emrn-smart-sidebar">
            <div class="emrn-smart-filter-title">Filters</div>

            <div class="emrn-smart-filter-block">
              <button class="emrn-smart-mobile-filter-close" type="button">Hide Filters</button>
            </div>

            <div class="emrn-smart-filter-block">
              <div class="emrn-smart-filter-heading">Price</div>
              <div class="emrn-smart-price-filter">
                <input class="emrn-smart-price-min" placeholder="Min" value="${escapeHtml(state.priceMin)}">
                <input class="emrn-smart-price-max" placeholder="Max" value="${escapeHtml(state.priceMax)}">
              </div>
              <button class="emrn-smart-apply-price" type="button">Apply Price</button>
            </div>

            <div class="emrn-smart-filter-block">
              <div class="emrn-smart-filter-heading">Brand</div>
              ${state.brand ? `<button class="emrn-smart-clear-brand" type="button">Clear brand</button>` : ""}
              <div class="emrn-smart-facets">
                ${brandFacet
                  .slice(0, 40)
                  .map(
                    (item) => `
                      <button class="emrn-smart-facet ${state.brand === item.value ? "is-selected" : ""}" data-brand="${escapeHtml(item.value)}" type="button">
                        <span>${escapeHtml(item.value)}</span><em>${item.count}</em>
                      </button>
                    `
                  )
                  .join("")}
              </div>
            </div>

            <div class="emrn-smart-filter-block">
              <div class="emrn-smart-filter-heading">Categories</div>
              <div class="emrn-smart-tree">${renderTree(0)}</div>
            </div>
          </aside>

          <section class="emrn-smart-results">
            <div class="emrn-smart-toolbar">
              <div class="emrn-smart-count">${state.products.length} / ${state.found} shown</div>
              <div class="emrn-smart-toolbar-actions">
                <button class="emrn-smart-show-filters" type="button">Show Filters</button>
                <label>
                  View by
                  <select class="emrn-smart-sort">
                    <option value="popularity" ${state.sort === "popularity" ? "selected" : ""}>Popularity</option>
                    <option value="price_asc" ${state.sort === "price_asc" ? "selected" : ""}>Price: Low to High</option>
                    <option value="price_desc" ${state.sort === "price_desc" ? "selected" : ""}>Price: High to Low</option>
                    <option value="name_asc" ${state.sort === "name_asc" ? "selected" : ""}>Name: A to Z</option>
                    <option value="name_desc" ${state.sort === "name_desc" ? "selected" : ""}>Name: Z to A</option>
                    <option value="newest" ${state.sort === "newest" ? "selected" : ""}>Newest</option>
                  </select>
                </label>
              </div>
            </div>

            ${
              state.loading && !state.products.length
                ? `<div class="emrn-smart-loading">Loading products...</div>`
                : `<div class="emrn-smart-grid">${state.products.map(productCard).join("")}</div>`
            }

            ${
              state.products.length < state.found
                ? `<button class="emrn-smart-more" type="button" ${state.loading ? "disabled" : ""}>${state.loading ? "Loading..." : "Show more products"}</button>`
                : ""
            }
          </section>
        </div>
      </div>
    `;

    bindEvents(root);
  }

  async function addToCart(button) {
    const card = button.closest(".emrn-smart-card");
    const message = card.querySelector(".emrn-smart-cart-msg");
    const productId = Number(button.getAttribute("data-product-id"));
    const variantId = Number(button.getAttribute("data-variant-id"));
    const qty = Math.max(1, Number(card.querySelector(".emrn-smart-qty")?.value || 1));

    if (!productId) {
      message.textContent = "Missing product ID";
      return;
    }

    button.disabled = true;
    button.textContent = "Adding...";
    message.textContent = "";

    try {
      const lineItem = {
        quantity: qty,
        productId
      };
      if (variantId) lineItem.variantId = variantId;

      let cartId = null;
      const current = await fetch("/api/storefront/carts?include=lineItems.physicalItems.options", {
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });

      if (current.ok) {
        const carts = await current.json();
        cartId = Array.isArray(carts) && carts[0]?.id ? carts[0].id : null;
      }

      const url = cartId ? `/api/storefront/carts/${cartId}/items` : "/api/storefront/carts";
      const body = cartId ? { lineItems: [lineItem] } : { lineItems: [lineItem] };

      const res = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json"
        },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        throw new Error(await res.text());
      }

      message.textContent = "Added to cart";
      button.textContent = "Added";

      document.dispatchEvent(new CustomEvent("cart-quantity-update"));
      window.dispatchEvent(new CustomEvent("emrn-smartsearch-cart-added"));
    } catch (error) {
      console.error("Smart category add to cart failed", error);
      message.textContent = "Could not add. Use View.";
      button.textContent = "Add";
    } finally {
      setTimeout(() => {
        button.disabled = false;
        if (button.textContent === "Added") button.textContent = "Add";
      }, 1300);
    }
  }

  function bindEvents(root) {
    root.querySelectorAll("[data-category-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.getAttribute("data-category-id"));
        const cat = state.categories.find((item) => Number(item.id) === id);
        if (!cat) return;
        state.currentCategory = cat;
        state.brand = "";
        state.page = 1;
        state.products = [];
        openParentPath(cat.id);

        const nextUrl = new URL(cat.url || window.location.href, window.location.origin);
        nextUrl.searchParams.set("smartcategory", "1");
        window.history.replaceState({}, "", nextUrl.toString());

        runSearch(1, false);
      });
    });

    root.querySelectorAll("[data-toggle-category]").forEach((button) => {
      button.addEventListener("click", () => {
        const id = Number(button.getAttribute("data-toggle-category"));
        state.openIds[id] = !state.openIds[id];
        render();
      });
    });

    root.querySelectorAll("[data-brand]").forEach((button) => {
      button.addEventListener("click", () => {
        state.brand = button.getAttribute("data-brand") || "";
        runSearch(1, false);
      });
    });

    root.querySelectorAll(".emrn-smart-add-cart").forEach((button) => {
      button.addEventListener("click", () => addToCart(button));
    });

    root.querySelector(".emrn-smart-clear-brand")?.addEventListener("click", () => {
      state.brand = "";
      runSearch(1, false);
    });

    root.querySelector(".emrn-smart-sort")?.addEventListener("change", (event) => {
      state.sort = event.target.value;
      runSearch(1, false);
    });

    root.querySelector(".emrn-smart-apply-price")?.addEventListener("click", () => {
      state.priceMin = root.querySelector(".emrn-smart-price-min")?.value || "";
      state.priceMax = root.querySelector(".emrn-smart-price-max")?.value || "";
      runSearch(1, false);
    });

    root.querySelector(".emrn-smart-more")?.addEventListener("click", () => runSearch(state.page + 1, true));
    root.querySelector(".emrn-smart-show-filters")?.addEventListener("click", () => root.classList.add("filters-open"));
    root.querySelector(".emrn-smart-mobile-filter-close")?.addEventListener("click", () => root.classList.remove("filters-open"));
  }

  async function runSearch(page = 1, append = false) {
    if (!state.currentCategory) return;
    state.loading = true;
    render();

    const params = new URLSearchParams();
    params.set("q", "*");
    params.set("page", String(page));
    params.set("category_id", String(state.currentCategory.id));
    if (state.currentCategory.name) params.set("category", state.currentCategory.name);
    params.set("sort", state.sort);
    if (state.brand) params.set("brand", state.brand);
    if (state.priceMin) params.set("price_min", state.priceMin);
    if (state.priceMax) params.set("price_max", state.priceMax);

    const data = await fetchJson(`${apiBase}/api/search?${params.toString()}`);

    state.data = data;
    state.found = data.found || 0;
    state.page = page;
    state.products = append ? state.products.concat((data.hits || []).map((hit) => hit.document)) : (data.hits || []).map((hit) => hit.document);
    state.loading = false;
    render();
  }

  function injectCss() {
    if (document.querySelector("#emrn-smart-category-css")) return;
    const style = document.createElement("style");
    style.id = "emrn-smart-category-css";
    style.textContent = `
      #emrn-smart-category-root{margin:22px auto;max-width:1220px}
      .emrn-smart-bubbles{display:flex;gap:14px;overflow-x:auto;padding:4px 0 20px}
      .emrn-smart-bubble{min-width:118px;min-height:72px;border:1px solid #efd6d6;border-radius:22px;background:#fff;color:#1f2937;font-weight:800;padding:10px 14px;cursor:pointer}
      .emrn-smart-layout{display:grid;grid-template-columns:270px 1fr;gap:22px}
      .emrn-smart-sidebar{background:#fff;border-right:1px solid #e5e7eb;padding:0 16px 0 0}
      .emrn-smart-filter-title{font-size:16px;font-weight:800;margin-bottom:10px}
      .emrn-smart-filter-block{border-top:1px solid #e5e7eb;padding-top:14px;margin-top:14px}
      .emrn-smart-filter-heading{color:#c34d50;font-weight:900;margin-bottom:8px}
      .emrn-smart-price-filter{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .emrn-smart-price-filter input{height:36px;border:1px solid #e5e7eb;border-radius:9px;padding:0 9px;min-width:0}
      .emrn-smart-apply-price,.emrn-smart-clear-brand{width:100%;height:36px;border:0;border-radius:999px;background:#c34d50;color:#fff;font-weight:900;margin-top:8px;cursor:pointer}
      .emrn-smart-facets{display:flex;flex-direction:column;gap:7px}
      .emrn-smart-facet{height:35px;border:1px solid #e5e7eb;border-radius:9px;background:#fff;display:flex;justify-content:space-between;align-items:center;padding:0 8px;font-weight:700;cursor:pointer}
      .emrn-smart-facet.is-selected{border-color:#c34d50;color:#c34d50;background:#fff8f8}
      .emrn-smart-facet em{font-style:normal;background:#f3f4f6;border-radius:999px;padding:2px 7px;font-size:11px;color:#555}
      .emrn-smart-tree-row{display:flex;gap:6px;align-items:center;min-height:32px;border-radius:9px;margin-bottom:5px}
      .emrn-smart-tree-row.is-selected{background:#c34d50;color:#fff}
      .emrn-smart-tree-toggle{width:22px;height:22px;border:0;border-radius:6px;background:#f3f4f6;font-weight:900;cursor:pointer}
      .emrn-smart-tree-row.is-selected .emrn-smart-tree-toggle{background:#fff;color:#c34d50}
      .emrn-smart-tree-spacer{width:22px}
      .emrn-smart-tree-link{flex:1;border:0;background:transparent;text-align:left;color:inherit;font-weight:800;font-size:13px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:7px}
      .emrn-smart-toolbar{display:flex;justify-content:space-between;align-items:center;gap:14px;border-bottom:1px solid #cfcfcf;padding:0 0 10px;margin-bottom:14px}
      .emrn-smart-count{font-size:16px;color:#111827}
      .emrn-smart-toolbar-actions{display:flex;align-items:center;gap:10px}
      .emrn-smart-toolbar label{font-weight:800;display:flex;align-items:center;gap:8px}
      .emrn-smart-sort{height:38px;border:1px solid #efd6d6;border-radius:12px;background:#fff;padding:0 10px;font-weight:800}
      .emrn-smart-show-filters,.emrn-smart-mobile-filter-close{height:38px;border:1px solid #efd6d6;border-radius:12px;background:#fff;color:#c34d50;font-weight:900;padding:0 14px;cursor:pointer}
      .emrn-smart-mobile-filter-close{display:none;width:100%;margin-bottom:8px}
      .emrn-smart-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px}
      .emrn-smart-card{background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(15,23,42,.08);overflow:hidden;text-align:center}
      .emrn-smart-card-image{height:185px;display:flex;align-items:center;justify-content:center;padding:18px}
      .emrn-smart-card-image img{max-width:100%;max-height:100%;object-fit:contain}
      .emrn-smart-card-body{padding:0 18px 18px}
      .emrn-smart-card-title{display:block;font-weight:900;color:#34343b;text-decoration:none;font-size:16px;line-height:1.3;min-height:44px}
      .emrn-smart-card-variant{font-size:12px;color:#c34d50;font-weight:800;min-height:24px;margin-top:7px}
      .emrn-smart-tags{display:flex;justify-content:center;flex-wrap:wrap;gap:5px;margin-top:8px}
      .emrn-smart-tags span{background:#f3f4f6;border-radius:999px;padding:4px 7px;font-size:10px;font-weight:800}
      .emrn-smart-price{font-weight:800;font-size:16px;margin-top:8px}
      .emrn-smart-actions{margin-top:10px;display:flex;justify-content:center;gap:8px;align-items:center}
      .emrn-smart-add-cart{height:36px;border:0;border-radius:999px;background:#c34d50;color:#fff;font-weight:900;padding:0 15px;cursor:pointer}
      .emrn-smart-add-cart[disabled]{opacity:.6;cursor:wait}
      .emrn-smart-qty{width:58px;height:36px;border:1px solid #e5e7eb;border-radius:999px;text-align:center;font-weight:800}
      .emrn-smart-view{height:36px;border:1px solid #c34d50;border-radius:999px;color:#c34d50;text-decoration:none;font-weight:900;padding:0 13px;display:inline-flex;align-items:center}
      .emrn-smart-cart-msg{min-height:18px;margin-top:7px;font-size:12px;font-weight:800;color:#166534}
      .emrn-smart-more{display:block;margin:24px auto 0;border:0;border-radius:999px;background:#c34d50;color:#fff;height:44px;padding:0 24px;font-weight:900;cursor:pointer}
      .emrn-smart-loading{padding:30px;background:#fff;border-radius:16px;text-align:center;font-weight:900}
      @media(max-width:900px){
        #emrn-smart-category-root{padding:0 14px}
        .emrn-smart-layout{grid-template-columns:1fr}
        .emrn-smart-sidebar{display:none}
        #emrn-smart-category-root.filters-open .emrn-smart-sidebar{display:block;position:fixed;inset:0;background:#fff;z-index:999999;padding:18px;overflow:auto}
        .emrn-smart-mobile-filter-close{display:block}
        .emrn-smart-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
        .emrn-smart-toolbar{align-items:flex-start;flex-direction:column}
      }
    `;
    document.head.appendChild(style);
  }

  async function init() {
    try {
      const categoriesData = await fetchJson(`${apiBase}/api/category-tree`);
      state.categories = categoriesData.categories || [];
      state.currentCategory = matchCurrentCategory(state.categories);

      if (!state.currentCategory) return;

      openParentPath(state.currentCategory.id);
      hideOldProductGrid();

      const mount = findMount();
      if (!mount) return;

      const root = document.createElement("div");
      root.id = "emrn-smart-category-root";
      mount.parentNode.insertBefore(root, mount);
      mount.style.display = "none";

      injectCss();
      await runSearch(1, false);
    } catch (error) {
      console.error("EMRN SmartCategory failed", error);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
