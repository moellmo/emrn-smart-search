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
    retail_price?: number;
    inventory_level?: number;
    image_url?: string;
    purchasing_disabled?: boolean;
    is_purchasing_disabled?: boolean;
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

function absoluteStoreUrl(path?: string) {
  if (!path) return STORE_URL;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${STORE_URL}${path.startsWith("/") ? "" : "/"}${path}`;
}

function productImage(product: BCProduct) {
  return (
    product.images?.find((img) => img.is_thumbnail)?.url_standard ||
    product.images?.[0]?.url_standard ||
    product.images?.[0]?.url_thumbnail ||
    ""
  );
}

function variantOptionText(variant: NonNullable<BCProduct["variants"]>[number]) {
  return (variant.option_values || [])
    .map((option) =>
      [option.option_display_name, option.label].filter(Boolean).join(": ")
    )
    .filter(Boolean)
    .join(", ");
}

function variantLabel(variant: NonNullable<BCProduct["variants"]>[number]) {
  return (variant.option_values || [])
    .map((option) => option.label)
    .filter(Boolean)
    .join(" / ");
}

function docName(parentName: string, label: string) {
  if (!label) return parentName;
  if (parentName.toLowerCase().includes(label.toLowerCase())) return parentName;
  return `${parentName} - ${label}`;
}

function productIsEnabled(product: BCProduct) {
  // BigCommerce uses is_visible for storefront visibility.
  // Availability can be "available", "disabled", or "preorder".
  // We exclude disabled/unavailable products so they do not appear in SmartSearch.
  if (product.is_visible === false) return false;
  if (String(product.availability || "").toLowerCase() === "disabled") return false;
  return true;
}

function variantIsEnabled(variant: NonNullable<BCProduct["variants"]>[number]) {
  // BigCommerce variants can be disabled for purchase.
  // Field name can differ by response/API version, so support both.
  if (variant.purchasing_disabled === true) return false;
  if (variant.is_purchasing_disabled === true) return false;
  return true;
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

  const documents: any[] = [];

  for (const product of products.filter(productIsEnabled)) {
    const baseImage = productImage(product);

    const brand = product.brand_id ? brandsMap.get(product.brand_id) || "" : "";

    const categories = (product.categories || [])
      .map((id) => categoriesMap.get(id)?.name || "")
      .filter(Boolean);

    const categoryIds = product.categories || [];
    const enabledVariants = (product.variants || []).filter(variantIsEnabled);

    const variantSkus = uniq(
      enabledVariants
        .map((variant) => normalizeSku(variant.sku))
        .filter(Boolean)
    );

    const allSkus = uniq([normalizeSku(product.sku), ...variantSkus]);

    const customFieldText = (product.custom_fields || [])
      .map((field) => `${field.name}: ${field.value}`)
      .join(" ");

    const description = stripHtml(product.description);
    const productUrl = absoluteStoreUrl(product.custom_url?.url);

    const createDoc = (
      variant?: NonNullable<BCProduct["variants"]>[number],
      fallbackIndex = 0
    ) => {
      const optionText = variant ? variantOptionText(variant) : "";
      const label = variant ? variantLabel(variant) : "";
      const sku = normalizeSku(variant?.sku || product.sku);
      const variantId = variant?.id || 0;
      const isVariant = Boolean(variantId);

      const name = docName(product.name || "", label || optionText);

      // Variant-level price first. This makes the displayed price match the exact SKU/variant.
      const price = Number(
        variant?.calculated_price ??
          variant?.price ??
          product.calculated_price ??
          product.price ??
          0
      );

      const salePrice = Number(variant?.sale_price ?? product.sale_price ?? 0);
      const retailPrice = Number(variant?.retail_price ?? product.retail_price ?? 0);

      const image = variant?.image_url || baseImage;

      const searchText = [
        name,
        product.name,
        sku,
        product.sku,
        ...allSkus,
        brand,
        ...categories,
        optionText,
        label,
        description,
        customFieldText,
      ]
        .filter(Boolean)
        .join(" ");

      return {
        id: variantId ? `${product.id}-${variantId}` : `${product.id}-${fallbackIndex}`,
        product_id: product.id,
        variant_id: variantId,
        is_variant: isVariant,
        parent_name: product.name || "",
        name,
        sku,
        variant_skus: variantSkus,
        all_skus: allSkus,
        brand,
        categories,
        category_ids: categoryIds,
        description,
        custom_fields_text: customFieldText,
        option_text: optionText,
        variant_label: label,
        search_text: searchText,
        price,
        sale_price: salePrice,
        retail_price: retailPrice,
        image,
        url: productUrl,
        inventory_level: Number(variant?.inventory_level ?? product.inventory_level ?? 0),
        availability: product.availability || "",
        availability_description: product.availability_description || "",
        is_visible: true,
        date_modified: product.date_modified || "",
      };
    };

    if (enabledVariants.length) {
      enabledVariants.forEach((variant, index) => {
        documents.push(createDoc(variant, index));
      });
    } else {
      documents.push(createDoc(undefined, 0));
    }
  }

  return documents;
}
