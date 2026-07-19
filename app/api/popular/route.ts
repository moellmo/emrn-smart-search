import { NextRequest, NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";
import { applyHiddenSkuFilter, applyPrivateCategoryFilter } from "../../../lib/search-ranking";
import { getEffectiveSearchOverrides } from "../../../lib/search-overrides";

const COLLECTION_NAME = "emrn_products";
const STORE_URL = process.env.EMRN_STORE_URL || "https://emrn.ca";
const STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH;
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN;
const API_V2_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function fixUrl(url: string | undefined) {
  if (!url) return STORE_URL;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${STORE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

function normalizeHit(doc: any) {
  return {
    id: doc.id,
    product_id: doc.product_id,
    variant_id: doc.variant_id || 0,
    is_variant: Boolean(doc.is_variant),
    parent_name: doc.parent_name || "",
    name: doc.name,
    sku: doc.sku,
    brand: doc.brand,
    sold_by: doc.sold_by || "",
    price: doc.price,
    sale_price: doc.sale_price,
    image: doc.image,
    url: fixUrl(doc.url),
    option_text: doc.option_text || "",
    variant_label: doc.variant_label || "",
    availability: doc.availability,
    purchasable: doc.purchasable !== false && doc.quote_only !== true,
    quote_only: doc.quote_only === true,
    purchase_action: doc.purchase_action || (doc.quote_only ? "quote_only" : "cart"),
    purchase_message: doc.purchase_message || "",
    popularity_score: Number(doc.popularity_score || 0),
  };
}

const customerOrderCache = new Map<string, { expiresAt: number; skus: string[] }>();

function normalizeSku(sku: string | null | undefined) {
  return String(sku || "").trim().toUpperCase().replace(/\s+/g, "");
}

async function bcFetchV2<T>(path: string): Promise<T> {
  if (!STORE_HASH || !ACCESS_TOKEN) throw new Error("Missing BigCommerce API credentials");

  const res = await fetch(`${API_V2_BASE}${path}`, {
    headers: {
      "X-Auth-Token": ACCESS_TOKEN,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`BigCommerce API error ${res.status}: ${await res.text()}`);
  return res.json();
}

async function getCustomerOrderSkus(customerId: string) {
  const safeCustomerId = String(customerId || "").replace(/[^0-9]/g, "");
  if (!safeCustomerId) return [];

  const cached = customerOrderCache.get(safeCustomerId);
  if (cached && cached.expiresAt > Date.now()) return cached.skus;

  try {
    const orders = await bcFetchV2<Array<{ id: number }>>(
      `/orders?customer_id=${safeCustomerId}&limit=30&sort=date_created:desc`
    );
    const scores = new Map<string, number>();

    for (let index = 0; index < orders.length; index += 8) {
      const batch = orders.slice(index, index + 8);
      const productsByOrder = await Promise.all(
        batch.map((order) =>
          bcFetchV2<Array<{ sku?: string; quantity?: number }>>(`/orders/${order.id}/products`).catch(() => [])
        )
      );

      for (const products of productsByOrder) {
        for (const product of products) {
          const sku = normalizeSku(product.sku);
          if (!sku) continue;
          scores.set(sku, (scores.get(sku) || 0) + Math.max(1, Number(product.quantity || 1)));
        }
      }
    }

    const skus = Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([sku]) => sku)
      .slice(0, 24);

    customerOrderCache.set(safeCustomerId, { skus, expiresAt: Date.now() + 1000 * 60 * 15 });
    return skus;
  } catch (error) {
    console.error("[EMRN SmartSearch] customer popular unavailable", error);
    customerOrderCache.set(safeCustomerId, { skus: [], expiresAt: Date.now() + 1000 * 60 * 3 });
    return [];
  }
}

async function searchBySkus(skus: string[], limit: number, controls: any, customerId = "") {
  const cleanSkus = Array.from(new Set(skus.map(normalizeSku).filter(Boolean))).slice(0, 30);
  if (!cleanSkus.length) return [];

  const results: any = await typesenseSearch
    .collections(COLLECTION_NAME)
    .documents()
    .search({
      q: cleanSkus.join(" "),
      query_by: "sku,all_skus",
      query_by_weights: "30,24",
      filter_by: "is_visible:=true",
      sort_by: "_text_match:desc,popularity_score:desc",
      per_page: Math.min(limit * 2, 32),
      page: 1,
      num_typos: 0,
      prefix: false,
    });

  const score = new Map(cleanSkus.map((sku, index) => [sku, cleanSkus.length - index]));
  return applyPrivateCategoryFilter(applyHiddenSkuFilter(results.hits || [], controls), customerId, controls)
    .sort((a: any, b: any) => {
      const aScore = score.get(normalizeSku(a.document?.sku)) || 0;
      const bScore = score.get(normalizeSku(b.document?.sku)) || 0;
      return bScore - aScore;
    })
    .slice(0, limit);
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const perPage = Math.min(Math.max(Number(searchParams.get("per_page") || 8), 1), 16);
  const customerId = searchParams.get("customer_id") || "";
  const viewedSkus = (searchParams.get("viewed_skus") || "")
    .split(",")
    .map(normalizeSku)
    .filter(Boolean);
  const controls = await getEffectiveSearchOverrides();

  const customerSkus = await getCustomerOrderSkus(customerId);
  const personalizedHits = await searchBySkus([...customerSkus, ...viewedSkus], perPage, controls, customerId);

  const results: any = await typesenseSearch
    .collections(COLLECTION_NAME)
    .documents()
    .search({
      q: "*",
      query_by: "name,parent_name,brand,categories,sku",
      filter_by: "is_visible:=true && popularity_score:>0",
      sort_by: "popularity_score:desc,product_id:desc",
      per_page: Math.min(perPage * 3, 48),
      page: 1,
    });

  let hits = [
    ...personalizedHits,
    ...applyPrivateCategoryFilter(applyHiddenSkuFilter(results.hits || [], controls), customerId, controls),
  ];
  const seen = new Set<string>();
  hits = hits.filter((hit: any) => {
    const key = String(hit.document?.id || hit.document?.sku || "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, perPage);

  if (hits.length < perPage) {
    const fallback: any = await typesenseSearch
      .collections(COLLECTION_NAME)
      .documents()
      .search({
        q: "*",
        query_by: "name,parent_name,brand,categories,sku",
        filter_by: "is_visible:=true",
        sort_by: "product_id:desc",
        per_page: Math.min(perPage * 3, 48),
        page: 1,
      });

    const fallbackHits = applyPrivateCategoryFilter(applyHiddenSkuFilter(fallback.hits || [], controls), customerId, controls);
    for (const hit of fallbackHits) {
      const key = String(hit.document?.id || hit.document?.sku || "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      hits.push(hit);
      if (hits.length >= perPage) break;
    }
  }

  return NextResponse.json(
    {
      products: hits.map((hit: any) => normalizeHit(hit.document)),
      source: customerSkus.length
        ? "customer_orders"
        : viewedSkus.length
          ? "viewed_history"
          : hits.some((hit: any) => Number(hit.document?.popularity_score || 0) > 0)
        ? "orders"
        : "fallback",
    },
    { headers: corsHeaders }
  );
}
