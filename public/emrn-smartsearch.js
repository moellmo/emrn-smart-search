(() => {
  const DEFAULT_API_BASE = "https://emrn-smart-search-vert.vercel.app";
  const DEFAULT_STORE_URL = "https://emrn.ca";

  const config = {
    apiBase: DEFAULT_API_BASE,
    storeUrl: DEFAULT_STORE_URL,
    enabled: false,
    testParam: "emrn-smartsearch",
    searchResultsUrl: `${DEFAULT_API_BASE}/smartsearch`,
    ...window.EMRNSmartSearchConfig,
  };

  const isTestMode = new URLSearchParams(window.location.search).get(config.testParam) === "1";

  if (!config.enabled && !isTestMode) return;

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

  const SELECTORS = [
    "#search_query_adv",
    'input[name="search_query_adv"]',
    'input[name="search_query"]',
    'input[type="search"]',
    'input[placeholder*="Search"]',
  ];

  const style = document.createElement("style");
  style.textContent = `
    .emrn-smartsearch-host {
      position: relative !important;
      z-index: 999999 !important;
    }

    .emrn-smartsearch-overlay {
      position: absolute;
      left: 0;
      right: 0;
      top: calc(100% + 10px);
      width: min(760px, calc(100vw - 24px));
      max-width: 760px;
      background: #fff;
      border: 1px solid #ead7d8;
      border-radius: 22px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(20,30,55,.22);
      z-index: 99999999;
      font-family: Arial, sans-serif;
      color: #1f2937;
    }

    .emrn-smartsearch-grid {
      display: grid;
      grid-template-columns: 1.45fr .85fr;
    }

    .emrn-smartsearch-products {
      padding: 18px;
      border-right: 1px solid #eee;
      background: #fff;
      min-height: 280px;
    }

    .emrn-smartsearch-side {
      padding: 18px;
      background: #fff8f8;
    }

    .emrn-smartsearch-title {
      color: #c34d50;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
      letter-spacing: .08em;
      margin: 0 0 12px;
    }

    .emrn-smartsearch-item {
      display: grid;
      grid-template-columns: 58px 1fr auto;
      gap: 12px;
      align-items: center;
      padding: 10px;
      border: 1px solid transparent;
      border-radius: 15px;
      text-decoration: none;
      color: #1f2937;
      transition: background .14s ease, border-color .14s ease, transform .14s ease;
    }

    .emrn-smartsearch-item:hover,
    .emrn-smartsearch-item:focus {
      background: #fff6f6;
      border-color: #efcccc;
      transform: translateX(2px);
      outline: none;
    }

    .emrn-smartsearch-img {
      width: 58px;
      height: 58px;
      border: 1px solid #eee;
      border-radius: 13px;
      background: #fafafa;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    }

    .emrn-smartsearch-img img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }

    .emrn-smartsearch-img span {
      color: #999;
      font-size: 10px;
    }

    .emrn-smartsearch-name {
      font-size: 14px;
      font-weight: 900;
      line-height: 1.3;
      color: #1f2937;
    }

    .emrn-smartsearch-meta {
      color: #666;
      font-size: 12px;
      margin-top: 4px;
    }

    .emrn-smartsearch-view {
      background: #f3f4f6;
      color: #1f2937;
      border-radius: 999px;
      padding: 7px 10px;
      font-size: 12px;
      font-weight: 900;
      white-space: nowrap;
    }

    .emrn-smartsearch-item:hover .emrn-smartsearch-view {
      background: #c34d50;
      color: #fff;
    }

    .emrn-smartsearch-viewall {
      margin-top: 14px;
      width: 100%;
      height: 44px;
      border: 0;
      background: #c34d50;
      color: #fff;
      border-radius: 999px;
      font-weight: 900;
      cursor: pointer;
      font-size: 14px;
    }

    .emrn-smartsearch-card {
      background: #fff;
      border: 1px solid #eee;
      border-radius: 16px;
      padding: 14px;
      margin-bottom: 12px;
    }

    .emrn-smartsearch-card h4 {
      margin: 0 0 10px;
      color: #1f2937;
      font-size: 15px;
      font-weight: 900;
    }

    .emrn-smartsearch-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 7px;
    }

    .emrn-smartsearch-chip {
      border: 1px solid #e5e7eb;
      background: #f5f6f8;
      border-radius: 999px;
      padding: 7px 9px;
      font-weight: 900;
      font-size: 12px;
      cursor: pointer;
      color: #1f2937;
    }

    .emrn-smartsearch-chip:hover {
      border-color: #c34d50;
      color: #c34d50;
      background: #fff;
    }

    .emrn-smartsearch-chip small {
      color: #666;
      font-weight: 800;
    }

    .emrn-smartsearch-help {
      background: #14365d;
      color: #fff;
      border-radius: 16px;
      padding: 14px;
      line-height: 1.4;
      font-size: 13px;
    }

    .emrn-smartsearch-help strong {
      display: block;
      margin-top: 3px;
    }

    .emrn-smartsearch-empty,
    .emrn-smartsearch-loading {
      background: #fffafa;
      border: 1px solid #f0dada;
      border-radius: 15px;
      padding: 18px;
      color: #666;
      font-size: 14px;
    }

    .emrn-smartsearch-starter h3 {
      margin: 0 0 6px;
      font-size: 16px;
      color: #1f2937;
    }

    .emrn-smartsearch-starter p {
      margin: 0 0 14px;
      color: #666;
      font-size: 14px;
      line-height: 1.4;
    }

    body.emrn-smartsearch-active .fast-autocomplete,
    body.emrn-smartsearch-active .fast-autocomplete-results,
    body.emrn-smartsearch-active .autocomplete-suggestions,
    body.emrn-smartsearch-active [class*="fast-autocomplete"],
    body.emrn-smartsearch-active [id*="fast-autocomplete"] {
      display: none !important;
      visibility: hidden !important;
      opacity: 0 !important;
    }

    @media (max-width: 760px) {
      .emrn-smartsearch-overlay {
        position: fixed;
        left: 10px;
        right: 10px;
        top: 92px;
        width: auto;
        max-height: calc(100vh - 110px);
        overflow: auto;
      }

      .emrn-smartsearch-grid {
        grid-template-columns: 1fr;
      }

      .emrn-smartsearch-products {
        border-right: 0;
        border-bottom: 1px solid #eee;
      }

      .emrn-smartsearch-item {
        grid-template-columns: 54px 1fr;
      }

      .emrn-smartsearch-view {
        display: none;
      }
    }
  `;
  document.head.appendChild(style);

  function debounce(fn, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function getRecentSearches() {
    try {
      return JSON.parse(localStorage.getItem("emrn_recent_searches") || "[]");
    } catch {
      return [];
    }
  }

  function saveRecentSearch(term) {
    if (!term || term.length < 2) return;
    const recent = getRecentSearches();
    const next = [term, ...recent.filter((x) => x !== term)].slice(0, 6);
    localStorage.setItem("emrn_recent_searches", JSON.stringify(next));
  }

  function normalizeUrl(url) {
    if (!url) return config.storeUrl;
    if (url.startsWith("http://") || url.startsWith("https://")) return url;
    return `${config.storeUrl}${url.startsWith("/") ? "" : "/"}${url}`;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function sideCard(title, items, onClickPrefix = "") {
    if (!items || !items.length) return "";

    return `
      <div class="emrn-smartsearch-card">
        <h4>${escapeHtml(title)}</h4>
        <div class="emrn-smartsearch-chips">
          ${items
            .slice(0, 7)
            .map((item) => {
              const value = typeof item === "string" ? item : item.value;
              const count = typeof item === "string" ? "" : ` <small>(${item.count})</small>`;
              return `<button type="button" class="emrn-smartsearch-chip" data-emrn-search="${escapeHtml(value)}">${escapeHtml(value)}${count}</button>`;
            })
            .join("")}
        </div>
      </div>
    `;
  }

  function productItem(product) {
    const url = normalizeUrl(product.url);
    const img = product.image
      ? `<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">`
      : `<span>No image</span>`;

    return `
      <a class="emrn-smartsearch-item" href="${escapeHtml(url)}">
        <div class="emrn-smartsearch-img">${img}</div>
        <div>
          <div class="emrn-smartsearch-name">${escapeHtml(product.name)}</div>
          <div class="emrn-smartsearch-meta">
            ${escapeHtml(product.brand || "EMRN")}${product.sku ? ` • SKU: ${escapeHtml(product.sku)}` : ""}
          </div>
        </div>
        <div class="emrn-smartsearch-view">View</div>
      </a>
    `;
  }

  function createOverlay(input) {
    const host = input.closest("form") || input.parentElement;
    host.classList.add("emrn-smartsearch-host");

    const overlay = document.createElement("div");
    overlay.className = "emrn-smartsearch-overlay";
    overlay.hidden = true;
    host.appendChild(overlay);

    overlay.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    overlay.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-emrn-search]");
      if (chip) {
        input.value = chip.getAttribute("data-emrn-search") || "";
        saveRecentSearch(input.value);
        renderResults(input, overlay, input.value);
        input.focus();
      }
    });

    return overlay;
  }

  function renderStarter(overlay) {
    const recent = getRecentSearches();

    overlay.innerHTML = `
      <div class="emrn-smartsearch-grid">
        <div class="emrn-smartsearch-products">
          <div class="emrn-smartsearch-title">Search EMRN</div>
          <div class="emrn-smartsearch-starter">
            <h3>Start typing to search products</h3>
            <p>Search by product name, SKU, brand, category, or common medical terms.</p>
            ${sideCard("Popular searches", POPULAR_SEARCHES)}
            ${recent.length ? sideCard("Recent searches", recent) : ""}
          </div>
        </div>
        <div class="emrn-smartsearch-side">
          ${sideCard("Popular searches", POPULAR_SEARCHES)}
          ${recent.length ? sideCard("Recent searches", recent) : ""}
          <div class="emrn-smartsearch-help">
            Can’t find the item?
            <strong>Request a quote and EMRN can help source it.</strong>
          </div>
        </div>
      </div>
    `;
    overlay.hidden = false;
  }

  async function renderResults(input, overlay, query) {
    if (!query || query.trim().length < 2) {
      renderStarter(overlay);
      return;
    }

    document.body.classList.add("emrn-smartsearch-active");

    overlay.hidden = false;
    overlay.innerHTML = `
      <div class="emrn-smartsearch-grid">
        <div class="emrn-smartsearch-products">
          <div class="emrn-smartsearch-title">Products</div>
          <div class="emrn-smartsearch-loading">Searching...</div>
        </div>
        <div class="emrn-smartsearch-side">
          <div class="emrn-smartsearch-help">
            Can’t find the item?
            <strong>Request a quote and EMRN can help source it.</strong>
          </div>
        </div>
      </div>
    `;

    try {
      const res = await fetch(`${config.apiBase}/api/autocomplete?q=${encodeURIComponent(query)}`, {
        mode: "cors",
      });
      const data = await res.json();

      const products = data.products || [];
      const brandFacet = (data.facets || []).find((facet) => facet.field === "brand");
      const categoryFacet = (data.facets || []).find((facet) => facet.field === "categories");

      overlay.innerHTML = `
        <div class="emrn-smartsearch-grid">
          <div class="emrn-smartsearch-products">
            <div class="emrn-smartsearch-title">Products</div>
            ${
              products.length
                ? products.map(productItem).join("")
                : `<div class="emrn-smartsearch-empty">No product suggestions found. Try another keyword, SKU, brand, or category.</div>`
            }
            ${
              products.length
                ? `<button type="button" class="emrn-smartsearch-viewall" data-emrn-viewall="1">View all results for “${escapeHtml(query)}”</button>`
                : ""
            }
          </div>
          <div class="emrn-smartsearch-side">
            ${sideCard("Suggested Brands", brandFacet?.values || [])}
            ${sideCard("Suggested Categories", categoryFacet?.values || [])}
            ${sideCard("Popular searches", POPULAR_SEARCHES)}
            <div class="emrn-smartsearch-help">
              Can’t find the item?
              <strong>Request a quote and EMRN can help source it.</strong>
            </div>
          </div>
        </div>
      `;

      const viewAll = overlay.querySelector("[data-emrn-viewall]");
      if (viewAll) {
        viewAll.addEventListener("click", () => {
          saveRecentSearch(query);
          window.location.href = `${config.searchResultsUrl}?q=${encodeURIComponent(query)}`;
        });
      }
    } catch (err) {
      overlay.innerHTML = `
        <div class="emrn-smartsearch-empty">
          SmartSearch could not load right now. Please try again.
        </div>
      `;
    }
  }

  function attach(input) {
    if (!input || input.dataset.emrnSmartSearchAttached === "1") return;

    input.dataset.emrnSmartSearchAttached = "1";
    input.setAttribute("autocomplete", "off");

    const overlay = createOverlay(input);
    const run = debounce(() => renderResults(input, overlay, input.value.trim()), 160);

    input.addEventListener("input", run);
    input.addEventListener("focus", () => {
      if (input.value.trim().length >= 2) {
        renderResults(input, overlay, input.value.trim());
      } else {
        renderStarter(overlay);
      }
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        overlay.hidden = true;
        document.body.classList.remove("emrn-smartsearch-active");
      }

      if (e.key === "Enter") {
        const q = input.value.trim();
        if (q.length >= 2) {
          e.preventDefault();
          saveRecentSearch(q);
          window.location.href = `${config.searchResultsUrl}?q=${encodeURIComponent(q)}`;
        }
      }
    });

    const form = input.closest("form");
    if (form) {
      form.addEventListener("submit", (e) => {
        const q = input.value.trim();
        if (q.length >= 2) {
          e.preventDefault();
          saveRecentSearch(q);
          window.location.href = `${config.searchResultsUrl}?q=${encodeURIComponent(q)}`;
        }
      });
    }

    document.addEventListener("click", (e) => {
      if (!overlay.contains(e.target) && e.target !== input) {
        overlay.hidden = true;
        document.body.classList.remove("emrn-smartsearch-active");
      }
    });
  }

  function init() {
    const input = SELECTORS.map((sel) => document.querySelector(sel)).find(Boolean);

    if (!input) return;

    attach(input);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  let tries = 0;
  const retry = setInterval(() => {
    tries++;
    init();
    if (tries > 20 || document.querySelector("[data-emrn-smart-search-attached='1']")) {
      clearInterval(retry);
    }
  }, 500);
})();
