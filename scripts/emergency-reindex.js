const fs = require("fs");

const IMPORT_BATCH_SIZE = 250;

function loadEnvFile(path) {
  if (!fs.existsSync(path)) return;
  for (const line of fs.readFileSync(path, "utf8").split(/\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2].replace(/^"|"$/g, "");
  }
}

loadEnvFile("env.local_test");

const STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH;
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN;
const API_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3`;
const API_V2_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;
const TYPESENSE_BASE = `${process.env.TYPESENSE_PROTOCOL || "https"}://${process.env.TYPESENSE_HOST}:${process.env.TYPESENSE_PORT || 443}`;
const TYPESENSE_KEY = process.env.TYPESENSE_ADMIN_API_KEY;
const STORE_URL = process.env.EMRN_STORE_URL || "https://emrn.ca";
const PRODUCT_COLLECTION_ALIAS = process.env.TYPESENSE_PRODUCT_COLLECTION_ALIAS || "emrn_products_live";
const MIN_REINDEX_RECORDS = Number(process.env.TYPESENSE_MIN_REINDEX_RECORDS || 20000);
const DRY_RUN = process.env.TYPESENSE_MAINTENANCE_DRY_RUN === "true";

function required(name, value) {
  if (!value) throw new Error(`${name} is required`);
}

required("BIGCOMMERCE_STORE_HASH", STORE_HASH);
required("BIGCOMMERCE_ACCESS_TOKEN", ACCESS_TOKEN);
required("TYPESENSE_HOST", process.env.TYPESENSE_HOST);
required("TYPESENSE_ADMIN_API_KEY", TYPESENSE_KEY);

async function bcFetch(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "X-Auth-Token": ACCESS_TOKEN,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`BigCommerce API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function bcFetchV2(path) {
  const res = await fetch(`${API_V2_BASE}${path}`, {
    headers: {
      "X-Auth-Token": ACCESS_TOKEN,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`BigCommerce V2 API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function fetchAllPages(path) {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const separator = path.includes("?") ? "&" : "?";
    const data = await bcFetch(`${path}${separator}limit=250&page=${page}`);
    all.push(...(data.data || []));
    totalPages = data.meta?.pagination?.total_pages || 1;
    console.log(`Fetched ${path} page ${page}/${totalPages}`);
    page++;
  } while (page <= totalPages);
  return all;
}

