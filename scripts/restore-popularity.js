const fs = require("fs");

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
const PRODUCT_COLLECTION_ALIAS = process.env.TYPESENSE_PRODUCT_COLLECTION_ALIAS || "emrn_products_live";
const DRY_RUN = process.env.TYPESENSE_MAINTENANCE_DRY_RUN === "true";

function normalizeSku(value) {
  return String(value || "").trim();
}

async function bcFetch(path, version = 3) {
  const base = version === 2 ? API_V2_BASE : API_BASE;
  const res = await fetch(`${base}${path}`, {
    headers: {
      "X-Auth-Token": ACCESS_TOKEN,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`BigCommerce API error ${res.status}: ${await res.text()}`);
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

async function fetchRecentOrders(limit) {
  const orders = [];
  let page = 1;
  while (orders.length < limit) {
    const batch = await bcFetch(`/orders?limit=250&page=${page}&sort=date_created:desc`, 2);
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
  const byDocumentId = new Map();
  const orderLimit = Number(process.env.POPULAR_ORDER_LIMIT || 600);
  const orders = await fetchRecentOrders(orderLimit);

  for (let index = 0; index < orders.length; index += 12) {
    const batch = orders.slice(index, index + 12);
    const productsByOrder = await Promise.all(
      batch.map((order) => bcFetch(`/orders/${order.id}/products`, 2).catch(() => []))
    );

    for (const orderProducts of productsByOrder) {
      for (const item of orderProducts) {
        const quantity = Math.max(1, Number(item.quantity || 1));
        const sku = normalizeSku(item.sku);
        const productId = Number(item.product_id || 0);
        const variantId = Number(item.variant_id || 0);
        if (sku) bySku.set(sku, (bySku.get(sku) || 0) + quantity);
        if (productId) byProductId.set(productId, (byProductId.get(productId) || 0) + quantity);
        if (productId && variantId) {
          const id = `${productId}-${variantId}`;
          byDocumentId.set(id, (byDocumentId.get(id) || 0) + quantity);
        }
      }
    }
    console.log(`Fetched popularity for ${Math.min(index + batch.length, orders.length)}/${orders.length} orders`);
  }

  return { bySku, byProductId, byDocumentId };
}

function popularityUpdates(products, popularity) {
  const updates = new Map();

  for (const product of products) {
    const variants = product.variants || [];
    if (variants.length) {
      for (const variant of variants) {
        const id = `${product.id}-${variant.id}`;
        const sku = normalizeSku(variant.sku || product.sku);
        const score =
          popularity.byDocumentId.get(id) ||
          (sku ? popularity.bySku.get(sku) || 0 : 0) ||
          popularity.byProductId.get(Number(product.id)) ||
          0;
        if (score > 0) updates.set(id, { id, popularity_score: score });
      }
    } else {
      const id = `${product.id}-0`;
      const sku = normalizeSku(product.sku);
      const score =
        (sku ? popularity.bySku.get(sku) || 0 : 0) ||
        popularity.byProductId.get(Number(product.id)) ||
        0;
      if (score > 0) updates.set(id, { id, popularity_score: score });
    }
  }

  return Array.from(updates.values());
}

async function resolveLiveCollectionTarget() {
  const alias = await typesense(`/aliases/${encodeURIComponent(PRODUCT_COLLECTION_ALIAS)}`);
  const target = String(alias.collection_name || "");
  if (!target || target === PRODUCT_COLLECTION_ALIAS) {
    throw new Error("Production product alias has no safe physical collection target.");
  }
  await typesense(`/collections/${encodeURIComponent(target)}`);
  return target;
}

async function importUpdates(collectionName, updates) {
  for (let index = 0; index < updates.length; index += 100) {
    const batch = updates.slice(index, index + 100);
    const res = await fetch(
      `${TYPESENSE_BASE}/collections/${encodeURIComponent(collectionName)}/documents/import?action=update`,
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
    console.log(`Updated ${Math.min(index + batch.length, updates.length)}/${updates.length}`);
  }
}

async function main() {
  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      alias: PRODUCT_COLLECTION_ALIAS,
      operations: ["resolve alias target", "update popularity on resolved physical collection"],
      mutations: false,
    }));
    return;
  }

  const [products, popularity] = await Promise.all([
    fetchAllPages("/catalog/products?include=variants"),
    getOrderPopularityMap(),
  ]);
  const updates = popularityUpdates(products, popularity);
  console.log(`Built ${updates.length} popularity updates`);
  const collectionName = await resolveLiveCollectionTarget();
  await importUpdates(collectionName, updates);
  console.log(JSON.stringify({ ok: true, alias: PRODUCT_COLLECTION_ALIAS, collectionName, updates: updates.length }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
