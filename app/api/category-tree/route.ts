import { NextResponse } from "next/server";

const STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH!;
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN!;
const API_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3`;
const STORE_URL = process.env.EMRN_STORE_URL || "https://emrn.ca";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

type BCCategory = {
  id: number;
  parent_id?: number;
  name: string;
  is_visible?: boolean;
  custom_url?: {
    url?: string;
  };
};

type BCList<T> = {
  data: T[];
  meta?: {
    pagination?: {
      total_pages: number;
    };
  };
};

function absoluteStoreUrl(path?: string) {
  if (!path) return STORE_URL;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${STORE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

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

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function GET() {
  const categories = await fetchAllCategories();

  const flat = categories.map((cat) => ({
    id: cat.id,
    parent_id: cat.parent_id || 0,
    name: cat.name,
    url: absoluteStoreUrl(cat.custom_url?.url),
  }));

  return NextResponse.json({ categories: flat }, { headers: corsHeaders });
}
