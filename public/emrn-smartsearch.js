(() => {
  const DEFAULT_API_BASE = "https://emrn-smart-search-vert.vercel.app";
  const DEFAULT_STORE_URL = "https://emrn.ca";

  const config = {
    apiBase: DEFAULT_API_BASE,
    storeUrl: DEFAULT_STORE_URL,
    quoteUrl: `${DEFAULT_STORE_URL}/contact-us/`,
    enabled: false,
    testParam: "emrn-smartsearch",
    resultsParam: "emrn-smart-results",
    searchResultsUrl: `${window.location.origin}/search.php`,
    ...window.EMRNSmartSearchConfig,
  };

  const params = new URLSearchParams(window.location.search);
  const isTestMode = params.get(config.testParam) === "1";
  const isResultsPage = params.get(config.resultsParam) === "1";

  if (!config.enabled && !isTestMode && !isResultsPage) return;

  console.log("[EMRN SmartSearch] French broad match popular starter loaded");

  const SELECTORS = ["#search_query_adv", 'input[name="search_query_adv"]', 'input[name="search_query"]', 'input[type="search"]', 'input[placeholder*="Search"]'];
  const LANG = (document.documentElement.lang || "").toLowerCase().startsWith("fr") || /\/fr(\/|$)/i.test(window.location.pathname) ? "fr" : "en";

  const COPY = {
    en: {
      products: "Products", popular: "Popular searches", popularProducts: "Popular products", recent: "Recent searches",
      suggestedBrands: "Suggested Brands", suggestedCategories: "Suggested Categories",
      startTyping: "Start typing to search products", searchHelp: "Search by product name, SKU, brand, category, or common medical terms.",
      cantFind: "Can’t find the item?", sourceHelp: "Request a quote and EMRN can help source it.",
      noSuggestions: "No product suggestions found. Try another keyword, SKU, brand, or category.",
      viewAll: "View all results for", resultsFor: "Search results for", smarterMatching: "Smarter SKU-level matching by name, SKU, brand, variant, and category.",
      searchPlaceholder: "Search products, brands, categories, or SKUs...", searchButton: "Search",
      refineBy: "Refine by", filtersApplied: "Filters applied", chooseBrandCategory: "Choose a brand or category",
      clearFilters: "Clear filters", brands: "Brands", categories: "Categories", skuLevelShown: "SKU-level results shown",
      addToCart: "Add to Cart", adding: "Adding...", added: "Added ✓", viewProduct: "View Product", addToQuote: "Add to quote",
      noProductsFound: "No products found.", noResultsTitle: "No exact results found", noResultsBody: "Try one of these related searches or request a quote and EMRN can help source it.",
      trySearches: "Try these searches", requestQuote: "Request a quote", subcategories: "Subcategories", loadMore: "Show more products", loadingMore: "Loading...",
    },
    fr: {
      products: "Produits", popular: "Recherches populaires", popularProducts: "Produits populaires", recent: "Recherches récentes",
      suggestedBrands: "Marques suggérées", suggestedCategories: "Catégories suggérées",
      startTyping: "Commencez à taper pour rechercher des produits", searchHelp: "Recherchez par nom de produit, SKU, marque, catégorie ou terme médical.",
      cantFind: "Vous ne trouvez pas l’article?", sourceHelp: "Demandez un devis et EMRN peut vous aider à le trouver.",
      noSuggestions: "Aucune suggestion trouvée. Essayez un autre mot-clé, SKU, marque ou catégorie.",
      viewAll: "Voir tous les résultats pour", resultsFor: "Résultats de recherche pour", smarterMatching: "Recherche par SKU, nom, marque, variante et catégorie.",
      searchPlaceholder: "Rechercher des produits, marques, catégories ou SKU...", searchButton: "Rechercher",
      refineBy: "Filtrer par", filtersApplied: "Filtres appliqués", chooseBrandCategory: "Choisissez une marque ou une catégorie",
      clearFilters: "Effacer les filtres", brands: "Marques", categories: "Catégories", skuLevelShown: "résultats par SKU affichés",
      addToCart: "Ajouter au panier", adding: "Ajout...", added: "Ajouté ✓", viewProduct: "Voir le produit", addToQuote: "Ajouter au devis",
      noProductsFound: "Aucun produit trouvé.", noResultsTitle: "Aucun résultat exact trouvé", noResultsBody: "Essayez une recherche associée ou demandez un devis. EMRN peut vous aider à trouver l’article.",
      trySearches: "Essayez ces recherches", requestQuote: "Demander un devis", subcategories: "Sous-catégories", loadMore: "Voir plus de produits", loadingMore: "Chargement...",
    }
  };

  function t(key){ return (COPY[LANG] && COPY[LANG][key]) || COPY.en[key] || key; }

  const POPULAR_SEARCHES = LANG === "fr"
    ? ["gants", "masques", "oxygène", "pansement", "seringue", "RCR"]
    : ["gloves", "masks", "AED", "oxygen", "wound dressing", "CPR manikin"];

  let activeInput = null;
  let overlay = null;
  let lastValue = "";
  let lastRendered = "";
  let renderTimer = null;
  let categoryTreeCache = null;

  const style = document.createElement("style");
  style.textContent = `
    .emrn-smartsearch-overlay{position:fixed!important;width:min(760px,calc(100vw - 24px));max-width:760px;background:#fff;border:1px solid #ead7d8;border-radius:22px;overflow:hidden;box-shadow:0 24px 60px rgba(20,30,55,.24);z-index:2147483647!important;font-family:Arial,sans-serif;color:#1f2937}
    .emrn-smartsearch-grid{display:grid;grid-template-columns:1.35fr .75fr}
    .emrn-smartsearch-products{padding:18px;border-right:1px solid #eee;background:#fff;min-height:260px;max-height:500px;overflow:auto}
    .emrn-smartsearch-side{padding:18px;background:#fff8f8;max-height:500px;overflow:auto}
    .emrn-smartsearch-title{color:#c34d50;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin:0 0 12px}
    .emrn-smartsearch-item{display:grid;grid-template-columns:58px 1fr auto;gap:12px;align-items:center;padding:10px;border:1px solid transparent;border-radius:15px;text-decoration:none;color:#1f2937;transition:all .14s ease}
    .emrn-smartsearch-item:hover{background:#fff6f6;border-color:#efcccc;transform:translateX(2px)}
    .emrn-smartsearch-img{width:58px;height:58px;border:1px solid #eee;border-radius:13px;background:#fafafa;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .emrn-smartsearch-img img{max-width:100%;max-height:100%;object-fit:contain}
    .emrn-smartsearch-name{font-size:14px;font-weight:900;line-height:1.3;color:#1f2937;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .emrn-smartsearch-meta{color:#666;font-size:12px;margin-top:4px}
    .emrn-smartsearch-option{color:#c34d50;font-size:12px;font-weight:900;margin-top:3px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .emrn-smartsearch-view{background:#f3f4f6;color:#1f2937;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:900;white-space:nowrap}
    .emrn-smartsearch-viewall{margin-top:14px;width:100%;height:44px;border:0;background:#c34d50;color:#fff;border-radius:999px;font-weight:900;cursor:pointer;font-size:14px}
    .emrn-smartsearch-card{background:#fff;border:1px solid #eee;border-radius:16px;padding:14px;margin-bottom:12px}
    .emrn-smartsearch-card h4{margin:0 0 10px;color:#1f2937;font-size:15px;font-weight:900}
    .emrn-smartsearch-chips{display:flex;flex-wrap:wrap;gap:7px}
    .emrn-smartsearch-chip{border:1px solid #e5e7eb;background:#f5f6f8;border-radius:999px;padding:7px 9px;font-weight:900;font-size:12px;cursor:pointer;color:#1f2937;text-align:left}
    .emrn-smartsearch-chip:hover{border-color:#c34d50;color:#c34d50;background:#fff}
    .emrn-smartsearch-chip small{color:#666;font-weight:800}
    .emrn-smartsearch-help{background:#14365d;color:#fff;border-radius:16px;padding:14px;line-height:1.4;font-size:13px}
    .emrn-smartsearch-help strong{display:block;margin-top:3px}
    .emrn-smartsearch-empty,.emrn-smartsearch-loading{background:#fffafa;border:1px solid #f0dada;border-radius:15px;padding:18px;color:#666;font-size:14px}

    .emrn-smart-results-page{max-width:1240px;margin:24px auto 70px;padding:0 20px;font-family:Arial,sans-serif;color:#1f2937}
    .emrn-smart-results-header{background:linear-gradient(135deg,#fff 0%,#fff8f8 100%);border:1px solid #f0dada;border-radius:22px;padding:24px;margin-bottom:24px;box-shadow:0 12px 30px rgba(20,30,55,.06)}
    .emrn-smart-results-header .eyebrow{color:#c34d50;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
    .emrn-smart-results-header h1{margin:0 0 8px;font-size:32px;letter-spacing:-.6px}
    .emrn-smart-results-search{display:flex;gap:10px;margin-top:18px}
    .emrn-smart-results-search input{flex:1;height:52px;border:2px solid #c34d50;border-radius:999px;padding:0 18px;font-size:16px;outline:none}
    .emrn-smart-results-search button{border:0;background:#c34d50;color:#fff;border-radius:999px;padding:0 24px;font-weight:900;cursor:pointer}
    .emrn-smart-results-shell{display:grid;grid-template-columns:280px 1fr;gap:22px}
    .emrn-smart-results-filters{background:#fff;border:1px solid #e8e8e8;border-radius:18px;padding:16px;height:max-content;position:sticky;top:20px;max-height:calc(100vh - 40px);overflow:auto}
    .emrn-smart-filter-title{font-size:18px;font-weight:900;margin-bottom:5px}
    .emrn-smart-filter-note{color:#777;font-size:13px;margin-bottom:14px}
    .emrn-smart-filter-group{border-top:1px solid #eee;padding:16px 0}
    .emrn-smart-filter-group h3{margin:0 0 12px;font-size:15px}
    .emrn-smart-facet-list{display:flex;flex-direction:column;gap:7px;max-height:330px;overflow:auto}
    .emrn-smart-facet{width:100%;border:1px solid #e5e7eb;background:#fff;border-radius:12px;min-height:38px;padding:8px 9px;display:flex;align-items:center;gap:8px;cursor:pointer;text-align:left}
    .emrn-smart-facet:hover,.emrn-smart-facet.active{border-color:#c34d50;background:#fff8f8;color:#c34d50}
    .emrn-smart-facet-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:800;font-size:13px}
    .emrn-smart-facet-count{background:#f3f4f6;color:#555;border-radius:999px;padding:4px 7px;font-size:11px;font-weight:900}
    .emrn-smart-category-tree{display:flex;flex-direction:column;gap:5px;max-height:430px;overflow:auto}
    .emrn-smart-cat-row{display:flex;align-items:center;gap:6px;border:1px solid #e5e7eb;background:#fff;border-radius:11px;min-height:36px;padding:6px 7px}
    .emrn-smart-cat-row.active{border-color:#c34d50;background:#fff8f8;color:#c34d50}
    .emrn-smart-cat-toggle{border:0;background:#f3f4f6;border-radius:7px;width:24px;height:24px;cursor:pointer;font-weight:900}
    .emrn-smart-cat-link{border:0;background:transparent;flex:1;text-align:left;font-weight:800;font-size:13px;cursor:pointer;color:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.emrn-smart-cat-count{background:#f3f4f6;color:#555;border-radius:999px;padding:4px 7px;font-size:11px;font-weight:900}
    .emrn-smart-cat-children{display:none;margin-left:18px;gap:5px;flex-direction:column}
    .emrn-smart-cat-children.open{display:flex}
    .emrn-smart-results-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:12px}
    .emrn-smart-results-top h2{margin:0;font-size:24px}
    .emrn-smart-results-top p{margin:4px 0 0;color:#777}
    .emrn-smart-products-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:stretch}
    .emrn-smart-product-card{background:#fff;border:1px solid #f0dada;border-radius:18px;overflow:hidden;box-shadow:0 8px 22px rgba(0,0,0,.04);transition:all .16s ease;display:flex;flex-direction:column}
    .emrn-smart-product-card:hover{transform:translateY(-3px);border-color:#e7bfc0;box-shadow:0 16px 32px rgba(0,0,0,.09)}
    .emrn-smart-product-img{height:165px;display:flex;align-items:center;justify-content:center;padding:16px;border-bottom:1px solid #f1eeee;text-decoration:none;background:#fff;flex:0 0 auto}
    .emrn-smart-product-img img{max-width:100%;max-height:100%;object-fit:contain}
    .emrn-smart-product-body{padding:14px;display:flex;flex-direction:column;flex:1}
    .emrn-smart-stars{color:#999;letter-spacing:2px;font-size:13px;margin-bottom:8px;flex:0 0 auto}
    .emrn-smart-product-name{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:#252735;text-decoration:none;font-size:14px;font-weight:900;line-height:1.34;min-height:38px;max-height:38px}
    .emrn-smart-variant{color:#c34d50;font-size:12px;font-weight:900;margin:8px 0;line-height:1.35;min-height:33px;max-height:33px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
    .emrn-smart-meta{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0 8px;min-height:24px}
    .emrn-smart-meta span{background:#f3f4f6;border-radius:999px;padding:5px 7px;color:#555;font-size:10px;font-weight:800;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .emrn-smart-price{font-size:20px;font-weight:400;color:#252735;min-height:28px;margin:6px 0 10px}
    .emrn-smart-card-actions{margin-top:auto}
    .emrn-smart-qty{height:38px;border:1px solid #f0dada;background:#fffafa;border-radius:999px;display:grid;grid-template-columns:38px 1fr 38px;align-items:center;text-align:center;margin-bottom:8px;overflow:hidden}
    .emrn-smart-qty button{height:100%;border:0;background:transparent;font-size:22px;font-weight:900;color:#555;cursor:pointer}
    .emrn-smart-cart-btn,.emrn-smart-quote-btn,.emrn-smart-view-btn{width:100%;height:40px;border-radius:999px;font-weight:900;cursor:pointer;transition:all .14s ease;margin-top:7px;font-size:13px}
    .emrn-smart-cart-btn{border:2px solid #c34d50;background:#c34d50;color:#fff}
    .emrn-smart-view-btn{display:flex;align-items:center;justify-content:center;text-decoration:none;border:2px solid #c34d50;background:#fff;color:#c34d50}
    .emrn-smart-quote-btn{border:1px solid #f0dada;background:#fffafa;color:#333}
    .emrn-smart-message{background:#fffafa;border:1px solid #f0dada;border-radius:16px;padding:18px;color:#666}
    .emrn-smart-load-more{margin:24px auto 0;display:flex;align-items:center;justify-content:center;width:min(260px,100%);height:46px;border:0;border-radius:999px;background:#c34d50;color:#fff;font-weight:900;cursor:pointer}
    .emrn-smart-load-more[disabled]{opacity:.65;cursor:not-allowed}
    .emrn-smart-cat-row.active .emrn-smart-cat-link{color:#c34d50}
    .emrn-smart-no-results{background:#fff;border:1px solid #f0dada;border-radius:20px;padding:24px;box-shadow:0 10px 26px rgba(0,0,0,.05)}
    .emrn-smart-no-results h2{margin:0 0 8px;font-size:26px}
    .emrn-smart-no-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
    .emrn-smart-no-actions button,.emrn-smart-no-actions a{border:1px solid #e5e7eb;background:#fff;border-radius:999px;padding:10px 14px;font-weight:900;text-decoration:none;color:#1f2937;cursor:pointer}
    .emrn-smart-no-actions .primary{background:#c34d50;color:#fff;border-color:#c34d50}
    @media (max-width:1100px){.emrn-smart-products-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media (max-width:900px){.emrn-smart-results-shell{grid-template-columns:1fr}.emrn-smart-results-filters{position:static;max-height:none}.emrn-smart-products-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:760px){.emrn-smartsearch-overlay{left:10px!important;right:10px!important;top:84px!important;width:auto!important;max-height:calc(100vh - 100px);overflow:auto}.emrn-smartsearch-grid{grid-template-columns:1fr}.emrn-smartsearch-products{border-right:0;border-bottom:1px solid #eee}.emrn-smartsearch-item{grid-template-columns:54px 1fr}.emrn-smartsearch-view{display:none}.emrn-smart-products-grid{grid-template-columns:1fr}.emrn-smart-results-search{flex-direction:column}.emrn-smart-results-search button{height:48px}}
  `;
  document.head.appendChild(style);

  function getInput(){return SELECTORS.map((sel)=>document.querySelector(sel)).find(Boolean)}
  function isSearchInput(el){return !!(el&&el.matches&&SELECTORS.some((sel)=>el.matches(sel)))}
  function escapeHtml(str){return String(str||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
  function normalizeUrl(url){if(!url)return config.storeUrl;if(url.startsWith("http://")||url.startsWith("https://"))return url;return `${config.storeUrl}${url.startsWith("/")?"":"/"}${url}`}
  function getRecentSearches(){try{return JSON.parse(localStorage.getItem("emrn_recent_searches")||"[]")}catch{return[]}}
  function saveRecentSearch(term){if(!term||term.length<2)return;const recent=getRecentSearches();const next=[term,...recent.filter((x)=>x!==term)].slice(0,6);localStorage.setItem("emrn_recent_searches",JSON.stringify(next))}
  function goToResults(term){const q=String(term||activeInput?.value||"").trim();if(q.length<2)return;saveRecentSearch(q);hideOverlay();const url=new URL(config.searchResultsUrl,window.location.origin);url.searchParams.set("search_query",q);url.searchParams.set(config.resultsParam,"1");window.location.href=url.toString()}
  function smartOptionText(text){let v=String(text||"").replace(/\s+/g," ").trim();v=v.replace(/\bcomplete with\b/ig,"with").replace(/\bDisposable\b/ig,"Disp.").replace(/\bConcentration\b/ig,"Conc.").replace(/\bResuscitation\b/ig,"Resus.");if(v.length>145)v=v.slice(0,142).trim().replace(/[,\s]+$/,"")+"…";return v}

  function sideCard(title,items){if(!items||!items.length)return"";const chipType=/brand/i.test(title)||/marque/i.test(title)?"brand":/categor/i.test(title)||/catégor/i.test(title)?"category":"search";return `<div class="emrn-smartsearch-card"><h4>${escapeHtml(title)}</h4><div class="emrn-smartsearch-chips">${items.slice(0,7).map((item)=>{const value=typeof item==="string"?item:item.value;const count=typeof item==="string"?"":` <small>(${item.count})</small>`;const categoryUrl=typeof item==="string"?"":(item.url||"");return `<button type="button" class="emrn-smartsearch-chip" data-emrn-search="${escapeHtml(value)}" data-emrn-chip-type="${chipType}" ${categoryUrl?`data-emrn-category-url="${escapeHtml(categoryUrl)}"`:""}>${escapeHtml(value)}${count}</button>`}).join("")}</div></div>`}
  function productItem(product){const url=normalizeUrl(product.url);const img=product.image?`<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">`:`<span>No image</span>`;return `<a class="emrn-smartsearch-item" href="${escapeHtml(url)}"><div class="emrn-smartsearch-img">${img}</div><div><div class="emrn-smartsearch-name">${escapeHtml(product.parent_name||product.name)}</div>${product.option_text?`<div class="emrn-smartsearch-option">${escapeHtml(smartOptionText(product.option_text))}</div>`:""}<div class="emrn-smartsearch-meta">${escapeHtml(product.brand||"EMRN")}${product.sold_by?` • ${escapeHtml(product.sold_by)}`:""}${product.sku?` • SKU: ${escapeHtml(product.sku)}`:""}</div></div><div class="emrn-smartsearch-view">${t("viewProduct")}</div></a>`}

  function ensureOverlay(){if(isResultsPage){document.querySelectorAll('.emrn-smartsearch-overlay').forEach((el)=>el.remove());return null}if(overlay&&document.body.contains(overlay))return overlay;document.querySelectorAll(".emrn-smartsearch-overlay").forEach((el)=>el.remove());overlay=document.createElement("div");overlay.className="emrn-smartsearch-overlay";overlay.hidden=true;overlay.style.display="none";document.body.appendChild(overlay);overlay.addEventListener("mousedown",(e)=>e.preventDefault());overlay.addEventListener("click",(e)=>{const chip=e.target.closest("[data-emrn-search]");if(chip&&activeInput){const term=chip.getAttribute("data-emrn-search")||"";const chipType=chip.getAttribute("data-emrn-chip-type")||"search";if(chipType==="category"){const categoryUrl=chip.getAttribute("data-emrn-category-url")||"";if(categoryUrl){hideOverlay();window.location.href=categoryUrl;return}}if(chipType==="brand"){goToFilteredResults("brand",term);return}activeInput.value=term;saveRecentSearch(term);lastRendered="";renderResults(term);activeInput.focus()}if(e.target.closest("[data-emrn-viewall]")&&activeInput)goToResults(activeInput.value)},true);return overlay}
  function positionOverlay(){if(!overlay||isResultsPage)return;const focused=isSearchInput(document.activeElement)?document.activeElement:activeInput;const input=focused||getInput();if(!input)return;activeInput=input;const rect=input.getBoundingClientRect();const viewportWidth=window.innerWidth||document.documentElement.clientWidth;const width=Math.min(760,viewportWidth-24);let left=rect.left;if(rect.width>0&&width<rect.width)left=rect.left;if(left+width>viewportWidth-12)left=Math.max(12,viewportWidth-width-12);if(left<12)left=12;overlay.style.width=`${width}px`;overlay.style.left=`${left}px`;overlay.style.top=`${rect.bottom+10}px`}
  function showOverlay(){if(isResultsPage){document.querySelectorAll('.emrn-smartsearch-overlay').forEach((el)=>el.remove());return}ensureOverlay();positionOverlay();overlay.hidden=false;overlay.style.display="block"}
  function hideOverlay(){if(!overlay)return;overlay.hidden=true;overlay.style.display="none"}

  function renderNoSuggestions(query,data){const terms=(data?.fallback_terms&&data.fallback_terms.length?data.fallback_terms:POPULAR_SEARCHES).slice(0,5);return `<div class="emrn-smartsearch-empty"><strong>${t("noResultsTitle")}</strong><br>${t("noResultsBody")}<div class="emrn-smartsearch-chips" style="margin-top:12px">${terms.map(term=>`<button type="button" class="emrn-smartsearch-chip" data-emrn-search="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join("")}</div></div>`}

  async function renderResults(query){if(isResultsPage){document.querySelectorAll('.emrn-smartsearch-overlay').forEach((el)=>el.remove());return}ensureOverlay();if(!overlay)return;if(!query||query.trim().length<2){renderStarter();return}lastRendered=query;overlay.innerHTML=`<div class="emrn-smartsearch-grid"><div class="emrn-smartsearch-products"><div class="emrn-smartsearch-title">${t("products")}</div><div class="emrn-smartsearch-loading">Searching...</div></div><div class="emrn-smartsearch-side"><div class="emrn-smartsearch-help">${t("cantFind")}<strong>${t("sourceHelp")}</strong></div></div></div>`;showOverlay();try{const res=await fetch(`${config.apiBase}/api/autocomplete?q=${encodeURIComponent(query)}`,{mode:"cors"});const data=await res.json();const products=data.products||[];const brandFacet=(data.facets||[]).find((facet)=>facet.field==="brand");const categoryFacet=(data.facets||[]).find((facet)=>facet.field==="categories");overlay.innerHTML=`<div class="emrn-smartsearch-grid"><div class="emrn-smartsearch-products"><div class="emrn-smartsearch-title">${t("products")}</div>${products.length?products.map(productItem).join(""):renderNoSuggestions(query,data)}${products.length?`<button type="button" class="emrn-smartsearch-viewall" data-emrn-viewall="1">${t("viewAll")} “${escapeHtml(query)}”</button>`:""}</div><div class="emrn-smartsearch-side">${sideCard(t("suggestedBrands"),brandFacet?.values||[])}${sideCard(t("suggestedCategories"),categoryFacet?.values||[])}${sideCard(t("popular"),POPULAR_SEARCHES)}<div class="emrn-smartsearch-help">${t("cantFind")}<strong>${t("sourceHelp")}</strong></div></div></div>`;showOverlay()}catch(err){console.error("[EMRN SmartSearch] API error",err);overlay.innerHTML=`<div class="emrn-smartsearch-empty">SmartSearch could not load right now. Please try again.</div>`;showOverlay()}}
  async function renderStarter(){if(isResultsPage){document.querySelectorAll('.emrn-smartsearch-overlay').forEach((el)=>el.remove());return}ensureOverlay();if(!overlay)return;const recent=getRecentSearches().slice(0,4);const popular=POPULAR_SEARCHES.slice(0,6);overlay.innerHTML=`<div class="emrn-smartsearch-grid"><div class="emrn-smartsearch-products"><div class="emrn-smartsearch-title">${t("popularProducts")}</div><div class="emrn-smartsearch-loading">Loading popular products...</div></div><div class="emrn-smartsearch-side">${sideCard(t("popular"),popular)}${recent.length?sideCard(t("recent"),recent):""}<div class="emrn-smartsearch-help">${t("cantFind")}<strong>${t("sourceHelp")}</strong></div></div></div>`;showOverlay();try{const starterQuery=LANG==="fr"?"gants":"gloves";const res=await fetch(`${config.apiBase}/api/autocomplete?q=${encodeURIComponent(starterQuery)}`,{mode:"cors"});const data=await res.json();const products=(data.products||[]).slice(0,5);if(!overlay||overlay.hidden||String(activeInput?.value||"").trim().length>=2)return;overlay.innerHTML=`<div class="emrn-smartsearch-grid"><div class="emrn-smartsearch-products"><div class="emrn-smartsearch-title">${t("popularProducts")}</div>${products.length?products.map(productItem).join(""):`<div class="emrn-smartsearch-starter"><h3>${t("startTyping")}</h3><p>${t("searchHelp")}</p>${sideCard(t("popular"),popular)}</div>`}</div><div class="emrn-smartsearch-side">${sideCard(t("popular"),popular)}${recent.length?sideCard(t("recent"),recent):""}<div class="emrn-smartsearch-help">${t("cantFind")}<strong>${t("sourceHelp")}</strong></div></div></div>`;showOverlay()}catch(err){console.error("[EMRN SmartSearch] starter products error",err)}}
  function scheduleRender(force=false){if(isResultsPage){document.querySelectorAll('.emrn-smartsearch-overlay').forEach((el)=>el.remove());return}if(!activeInput)return;const value=activeInput.value.trim();if(!force&&value===lastRendered)return;clearTimeout(renderTimer);renderTimer=setTimeout(()=>renderResults(value),120)}
  function attach(input){if(!input)return;activeInput=input;activeInput.dataset.emrnSmartSearchAttached="1";activeInput.setAttribute("autocomplete","off");if(!isResultsPage)ensureOverlay();input.addEventListener("focus",()=>{activeInput=input;scheduleRender(true)},true);input.addEventListener("input",()=>{activeInput=input;scheduleRender(true)},true);input.addEventListener("keyup",()=>{activeInput=input;scheduleRender(true)},true)}

  function goToFilteredResults(type,value){const q=new URLSearchParams(window.location.search).get("search_query")||activeInput?.value||"";const url=new URL(config.searchResultsUrl,window.location.origin);url.searchParams.set("search_query",q);url.searchParams.set(config.resultsParam,"1");if(type&&value)url.searchParams.set(type,value);window.location.href=url.toString()}
  function goToCategoryId(id){const q=new URLSearchParams(window.location.search).get("search_query")||"*";const url=new URL(config.searchResultsUrl,window.location.origin);url.searchParams.set("search_query",q);url.searchParams.set(config.resultsParam,"1");url.searchParams.set("category_id",id);window.location.href=url.toString()}

  async function loadCategoryTree(){if(categoryTreeCache)return categoryTreeCache;try{const res=await fetch(`${config.apiBase}/api/category-tree`,{mode:"cors"});const data=await res.json();const cats=data.categories||[];const byParent=new Map();cats.forEach(cat=>{const parent=Number(cat.parent_id||0);if(!byParent.has(parent))byParent.set(parent,[]);byParent.get(parent).push(cat)});categoryTreeCache={cats,byParent};return categoryTreeCache}catch(err){console.error("[EMRN SmartSearch] category tree error",err);return {cats:[],byParent:new Map()}}}
  function buildRelevantCategoryHelpers(categoryFacetCounts=[],selectedId=0,selectedName=""){
    const countByName=new Map((categoryFacetCounts||[]).map(item=>[String(item.value||"").toLowerCase(),Number(item.count||0)]));
    const visibleIds=new Set();
    const hasOwnCount=(cat)=>countByName.has(String(cat.name||"").toLowerCase());

    function markAncestors(cat){
      if(!cat||visibleIds.has(Number(cat.id)))return;
      visibleIds.add(Number(cat.id));
      const parentId=Number(cat.parent_id||0);
      if(parentId){
        const parent=(categoryTreeCache?.cats||[]).find(item=>Number(item.id)===parentId);
        if(parent)markAncestors(parent);
      }
    }

    function markDescendantsWithResults(cat){
      const children=categoryTreeCache?.byParent.get(Number(cat.id))||[];
      let childHasResults=false;
      children.forEach(child=>{
        if(markDescendantsWithResults(child)) childHasResults=true;
      });
      const activeById=Number(selectedId)===Number(cat.id);
      const activeByName=selectedName&&String(cat.name).toLowerCase()===String(selectedName).toLowerCase();
      const include=hasOwnCount(cat)||childHasResults||activeById||activeByName;
      if(include)markAncestors(cat);
      if(include)visibleIds.add(Number(cat.id));
      return include;
    }

    (categoryTreeCache?.cats||[]).forEach(cat=>markDescendantsWithResults(cat));

    return {visibleIds,countByName};
  }

  function renderCategoryBranch(parentId,level=0,selectedId=0,selectedName="",helpers={visibleIds:new Set(),countByName:new Map()}){
    if(!categoryTreeCache)return"";
    const children=(categoryTreeCache.byParent.get(Number(parentId))||[])
      .filter(cat=>helpers.visibleIds.has(Number(cat.id)))
      .sort((a,b)=>a.name.localeCompare(b.name));

    return children.map(cat=>{
      const hasChildren=(categoryTreeCache.byParent.get(Number(cat.id))||[]).some(child=>helpers.visibleIds.has(Number(child.id)));
      const isActive=Number(selectedId)===Number(cat.id)||(selectedName&&String(cat.name).toLowerCase()===String(selectedName).toLowerCase());
      const count=helpers.countByName.get(String(cat.name||"").toLowerCase())||0;
      return `<div class="emrn-smart-cat-node" data-cat-node="${cat.id}" style="margin-left:${level?10:0}px"><div class="emrn-smart-cat-row ${isActive?"active":""}">${hasChildren?`<button type="button" class="emrn-smart-cat-toggle" data-cat-toggle="${cat.id}">+</button>`:`<span style="width:24px"></span>`}<button type="button" class="emrn-smart-cat-link" data-category-id="${cat.id}" title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</button>${count?`<span class="emrn-smart-cat-count">${count}</span>`:""}</div>${hasChildren?`<div class="emrn-smart-cat-children" data-cat-children="${cat.id}">${renderCategoryBranch(cat.id,level+1,selectedId,selectedName,helpers)}</div>`:""}</div>`
    }).join("")
  }

  function renderCategoryTree(selectedId,selectedName="",categoryFacetCounts=[]){
    const helpers=buildRelevantCategoryHelpers(categoryFacetCounts,selectedId,selectedName);
    const tree=renderCategoryBranch(0,0,selectedId,selectedName,helpers);
    if(!tree)return "";
    return `<div class="emrn-smart-filter-group"><h3>${t("categories")}</h3><div class="emrn-smart-category-tree">${tree}</div></div>`;
  }

  function expandActiveCategoryTree(){
    document.querySelectorAll(".emrn-smart-cat-row.active").forEach(row=>{
      let parent=row.closest(".emrn-smart-cat-children");
      while(parent){
        parent.classList.add("open");
        const id=parent.getAttribute("data-cat-children");
        const toggle=document.querySelector(`[data-cat-toggle="${id}"]`);
        if(toggle)toggle.textContent="−";
        parent=parent.parentElement?.closest(".emrn-smart-cat-children")
      }
    })
  }

  async function addToCart(product,qty,button){button.disabled=true;const original=button.textContent;button.textContent=t("adding");try{const quantity=Math.max(1,Number(qty||1));const cartsRes=await fetch("/api/storefront/carts",{credentials:"include"});const carts=await cartsRes.json();const existingCart=Array.isArray(carts)&&carts.length?carts[0]:null;const endpoint=existingCart?.id?`/api/storefront/carts/${existingCart.id}/items`:"/api/storefront/carts";const lineItem={quantity,productId:Number(product.product_id)};if(Number(product.variant_id)>0)lineItem.variantId=Number(product.variant_id);const res=await fetch(endpoint,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({lineItems:[lineItem]})});if(!res.ok)throw new Error(await res.text());button.textContent=t("added")}catch(err){console.error("[EMRN SmartSearch] add to cart failed",err);button.textContent=t("viewProduct");button.dataset.fallback="1"}finally{setTimeout(()=>{button.disabled=false;if(button.textContent===t("added"))button.textContent=original},1800)}}
  function productCard(product){const url=normalizeUrl(product.url);const price=Number(product.price||0);const img=product.image?`<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">`:`<span>No image</span>`;const option=smartOptionText(product.option_text);return `<article class="emrn-smart-product-card" data-product='${escapeHtml(JSON.stringify({product_id:product.product_id,variant_id:product.variant_id||0,url}))}'><a class="emrn-smart-product-img" href="${escapeHtml(url)}">${img}</a><div class="emrn-smart-product-body"><div class="emrn-smart-stars">★ ★ ★ ★ ★</div><a class="emrn-smart-product-name" href="${escapeHtml(url)}">${escapeHtml(product.parent_name||product.name)}</a>${option?`<div class="emrn-smart-variant" title="${escapeHtml(product.option_text)}">${escapeHtml(option)}</div>`:"<div class='emrn-smart-variant'></div>"}<div class="emrn-smart-meta">${product.brand?`<span>${escapeHtml(product.brand)}</span>`:""}${product.sold_by?`<span>${escapeHtml(product.sold_by)}</span>`:""}${product.sku?`<span>SKU: ${escapeHtml(product.sku)}</span>`:""}</div><div class="emrn-smart-price">${price>0?`$${price.toFixed(2)}`:"See product"}</div><div class="emrn-smart-card-actions"><div class="emrn-smart-qty"><button type="button" data-qty-minus>−</button><span data-qty>1</span><button type="button" data-qty-plus>+</button></div><button type="button" class="emrn-smart-cart-btn" data-add-cart>${t("addToCart")}</button><a class="emrn-smart-view-btn" href="${escapeHtml(url)}">${t("viewProduct")}</a><button type="button" class="emrn-smart-quote-btn" data-quote>${t("addToQuote")}</button></div></div></article>`}
  function facetGroup(title,items,type){if(!items||!items.length)return"";return `<div class="emrn-smart-filter-group"><h3>${escapeHtml(title)}</h3><div class="emrn-smart-facet-list">${items.slice(0,20).map((item)=>`<button type="button" class="emrn-smart-facet" data-filter-type="${type}" data-filter-value="${escapeHtml(item.value)}"><span class="emrn-smart-facet-name">${escapeHtml(item.value)}</span><span class="emrn-smart-facet-count">${item.count}</span></button>`).join("")}</div></div>`}
  function noResultsBox(data,q){const terms=data?.fallback_terms||POPULAR_SEARCHES.slice(0,6);return `<div class="emrn-smart-no-results"><h2>${t("noResultsTitle")}</h2><p>${t("noResultsBody")}</p><div class="emrn-smart-no-actions">${terms.map(term=>`<button type="button" data-no-search="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join("")}<a class="primary" href="${escapeHtml(config.quoteUrl)}?search=${encodeURIComponent(q)}">${t("requestQuote")}</a></div></div>`}

  function currentSearchParamsForApi(page=1){
    const pageParams=new URLSearchParams(window.location.search);
    const q=pageParams.get("search_query")||pageParams.get("q")||"";
    const brand=pageParams.get("brand")||"";
    const category=pageParams.get("category")||"";
    const categoryId=Number(pageParams.get("category_id")||0);
    const apiParams=new URLSearchParams();
    apiParams.set("q",q||"*");
    apiParams.set("page",String(page));
    if(brand)apiParams.set("brand",brand);
    if(category)apiParams.set("category",category);
    if(categoryId)apiParams.set("category_id",String(categoryId));
    return {apiParams,q,brand,category,categoryId}
  }

  async function fetchSearchPage(page=1){
    const {apiParams}=currentSearchParamsForApi(page);
    const res=await fetch(`${config.apiBase}/api/search?${apiParams.toString()}`,{mode:"cors"});
    return res.json();
  }

  function renderLoadMore(found,totalShown,page){
    if(!found || totalShown>=found) return "";
    return `<button type="button" class="emrn-smart-load-more" data-load-more="${page+1}">${t("loadMore")}</button>`;
  }

  async function renderStorefrontResults(){
    hideOverlay();
    document.querySelectorAll('.emrn-smartsearch-overlay').forEach((el)=>el.remove());
    const {q,brand,category,categoryId}=currentSearchParamsForApi(1);
    const main=document.querySelector("main")||document.querySelector(".body")||document.body;
    document.querySelector(".emrn-smart-results-page")?.remove();
    const shell=document.createElement("section");
    shell.className="emrn-smart-results-page";
    shell.innerHTML=`<div class="emrn-smart-results-header"><div class="eyebrow">EMRN SmartSearch</div><h1>${t("resultsFor")} “${escapeHtml(q)}”</h1><p>${t("smarterMatching")}</p><div class="emrn-smart-results-search"><input value="${escapeHtml(q)}" placeholder="${t("searchPlaceholder")}" data-smart-results-input><button type="button" data-smart-results-search>${t("searchButton")}</button></div></div><div class="emrn-smart-message">Loading SmartSearch results...</div>`;
    main.prepend(shell);
    await loadCategoryTree();
    try{
      const data=await fetchSearchPage(1);
      const products=(data.hits||[]).map((hit)=>hit.document);
      const found=Number(data.found||products.length||0);
      const brandFacet=(data.facet_counts||[]).find((facet)=>facet.field_name==="brand")?.counts||[];const categoryFacet=(data.facet_counts||[]).find((facet)=>facet.field_name==="categories")?.counts||[];
      shell.innerHTML=`<div class="emrn-smart-results-header"><div class="eyebrow">EMRN SmartSearch</div><h1>${t("resultsFor")} “${escapeHtml(q)}”</h1><p>${found||products.length} ${t("skuLevelShown")}${brand?` • ${escapeHtml(brand)}`:""}${category?` • ${escapeHtml(category)}`:""}</p><div class="emrn-smart-results-search"><input value="${escapeHtml(q)}" placeholder="${t("searchPlaceholder")}" data-smart-results-input><button type="button" data-smart-results-search>${t("searchButton")}</button></div></div><div class="emrn-smart-results-shell"><aside class="emrn-smart-results-filters"><div class="emrn-smart-filter-title">${t("refineBy")}</div><div class="emrn-smart-filter-note">${brand||category||categoryId?t("filtersApplied"):t("chooseBrandCategory")}</div>${brand||category||categoryId?`<button type="button" class="emrn-smart-viewall" data-clear-filters>${t("clearFilters")}</button>`:""}${facetGroup(t("brands"),brandFacet,"brand")}${renderCategoryTree(categoryId,category,categoryFacet)}</aside><div class="emrn-smart-results-main"><div class="emrn-smart-results-top"><div><h2>${t("products")}</h2><p><span data-results-count>${products.length}</span> / ${found||products.length} ${t("skuLevelShown")}</p></div></div>${products.length?`<div class="emrn-smart-products-grid" data-products-grid>${products.map(productCard).join("")}</div>${renderLoadMore(found,products.length,1)}`:noResultsBox(data,q)}</div></div>`;
      expandActiveCategoryTree();
    }catch(err){
      console.error("[EMRN SmartSearch] results page error",err);
      shell.innerHTML=`<div class="emrn-smart-message">SmartSearch results could not load. Please try again.</div>`;
    }
  }

  document.addEventListener("focusin",(e)=>{if(isSearchInput(e.target)){attach(e.target);scheduleRender(true)}},true)
  document.addEventListener("input",(e)=>{if(isSearchInput(e.target)){attach(e.target);scheduleRender(true)}},true)
  document.addEventListener("keyup",(e)=>{if(isSearchInput(e.target)){attach(e.target);scheduleRender(true)}},true)
  document.addEventListener("keydown",(e)=>{if(!isSearchInput(e.target))return;activeInput=e.target;if(e.key==="Escape")return hideOverlay();if(e.key==="Enter"){const q=activeInput.value.trim();if(q.length>=2){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();goToResults(q)}}},true)
  document.addEventListener("submit",(e)=>{const form=e.target;const input=form?.querySelector?.(SELECTORS.join(","));if(!input)return;const q=input.value.trim();if(q.length>=2){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();activeInput=input;goToResults(q)}},true)
  document.addEventListener("click",(e)=>{const loadMore=e.target.closest("[data-load-more]");if(loadMore){const nextPage=Number(loadMore.getAttribute("data-load-more")||2);loadMore.disabled=true;loadMore.textContent=t("loadingMore");fetchSearchPage(nextPage).then(data=>{const products=(data.hits||[]).map((hit)=>hit.document);const grid=document.querySelector("[data-products-grid]");if(grid)grid.insertAdjacentHTML("beforeend",products.map(productCard).join(""));const shown=document.querySelectorAll(".emrn-smart-product-card").length;const count=document.querySelector("[data-results-count]");if(count)count.textContent=String(shown);const found=Number(data.found||shown);loadMore.outerHTML=renderLoadMore(found,shown,nextPage)}).catch(err=>{console.error("[EMRN SmartSearch] load more failed",err);loadMore.disabled=false;loadMore.textContent=t("loadMore")});return}const searchButton=e.target.closest("[data-smart-results-search]");if(searchButton){const input=document.querySelector("[data-smart-results-input]");goToResults(input?.value||"");return}const noSearch=e.target.closest("[data-no-search]");if(noSearch){goToResults(noSearch.getAttribute("data-no-search")||"");return}const clear=e.target.closest("[data-clear-filters]");if(clear){const q=new URLSearchParams(window.location.search).get("search_query")||"";goToResults(q);return}const catToggle=e.target.closest("[data-cat-toggle]");if(catToggle){const id=catToggle.getAttribute("data-cat-toggle");const child=document.querySelector(`[data-cat-children="${id}"]`);if(child){child.classList.toggle("open");catToggle.textContent=child.classList.contains("open")?"−":"+"}return}const catLink=e.target.closest("[data-category-id]");if(catLink){goToCategoryId(catLink.getAttribute("data-category-id"));return}const filter=e.target.closest("[data-filter-type][data-filter-value]");if(filter){goToFilteredResults(filter.dataset.filterType,filter.dataset.filterValue);return}const plus=e.target.closest("[data-qty-plus]");const minus=e.target.closest("[data-qty-minus]");if(plus||minus){const card=e.target.closest("[data-product]");const qtyEl=card?.querySelector("[data-qty]");if(!qtyEl)return;const current=Number(qtyEl.textContent||1);qtyEl.textContent=String(Math.max(1,current+(plus?1:-1)));return}const add=e.target.closest("[data-add-cart]");if(add){const card=add.closest("[data-product]");const qty=Number(card?.querySelector("[data-qty]")?.textContent||1);let product={};try{product=JSON.parse(card.dataset.product)}catch{}if(add.dataset.fallback==="1"){if(product.url)window.location.href=product.url;return}addToCart(product,qty,add);return}const quote=e.target.closest("[data-quote]");if(quote){const card=quote.closest("[data-product]");let product={};try{product=JSON.parse(card.dataset.product)}catch{}if(product.url)window.location.href=product.url;return}if(overlay&&!overlay.contains(e.target)&&activeInput&&e.target!==activeInput)hideOverlay()},true)
  window.addEventListener("resize",positionOverlay)
  window.addEventListener("scroll",()=>{ if(overlay&&!overlay.hidden) positionOverlay() },true)
  setInterval(()=>{if(isResultsPage)return;const input=getInput();if(input&&input!==activeInput)attach(input);if(activeInput){const current=activeInput.value||"";if(current!==lastValue){lastValue=current;scheduleRender(true)}}},300)
  function init(){if(isResultsPage){renderStorefrontResults();return}const input=getInput();if(input)attach(input)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init()
})();
