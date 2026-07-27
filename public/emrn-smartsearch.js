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
  const isSearchPath = /\/search\.php$/i.test(window.location.pathname);
  const isResultsPage = isSearchPath && (params.get(config.resultsParam) === "1" || params.has("search_query") || params.has("q"));
  const pageType = String(config.pageType || "").toLowerCase();
  const configuredCategoryId = Number(config.categoryId || 0);
  const configuredCategoryName = String(config.categoryName || "");
  const configuredBrandName = String(config.brandName || "");
  const shouldReplaceCategory = config.replaceCategoryPages !== false && pageType === "category" && (configuredCategoryId || configuredCategoryName) && !isSearchPath;
  const shouldReplaceBrand = config.replaceBrandPages !== false && pageType === "brand" && configuredBrandName && !isSearchPath;
  const isSmartListingPage = isResultsPage || shouldReplaceCategory || shouldReplaceBrand;

  if (!config.enabled && !isTestMode && !isSmartListingPage) return;

  console.log("[EMRN SmartSearch] French broad match popular starter loaded");

  const SELECTORS = ["#search_query_adv", 'input[name="search_query_adv"]', 'input[name="search_query"]', 'input[type="search"]', 'input[placeholder*="Search"]'];
  const MOBILE_INPUT_SELECTOR = "[data-emrn-smart-mobile-input]";
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
      addToCart: "Add to Cart", adding: "Adding...", added: "Added ✓", viewProduct: "View Product", addToQuote: "Add to quote", quoteOnly: "Quote only", backTop: "Back to top",
      noProductsFound: "No products found.", noResultsTitle: "No exact results found", noResultsBody: "Try one of these related searches or request a quote and EMRN can help source it.",
      trySearches: "Try these searches", requestQuote: "Request a quote", askMeri: "Ask Meri for help", subcategories: "Subcategories", loadMore: "Show more products", loadingMore: "Loading...", showingResultsFor: "Showing results for",
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
      addToCart: "Ajouter au panier", adding: "Ajout...", added: "Ajouté ✓", viewProduct: "Voir le produit", addToQuote: "Ajouter au devis", quoteOnly: "Devis seulement", backTop: "Retour en haut",
      noProductsFound: "Aucun produit trouvé.", noResultsTitle: "Aucun résultat exact trouvé", noResultsBody: "Essayez une recherche associée ou demandez un devis. EMRN peut vous aider à trouver l’article.",
      trySearches: "Essayez ces recherches", requestQuote: "Demander un devis", askMeri: "Demander à Meri", subcategories: "Sous-catégories", loadMore: "Voir plus de produits", loadingMore: "Chargement...", showingResultsFor: "Résultats affichés pour",
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
  let requestSeq = 0;
  let navigatingToSmartResults = false;
  const autocompleteShownQueries = new Set();
  const SUPPRESS_KEY = "emrn-smartsearch-suppress-until-click";
  let suppressOverlayUntilClick = (()=>{try{return sessionStorage.getItem(SUPPRESS_KEY)==="1"}catch{return false}})();
  const QUOTE_UPDATED_KEY = "emrnSmartSearchQuoteUpdatedAt";
  const QUOTE_STALE_KEY = "emrnSmartSearchQuoteStaleAt";

  function markSmartReady(){
    document.body?.classList.add("emrn-smart-ready");
    document.documentElement.classList.remove("emrn-smart-preload");
  }

  const style = document.createElement("style");
  style.textContent = `
    .emrn-smartsearch-overlay{position:fixed!important;width:min(820px,calc(100vw - 24px));max-width:820px;background:#fff;border:1px solid #ead7d8;border-radius:22px;overflow:hidden;box-shadow:0 24px 60px rgba(20,30,55,.24);z-index:2147483647!important;font-family:Arial,sans-serif;color:#1f2937}
    .emrn-smartsearch-grid{display:grid;grid-template-columns:1.35fr .75fr}
    .emrn-smartsearch-starter-grid{display:grid;grid-template-columns:1fr 1.2fr .72fr}
    .emrn-smartsearch-products{padding:18px;border-right:1px solid #eee;background:#fff;min-height:260px;max-height:500px;overflow:auto}
    .emrn-smartsearch-side{padding:18px;background:#fff8f8;max-height:500px;overflow:auto}
    .emrn-smartsearch-title{color:#c34d50;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin:0 0 12px}
    .emrn-smartsearch-cat-grid{display:grid;grid-template-columns:1fr;gap:7px}
    .emrn-smartsearch-cat-choice{width:100%;min-height:38px;border:1px solid #edf0f4;background:#fff;border-radius:12px;padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left;font-weight:900;color:#263142;cursor:pointer}
    .emrn-smartsearch-cat-choice:hover{border-color:#c34d50;background:#fff8f8;color:#c34d50}
    .emrn-smartsearch-cat-choice small{background:#f3f4f6;border-radius:999px;padding:3px 7px;color:#6b7280;font-size:11px;font-weight:900}
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
    .emrn-smartsearch-correction{display:inline-flex;margin:0 0 12px;padding:7px 10px;border:1px solid #f0dada;border-radius:999px;background:#fff;color:#475569;font-size:13px;font-weight:800}
    .emrn-smartsearch-correction strong{color:#14365d;margin-left:4px}
    .emrn-smartsearch-help{background:#14365d;color:#fff;border-radius:16px;padding:14px;line-height:1.4;font-size:13px}
    .emrn-smartsearch-help strong{display:block;margin-top:3px}
    .emrn-smartsearch-empty,.emrn-smartsearch-loading{background:#fffafa;border:1px solid #f0dada;border-radius:15px;padding:18px;color:#666;font-size:14px}
    .emrn-smartsearch-mobile-search{display:none;padding:12px 12px 0;background:#fff}
    .emrn-smartsearch-mobile-search input{width:100%;height:46px;border:2px solid #c34d50;border-radius:999px;background:#fff;padding:0 16px;font-size:16px;line-height:46px;color:#1f2937;caret-color:#c34d50;outline:none;box-sizing:border-box;-webkit-user-select:text;user-select:text}

    body.emrn-smart-search-active .emrn-top-wrap--search,body.emrn-smart-search-active .emrn-search-toolbar{display:none!important}
    body.emrn-smart-search-active section.page{display:block!important}
    body.emrn-smart-search-active{overflow-x:hidden}
    body.emrn-smart-search-active main.body>.container{max-width:none;width:100%;padding-left:0;padding-right:0}
    .emrn-smart-results-page{width:min(1240px,calc(100% - 40px));max-width:1240px;margin:24px auto 70px;padding:0 20px;box-sizing:border-box;font-family:Arial,sans-serif;color:#1f2937;overflow:visible}
    .emrn-smart-results-header{background:linear-gradient(135deg,#fff 0%,#fff8f8 100%);border:1px solid #f0dada;border-radius:22px;padding:24px;margin-bottom:24px;box-shadow:0 12px 30px rgba(20,30,55,.06)}
    .emrn-smart-results-header.compact{padding:18px 22px;margin-bottom:18px}
    .emrn-smart-results-header .eyebrow{color:#c34d50;font-size:12px;font-weight:900;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
    .emrn-smart-results-header h1{margin:0 0 8px;font-size:32px;letter-spacing:-.6px}
    .emrn-smart-did-you-mean{display:inline-flex;margin:8px 0 0;padding:7px 10px;border:1px solid #f0dada;border-radius:999px;background:#fff;color:#475569;font-size:13px;font-weight:800}
    .emrn-smart-did-you-mean strong{color:#14365d;margin-left:4px}
    .emrn-smart-results-search{display:flex;gap:10px;margin-top:18px}
    .emrn-smart-results-search input{flex:1;height:52px;border:2px solid #c34d50;border-radius:999px;padding:0 18px;font-size:16px;outline:none}
    .emrn-smart-results-search button{border:0;background:#c34d50;color:#fff;border-radius:999px;padding:0 24px;font-weight:900;cursor:pointer}
    .emrn-smart-filter-toggle{display:none;width:100%;height:44px;margin:0 0 14px;border:1px solid #c34d50;background:#fff;color:#c34d50;border-radius:999px;font-weight:900;align-items:center;justify-content:center;cursor:pointer}.emrn-smart-results-shell{display:grid;grid-template-columns:280px minmax(0,1fr);gap:22px;min-width:0}.emrn-smart-results-main{min-width:0}
    .emrn-smart-related-cats{display:flex;gap:18px;align-items:flex-start;overflow:auto;padding:0 2px 22px;margin:-2px 0 18px;scrollbar-width:thin}
    .emrn-smart-related-cat{width:108px;flex:0 0 108px;border:0;background:transparent;color:#2f3138;text-align:center;cursor:pointer;padding:0;font-weight:900;line-height:1.2}
    .emrn-smart-related-cat-img{width:86px;height:86px;margin:0 auto 9px;border:1px solid #f0dada;border-radius:999px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;box-shadow:0 8px 20px rgba(0,0,0,.05)}
    .emrn-smart-related-cat-img img{width:100%;height:100%;object-fit:contain;padding:9px}
    .emrn-smart-related-cat:hover .emrn-smart-related-cat-img{border-color:#c84d52;box-shadow:0 10px 24px rgba(200,77,82,.14)}
    .emrn-smart-related-cat span{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:12px}
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
    .emrn-smart-price-fields{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}.emrn-smart-price-fields label{font-size:11px;font-weight:900;color:#606975;text-transform:uppercase}.emrn-smart-price-fields input{width:100%;height:36px;border:1px solid #e5e7eb;border-radius:10px;padding:0 9px;margin-top:5px;font-weight:800}.emrn-smart-price-filter input[type="range"]{width:100%;accent-color:#c34d50}.emrn-smart-apply-price{width:100%;height:38px;margin-top:9px;border:1px solid #c34d50;background:#c34d50;color:#fff;border-radius:999px;font-weight:900;cursor:pointer}.emrn-smart-apply-price:hover{background:#b43f44}
    .emrn-smart-cat-row{display:flex;align-items:center;gap:6px;border:1px solid #e5e7eb;background:#fff;border-radius:11px;min-height:36px;padding:6px 7px}
    .emrn-smart-cat-row.active{border-color:#c34d50;background:#fff8f8;color:#c34d50}
    .emrn-smart-cat-toggle{border:0;background:#f3f4f6;border-radius:7px;width:24px;height:24px;cursor:pointer;font-weight:900}
    .emrn-smart-cat-link{border:0;background:transparent;flex:1;text-align:left;font-weight:800;font-size:13px;cursor:pointer;color:inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.emrn-smart-cat-count{background:#f3f4f6;color:#555;border-radius:999px;padding:4px 7px;font-size:11px;font-weight:900}
    .emrn-smart-cat-children{display:none;margin-left:18px;gap:5px;flex-direction:column}
    .emrn-smart-cat-children.open{display:flex}
    .emrn-smart-results-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;gap:12px}
    .emrn-smart-results-top h2{margin:0;font-size:24px}
    .emrn-smart-results-top p{margin:4px 0 0;color:#777}
    .emrn-smart-results-controls{display:flex;align-items:center;gap:8px;margin-left:auto}
    .emrn-smart-results-controls label{font-size:12px;color:#606975;font-weight:900;text-transform:uppercase}
    .emrn-smart-sort-select{height:40px;border:1px solid #e5e7eb;background:#fff;border-radius:999px;padding:0 34px 0 13px;font-weight:900;color:#343742;cursor:pointer}
    .emrn-smart-products-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;align-items:stretch;min-width:0}
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
    .emrn-smart-price{font-size:20px;font-weight:400;color:#252735;min-height:28px;margin:6px 0 10px;display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}
    .emrn-smart-sale-price{color:#1f8b4c;font-weight:900}
    .emrn-smart-was-price{color:#8a8f9b;text-decoration:line-through;font-size:14px;font-weight:800}
    .emrn-smart-card-actions{margin-top:auto;display:flex;flex-direction:column;gap:8px}
    .emrn-smart-qty{height:44px;border:1px solid rgba(195,77,80,.11);background:#fff;border-radius:999px;display:grid;grid-template-columns:42px 1fr 42px;align-items:center;text-align:center;margin:0 0 4px;overflow:hidden}
    .emrn-smart-qty button{height:42px;border:0;background:transparent;font-size:18px;font-weight:800;color:#4f4851;cursor:pointer;display:flex;align-items:center;justify-content:center}
    .emrn-smart-qty button:hover{color:#c34d50;background:rgba(195,77,80,.05)}
    .emrn-smart-cart-btn,.emrn-smart-quote-btn,.emrn-smart-view-btn{width:100%;min-height:44px;border-radius:999px;font-weight:900;cursor:pointer;transition:all .18s ease;font-size:13px;display:flex;align-items:center;justify-content:center;text-decoration:none;text-align:center;padding:0 16px;margin:0}
    .emrn-smart-cart-btn{border:2px solid #c34d50;background:#c34d50;color:#fff;box-shadow:0 6px 12px rgba(195,77,80,.12)}
    .emrn-smart-cart-btn:hover{background:#b94246;border-color:#b94246;transform:translateY(-1px)}
    .emrn-smart-view-btn{border:2px solid #c34d50;background:#fff;color:#c34d50}
    .emrn-smart-view-btn:hover{background:#fff7f7;transform:translateY(-1px)}
    .emrn-smart-quote-btn{color:#3f3941;background:linear-gradient(180deg,#fffefe 0%,#f3ecec 100%);border:1px solid rgba(195,77,80,.34);box-shadow:inset 0 1px 0 rgba(255,255,255,.96),0 2px 8px rgba(195,77,80,.045);letter-spacing:.01em}
    .emrn-smart-quote-btn:hover{transform:translateY(-1px);color:#8a3136;background:linear-gradient(180deg,#fff8f8 0%,#fbe9e9 100%);border-color:rgba(195,77,80,.36);box-shadow:0 8px 16px rgba(195,77,80,.085),inset 0 1px 0 rgba(255,255,255,.98)}
    .emrn-smart-cart-btn[disabled],.emrn-smart-quote-btn[disabled]{opacity:.7;cursor:wait}
    .emrn-smart-cart-btn.emrn-atc-loading,.emrn-smart-quote-btn.emrn-atc-loading{position:relative;overflow:hidden;color:#fff;background:#c34d50;border-color:#c34d50}
    .emrn-smart-cart-btn.emrn-atc-loading::after,.emrn-smart-quote-btn.emrn-atc-loading::after{content:"";position:absolute;inset:0;border-radius:inherit;background:linear-gradient(120deg,rgba(255,255,255,.08),rgba(255,255,255,.38),rgba(255,255,255,.08));background-size:260% 100%;animation:emrn-quote-shimmer 1.45s linear infinite;pointer-events:none}
    .emrn-smart-cart-btn.emrn-atc-success,.emrn-smart-quote-btn.emrn-atc-success{background:#25a56a!important;border-color:#25a56a!important;color:#fff!important;box-shadow:0 8px 18px rgba(37,165,106,.22)}
    @keyframes emrn-quote-shimmer{0%{background-position:-160% 0}100%{background-position:160% 0}}
    .emrn-smart-message{background:#fffafa;border:1px solid #f0dada;border-radius:16px;padding:18px;color:#666}
    .emrn-smart-load-more{margin:24px auto 0;display:flex;align-items:center;justify-content:center;width:min(260px,100%);height:46px;border:0;border-radius:999px;background:#c34d50;color:#fff;font-weight:900;cursor:pointer}
    .emrn-smart-load-more[disabled]{opacity:.65;cursor:not-allowed}
    .emrn-smart-backtop{position:fixed;right:24px;bottom:104px;z-index:999999;border:0;border-radius:999px;background:#c34d50;color:#fff;box-shadow:0 12px 28px rgba(195,77,80,.24);width:46px;height:46px;padding:0;font-size:20px;line-height:1;font-weight:900;cursor:pointer;opacity:0;pointer-events:none;transform:translateY(8px);transition:all .16s ease}
    .emrn-smart-backtop.is-visible{opacity:1;pointer-events:auto;transform:translateY(0)}
    .emrn-smart-cat-row.active .emrn-smart-cat-link{color:#c34d50}
    .emrn-smart-no-results{background:#fff;border:1px solid #f0dada;border-radius:20px;padding:24px;box-shadow:0 10px 26px rgba(0,0,0,.05)}
    .emrn-smart-no-results h2{margin:0 0 8px;font-size:26px}
    .emrn-smart-no-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}
    .emrn-smart-no-actions button,.emrn-smart-no-actions a{border:1px solid #e5e7eb;background:#fff;border-radius:999px;padding:10px 14px;font-weight:900;text-decoration:none;color:#1f2937;cursor:pointer}
    .emrn-smart-no-actions .primary{background:#c34d50;color:#fff;border-color:#c34d50}
    .emrn-smart-ask-meri{display:inline-flex;align-items:center;gap:8px;box-shadow:0 10px 22px rgba(195,77,80,.18)}
    .emrn-smart-ask-meri img{width:24px;height:24px;border-radius:999px;background:#fff;object-fit:contain}
    @media (max-width:1100px){.emrn-smart-products-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media (max-width:900px){.emrn-smart-results-shell{grid-template-columns:1fr}.emrn-smart-filter-toggle{display:flex}.emrn-smart-results-filters{display:none;position:static;max-height:none}.emrn-smart-results-filters.open{display:block}.emrn-smart-products-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:760px){body.emrn-smart-search-active{overflow-x:hidden}.emrn-smartsearch-mobile-search{display:block}.emrn-smartsearch-mobile-search input:focus{border-color:#c34d50;box-shadow:0 0 0 3px rgba(195,77,80,.12)}.emrn-smartsearch-overlay{left:10px!important;right:10px!important;top:84px!important;width:auto!important;max-height:calc(100vh - 100px);overflow:auto;border-radius:18px}.emrn-smartsearch-grid,.emrn-smartsearch-starter-grid{grid-template-columns:1fr}.emrn-smartsearch-products{border-right:0;border-bottom:1px solid #eee;max-height:360px}.emrn-smartsearch-side{max-height:none}.emrn-smartsearch-item{grid-template-columns:54px 1fr}.emrn-smartsearch-view{display:none}.emrn-smart-results-page{width:100%;max-width:100%;box-sizing:border-box;margin:12px auto 110px;padding:0 12px;overflow:hidden}.emrn-smart-results-header{padding:16px;border-radius:18px;margin-bottom:16px}.emrn-smart-results-header h1{font-size:25px;line-height:1.15}.emrn-smart-results-shell{display:block;min-width:0}.emrn-smart-results-main{min-width:0;width:100%}.emrn-smart-products-grid{grid-template-columns:minmax(0,1fr);gap:14px;width:100%;min-width:0}.emrn-smart-product-card{width:100%;min-width:0;box-sizing:border-box}.emrn-smart-product-img{height:190px}.emrn-smart-product-body{min-width:0}.emrn-smart-card-actions{padding-bottom:4px}.emrn-smart-results-search{flex-direction:column}.emrn-smart-results-search button{height:48px}.emrn-smart-related-cats{gap:13px;padding-bottom:16px;margin-bottom:10px}.emrn-smart-related-cat{width:84px;flex-basis:84px}.emrn-smart-related-cat-img{width:68px;height:68px}.emrn-smart-related-cat span{font-size:11px}.emrn-smart-backtop{right:14px;bottom:136px;width:42px;height:42px;font-size:18px}body.emrn-smart-search-active .emrn-finish-quote-button{right:70px!important;bottom:18px!important}}
  `;
  document.head.appendChild(style);

  function getInput(){return SELECTORS.map((sel)=>document.querySelector(sel)).find(Boolean)}
  function isSearchInput(el){return !!(el&&el.matches&&SELECTORS.some((sel)=>el.matches(sel)))}
  function isMobileOverlayInput(el){return !!(el&&el.matches&&el.matches(MOBILE_INPUT_SELECTOR))}
  function escapeHtml(str){return String(str||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
  function normalizeUrl(url){try{const next=new URL(url||"/",window.location.origin);const configured=new URL(config.storeUrl||window.location.origin,window.location.origin);if(next.host===configured.host||next.host!==window.location.host)return `${next.pathname}${next.search}${next.hash}`;return next.toString()}catch{return url||"/"}}
  function productUrl(product){const next=new URL(normalizeUrl(product?.url),window.location.origin);if(product?.sku)next.searchParams.set("sku",product.sku);if(Number(product?.variant_id)>0)next.searchParams.set("variant_id",String(Number(product.variant_id)));if(product?.option_text)next.searchParams.set("option_text",product.option_text);return `${next.pathname}${next.search}${next.hash}`}
  function quoteUrl(url){const next=new URL(normalizeUrl(url),window.location.origin);next.searchParams.delete("quote");next.searchParams.set("fsquote","1");return `${next.pathname}${next.search}${next.hash}`}
  function isQuoteOnly(product){return product?.quote_only===true||product?.purchase_action==="quote_only"||product?.purchasable===false}
  function getRecentSearches(){try{return JSON.parse(localStorage.getItem("emrn_recent_searches")||"[]")}catch{return[]}}
  function saveRecentSearch(term){if(!term||term.length<2)return;const recent=getRecentSearches();const next=[term,...recent.filter((x)=>x!==term)].slice(0,6);localStorage.setItem("emrn_recent_searches",JSON.stringify(next))}
  function getViewedSkus(){try{return JSON.parse(localStorage.getItem("emrn_viewed_skus")||"[]")}catch{return[]}}
  function rememberViewedSku(sku){const clean=String(sku||"").trim().toUpperCase().replace(/\s+/g,"");if(!clean)return;try{const next=[clean,...getViewedSkus().filter((item)=>item!==clean)].slice(0,24);localStorage.setItem("emrn_viewed_skus",JSON.stringify(next))}catch{}}
  function recordCurrentProductView(){const params=new URLSearchParams(window.location.search);const sku=params.get("sku")||document.querySelector("[data-product-sku]")?.textContent||"";rememberViewedSku(sku)}
  function currentQuery(){return new URLSearchParams(window.location.search).get("search_query")||activeInput?.value||""}
  function appendCustomerParam(params){if(config.customerId)params.set("customer_id",String(config.customerId));return params}
  function trackSmartSearchEvent(event,detail={}){try{const payload={event,query:String(detail.query||currentQuery()||"").trim(),sku:detail.sku||"",product_name:detail.product_name||"",product_id:Number(detail.product_id||0)||0,customer_id:config.customerId?String(config.customerId):"",page_type:pageType||"",url:window.location.href};const body=JSON.stringify(payload);if(navigator.sendBeacon){const queued=navigator.sendBeacon(`${config.apiBase}/api/search-analytics`,new Blob([body],{type:"application/json"}));if(queued)return}fetch(`${config.apiBase}/api/search-analytics`,{method:"POST",mode:"cors",keepalive:true,headers:{"Content-Type":"application/json"},body}).catch(()=>{})}catch{}}
  window.EMRNSmartSearchAnalytics = window.EMRNSmartSearchAnalytics || { track: (event, detail) => trackSmartSearchEvent(event, detail || {}) };
  function trackAutocompleteEnter(query){const clean=String(query||"").trim();if(clean&&autocompleteShownQueries.has(clean.toLowerCase()))trackSmartSearchEvent("autocomplete_enter",{query:clean})}
  function goToResults(term){const q=String(term||activeInput?.value||"").trim();if(q.length<2)return;navigatingToSmartResults=true;suppressOverlayUntilClick=true;try{sessionStorage.setItem(SUPPRESS_KEY,"1")}catch{}clearTimeout(renderTimer);saveRecentSearch(q);try{const previous=JSON.parse(sessionStorage.getItem("emrnSmartSearchLastSearch")||"{}");if(previous.query&&previous.query!==q&&Date.now()-Number(previous.at||0)<60000)trackSmartSearchEvent("search_refined",{query:q,product_name:previous.query});sessionStorage.setItem("emrnSmartSearchLastSearch",JSON.stringify({query:q,at:Date.now()}))}catch{}trackSmartSearchEvent("search",{query:q});hideOverlay();document.querySelectorAll(".emrn-smartsearch-overlay").forEach((el)=>el.remove());try{activeInput?.blur()}catch{}const url=new URL(config.searchResultsUrl,window.location.origin);url.searchParams.set("search_query",q);url.searchParams.set(config.resultsParam,"1");window.location.href=url.toString()}
  function smartOptionText(text){let v=String(text||"").replace(/\s+/g," ").trim();v=v.replace(/\bcomplete with\b/ig,"with").replace(/\bDisposable\b/ig,"Disp.").replace(/\bConcentration\b/ig,"Conc.").replace(/\bResuscitation\b/ig,"Resus.");if(v.length>145)v=v.slice(0,142).trim().replace(/[,\s]+$/,"")+"…";return v}
  function mobileSearchBox(value=""){return `<div class="emrn-smartsearch-mobile-search"><input type="search" value="${escapeHtml(value)}" placeholder="${escapeHtml(t("searchPlaceholder"))}" autocomplete="off" autocorrect="off" spellcheck="false" data-emrn-smart-mobile-input></div>`}
  function syncMobileQuery(value){if(activeInput&&activeInput.value!==value)activeInput.value=value;lastValue=value}
  function restoreMobileFocus(value){if((window.innerWidth||document.documentElement.clientWidth)>760)return;setTimeout(()=>{const input=overlay?.querySelector(MOBILE_INPUT_SELECTOR);if(!input)return;input.value=value;try{input.focus({preventScroll:true});const end=String(value||"").length;input.setSelectionRange(end,end)}catch{}},0)}

  function categoryCatalogCount(categoryName){const lower=String(categoryName||"").toLowerCase();const matches=(categoryTreeCache?.cats||[]).filter(cat=>String(cat.name||"").toLowerCase()===lower);if(!matches.length)return null;return matches.reduce((sum,cat)=>sum+Number(cat.product_count||cat.count||0),0)}
  function sideCard(title,items){if(!items||!items.length)return"";const chipType=/brand/i.test(title)||/marque/i.test(title)?"brand":/categor/i.test(title)||/catégor/i.test(title)?"category":"search";return `<div class="emrn-smartsearch-card"><h4>${escapeHtml(title)}</h4><div class="emrn-smartsearch-chips">${items.slice(0,7).map((item)=>{const value=typeof item==="string"?item:item.value;const displayCount=chipType==="category"?categoryCatalogCount(value):null;const rawCount=displayCount===null?(typeof item==="string"?"":item.count):displayCount;const count=rawCount!==""&&rawCount!==null&&rawCount!==undefined?` <small>(${rawCount})</small>`:"";const category=chipType==="category"?categoryByName(value):null;const categoryUrl=typeof item==="string"?(category?.url||""):(item.url||category?.url||"");const categoryId=typeof item==="string"?(category?.id||""):(item.id||category?.id||"");return `<button type="button" class="emrn-smartsearch-chip" data-emrn-search="${escapeHtml(value)}" data-emrn-chip-type="${chipType}" ${categoryId?`data-emrn-category-id="${escapeHtml(categoryId)}"`:""} ${categoryUrl?`data-emrn-category-url="${escapeHtml(normalizeUrl(categoryUrl))}"`:""}>${escapeHtml(value)}${count}</button>`}).join("")}</div></div>`}
  function productItem(product){const url=productUrl(product);const img=product.image?`<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">`:`<span>No image</span>`;return `<a class="emrn-smartsearch-item" href="${escapeHtml(url)}"><div class="emrn-smartsearch-img">${img}</div><div><div class="emrn-smartsearch-name">${escapeHtml(product.parent_name||product.name)}</div>${product.option_text?`<div class="emrn-smartsearch-option">${escapeHtml(smartOptionText(product.option_text))}</div>`:""}<div class="emrn-smartsearch-meta">${escapeHtml(product.brand||"EMRN")}${product.sold_by?` • ${escapeHtml(product.sold_by)}`:""}${product.sku?` • SKU: ${escapeHtml(product.sku)}`:""}</div></div><div class="emrn-smartsearch-view">${t("viewProduct")}</div></a>`}

  function ensureOverlay(){if(overlay&&document.body.contains(overlay))return overlay;document.querySelectorAll(".emrn-smartsearch-overlay").forEach((el)=>el.remove());overlay=document.createElement("div");overlay.className="emrn-smartsearch-overlay";overlay.hidden=true;overlay.style.display="none";document.body.appendChild(overlay);overlay.addEventListener("mousedown",(e)=>{if(e.target.closest(MOBILE_INPUT_SELECTOR))return;e.preventDefault()});overlay.addEventListener("click",(e)=>{const productLink=e.target.closest("a.emrn-smartsearch-item");if(productLink){hideOverlay();return}const viewAll=e.target.closest("[data-emrn-viewall]");if(viewAll){e.preventDefault();e.stopPropagation();trackSmartSearchEvent("autocomplete_view_all",{query:activeInput?.value||viewAll.getAttribute("data-emrn-viewall")||""});goToResults(activeInput?.value||viewAll.getAttribute("data-emrn-viewall")||"");return}const chip=e.target.closest("[data-emrn-search]");if(chip&&activeInput){e.preventDefault();e.stopPropagation();const term=chip.getAttribute("data-emrn-search")||"";const chipType=chip.getAttribute("data-emrn-chip-type")||"search";if(chipType==="category"){trackSmartSearchEvent("category_click",{query:currentQuery(),product_name:term});const id=chip.getAttribute("data-emrn-category-id")||"";if(id){goToFullCategoryId(id,term);return}const categoryUrl=chip.getAttribute("data-emrn-category-url")||"";if(categoryUrl){hideOverlay();window.location.href=categoryUrl;return}goToFullCategoryName(term);return}if(chipType==="brand"){hideOverlay();goToFilteredResults("brand",term);return}activeInput.value=term;saveRecentSearch(term);lastRendered="";renderResults(term);activeInput.focus()}},true);return overlay}
  function positionOverlay(){if(!overlay)return;const focused=isSearchInput(document.activeElement)?document.activeElement:activeInput;const input=focused||getInput();if(!input)return;activeInput=input;const rect=input.getBoundingClientRect();const viewportWidth=window.innerWidth||document.documentElement.clientWidth;const width=Math.min(820,viewportWidth-24);let left=rect.left;if(rect.width>0&&width<rect.width)left=rect.left;if(left+width>viewportWidth-12)left=Math.max(12,viewportWidth-width-12);if(left<12)left=12;overlay.style.width=`${width}px`;overlay.style.left=`${left}px`;overlay.style.top=`${rect.bottom+10}px`}
  function showOverlay(){ensureOverlay();positionOverlay();overlay.hidden=false;overlay.style.display="block"}
  function hideOverlay(){if(!overlay)return;overlay.hidden=true;overlay.style.display="none"}
  function setOverlayBody(html){overlay.innerHTML=html;stripObjectObjectText(overlay)}

  function starterCategoryItems(){
    const cats=(categoryTreeCache?.cats||[]).filter(cat=>cat&&cat.name&&cat.url);
    const preferred=["Shop All","Deals and Promotions","Medical Training","First Aid Kits & Supplies","Medical Bags","Diagnostics","Liquidation","PPE & Infection Control","DME & Home Care","Equipment & Furnishings"];
    const byName=new Map(cats.map(cat=>[String(cat.name).toLowerCase(),cat]));
    const picked=[];
    preferred.forEach(name=>{const cat=byName.get(name.toLowerCase());if(cat&&!picked.some(item=>Number(item.id)===Number(cat.id)))picked.push(cat)});
    cats.filter(cat=>Number(cat.product_count||0)>0&&!picked.some(item=>Number(item.id)===Number(cat.id))).sort((a,b)=>Number(b.product_count||0)-Number(a.product_count||0)).forEach(cat=>{if(picked.length<9)picked.push(cat)});
    return picked.slice(0,9);
  }
  function starterCategoriesBlock(items){if(!items||!items.length)return"";return `<div class="emrn-smartsearch-title">${t("categories")}</div><div class="emrn-smartsearch-cat-grid">${items.map(cat=>`<button type="button" class="emrn-smartsearch-cat-choice" data-emrn-search="${escapeHtml(cat.name)}" data-emrn-chip-type="category" data-emrn-category-id="${escapeHtml(cat.id)}" data-emrn-category-url="${escapeHtml(normalizeUrl(cat.url))}"><span>${escapeHtml(cat.name)}</span>${Number(cat.product_count||0)?`<small>${Number(cat.product_count||0)}</small>`:""}</button>`).join("")}</div>`}
  function starterSidebarCategories(){return starterCategoryItems().slice(0,7).map(cat=>({value:cat.name,count:cat.product_count||0,url:normalizeUrl(cat.url),id:cat.id}))}
  function renderNoSuggestions(query,data){const terms=(data?.fallback_terms&&data.fallback_terms.length?data.fallback_terms:POPULAR_SEARCHES).slice(0,5);return `<div class="emrn-smartsearch-empty"><strong>${t("noResultsTitle")}</strong><br>${t("noResultsBody")}<div class="emrn-smartsearch-chips" style="margin-top:12px">${terms.map(term=>`<button type="button" class="emrn-smartsearch-chip" data-emrn-search="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join("")}</div></div>`}

  async function renderResults(query){if(navigatingToSmartResults)return;ensureOverlay();if(!overlay)return;if(!query||query.trim().length<2){renderStarter();return}const seq=++requestSeq;lastRendered=query;setOverlayBody(`${mobileSearchBox(query)}<div class="emrn-smartsearch-grid"><div class="emrn-smartsearch-products"><div class="emrn-smartsearch-title">${t("products")}</div><div class="emrn-smartsearch-loading">Searching...</div></div><div class="emrn-smartsearch-side"><div class="emrn-smartsearch-help">${t("cantFind")}<strong>${t("sourceHelp")}</strong></div></div></div>`);showOverlay();restoreMobileFocus(query);const treePromise=loadCategoryTree();try{const params=appendCustomerParam(new URLSearchParams({q:query}));const res=await fetch(`${config.apiBase}/api/autocomplete?${params.toString()}`,{mode:"cors"});const data=await res.json();await treePromise.catch(()=>null);if(seq!==requestSeq||navigatingToSmartResults)return;const cleanQuery=String(query||"").trim();if(cleanQuery&&!autocompleteShownQueries.has(cleanQuery.toLowerCase())){autocompleteShownQueries.add(cleanQuery.toLowerCase());trackSmartSearchEvent("autocomplete_shown",{query:cleanQuery})}const products=data.products||[];const brandFacet=(data.facets||[]).find((facet)=>facet.field==="brand");const categoryFacet=(data.facets||[]).find((facet)=>facet.field==="categories");setOverlayBody(`${mobileSearchBox(query)}<div class="emrn-smartsearch-grid"><div class="emrn-smartsearch-products"><div class="emrn-smartsearch-title">${t("products")}</div>${products.length?products.map(productItem).join(""):renderNoSuggestions(query,data)}${products.length?`<button type="button" class="emrn-smartsearch-viewall" data-emrn-viewall="${escapeHtml(query)}">${t("viewAll")} “${escapeHtml(query)}”</button>`:""}</div><div class="emrn-smartsearch-side">${sideCard(t("suggestedCategories"),categoryFacet?.values||[])}${sideCard(t("suggestedBrands"),brandFacet?.values||[])}${sideCard(t("popular"),POPULAR_SEARCHES)}<div class="emrn-smartsearch-help">${t("cantFind")}<strong>${t("sourceHelp")}</strong></div></div></div>`);showOverlay();restoreMobileFocus(query)}catch(err){if(seq!==requestSeq||navigatingToSmartResults)return;console.error("[EMRN SmartSearch] API error",err);setOverlayBody(`${mobileSearchBox(query)}<div class="emrn-smartsearch-empty">SmartSearch could not load right now. Please try again.</div>`);showOverlay();restoreMobileFocus(query)}}
  async function renderStarter(){if(navigatingToSmartResults)return;ensureOverlay();if(!overlay)return;const recent=getRecentSearches().slice(0,4);const popular=POPULAR_SEARCHES.slice(0,6);const value=activeInput?.value||"";overlay.innerHTML=`${mobileSearchBox(value)}<div class="emrn-smartsearch-grid"><div class="emrn-smartsearch-products"><div class="emrn-smartsearch-title">${t("popularProducts")}</div><div class="emrn-smartsearch-loading">Loading popular products...</div></div><div class="emrn-smartsearch-side">${sideCard(t("categories"),starterSidebarCategories())}${sideCard(t("popular"),popular)}${recent.length?sideCard(t("recent"),recent):""}</div></div>`;showOverlay();restoreMobileFocus(value);try{const params=new URLSearchParams();params.set("per_page","12");if(config.customerId)params.set("customer_id",String(config.customerId));const viewed=getViewedSkus().slice(0,12);if(viewed.length)params.set("viewed_skus",viewed.join(","));const [treeResult,popularResult]=await Promise.allSettled([loadCategoryTree(),fetch(`${config.apiBase}/api/popular?${params.toString()}`,{mode:"cors"}).then(res=>res.json())]);const products=(popularResult.status==="fulfilled"?(popularResult.value.products||[]):[]).slice(0,10);if(!overlay||overlay.hidden||String(activeInput?.value||"").trim().length>=2||navigatingToSmartResults)return;const nextValue=activeInput?.value||"";overlay.innerHTML=`${mobileSearchBox(nextValue)}<div class="emrn-smartsearch-grid"><div class="emrn-smartsearch-products"><div class="emrn-smartsearch-title">${t("popularProducts")}</div>${products.length?products.map(productItem).join(""):`<div class="emrn-smartsearch-starter"><h3>${t("startTyping")}</h3><p>${t("searchHelp")}</p></div>`}</div><div class="emrn-smartsearch-side">${sideCard(t("categories"),starterSidebarCategories())}${sideCard(t("popular"),popular)}${recent.length?sideCard(t("recent"),recent):""}<div class="emrn-smartsearch-help">${t("cantFind")}<strong>${t("sourceHelp")}</strong></div></div></div>`;showOverlay();restoreMobileFocus(nextValue)}catch(err){console.error("[EMRN SmartSearch] starter content error",err)}}
  function allowOverlayAfterIntent(){suppressOverlayUntilClick=false;try{sessionStorage.removeItem(SUPPRESS_KEY)}catch{}}
  function scheduleRender(force=false){if(!activeInput||navigatingToSmartResults||suppressOverlayUntilClick)return;const value=activeInput.value.trim();if(!force&&value===lastRendered)return;clearTimeout(renderTimer);renderTimer=setTimeout(()=>renderResults(value),120)}
  function attach(input){if(!input)return;activeInput=input;activeInput.dataset.emrnSmartSearchAttached="1";activeInput.setAttribute("autocomplete","off");ensureOverlay();input.addEventListener("focus",()=>{if(navigatingToSmartResults)return;activeInput=input;scheduleRender(true)},true);input.addEventListener("click",()=>{if(navigatingToSmartResults)return;allowOverlayAfterIntent();activeInput=input;scheduleRender(true)},true);input.addEventListener("input",()=>{if(navigatingToSmartResults)return;activeInput=input;scheduleRender(true)},true);input.addEventListener("keyup",()=>{if(navigatingToSmartResults)return;activeInput=input;scheduleRender(true)},true)}

  function preserveListingFilters(url,except=""){const params=new URLSearchParams(window.location.search);["brand","category","category_id","sold_by","color","price_min","price_max","sort"].forEach(key=>{if(key!==except&&params.get(key))url.searchParams.set(key,params.get(key))})}
  function goToFilteredResults(type,value){const q=new URLSearchParams(window.location.search).get("search_query")||activeInput?.value||"";const url=new URL(config.searchResultsUrl,window.location.origin);url.searchParams.set("search_query",q||"*");url.searchParams.set(config.resultsParam,"1");preserveListingFilters(url,type);if(type&&value)url.searchParams.set(type,value);window.location.href=url.toString()}
  function hasActiveSearchQuery(){const params=new URLSearchParams(window.location.search);const q=String(params.get("search_query")||params.get("q")||"").trim();return isResultsPage&&q&&q!=="*"}
  function categoryById(categoryId){const id=Number(categoryId||0);return (categoryTreeCache?.cats||[]).find(cat=>Number(cat.id)===id)||null}
  function navigateDirectCategory(category){const path=category?.url?normalizeUrl(category.url):"";if(!path)return false;const url=new URL(path,window.location.origin);const currentBrand=new URLSearchParams(window.location.search).get("brand")||configuredBrandName||"";if(currentBrand&&!url.searchParams.get("brand"))url.searchParams.set("brand",currentBrand);hideOverlay();window.location.href=url.toString();return true}
  function goToCategoryId(id,name=""){const category=categoryById(id)||categoryByName(name);if(!hasActiveSearchQuery()&&navigateDirectCategory(category))return;const q=new URLSearchParams(window.location.search).get("search_query")||"*";const url=new URL(config.searchResultsUrl,window.location.origin);url.searchParams.set("search_query",q);url.searchParams.set(config.resultsParam,"1");preserveListingFilters(url,"category_id");if(configuredBrandName&&!url.searchParams.get("brand"))url.searchParams.set("brand",configuredBrandName);url.searchParams.delete("category");if(name)url.searchParams.set("category",String(name).trim());url.searchParams.set("category_id",id);window.location.href=url.toString()}
  function goToFullCategoryId(id,name=""){const category=categoryById(id)||categoryByName(name);if(navigateDirectCategory(category))return;const url=new URL(config.searchResultsUrl,window.location.origin);url.searchParams.set("search_query","*");url.searchParams.set(config.resultsParam,"1");if(name)url.searchParams.set("category",String(name).trim());url.searchParams.set("category_id",id);window.location.href=url.toString()}
  function goToFullCategoryName(name){const clean=String(name||"").trim();if(!clean)return;const category=categoryByName(clean);if(navigateDirectCategory(category))return;const url=new URL(config.searchResultsUrl,window.location.origin);url.searchParams.set("search_query","*");url.searchParams.set(config.resultsParam,"1");url.searchParams.set("category",clean);window.location.href=url.toString()}

  async function loadCategoryTree(){if(categoryTreeCache)return categoryTreeCache;try{const params=appendCustomerParam(new URLSearchParams());const query=params.toString();const res=await fetch(`${config.apiBase}/api/category-tree${query?`?${query}`:""}`,{mode:"cors"});const data=await res.json();const cats=data.categories||[];const byParent=new Map();cats.forEach(cat=>{const parent=Number(cat.parent_id||0);cat.product_count=Number(cat.product_count||cat.count||0);if(!byParent.has(parent))byParent.set(parent,[]);byParent.get(parent).push(cat)});categoryTreeCache={cats,byParent};return categoryTreeCache}catch(err){console.error("[EMRN SmartSearch] category tree error",err);return {cats:[],byParent:new Map()}}}
  function categoryBranchIds(categoryId){const id=Number(categoryId||0);if(!id)return[];const ids=[];const visit=(nextId)=>{if(!nextId||ids.includes(Number(nextId)))return;ids.push(Number(nextId));(categoryTreeCache?.byParent.get(Number(nextId))||[]).forEach(child=>visit(child.id))};const selected=(categoryTreeCache?.cats||[]).find(cat=>Number(cat.id)===id);const selectedName=String(selected?.name||"").toLowerCase();(categoryTreeCache?.cats||[]).filter(cat=>selectedName&&String(cat.name||"").toLowerCase()===selectedName).forEach(cat=>visit(cat.id));visit(id);return ids}
  function buildRelevantCategoryHelpers(categoryFacetCounts=[],selectedId=0,selectedName="",useScopedCounts=false){
    const countByName=new Map((categoryFacetCounts||[]).map(item=>[String(item.value||"").toLowerCase(),Number(item.count||0)]));
    const catalogCountByName=new Map((categoryTreeCache?.cats||[]).map(cat=>[String(cat.name||"").toLowerCase(),Number(cat.product_count||0)]));
    const visibleIds=new Set();
    const hasOwnCount=(cat)=>{const key=String(cat.name||"").toLowerCase();return useScopedCounts?countByName.has(key):Boolean((catalogCountByName.get(key)||0)||countByName.has(key))};
    const byId=new Map((categoryTreeCache?.cats||[]).map(cat=>[Number(cat.id),cat]));

    function markAncestors(cat){
      if(!cat||visibleIds.has(Number(cat.id)))return;
      visibleIds.add(Number(cat.id));
      const parentId=Number(cat.parent_id||0);
      if(parentId){
        const parent=byId.get(parentId);
        if(parent)markAncestors(parent);
      }
    }

    function markCatalogBranch(cat){
      if(!cat)return false;
      const children=categoryTreeCache?.byParent.get(Number(cat.id))||[];
      let childHasProducts=false;
      children.forEach(child=>{if(markCatalogBranch(child))childHasProducts=true});
      const include=hasOwnCount(cat)||childHasProducts||Number(selectedId)===Number(cat.id);
      if(include)visibleIds.add(Number(cat.id));
      return include;
    }

    if(!useScopedCounts){
      (categoryTreeCache?.cats||[]).forEach(cat=>{if(hasOwnCount(cat))visibleIds.add(Number(cat.id))});
      if(selectedId){
        const selected=byId.get(Number(selectedId));
        if(selected){
          markAncestors(selected);
          markCatalogBranch(selected);
        }
      }
      return {visibleIds,countByName,catalogCountByName,useScopedCounts};
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

    return {visibleIds,countByName,catalogCountByName,useScopedCounts};
  }

  function renderCategoryBranch(parentId,level=0,selectedId=0,selectedName="",helpers={visibleIds:new Set(),countByName:new Map(),catalogCountByName:new Map()}){
    if(!categoryTreeCache)return"";
    const children=(categoryTreeCache.byParent.get(Number(parentId))||[])
      .filter(cat=>helpers.visibleIds.has(Number(cat.id)))
      .sort((a,b)=>a.name.localeCompare(b.name));

    function branchCount(cat){
      const key=String(cat.name||"").toLowerCase();
      const filteredCount=helpers.countByName.get(key)||0;
      const catalogCount=helpers.catalogCountByName.get(key)||0;
      const direct=helpers.useScopedCounts?filteredCount:catalogCount||filteredCount;
      if(direct)return direct;
      return (categoryTreeCache.byParent.get(Number(cat.id))||[])
        .filter(child=>helpers.visibleIds.has(Number(child.id)))
        .reduce((sum,child)=>sum+branchCount(child),0);
    }

    return children.map(cat=>{
      const hasChildren=(categoryTreeCache.byParent.get(Number(cat.id))||[]).some(child=>helpers.visibleIds.has(Number(child.id)));
      const isActive=Number(selectedId)===Number(cat.id)||(selectedName&&String(cat.name).toLowerCase()===String(selectedName).toLowerCase());
      const count=branchCount(cat);
      return `<div class="emrn-smart-cat-node" data-cat-node="${cat.id}" style="margin-left:${level?10:0}px"><div class="emrn-smart-cat-row ${isActive?"active":""}">${hasChildren?`<button type="button" class="emrn-smart-cat-toggle" data-cat-toggle="${cat.id}">+</button>`:`<span style="width:24px"></span>`}<button type="button" class="emrn-smart-cat-link" data-category-id="${cat.id}" ${cat.url?`data-category-url="${escapeHtml(normalizeUrl(cat.url))}"`:""} title="${escapeHtml(cat.name)}">${escapeHtml(cat.name)}</button>${count?`<span class="emrn-smart-cat-count">${count}</span>`:""}</div>${hasChildren?`<div class="emrn-smart-cat-children" data-cat-children="${cat.id}">${renderCategoryBranch(cat.id,level+1,selectedId,selectedName,helpers)}</div>`:""}</div>`
    }).join("")
  }

  function filterToggleButton(){return `<button type="button" class="emrn-smart-filter-toggle" data-filter-toggle>Show filters</button>`}

  function renderCategoryTree(selectedId,selectedName="",categoryFacetCounts=[]){
    const params=new URLSearchParams(window.location.search);
    const q=String(params.get("search_query")||params.get("q")||"").trim();
    const isTypedSearch=Boolean(q&&q!=="*");
    const useScopedCounts=Boolean(isTypedSearch||params.get("brand")||params.get("sold_by")||params.get("color")||shouldReplaceBrand&&configuredBrandName);
    const helpers=buildRelevantCategoryHelpers(categoryFacetCounts,selectedId,selectedName,useScopedCounts);
    const tree=renderCategoryBranch(0,0,selectedId,selectedName,helpers);
    if(!tree)return "";
    return `<div class="emrn-smart-filter-group"><h3>${t("categories")}</h3><div class="emrn-smart-category-tree">${tree}</div></div>`;
  }

  function signalQuoteUpdated(){try{localStorage.setItem(QUOTE_UPDATED_KEY,String(Date.now()))}catch{}}
  function looksLikeQuoteNav(el){if(!el)return false;const text=String(el.textContent||"").toLowerCase();const href=String(el.getAttribute&&el.getAttribute("href")||"").toLowerCase();const idClass=String((el.id||"")+" "+(el.className||"")).toLowerCase();return text.includes("my quote")||text.includes("finish quote")||href.includes("quote")||idClass.includes("quote")||!!(el.closest&&el.closest('#myquote-entry, [data-emrn-finish-quote-link], .emrn-finish-quote-button'))}
  function installQuoteRefreshBridge(){if(window.__emrnSmartSearchQuoteRefreshBridge)return;window.__emrnSmartSearchQuoteRefreshBridge=true;window.addEventListener("storage",(event)=>{if(event&&event.key===QUOTE_UPDATED_KEY&&event.newValue){try{sessionStorage.setItem(QUOTE_STALE_KEY,event.newValue)}catch{}}});document.addEventListener("click",(event)=>{const link=event.target&&event.target.closest&&event.target.closest('a, button, [role="button"]');if(!looksLikeQuoteNav(link))return;let staleAt="";try{staleAt=sessionStorage.getItem(QUOTE_STALE_KEY)||""}catch{}if(!staleAt)return;let used=false;try{used=sessionStorage.getItem("emrnSmartSearchQuoteRefreshUsed")===staleAt}catch{}if(used)return;event.preventDefault();event.stopPropagation();try{sessionStorage.setItem("emrnSmartSearchQuoteRefreshUsed",staleAt);sessionStorage.setItem("emrnSmartSearchRefreshUrl",window.location.href);sessionStorage.setItem("emrnSmartSearchRestoreScrollY",String(window.scrollY||window.pageYOffset||0))}catch{}window.location.reload()},true);window.addEventListener("load",()=>{let scrollY=0;let refreshUrl="";try{refreshUrl=sessionStorage.getItem("emrnSmartSearchRefreshUrl")||"";scrollY=parseInt(sessionStorage.getItem("emrnSmartSearchRestoreScrollY")||"0",10)||0;sessionStorage.removeItem("emrnSmartSearchRefreshUrl");sessionStorage.removeItem("emrnSmartSearchRestoreScrollY");sessionStorage.removeItem(QUOTE_STALE_KEY)}catch{}if(refreshUrl&&window.location.href!==refreshUrl){window.location.href=refreshUrl;return}if(scrollY)setTimeout(()=>window.scrollTo(0,scrollY),250)})}

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

  function openCartDrawer(quantity){try{document.dispatchEvent(new CustomEvent("cart-quantity-update",{detail:{quantity}}));window.dispatchEvent(new CustomEvent("emrn-smartsearch-cart-added",{detail:{quantity}}));if(window.jQuery)window.jQuery("body").trigger("cart-quantity-update",quantity)}catch{}setTimeout(()=>{const trigger=document.querySelector('[data-cart-preview], .navUser-action--cart, [data-dropdown="cart-preview-dropdown"]');if(trigger&&typeof trigger.click==="function")trigger.click()},250)}
  async function addToCart(product,qty,button){if(isQuoteOnly(product)){addToQuote(product,qty,button);return}button.disabled=true;const original=button.textContent;button.classList.add("emrn-atc-loading");button.classList.remove("emrn-atc-success");button.textContent=t("adding");try{const quantity=Math.max(1,Number(qty||1));const cartsRes=await fetch("/api/storefront/carts",{credentials:"include"});const carts=cartsRes.ok?await cartsRes.json():[];const existingCart=Array.isArray(carts)&&carts.length?carts[0]:null;const endpoint=existingCart?.id?`/api/storefront/carts/${existingCart.id}/items`:"/api/storefront/carts";const lineItem={quantity,productId:Number(product.product_id)};if(Number(product.variant_id)>0)lineItem.variantId=Number(product.variant_id);const res=await fetch(endpoint,{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},body:JSON.stringify({lineItems:[lineItem]})});if(!res.ok)throw new Error(await res.text());trackSmartSearchEvent("add_to_cart",{sku:product.sku,product_id:product.product_id,product_name:product.name||product.parent_name});button.classList.remove("emrn-atc-loading");button.classList.add("emrn-atc-success");button.textContent=t("added");openCartDrawer(quantity)}catch(err){console.error("[EMRN SmartSearch] add to cart failed",err);button.classList.remove("emrn-atc-loading","emrn-atc-success");button.textContent=t("viewProduct");button.dataset.fallback="1"}finally{setTimeout(()=>{button.disabled=false;button.classList.remove("emrn-atc-loading","emrn-atc-success");if(button.textContent===t("added"))button.textContent=original},2300)}}
  function waitForQuoteApi(timeout=7000){return new Promise((resolve,reject)=>{const started=Date.now();const tick=()=>{const quoteApi=window.b2b&&window.b2b.utils&&window.b2b.utils.quote;if(quoteApi&&(typeof quoteApi.addProducts==="function"||typeof quoteApi.addProduct==="function")){resolve(quoteApi);return}if(Date.now()-started>timeout){reject(new Error("Buyer Portal quote API unavailable"));return}setTimeout(tick,150)};tick()})}
  async function addToQuote(product,qty,button){const quantity=Math.max(1,Number(qty||1));const original=button?.textContent||t("addToQuote");if(button){button.disabled=true;button.classList.add("emrn-atc-loading");button.classList.remove("emrn-atc-success");button.textContent=t("adding")}try{const quoteApi=await waitForQuoteApi();const item={productEntityId:Number(product.product_id),productId:Number(product.product_id),quantity,sku:product.sku||"",variantSku:product.sku||"",optionList:[],selectedOptions:[]};if(Number(product.variant_id)>0){item.variantEntityId=Number(product.variant_id);item.variantId=Number(product.variant_id)}if(!item.productEntityId)throw new Error("Missing product id for quote");if(typeof quoteApi.addProducts==="function")await quoteApi.addProducts([item]);else await quoteApi.addProduct(item);trackSmartSearchEvent("add_to_quote",{sku:product.sku,product_id:product.product_id,product_name:product.name||product.parent_name});signalQuoteUpdated();if(button){button.classList.remove("emrn-atc-loading");button.classList.add("emrn-atc-success");button.textContent=t("added")}}catch(err){console.error("[EMRN SmartSearch] add to quote failed",err);if(button)button.classList.remove("emrn-atc-loading","emrn-atc-success");const next=new URL(product.quote_url||quoteUrl(product.url),window.location.origin);next.searchParams.set("qty",String(quantity));window.location.href=next.toString();return}finally{if(button)setTimeout(()=>{button.disabled=false;button.classList.remove("emrn-atc-loading","emrn-atc-success");if(button.textContent===t("added"))button.textContent=original},2300)}}
  function productPriceHtml(product){const price=Number(product.price||0);const sale=Number(product.sale_price||0);const was=Number(product.retail_price||0);if(sale>0&&was>sale)return `<span class="emrn-smart-sale-price">$${sale.toFixed(2)}</span><span class="emrn-smart-was-price">$${was.toFixed(2)}</span>`;if(price>0)return `$${price.toFixed(2)}`;return "See product"}
  function productKey(product){return String(product?.id||`${product?.product_id||""}:${product?.variant_id||""}:${product?.sku||""}`)}
  function productCard(product){const url=productUrl(product);const qUrl=quoteUrl(url);const img=product.image?`<img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}">`:`<span>No image</span>`;const option=smartOptionText(product.option_text);const quoteOnly=isQuoteOnly(product);const productData={product_id:product.product_id,variant_id:product.variant_id||0,sku:product.sku||"",name:product.name||product.parent_name||"",url,quote_url:qUrl,quote_only:quoteOnly,purchasable:!quoteOnly};return `<article class="emrn-smart-product-card" data-product-key="${escapeHtml(productKey(product))}" data-product='${escapeHtml(JSON.stringify(productData))}'><a class="emrn-smart-product-img" href="${escapeHtml(url)}">${img}</a><div class="emrn-smart-product-body"><div class="emrn-smart-stars">★ ★ ★ ★ ★</div><a class="emrn-smart-product-name" href="${escapeHtml(url)}">${escapeHtml(product.parent_name||product.name)}</a>${option?`<div class="emrn-smart-variant" title="${escapeHtml(product.option_text)}">${escapeHtml(option)}</div>`:"<div class='emrn-smart-variant'></div>"}<div class="emrn-smart-meta">${product.brand?`<span>${escapeHtml(product.brand)}</span>`:""}${product.sold_by?`<span>${escapeHtml(product.sold_by)}</span>`:""}${product.sku?`<span>SKU: ${escapeHtml(product.sku)}</span>`:""}${quoteOnly?`<span>${t("quoteOnly")}</span>`:""}</div><div class="emrn-smart-price">${productPriceHtml(product)}</div><div class="emrn-smart-card-actions"><div class="emrn-smart-qty"><button type="button" data-qty-minus>−</button><span data-qty>1</span><button type="button" data-qty-plus>+</button></div><button type="button" class="emrn-smart-quote-btn" data-quote>${t("addToQuote")}</button>${quoteOnly?"":`<button type="button" class="emrn-smart-cart-btn" data-add-cart>${t("addToCart")}</button>`}<a class="emrn-smart-view-btn" href="${escapeHtml(url)}">${t("viewProduct")}</a></div></div></article>`}
  function newProductsOnly(products,grid){const seen=new Set(Array.from(grid?.querySelectorAll("[data-product-key]")||[]).map((card)=>card.getAttribute("data-product-key")).filter(Boolean));return (products||[]).filter((product)=>{const key=productKey(product);if(!key||seen.has(key))return false;seen.add(key);return true})}
  function currentValueForFilter(type){return new URLSearchParams(window.location.search).get(type)||""}
  function facetGroup(title,items,type){if(!items||!items.length)return"";const current=currentValueForFilter(type);return `<div class="emrn-smart-filter-group"><h3>${escapeHtml(title)}</h3><div class="emrn-smart-facet-list">${items.slice(0,20).filter(item=>item&&item.value).map((item)=>{const active=String(item.value)===String(current);const category=type==="category"?categoryByName(item.value):null;const attrs=type==="category"&&category?.id?`data-category-id="${escapeHtml(category.id)}" ${category?.url?`data-category-url="${escapeHtml(normalizeUrl(category.url))}"`:""}`:`data-filter-type="${type}" data-filter-value="${escapeHtml(item.value)}"`;return `<button type="button" class="emrn-smart-facet ${active?"active":""}" ${attrs}><span class="emrn-smart-facet-name">${escapeHtml(item.value)}</span><span class="emrn-smart-facet-count">${item.count}</span></button>`}).join("")}</div></div>`}
  function priceStats(priceFacet,products){const prices=(products||[]).map(p=>Number(p.price||0)).filter(p=>p>0);const stats=priceFacet?.stats||{};return {min:Math.floor(Number(stats.min||Math.min(...prices,0)||0)),max:Math.ceil(Number(stats.max||Math.max(...prices,0)||0))}}
  function priceFilter(priceFacet,products,priceMin="",priceMax=""){const stats=priceStats(priceFacet,products);if(!stats.max)return"";const currentMax=Number(priceMax||stats.max);return `<div class="emrn-smart-filter-group emrn-smart-price-filter"><h3>Price</h3><div class="emrn-smart-price-fields"><label>Min <input type="number" min="0" step="1" value="${escapeHtml(priceMin)}" placeholder="${stats.min}" data-price-min></label><label>Max <input type="number" min="0" step="1" value="${escapeHtml(priceMax)}" placeholder="${stats.max}" data-price-max></label></div><input type="range" min="${stats.min}" max="${stats.max}" value="${Math.min(Math.max(currentMax,stats.min),stats.max)}" data-price-range><button type="button" class="emrn-smart-apply-price" data-apply-price>Apply price</button></div>`}
  function sortSelect(currentSort="popularity"){const options=[["popularity","Frequently purchased"],["price_asc","Price: low to high"],["price_desc","Price: high to low"],["name_asc","Name: A to Z"],["name_desc","Name: Z to A"],["newest","Newest"]];return `<div class="emrn-smart-results-controls"><label for="emrn-smart-sort">Sort</label><select id="emrn-smart-sort" class="emrn-smart-sort-select" data-smart-sort>${options.map(([value,label])=>`<option value="${value}" ${String(currentSort||"popularity")===value?"selected":""}>${label}</option>`).join("")}</select></div>`}
  function categoryByName(categoryName){const lower=String(categoryName||"").toLowerCase();return (categoryTreeCache?.cats||[]).find((cat)=>String(cat.name||"").toLowerCase()===lower)}
  function categoryBubbleImage(categoryName){const category=categoryByName(categoryName);return category?.image||""}
  function relatedCategoryBubbles(categoryFacet,products,selectedCategory=""){const items=(categoryFacet||[]).filter((item)=>item&&item.value&&String(item.value).toLowerCase()!==String(selectedCategory||"").toLowerCase()).slice(0,8);if(!items.length)return"";return `<div class="emrn-smart-related-cats" aria-label="${escapeHtml(t("categories"))}">${items.map((item)=>{const image=categoryBubbleImage(item.value,products);const category=categoryByName(item.value);const attrs=category?.id?`data-full-category-id="${escapeHtml(category.id)}" ${category?.url?`data-category-url="${escapeHtml(normalizeUrl(category.url))}"`:""}`:(category?.url?`data-category-url="${escapeHtml(normalizeUrl(category.url))}"`:`data-filter-type="category" data-filter-value="${escapeHtml(item.value)}"`);return `<button type="button" class="emrn-smart-related-cat" ${attrs}>${image?`<span class="emrn-smart-related-cat-img"><img src="${escapeHtml(image)}" alt=""></span>`:`<span class="emrn-smart-related-cat-img"></span>`}<span>${escapeHtml(item.value)}</span></button>`}).join("")}</div>`}
  function askMeriForSearchHelp(query){const clean=String(query||"").replace(/\s+/g," ").trim();if(!clean)return false;try{if(window.EMRNPulse&&typeof window.EMRNPulse.openWithSearchHelp==="function"){window.EMRNPulse.openWithSearchHelp(clean);return true}window.dispatchEvent(new CustomEvent("emrn-pulse:search-help",{detail:{query:clean}}));return true}catch{return false}}
  function noResultsBox(data,q){const terms=data?.fallback_terms||POPULAR_SEARCHES.slice(0,6);return `<div class="emrn-smart-no-results"><h2>${t("noResultsTitle")}</h2><p>${t("noResultsBody")}</p><div class="emrn-smart-no-actions">${terms.map(term=>`<button type="button" data-no-search="${escapeHtml(term)}">${escapeHtml(term)}</button>`).join("")}<button type="button" class="primary emrn-smart-ask-meri" data-ask-meri-search="${escapeHtml(q)}"><img src="/emrn-pulse/meri-mascot-transparent.png" alt="" loading="lazy">${t("askMeri")}</button><a href="${escapeHtml(config.quoteUrl)}?search=${encodeURIComponent(q)}">${t("requestQuote")}</a></div></div>`}
  function ensureBackTopButton(){let btn=document.querySelector("[data-smart-backtop]");if(!btn){btn=document.createElement("button");btn.type="button";btn.className="emrn-smart-backtop";btn.setAttribute("data-smart-backtop","1");btn.setAttribute("aria-label",t("backTop"));btn.textContent="↑";document.body.appendChild(btn)}updateBackTopButton()}
  function updateBackTopButton(){const btn=document.querySelector("[data-smart-backtop]");if(!btn)return;btn.classList.toggle("is-visible",(window.scrollY||document.documentElement.scrollTop)>260)}
  function autoClickBuyerPortalQuote(){const pageParams=new URLSearchParams(window.location.search);if(!pageParams.has("fsquote")&&!pageParams.has("quote"))return;const requestedQty=Math.max(1,Number(pageParams.get("qty")||1));const started=Date.now();const timer=setInterval(()=>{const qtyInput=document.querySelector('input[name="qty[]"], input[name="qty"], [data-quantity-change] input');if(qtyInput&&requestedQty>1){qtyInput.value=String(requestedQty);qtyInput.dispatchEvent(new Event("change",{bubbles:true}));qtyInput.dispatchEvent(new Event("input",{bubbles:true}))}const quoteButton=document.querySelector('[data-emrn-pdp-quote], .emrn-pdp-quoteBtn, button[aria-label*="quote" i], button[class*="quote" i]');const buyerPortalReady=window.b2b&&window.b2b.utils&&window.b2b.utils.quote;if(quoteButton&&buyerPortalReady){clearInterval(timer);try{quoteButton.click();signalQuoteUpdated()}catch{}return}if(Date.now()-started>12000)clearInterval(timer)},250)}
  function optionTargetsFromUrl(){const params=new URLSearchParams(window.location.search);const raw=params.get("option_text")||"";return raw.split(/[,|]/).map((part)=>part.includes(":")?part.split(":").slice(1).join(":"):part).map((part)=>part.trim().toLowerCase()).filter((part)=>part.length>2)}
  function autoSelectVariantFromUrl(){const targets=optionTargetsFromUrl();if(!targets.length)return;const started=Date.now();const timer=setInterval(()=>{let changed=false;targets.forEach((target)=>{document.querySelectorAll('select[name^="attribute["]').forEach((select)=>{const option=Array.from(select.options||[]).find((opt)=>String(opt.textContent||"").trim().toLowerCase()===target||String(opt.textContent||"").toLowerCase().includes(target));if(option&&select.value!==option.value){select.value=option.value;select.dispatchEvent(new Event("change",{bubbles:true}));changed=true}});document.querySelectorAll('input[name^="attribute["]').forEach((input)=>{const label=document.querySelector(`label[for="${input.id}"]`);const text=String(label?.textContent||input.value||"").trim().toLowerCase();if(text===target||text.includes(target)){if(!input.checked){input.click();input.dispatchEvent(new Event("change",{bubbles:true}));changed=true}}})});if(changed||Date.now()-started>5000)clearInterval(timer)},250)}

  function currentSearchParamsForApi(page=1){
    const pageParams=new URLSearchParams(window.location.search);
    const q=pageParams.get("search_query")||pageParams.get("q")||(shouldReplaceCategory||shouldReplaceBrand?"*":"");
    const brand=pageParams.get("brand")||(shouldReplaceBrand?configuredBrandName:"");
    const category=pageParams.get("category")||(shouldReplaceCategory?configuredCategoryName:"");
    const categoryId=Number(pageParams.get("category_id")||(shouldReplaceCategory?configuredCategoryId:0)||0);
    const soldBy=pageParams.get("sold_by")||"";
    const color=pageParams.get("color")||"";
    const priceMin=pageParams.get("price_min")||"";
    const priceMax=pageParams.get("price_max")||"";
    const sort=pageParams.get("sort")||"popularity";
    const apiParams=new URLSearchParams();
    apiParams.set("q",q||"*");
    apiParams.set("page",String(page));
    if(brand)apiParams.set("brand",brand);
    if(category&&!categoryId)apiParams.set("category",category);
    if(categoryId){apiParams.set("category_id",String(categoryId));const branchIds=categoryBranchIds(categoryId);if(branchIds.length>1)apiParams.set("category_ids",branchIds.join(","))}
    if(soldBy)apiParams.set("sold_by",soldBy);
    if(color)apiParams.set("color",color);
    if(priceMin)apiParams.set("price_min",priceMin);
    if(priceMax)apiParams.set("price_max",priceMax);
    if(sort)apiParams.set("sort",sort);
    appendCustomerParam(apiParams);
    return {apiParams,q,brand,category,categoryId,soldBy,color,priceMin,priceMax,sort}
  }

  function listingTitle(q,brand,category,categoryId=0){
    if(brand) return escapeHtml(brand);
    if(category) return escapeHtml(category);
    if(categoryId&&categoryTreeCache){const cat=categoryTreeCache.cats.find(item=>Number(item.id)===Number(categoryId));if(cat?.name)return escapeHtml(cat.name)}
    if(shouldReplaceCategory) return escapeHtml(configuredCategoryName||category||t("categories"));
    if(shouldReplaceBrand) return escapeHtml(configuredBrandName||brand||t("brands"));
    if(!q||q==="*") return t("products");
    return `${t("resultsFor")} “${escapeHtml(q)}”`;
  }

  function correctionText(value,depth=0){
    if(!value||depth>3)return"";
    if(typeof value==="string")return value.replace(/\s+/g," ").trim();
    if(typeof value==="object"){
      const preferred=value.suggested_query||value.corrected_query||value.correctedQuery||value.normalized_query||value.normalizedQuery||value.query||value.value||value.label||value.text||value.corrected||value.suggestion||value.term||value.phrase||value[LANG]||value.en||value.fr;
      const direct=correctionText(preferred,depth+1);
      if(direct)return direct;
      for(const next of Object.values(value)){const found=correctionText(next,depth+1);if(found&&found!=="[object Object]")return found}
    }
    return "";
  }
  function correctionLabel(){return LANG==="fr"?"Résultats affichés pour":"Showing results for"}
  function currentCorrectionFallback(){
    const raw=String(activeInput?.value||document.querySelector("[data-smart-results-input]")?.value||new URLSearchParams(window.location.search).get("search_query")||"").replace(/\s+/g," ").trim();
    const normalized=raw.toLowerCase();
    const map=[
      [/^stet+h?oscop+e?$/,"stethoscope"],[/stet+h?oscop/,"stethoscope"],[/^otoscop+e?$/,"otoscope"],[/otoscop/,"otoscope"],
      [/nusing|nuring|nursing suplies|nursing supplies/,"nursing supplies"],[/hosptial|hospital supl|hospital suppl/,"hospital supplies"],[/clinic|clici|doctor office|medical office/,"clinic supplies"]
    ];
    const hit=map.find(([pattern])=>pattern.test(normalized));
    if(hit&&hit[1]&&hit[1].toLowerCase()!==normalized)return hit[1];
    return "";
  }
  function stripObjectObjectText(root=document){
    try{
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      const nodes=[];
      while(walker.nextNode())if(/\[object Object\]/.test(walker.currentNode.nodeValue||""))nodes.push(walker.currentNode);
      nodes.forEach((node)=>{
        const fallback=currentCorrectionFallback();
        node.nodeValue=fallback?`${correctionLabel()} ${fallback}`:(node.nodeValue||"").replace(/\[object Object\]/g,"").trim();
      });
    }catch{}
  }
  function correctionNotice(data,q,mode="results"){
    const suggested=correctionText(data?.suggested_query)||correctionText(data?.natural_language_plan?.suggested_query)||correctionText(data?.correction);
    const original=String(q||"").replace(/\s+/g," ").trim();
    if(!suggested||suggested==="[object Object]"||!original||original==="*"||suggested.toLowerCase()===original.toLowerCase())return"";
    const className=mode==="autocomplete"?"emrn-smartsearch-correction":"emrn-smart-did-you-mean";
    return `<div class="${className}">${correctionLabel()} <strong>${escapeHtml(suggested)}</strong></div>`;
  }

  function getSmartListingMount(){
    if(shouldReplaceCategory){
      const smartMount=document.querySelector("#emrn-smart-listing-app");
      if(smartMount) return {mode:"replace",el:smartMount};
      const categoryPage=document.querySelector(".emrn-category-page");
      if(categoryPage) return {mode:"replace",el:categoryPage};
    }
    if(shouldReplaceBrand){
      const brandPage=document.querySelector(".emrn-brand-page");
      if(brandPage) return {mode:"replace",el:brandPage};
      const listing=document.querySelector("#product-listing-container");
      if(listing) return {mode:"replace",el:listing};
    }
    if(isResultsPage){
      const page=document.querySelector("section.page")||document.querySelector(".emrn-search-page-content")||document.querySelector(".page-content");
      if(page) return {mode:"replace",el:page};
    }
    return {mode:"prepend",el:document.querySelector("main")||document.querySelector(".body")||document.body};
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
    document.body.classList.toggle("emrn-smart-search-active",isResultsPage);
    hideOverlay();
    document.querySelectorAll('.emrn-smartsearch-overlay').forEach((el)=>el.remove());
    ensureBackTopButton();
    const {q,brand,category,categoryId,soldBy,color,priceMin,priceMax,sort}=currentSearchParamsForApi(1);
    let title=listingTitle(q,brand,category,categoryId);
    const mount=getSmartListingMount();
    document.querySelector(".emrn-smart-results-page")?.remove();
    const shell=document.createElement("section");
    shell.className="emrn-smart-results-page";
    const compactListing=shouldReplaceCategory||shouldReplaceBrand;
    shell.innerHTML=`${compactListing?"":`<div class="emrn-smart-results-header"><div class="eyebrow">EMRN SmartSearch</div><h1>${title}</h1><p>${t("smarterMatching")}</p><div class="emrn-smart-results-search"><input value="${escapeHtml(q==="*"?"":q)}" placeholder="${t("searchPlaceholder")}" data-smart-results-input><button type="button" data-smart-results-search>${t("searchButton")}</button></div></div>`}<div class="emrn-smart-message">Loading SmartSearch results...</div>`;
    if(mount.mode==="replace") mount.el.replaceChildren(shell);
    else if(mount.mode==="append") mount.el.appendChild(shell);
    else mount.el.prepend(shell);
    markSmartReady();
    const categoryTreePromise=loadCategoryTree();
    try{
      await categoryTreePromise;
      const data=await fetchSearchPage(1);
      title=listingTitle(q,brand,category,categoryId);
      const products=(data.hits||[]).map((hit)=>hit.document);
      const found=Number(data.found||products.length||0);
      if(q&&q!=="*")trackSmartSearchEvent(products.length?"results_view":"no_results",{query:q});
      const brandFacet=(data.facet_counts||[]).find((facet)=>facet.field_name==="brand")?.counts||[];const categoryFacet=(data.facet_counts||[]).find((facet)=>facet.field_name==="categories")?.counts||[];const soldByFacet=(data.facet_counts||[]).find((facet)=>facet.field_name==="sold_by")?.counts||[];const colorFacet=(data.facet_counts||[]).find((facet)=>facet.field_name==="color")?.counts||[];const priceFacet=(data.facet_counts||[]).find((facet)=>facet.field_name==="price");
      shell.innerHTML=`${compactListing?"":`<div class="emrn-smart-results-header"><div class="eyebrow">EMRN SmartSearch</div><h1>${title}</h1><p>${found||products.length} ${t("skuLevelShown")}${brand?` • ${escapeHtml(brand)}`:""}${category?` • ${escapeHtml(category)}`:""}</p><div class="emrn-smart-results-search"><input value="${escapeHtml(q==="*"?"":q)}" placeholder="${t("searchPlaceholder")}" data-smart-results-input><button type="button" data-smart-results-search>${t("searchButton")}</button></div></div>`}${filterToggleButton()}<div class="emrn-smart-results-shell"><aside class="emrn-smart-results-filters"><div class="emrn-smart-filter-title">${t("refineBy")}</div><div class="emrn-smart-filter-note">${brand||category||categoryId?t("filtersApplied"):t("chooseBrandCategory")}</div>${isResultsPage&&(brand||category||categoryId)?`<button type="button" class="emrn-smart-viewall" data-clear-filters>${t("clearFilters")}</button>`:""}${renderCategoryTree(categoryId,category,categoryFacet)}${facetGroup(t("brands"),brandFacet,"brand")}${facetGroup("Sold By",soldByFacet,"sold_by")}${facetGroup("Color",colorFacet,"color")}${priceFilter(priceFacet,products,priceMin,priceMax)}</aside><div class="emrn-smart-results-main">${relatedCategoryBubbles(categoryFacet,products,category)}<div class="emrn-smart-results-top"><div><h2>${t("products")}</h2><p><span data-results-count>${products.length}</span> / ${found||products.length} ${t("skuLevelShown")}</p></div>${sortSelect(sort)}</div>${products.length?`<div class="emrn-smart-products-grid" data-products-grid>${products.map(productCard).join("")}</div>${renderLoadMore(found,products.length,1)}`:noResultsBox(data,q)}</div></div>`;
      stripObjectObjectText(shell);
      expandActiveCategoryTree();
    }catch(err){
      console.error("[EMRN SmartSearch] results page error",err);
      shell.innerHTML=`<div class="emrn-smart-message">SmartSearch results could not load. Please try again.</div>`;
    }
  }

  document.addEventListener("focusin",(e)=>{if(isSearchInput(e.target)){attach(e.target);if(!suppressOverlayUntilClick)scheduleRender(true)}},true)
  document.addEventListener("input",(e)=>{if(isMobileOverlayInput(e.target)){syncMobileQuery(e.target.value||"");scheduleRender(true);return}if(isSearchInput(e.target)){attach(e.target);scheduleRender(true)}},true)
  document.addEventListener("keyup",(e)=>{if(isMobileOverlayInput(e.target)){syncMobileQuery(e.target.value||"");if(e.key!=="Enter")scheduleRender(true);return}if(isSearchInput(e.target)){attach(e.target);scheduleRender(true)}},true)
  document.addEventListener("keydown",(e)=>{if(isMobileOverlayInput(e.target)){if(e.key==="Escape")return hideOverlay();if(e.key==="Enter"){const q=String(e.target.value||"").trim();if(q.length>=2){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();syncMobileQuery(q);trackAutocompleteEnter(q);goToResults(q)}}return}if(!isSearchInput(e.target))return;activeInput=e.target;if(e.key==="Escape")return hideOverlay();if(e.key==="Enter"){const q=activeInput.value.trim();if(q.length>=2){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();trackAutocompleteEnter(q);goToResults(q)}}},true)
  document.addEventListener("submit",(e)=>{const form=e.target;const input=form?.querySelector?.(SELECTORS.join(","));if(!input)return;const q=input.value.trim();if(q.length>=2){e.preventDefault();e.stopPropagation();e.stopImmediatePropagation();activeInput=input;trackAutocompleteEnter(q);goToResults(q)}},true)
  document.addEventListener("change",(e)=>{const sort=e.target.closest&&e.target.closest("[data-smart-sort]");if(!sort)return;const url=new URL(window.location.href);const value=sort.value||"popularity";if(value==="popularity")url.searchParams.delete("sort");else url.searchParams.set("sort",value);url.searchParams.set(config.resultsParam,"1");if(!url.searchParams.get("search_query"))url.searchParams.set("search_query",new URLSearchParams(window.location.search).get("search_query")||"*");window.location.href=url.toString()},true)
  document.addEventListener("click",(e)=>{if(isSearchInput(e.target)){attach(e.target);allowOverlayAfterIntent();scheduleRender(true)}},true)
  document.addEventListener("click",(e)=>{const catUrl=e.target.closest("[data-category-url]:not([data-category-id]):not([data-full-category-id])");if(catUrl){e.preventDefault();e.stopImmediatePropagation();trackSmartSearchEvent("category_click",{query:currentQuery(),product_name:String(catUrl.textContent||"").trim()});window.location.href=catUrl.getAttribute("data-category-url")}},true)
  document.addEventListener("click",(e)=>{const loadMore=e.target.closest("[data-load-more]");if(loadMore){const nextPage=Number(loadMore.getAttribute("data-load-more")||2);loadMore.disabled=true;loadMore.textContent=t("loadingMore");fetchSearchPage(nextPage).then(data=>{const products=(data.hits||[]).map((hit)=>hit.document);const grid=document.querySelector("[data-products-grid]");const newProducts=newProductsOnly(products,grid);if(grid&&newProducts.length)grid.insertAdjacentHTML("beforeend",newProducts.map(productCard).join(""));const shown=document.querySelectorAll(".emrn-smart-product-card").length;const count=document.querySelector("[data-results-count]");if(count)count.textContent=String(shown);const found=Number(data.found||shown);loadMore.outerHTML=renderLoadMore(found,shown,nextPage)}).catch(err=>{console.error("[EMRN SmartSearch] load more failed",err);loadMore.disabled=false;loadMore.textContent=t("loadMore")});return}const backTop=e.target.closest("[data-smart-backtop]");if(backTop){window.scrollTo({top:0,behavior:"smooth"});return}const priceRange=e.target.closest("[data-price-range]");if(priceRange){const maxInput=document.querySelector("[data-price-max]");if(maxInput)maxInput.value=priceRange.value;return}const applyPrice=e.target.closest("[data-apply-price]");if(applyPrice){const url=new URL(config.searchResultsUrl,window.location.origin);const q=new URLSearchParams(window.location.search).get("search_query")||"*";url.searchParams.set("search_query",q);url.searchParams.set(config.resultsParam,"1");preserveListingFilters(url,"price_min");const min=document.querySelector("[data-price-min]")?.value||"";const max=document.querySelector("[data-price-max]")?.value||"";if(min)url.searchParams.set("price_min",min);else url.searchParams.delete("price_min");if(max)url.searchParams.set("price_max",max);else url.searchParams.delete("price_max");window.location.href=url.toString();return}const filterToggle=e.target.closest("[data-filter-toggle]");if(filterToggle){const filters=document.querySelector(".emrn-smart-results-filters");filters?.classList.toggle("open");filterToggle.textContent=filters?.classList.contains("open")?"Hide filters":"Show filters";return}const searchButton=e.target.closest("[data-smart-results-search]");if(searchButton){const input=document.querySelector("[data-smart-results-input]");goToResults(input?.value||"");return}const askMeri=e.target.closest("[data-ask-meri-search]");if(askMeri){e.preventDefault();askMeriForSearchHelp(askMeri.getAttribute("data-ask-meri-search")||currentQuery());return}const noSearch=e.target.closest("[data-no-search]");if(noSearch){goToResults(noSearch.getAttribute("data-no-search")||"");return}const clear=e.target.closest("[data-clear-filters]");if(clear){const q=new URLSearchParams(window.location.search).get("search_query")||"";goToResults(q);return}const catToggle=e.target.closest("[data-cat-toggle]");if(catToggle){const id=catToggle.getAttribute("data-cat-toggle");const child=document.querySelector(`[data-cat-children="${id}"]`);if(child){child.classList.toggle("open");catToggle.textContent=child.classList.contains("open")?"−":"+"}return}const fullCat=e.target.closest("[data-full-category-id]");if(fullCat){trackSmartSearchEvent("category_click",{query:currentQuery(),product_name:String(fullCat.textContent||"").trim()});const categoryUrl=fullCat.getAttribute("data-category-url")||"";if(categoryUrl){window.location.href=categoryUrl;return}goToFullCategoryId(fullCat.getAttribute("data-full-category-id"),String(fullCat.textContent||"").trim());return}const catLink=e.target.closest("[data-category-id]");if(catLink){trackSmartSearchEvent("category_click",{query:currentQuery(),product_name:String(catLink.textContent||"").trim()});const categoryUrl=catLink.getAttribute("data-category-url")||"";if(categoryUrl){window.location.href=categoryUrl;return}goToCategoryId(catLink.getAttribute("data-category-id"),String(catLink.textContent||"").trim());return}const filter=e.target.closest("[data-filter-type][data-filter-value]");if(filter){if(filter.dataset.filterType==="category")trackSmartSearchEvent("category_click",{query:currentQuery(),product_name:filter.dataset.filterValue});goToFilteredResults(filter.dataset.filterType,filter.dataset.filterValue);return}const plus=e.target.closest("[data-qty-plus]");const minus=e.target.closest("[data-qty-minus]");if(plus||minus){const card=e.target.closest("[data-product]");const qtyEl=card?.querySelector("[data-qty]");if(!qtyEl)return;const current=Number(qtyEl.textContent||1);qtyEl.textContent=String(Math.max(1,current+(plus?1:-1)));return}const add=e.target.closest("[data-add-cart]");if(add){const card=add.closest("[data-product]");const qty=Number(card?.querySelector("[data-qty]")?.textContent||1);let product={};try{product=JSON.parse(card.dataset.product)}catch{}if(add.dataset.fallback==="1"){if(product.url)window.location.href=product.url;return}addToCart(product,qty,add);return}const quote=e.target.closest("[data-quote]");if(quote){e.preventDefault();const card=quote.closest("[data-product]");const qty=Number(card?.querySelector("[data-qty]")?.textContent||1);let product={};try{product=JSON.parse(card.dataset.product)}catch{}addToQuote(product,qty,quote);return}const productLink=e.target.closest('a[href*="sku="], .emrn-smart-view-btn, .emrn-smart-product-img, .emrn-smart-product-name, .emrn-smartsearch-item');if(productLink){try{const card=productLink.closest("[data-product]");let product={};if(card)product=JSON.parse(card.dataset.product);const sku=product.sku||new URL(productLink.href,window.location.origin).searchParams.get("sku")||"";rememberViewedSku(sku);trackSmartSearchEvent("product_click",{sku,product_id:product.product_id,product_name:product.name})}catch{}}if(overlay&&!overlay.contains(e.target)&&activeInput&&e.target!==activeInput)hideOverlay()},true)
  window.addEventListener("resize",positionOverlay)
  window.addEventListener("scroll",()=>{ if(overlay&&!overlay.hidden) positionOverlay(); updateBackTopButton() },true)
  setInterval(()=>{if(navigatingToSmartResults)return;const input=getInput();if(input&&input!==activeInput)attach(input);if(activeInput){const current=activeInput.value||"";if(current!==lastValue){lastValue=current;scheduleRender(true)}}},300)
  function init(){installQuoteRefreshBridge();ensureBackTopButton();recordCurrentProductView();autoSelectVariantFromUrl();autoClickBuyerPortalQuote();if(isSmartListingPage){renderStorefrontResults();return}markSmartReady();const input=getInput();if(input)attach(input)}
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init);else init()
  window.addEventListener("load",()=>setTimeout(markSmartReady,3500),{once:true})
})();