async function typesense(path, options = {}) {
  const res = await fetch(`${TYPESENSE_BASE}${path}`, {
    ...options,
    headers: {
      "X-TYPESENSE-API-KEY": TYPESENSE_KEY,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {}
  if (!res.ok) throw new Error(`Typesense API error ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function normalizeSku(value) {
  return String(value || "").trim();
}

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function absoluteStoreUrl(url) {
  if (!url) return STORE_URL;
  try {
    return new URL(url, STORE_URL).toString();
  } catch {
    return STORE_URL;
  }
}

function productImage(product) {
  return (
    product.images?.find((img) => img.is_thumbnail)?.url_standard ||
    product.images?.[0]?.url_standard ||
    product.images?.[0]?.url_thumbnail ||
    ""
  );
}

function trimSearchText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
}

function variantOptionText(variant) {
  return (variant.option_values || [])
    .map((option) => [option.option_display_name, option.label].filter(Boolean).join(": "))
    .filter(Boolean)
    .join(", ");
}

function variantLabel(variant) {
  return (variant.option_values || [])
    .map((option) => option.label)
    .filter(Boolean)
    .join(" / ");
}

function docName(parentName, label) {
  if (!label) return parentName;
  if (parentName.toLowerCase().includes(label.toLowerCase())) return parentName;
  return `${parentName} - ${label}`;
}

function textSaysQuoteOnly(value) {
  return /contact\s+us\s+for\s+quote|request\s+a\s+quote|quote\s+only|devis|soumission/i.test(value);
}

function productIsQuoteOnly(product) {
  if (product.call_for_price === true) return true;
  const text = [
    product.availability,
    product.availability_description,
    product.price_hidden_label,
    ...(product.custom_fields || []).map((field) => `${field.name}: ${field.value}`),
  ]
    .filter(Boolean)
    .join(" ");
  if (product.is_price_hidden === true && textSaysQuoteOnly(text)) return true;
  return textSaysQuoteOnly(text);
}

function productIsPurchasingDisabled(product) {
  if (product.purchasing_disabled === true) return true;
  if (product.is_purchasing_disabled === true) return true;
  if (String(product.availability || "").toLowerCase() === "disabled") return true;
  return false;
}

function productIsEnabled(product) {
  if (product.is_visible === false) return false;
  if (productIsPurchasingDisabled(product) && !productIsQuoteOnly(product)) return false;
  return true;
}

function variantIsPurchasingDisabled(variant) {
  return variant.purchasing_disabled === true || variant.is_purchasing_disabled === true;
}

function variantIsSearchable(variant, parentQuoteOnly) {
  if (!variantIsPurchasingDisabled(variant)) return true;
  return parentQuoteOnly;
}

function getCustomField(product, wantedName) {
  const wanted = wantedName.trim().toLowerCase();
  return (
    product.custom_fields?.find(
      (field) => String(field.name || "").trim().toLowerCase() === wanted
    )?.value || ""
  );
}

function extractColorOption(value) {
  const match = String(value || "").match(/(?:^|[,|;])\s*(?:colou?r)\s*:\s*([^,|;]+)/i);
  return match ? match[1].trim() : "";
}

async function fetchRecentOrders(limit) {
  const orders = [];
  let page = 1;
  while (orders.length < limit) {
    const batch = await bcFetchV2(`/orders?limit=250&page=${page}&sort=date_created:desc`);
    if (!batch.length) break;
    orders.push(...batch);
    if (batch.length < 250) break;
    page++;
  }
  return orders.slice(0, limit);
}

async function getOrderPopularityMap() {
  const bySku = new Map();
  const byProductId = new Map();
  const orderLimit = Number(process.env.POPULAR_ORDER_LIMIT || 600);
  const orders = await fetchRecentOrders(orderLimit);

  for (let index = 0; index < orders.length; index += 12) {
    const batch = orders.slice(index, index + 12);
    const productsByOrder = await Promise.all(
      batch.map((order) => bcFetchV2(`/orders/${order.id}/products`).catch(() => []))
    );
    for (const orderProducts of productsByOrder) {
      for (const item of orderProducts) {
        const quantity = Math.max(1, Number(item.quantity || 1));
        const sku = normalizeSku(item.sku);
        const productId = Number(item.product_id || 0);
        if (sku) bySku.set(sku, (bySku.get(sku) || 0) + quantity);
        if (productId) byProductId.set(productId, (byProductId.get(productId) || 0) + quantity);
      }
    }
    console.log(`Fetched popularity for ${Math.min(index + batch.length, orders.length)}/${orders.length} orders`);
  }

  return { bySku, byProductId };
}

function versionedProductCollectionName(date = new Date()) {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.(\d+)Z$/, "_$1")
    .replace("T", "_");

  return `emrn_products_${stamp}`;
}

function collectionSchema(collectionName) {
  return {
    name: collectionName,
    fields: [
      { name: "product_id", type: "int32" },
      { name: "variant_id", type: "int32", facet: true, optional: true },
      { name: "is_variant", type: "bool", facet: true, optional: true },
      { name: "parent_name", type: "string", optional: true },
      { name: "name", type: "string" },
      { name: "sku", type: "string", optional: true },
      { name: "variant_skus", type: "string[]", optional: true },
      { name: "all_skus", type: "string[]", optional: true },
      { name: "brand", type: "string", facet: true, optional: true },
      { name: "sold_by", type: "string", facet: true, optional: true },
      { name: "categories", type: "string[]", facet: true, optional: true },
      { name: "category_url_pairs", type: "string[]", optional: true },
      { name: "category_ids", type: "int32[]", facet: true, optional: true },
      { name: "description", type: "string", optional: true },
      { name: "custom_fields_text", type: "string", optional: true },
      { name: "option_text", type: "string", optional: true },
      { name: "variant_label", type: "string", optional: true },
      { name: "color", type: "string", facet: true, optional: true },
      { name: "search_text", type: "string", optional: true },
      { name: "price", type: "float", facet: true },
      { name: "sale_price", type: "float", optional: true },
      { name: "retail_price", type: "float", optional: true },
      { name: "image", type: "string", optional: true },
      { name: "url", type: "string" },
      { name: "inventory_level", type: "int32", facet: true, optional: true },
      { name: "popularity_score", type: "int32", facet: true },
      { name: "availability", type: "string", facet: true, optional: true },
      { name: "availability_description", type: "string", optional: true },
      { name: "purchasable", type: "bool", facet: true, optional: true },
      { name: "quote_only", type: "bool", facet: true, optional: true },
      { name: "purchase_action", type: "string", facet: true, optional: true },
      { name: "purchase_message", type: "string", optional: true },
      { name: "is_visible", type: "bool", facet: true },
      { name: "date_modified", type: "string", optional: true },
    ],
    default_sorting_field: "popularity_score",
  };
}

async function createTargetCollection(collectionName) {
  await typesense("/collections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collectionSchema(collectionName)),
  });
}

function toDocuments(products, brandsMap, categoriesMap, popularity) {
  const documents = [];
  for (const product of products.filter(productIsEnabled)) {
    const baseImage = productImage(product);
    const soldBy = getCustomField(product, "Sold By");
    const brand = product.brand_id ? brandsMap.get(product.brand_id) || "" : "";
    const categories = (product.categories || [])
      .map((id) => categoriesMap.get(id)?.name || "")
      .filter(Boolean);
    const categoryUrlPairs = (product.categories || [])
      .map((id) => {
        const category = categoriesMap.get(id);
        if (!category?.name || !category.custom_url?.url) return "";
        return `${category.name}|${absoluteStoreUrl(category.custom_url.url)}`;
      })
      .filter(Boolean);
    const categoryIds = product.categories || [];
    const parentQuoteOnly = productIsQuoteOnly(product);
    const parentPurchasingDisabled = productIsPurchasingDisabled(product);
    const enabledVariants = (product.variants || []).filter((variant) =>
      variantIsSearchable(variant, parentQuoteOnly)
    );
    const variantSkus = uniq(enabledVariants.map((variant) => normalizeSku(variant.sku)));
    const allSkus = uniq([normalizeSku(product.sku), ...variantSkus]);
    const customFieldText = (product.custom_fields || [])
      .map((field) => `${field.name}: ${field.value}`)
      .join(" ");
    const description = trimSearchText(stripHtml(product.description), 1400);
    const productUrl = absoluteStoreUrl(product.custom_url?.url);
    const createDoc = (variant, fallbackIndex = 0) => {
      const optionText = variant ? variantOptionText(variant) : "";
      const label = variant ? variantLabel(variant) : "";
      const sku = normalizeSku(variant?.sku || product.sku);
      const variantId = variant?.id || 0;
      const popularityScore =
        (sku ? popularity.bySku.get(sku) || 0 : 0) ||
        popularity.byProductId.get(product.id) ||
        0;
      const variantPurchasingDisabled = variant ? variantIsPurchasingDisabled(variant) : false;
      const quoteOnly = parentQuoteOnly || variantPurchasingDisabled;
      const purchasable = !quoteOnly && !parentPurchasingDisabled && !variantPurchasingDisabled;
      const name = docName(product.name || "", label || optionText);
      const regularPrice = Number(variant?.price ?? product.price ?? 0);
      const calculatedPrice = Number(
        variant?.calculated_price ??
          variant?.price ??
          product.calculated_price ??
          product.price ??
          0
      );
      const salePrice = Number(variant?.sale_price ?? product.sale_price ?? 0);
      const retailPrice =
        Number(variant?.retail_price ?? product.retail_price ?? 0) ||
        (salePrice > 0 && regularPrice > salePrice ? regularPrice : 0);
      const searchText = trimSearchText(
        [
          name,
          product.name,
          sku,
          product.sku,
          ...allSkus,
          brand,
          soldBy,
          ...categories,
          optionText,
          label,
          description,
          customFieldText,
        ]
          .filter(Boolean)
          .join(" "),
        2600
      );
      return {
        id: variantId ? `${product.id}-${variantId}` : `${product.id}-${fallbackIndex}`,
        product_id: product.id,
        variant_id: variantId,
        is_variant: Boolean(variantId),
        parent_name: product.name || "",
        name,
        sku,
        variant_skus: variantSkus,
        all_skus: allSkus,
        brand,
        sold_by: soldBy,
        categories,
        category_url_pairs: categoryUrlPairs,
        category_ids: categoryIds,
        description,
        custom_fields_text: customFieldText,
        option_text: optionText,
        variant_label: label,
        color: extractColorOption(optionText || label),
        search_text: searchText,
        price: calculatedPrice,
        sale_price: salePrice,
        retail_price: retailPrice,
        image: variant?.image_url || baseImage,
        url: productUrl,
        inventory_level: Number(variant?.inventory_level ?? product.inventory_level ?? 0),
        popularity_score: popularityScore,
        availability: product.availability || "",
        availability_description: product.availability_description || "",
        purchasable,
        quote_only: quoteOnly,
        purchase_action: quoteOnly ? "quote_only" : "cart",
        purchase_message:
          quoteOnly
            ? product.availability_description ||
              product.price_hidden_label ||
              "Contact us for quote"
            : "",
        is_visible: true,
        date_modified: product.date_modified || "",
      };
    };
    if (enabledVariants.length) {
      enabledVariants.forEach((variant, index) => documents.push(createDoc(variant, index)));
    } else {
      documents.push(createDoc(undefined, 0));
    }
  }
  return documents;
}

function parseImportResult(text) {
  return String(text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return { success: false, error: line };
      }
    });
}

async function importDocuments(collectionName, documents) {
  let failed = [];
  for (let index = 0; index < documents.length; index += IMPORT_BATCH_SIZE) {
    const batch = documents.slice(index, index + IMPORT_BATCH_SIZE);
    const res = await fetch(
      `${TYPESENSE_BASE}/collections/${encodeURIComponent(collectionName)}/documents/import?action=upsert`,
      {
        method: "POST",
        headers: {
          "X-TYPESENSE-API-KEY": TYPESENSE_KEY,
          "Content-Type": "text/plain",
        },
        body: batch.map((doc) => JSON.stringify(doc)).join("\n"),
      }
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`Typesense import error ${res.status}: ${text}`);
    const rows = parseImportResult(text);
    failed.push(...rows.filter((row) => row.success === false));
    console.log(`Imported ${Math.min(index + batch.length, documents.length)}/${documents.length}`);
  }
  return failed;
}

async function readAliasTarget() {
  const alias = await typesense(`/aliases/${encodeURIComponent(PRODUCT_COLLECTION_ALIAS)}`);
  const target = String(alias.collection_name || "");
  if (!target) throw new Error("Production product alias has no target collection.");
  return target;
}

async function validateTargetCollection(collectionName, expectedDocuments) {
  const collection = await typesense(`/collections/${encodeURIComponent(collectionName)}`);
  const indexedDocuments = Number(collection.num_documents || 0);
  if (indexedDocuments < MIN_REINDEX_RECORDS || indexedDocuments !== expectedDocuments) {
    throw new Error(`Validation failed: indexed ${indexedDocuments} documents, expected ${expectedDocuments}.`);
  }

  const smokeSearch = await typesense(
    `/collections/${encodeURIComponent(collectionName)}/documents/search?${new URLSearchParams({
      q: "bandage",
      query_by: "sku,all_skus,name,parent_name,brand,categories,search_text",
      filter_by: "is_visible:=true",
      per_page: "1",
    }).toString()}`
  );
  if (Number(smokeSearch.found || 0) <= 0) {
    throw new Error("Validation failed: smoke search returned no results.");
  }

  return collection;
}

async function switchAliasAfterValidation(targetCollection, previousAliasTarget) {
  if (!targetCollection || targetCollection === PRODUCT_COLLECTION_ALIAS || targetCollection === previousAliasTarget) {
    throw new Error("Refusing to switch the product alias to an unsafe collection target.");
  }

  await typesense(`/aliases/${encodeURIComponent(PRODUCT_COLLECTION_ALIAS)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collection_name: targetCollection }),
  });

  const confirmedAliasTarget = await readAliasTarget();
  if (confirmedAliasTarget !== targetCollection) {
    if (previousAliasTarget) {
      await typesense(`/aliases/${encodeURIComponent(PRODUCT_COLLECTION_ALIAS)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection_name: previousAliasTarget }),
      }).catch(() => null);
    }
    throw new Error("Alias switch could not be confirmed; the prior live target was preserved when possible.");
  }
}

async function main() {
  const targetCollection = versionedProductCollectionName();
  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      alias: PRODUCT_COLLECTION_ALIAS,
      plannedTargetCollection: targetCollection,
      operations: ["create dated collection", "import", "validate", "switch alias after validation"],
      mutations: false,
    }));
    return;
  }

  console.log("Fetching BigCommerce catalog...");
  const [products, brands, categories, popularity] = await Promise.all([
    fetchAllPages("/catalog/products?include=variants,images,custom_fields"),
    fetchAllPages("/catalog/brands"),
    fetchAllPages("/catalog/categories"),
    getOrderPopularityMap(),
  ]);
  const brandsMap = new Map(brands.map((brand) => [brand.id, brand.name]));
  const categoriesMap = new Map(categories.map((category) => [category.id, category]));
  const documents = toDocuments(products, brandsMap, categoriesMap, popularity);
  console.log(`Built ${documents.length} documents from ${products.length} products`);
  if (documents.length < MIN_REINDEX_RECORDS) {
    throw new Error(`Reindex aborted: built ${documents.length} documents, below the ${MIN_REINDEX_RECORDS} safety threshold.`);
  }

  const previousAliasTarget = await readAliasTarget();
  if (targetCollection === previousAliasTarget || targetCollection === PRODUCT_COLLECTION_ALIAS) {
    throw new Error("Refusing to create or import into the live alias target.");
  }

  console.log(`Creating staged Typesense collection ${targetCollection}...`);
  await createTargetCollection(targetCollection);
  const failed = await importDocuments(targetCollection, documents);
  if (failed.length) {
    console.error(JSON.stringify(failed.slice(0, 10), null, 2));
    throw new Error(`Reindex aborted before alias switch: ${failed.length} import rows failed.`);
  }

  const collection = await validateTargetCollection(targetCollection, documents.length);
  await switchAliasAfterValidation(targetCollection, previousAliasTarget);
  console.log(JSON.stringify({
    ok: true,
    alias: PRODUCT_COLLECTION_ALIAS,
    previousAliasTarget,
    targetCollection,
    documents: documents.length,
    indexedDocuments: Number(collection.num_documents || 0),
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
