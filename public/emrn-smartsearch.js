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

  console.log("[EMRN SmartSearch] interaction fix loaded");

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

  let activeInput = null;
  let overlay = null;
  let lastValue = "";
  let lastRendered = "";
  let renderTimer = null;

  const style = document.createElement("style");
  style.textContent = `
    .emrn-smartsearch-overlay {
      position: fixed !important;
      width: min(680px, calc(100vw - 24px));
      max-width: 680px;
      background: #fff;
      border: 1px solid #ead7d8;
      border-radius: 22px;
      overflow: hidden;
      box-shadow: 0 24px 60px rgba(20,30,55,.24);
      z-index: 2147483647 !important;
      font-family: Arial, sans-serif;
      color: #1f2937;
    }
    .emrn-smartsearch-grid {
      display: grid;
      grid-template-columns: 1.35fr .85fr;
    }
    .emrn-smartsearch-products {
      padding: 18px;
      border-right: 1px solid #eee;
      background: #fff;
      min-height: 280px;
      max-height: 520px;
      overflow: auto;
    }
    .emrn-smartsearch-side {
      padding: 18px;
      background: #fff8f8;
      max-height: 520px;
      overflow: auto;
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
      text-align: left;
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
        left: 10px !important;
        right: 10px !important;
        top: 84px !important;
        width: auto !important;
        max-height: calc(100vh - 100px);
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

  function getInput() {
    return SELECTORS.map((sel) => document.querySelector(sel)).find(Boolean);
  }

  function isSearchInput(el) {
    return !!(el && el.matches && SELECTORS.some((sel) => el.matches(sel)));
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

  function goToResults(term) {
    const q = String(term || activeInput?.value || "").trim();
    if (q.length < 2) return;
    saveRecentSearch(q);
    window.location.href = `${config.searchResultsUrl}?q=${encodeURIComponent(q)}`;
  }

  function sideCard(title, items, clickMode = "refine") {
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
              return `<button type="button" class="emrn-smartsearch-chip" data-emrn-search="${escapeHtml(value)}" data-emrn-mode="${clickMode}">${escapeHtml(value)}${count}</button>`;
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

  function ensureOverlay() {
    if (overlay && document.body.contains(overlay)) return overlay;

    document.querySelectorAll(".emrn-smartsearch-overlay").forEach((el) => el.remove());

    overlay = document.createElement("div");
    overlay.className = "emrn-smartsearch-overlay";
    overlay.hidden = true;
    overlay.style.display = "none";
    document.body.appendChild(overlay);

    overlay.addEventListener("mousedown", (e) => {
      e.preventDefault();
    });

    overlay.addEventListener("click", (e) => {
      const chip = e.target.closest("[data-emrn-search]");
      if (chip && activeInput) {
        const term = chip.getAttribute("data-emrn-search") || "";
        const mode = chip.getAttribute("data-emrn-mode") || "refine";

        activeInput.value = term;
        saveRecentSearch(term);

        if (mode === "navigate") {
          goToResults(term);
          return;
        }

        lastRendered = "";
        renderResults(term);
        activeInput.focus();
      }

      const viewAll = e.target.closest("[data-emrn-viewall]");
      if (viewAll && activeInput) {
        goToResults(activeInput.value);
      }
    }, true);

    return overlay;
  }

  function positionOverlay() {
    if (!activeInput || !overlay) return;

    const rect = activeInput.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth;

    const width = Math.min(680, viewportWidth - 24);
    const center = rect.left + rect.width / 2;

    let left = center - width / 2;
    if (left < 12) left = 12;
    if (left + width > viewportWidth - 12) left = viewportWidth - width - 12;

    overlay.style.width = `${width}px`;
    overlay.style.left = `${left}px`;
    overlay.style.top = `${rect.bottom + 10}px`;
  }

  function showOverlay() {
    ensureOverlay();
    positionOverlay();
    overlay.hidden = false;
    overlay.style.display = "block";
    document.body.classList.add("emrn-smartsearch-active");
  }

  function hideOverlay() {
    if (!overlay) return;
    overlay.hidden = true;
    overlay.style.display = "none";
    document.body.classList.remove("emrn-smartsearch-active");
  }

  function renderStarter() {
    ensureOverlay();
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
    showOverlay();
  }

  async function renderResults(query) {
    ensureOverlay();

    if (!query || query.trim().length < 2) {
      renderStarter();
      return;
    }

    lastRendered = query;

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
    showOverlay();

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
            ${sideCard("Suggested Brands", brandFacet?.values || [], "refine")}
            ${sideCard("Suggested Categories", categoryFacet?.values || [], "refine")}
            ${sideCard("Popular searches", POPULAR_SEARCHES, "refine")}
            <div class="emrn-smartsearch-help">
              Can’t find the item?
              <strong>Request a quote and EMRN can help source it.</strong>
            </div>
          </div>
        </div>
      `;
      showOverlay();
    } catch (err) {
      console.error("[EMRN SmartSearch] API error", err);
      overlay.innerHTML = `<div class="emrn-smartsearch-empty">SmartSearch could not load right now. Please try again.</div>`;
      showOverlay();
    }
  }

  function scheduleRender(force = false) {
    if (!activeInput) return;
    const value = activeInput.value.trim();

    if (!force && value === lastRendered) return;

    clearTimeout(renderTimer);
    renderTimer = setTimeout(() => renderResults(value), 120);
  }

  function attach(input) {
    if (!input) return;

    activeInput = input;
    activeInput.dataset.emrnSmartSearchAttached = "1";
    activeInput.setAttribute("autocomplete", "off");
    ensureOverlay();

    console.log("[EMRN SmartSearch] attached", activeInput);

    activeInput.addEventListener("focus", () => {
      activeInput = input;
      scheduleRender(true);
    }, true);

    activeInput.addEventListener("input", () => {
      activeInput = input;
      scheduleRender(true);
    }, true);

    activeInput.addEventListener("keyup", () => {
      activeInput = input;
      scheduleRender(true);
    }, true);
  }

  function init() {
    const input = getInput();
    if (!input) return;
    attach(input);
  }

  document.addEventListener("focusin", (e) => {
    if (isSearchInput(e.target)) {
      attach(e.target);
      scheduleRender(true);
    }
  }, true);

  document.addEventListener("input", (e) => {
    if (isSearchInput(e.target)) {
      attach(e.target);
      scheduleRender(true);
    }
  }, true);

  document.addEventListener("keyup", (e) => {
    if (isSearchInput(e.target)) {
      attach(e.target);
      scheduleRender(true);
    }
  }, true);

  document.addEventListener("keydown", (e) => {
    if (!isSearchInput(e.target)) return;

    activeInput = e.target;

    if (e.key === "Escape") {
      hideOverlay();
      return;
    }

    if (e.key === "Enter") {
      const q = activeInput.value.trim();
      if (q.length >= 2) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        goToResults(q);
      }
    }
  }, true);

  document.addEventListener("submit", (e) => {
    const form = e.target;
    const input = form?.querySelector?.(SELECTORS.join(","));
    if (!input) return;

    const q = input.value.trim();
    if (q.length >= 2) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      activeInput = input;
      goToResults(q);
    }
  }, true);

  document.addEventListener("click", (e) => {
    if (!overlay) return;
    if (overlay.contains(e.target)) return;
    if (activeInput && e.target === activeInput) return;
    hideOverlay();
  }, true);

  window.addEventListener("resize", positionOverlay);
  window.addEventListener("scroll", positionOverlay, true);

  setInterval(() => {
    const input = getInput();
    if (input && input !== activeInput) attach(input);

    if (activeInput) {
      const current = activeInput.value || "";
      if (current !== lastValue) {
        lastValue = current;
        scheduleRender(true);
      }
    }
  }, 300);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
