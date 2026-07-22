import { NextResponse } from "next/server";
import { typesenseSearch } from "../../../lib/typesense";
import { getEffectiveSearchOverrides, getHiddenCategoryRules } from "../../../lib/search-overrides";
import { absoluteStoreUrl } from "../../../lib/store-url";

const STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH!;
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN!;
const API_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3`;
const COLLECTION_NAME = "emrn_products";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "public, s-maxage=300, stale-while-revalidate=1800",
};

type BCCategory = {
  id: number;
  parent_id?: number;
  name: string;
  is_visible?: boolean;
  image_url?: string;
  custom_url?: {
    url?: string;
  };
  product_count?: number;
};

type BCList<T> = {
  data: T[];
  meta?: {
    pagination?: {
      total_pages: number;
    };
  };
};

const RAW_CATEGORY_CACHE_MS = 1000 * 60 * 5;
let rawCategoryCache: {
  expiresAt: number;
  categories: BCCategory[];
  catalogCounts: Map<string, number> | null;
} | null = null;

async function bcFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "X-Auth-Token": ACCESS_TOKEN,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`BigCommerce API error ${res.status}: ${await res.text()}`);
  }

  return res.json();
}

async function fetchCatalogCategoryCounts() {
  try {
    const result: any = await typesenseSearch
      .collections(COLLECTION_NAME)
      .documents()
      .search({
        q: "*",
        query_by: "name,categories,brand,sku",
        filter_by: "is_visible:=true",
        facet_by: "categories",
        max_facet_values: 1000,
        per_page: 0,
      });

    const counts = new Map<string, number>();
    const categoryFacet = result.facet_counts?.find((facet: any) => facet.field_name === "categories");
    for (const item of categoryFacet?.counts || []) {
      counts.set(String(item.value || "").toLowerCase(), Number(item.count || 0));
    }
    return counts;
  } catch (err) {
    console.error("[EMRN SmartSearch] category catalog counts unavailable", err);
    return null;
  }
}

async function fetchAllCategories() {
  const all: BCCategory[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const data = await bcFetch<BCList<BCCategory>>(`/catalog/categories?limit=250&page=${page}`);
    all.push(...data.data);
    totalPages = data.meta?.pagination?.total_pages || 1;
    page++;
  } while (page <= totalPages);

  return all.filter((cat) => cat.is_visible !== false);
}

async function getRawCategoryData() {
  if (rawCategoryCache && rawCategoryCache.expiresAt > Date.now()) return rawCategoryCache;

  const [categories, catalogCounts] = await Promise.all([fetchAllCategories(), fetchCatalogCategoryCounts()]);
  if (catalogCounts && catalogCounts.size > 0) {
    rawCategoryCache = {
      categories,
      catalogCounts,
      expiresAt: Date.now() + RAW_CATEGORY_CACHE_MS,
    };
  }

  return { categories, catalogCounts };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  const controls = await getEffectiveSearchOverrides();
  const hiddenRules = getHiddenCategoryRules(controls);
  const blockedIds = new Set(hiddenRules.flatMap((rule) => rule.categoryIds.map((id) => Number(id))));
  const blockedNames = new Set(hiddenRules.flatMap((rule) => rule.categoryNames.map((name) => String(name).toLowerCase())));

  const { categories, catalogCounts } = await getRawCategoryData();

  const flat = categories
    .filter((cat) => !blockedIds.has(Number(cat.id)) && !blockedNames.has(String(cat.name || "").toLowerCase()))
    .map((cat) => ({
      id: cat.id,
      parent_id: cat.parent_id || 0,
      name: cat.name,
      url: absoluteStoreUrl(cat.custom_url?.url),
      image: cat.image_url ? absoluteStoreUrl(cat.image_url) : "",
      product_count: catalogCounts?.get(String(cat.name || "").toLowerCase()) || Number(cat.product_count || 0),
    }));

  return NextResponse.json({ categories: flat }, { headers: corsHeaders });
}
