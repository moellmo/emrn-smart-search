import { stripHtml, normalizeSku, uniq } from "./clean";

const STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH!;
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN!;
const API_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3`;
const STORE_URL = process.env.EMRN_STORE_URL || "https://emrn.ca";

type BigCommerceListResponse<T> = {
  data: T[];
  meta?: {
    pagination?: {
      total_pages: number;
      current_page: number;
    };
  };
};

type BCProduct = {
  id: number;
  name: string;
  sku?: string;
  description?: string;
  price?: number;
  sale_price?: number;
  retail_price?: number;
  calculated_price?: number;
  brand_id?: number;
  categories?: number[];
  inventory_level?: number;
  inventory_tracking?: string;
  availability?: string;
  availability_description?: string;
  is_visible?: boolean;
  custom_url?: {
    url?: string;
  };
  date_modified?: string;
  images?: Array<{
    url_standard?: string;
    url_thumbnail?: string;
    is_thumbnail?: boolean;
  }>;
  variants?: Array<{
    id: number;
    sku?: string;
    price?: number;
    calculated_price?: number;
    sale_price?: number;
    inventory_level?: number;
    option_values?: Array<{
      option_display_name?: string;
      label?: string;
    }>;
  }>;
  custom_fields?: Array<{
    name: string;
    value: string;
  }>;
};

type BCBrand = {
  id: number;
  name: string;
};

type BCCategory = {
  id: number;
  name: string;
  parent_id?: number;
  custom_url?: {
    url?: string;
  };
};

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
    const body = await res.text();
    throw new Error(`BigCommerce API error ${res.status}: ${body}`);
  }

  return res.json();
}

async function fetchAllPages<T>(path: string): Promise<T[]> {
  const all: T[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const separator = path.includes("?") ? "&" : "?";
    const data = await bcFetch<BigCommerceListResponse<T>>(
      `${path}${separator}limit=250&page=${page}`
    );

    all.push(...data.data);
    totalPages = data.meta?.pagination?.total_pages || 1;
    page++;
  } while (page <= totalPages);

  return all;
}

export async function getBrandsMap() {
  const brands = await fetchAllPages<BCBrand>("/catalog/brands");
  return new Map(brands.map((brand) => [brand.id, brand.name]));
}

export async function getCategoriesMap() {
  const categories = await fetchAllPages<BCCategory>("/catalog/categories");
  return new Map(categories.map((cat) => [cat.id, cat]));
}

export async function getAllProductsForSearch() {
  const [products, brandsMap, categoriesMap] = await Promise.all([
    fetchAllPages<BCProduct>(
      "/catalog/products?include=variants,images,custom_fields"
    ),
    getBrandsMap(),
    getCategoriesMap(),
  ]);

  return products
    .filter((product) => product.is_visible !== false)
    .map((product) => {
      const thumbnail =
        product.images?.find((img) => img.is_thumbnail)?.url_standard ||
        product.images?.[0]?.url_standard ||
        product.images?.[0]?.url_thumbnail ||
        "";

      const brand = product.brand_id
        ? brandsMap.get(product.brand_id) || ""
        : "";

      const categories = (product.categories || [])
        .map((id) => categoriesMap.get(id)?.name || "")
        .filter(Boolean);

      const categoryIds = product.categories || [];

      const variantSkus = uniq(
        (product.variants || [])
          .map((variant) => normalizeSku(variant.sku))
          .filter(Boolean)
      );

      const allSkus = uniq([normalizeSku(product.sku), ...variantSkus]);

      const customFieldText = (product.custom_fields || [])
        .map((field) => `${field.name}: ${field.value}`)
        .join(" ");

      const optionText = (product.variants || [])
        .flatMap((variant) => variant.option_values || [])
        .map((option) =>
          [option.option_display_name, option.label].filter(Boolean).join(": ")
        )
        .join(" ");

      const description = stripHtml(product.description);

      const searchText = [
        product.name,
        product.sku,
        ...variantSkus,
        brand,
        ...categories,
        description,
        customFieldText,
        optionText,
        product.availability_description,
      ]
        .filter(Boolean)
        .join(" ");

      return {
        id: String(product.id),
        product_id: product.id,
        name: product.name || "",
        sku: normalizeSku(product.sku),
        variant_skus: variantSkus,
        all_skus: allSkus,
        brand,
        categories,
        category_ids: categoryIds,
        description,
        custom_fields_text: customFieldText,
        option_text: optionText,
        search_text: searchText,
        price: Number(product.calculated_price || product.price || 0),
        sale_price: Number(product.sale_price || 0),
        retail_price: Number(product.retail_price || 0),
        image: thumbnail,
        url: product.custom_url?.url
  ? `${STORE_URL}${product.custom_url.url.startsWith("/") ? "" : "/"}${product.custom_url.url}`
  : `${STORE_URL}/products/${product.id}`,
        inventory_level: Number(product.inventory_level || 0),
        availability: product.availability || "",
        availability_description: product.availability_description || "",
        is_visible: product.is_visible !== false,
        date_modified: product.date_modified || "",
      };
    });
}
