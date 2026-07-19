import { stripHtml, normalizeSku, uniq } from "./clean";
import { STORE_URL, absoluteStoreUrl } from "./store-url";

const STORE_HASH = process.env.BIGCOMMERCE_STORE_HASH!;
const ACCESS_TOKEN = process.env.BIGCOMMERCE_ACCESS_TOKEN!;
const API_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}/v3`;
const API_V2_BASE = `https://api.bigcommerce.com/stores/${STORE_HASH}/v2`;

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
  purchasing_disabled?: boolean;
  is_purchasing_disabled?: boolean;
  call_for_price?: boolean;
  is_price_hidden?: boolean;
  price_hidden_label?: string;
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

type BCOrder = {
  id: number;
};

type BCOrderProduct = {
  product_id?: number;
  variant_id?: number;
  sku?: string;
  quantity?: number;
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

async function bcFetchV2<T>(path: string): Promise<T> {
  const res = await fetch(`${API_V2_BASE}${path}`, {
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

function productImage(product: BCProduct) {
  return (
    product.images?.find((img) => img.is_thumbnail)?.url_standard ||
    product.images?.[0]?.url_standard ||
    product.images?.[0]?.url_thumbnail ||
    ""
  );
}

function extractColorOption(value: string) {
  const match = String(value || "").match(/(?:^|[,|;])\s*(?:colou?r)\s*:\s*([^,|;]+)/i);
  return match ? match[1].trim() : "";
}

function trimSearchText(value: string, maxLength: number) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).replace(/\s+\S*$/, "").trim();
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
  if (product.is_visible === false) return false;
  if (productIsPurchasingDisabled(product) && !productIsQuoteOnly(product)) return false;
  return true;
}

function textSaysQuoteOnly(value: string) {
  return /contact\s+us\s+for\s+quote|request\s+a\s+quote|quote\s+only|devis|soumission/i.test(value);
}

function productIsQuoteOnly(product: BCProduct) {
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

function productIsPurchasingDisabled(product: BCProduct) {
  if (product.purchasing_disabled === true) return true;
  if (product.is_purchasing_disabled === true) return true;
  if (String(product.availability || "").toLowerCase() === "disabled") return true;
  return false;
}

function variantIsPurchasingDisabled(variant: NonNullable<BCProduct["variants"]>[number]) {
  return variant.purchasing_disabled === true || variant.is_purchasing_disabled === true;
}

function variantIsSearchable(variant: NonNullable<BCProduct["variants"]>[number], parentQuoteOnly: boolean) {
  if (!variantIsPurchasingDisabled(variant)) return true;
  return parentQuoteOnly;
}

function getCustomField(product: BCProduct, wantedName: string) {
  const wanted = wantedName.trim().toLowerCase();
  return (
    product.custom_fields?.find(
      (field) => String(field.name || "").trim().toLowerCase() === wanted
    )?.value || ""
  );
}

export async function getBrandsMap() {
  const brands = await fetchAllPages<BCBrand>("/catalog/brands");
  return new Map(brands.map((brand) => [brand.id, brand.name]));
}

export async function getCategoriesMap() {
  const categories = await fetchAllPages<BCCategory>("/catalog/categories");
  return new Map(categories.map((cat) => [cat.id, cat]));
}

async function fetchRecentOrders(limit: number) {
  const orders: BCOrder[] = [];
  let page = 1;

  while (orders.length < limit) {
    const batch = await bcFetchV2<BCOrder[]>(
      `/orders?limit=250&page=${page}&sort=date_created:desc`
    );
    if (!batch.length) break;
    orders.push(...batch);
    if (batch.length < 250) break;
    page++;
  }

  return orders.slice(0, limit);
}

async function getOrderPopularityMap() {
  const bySku = new Map<string, number>();
  const byProductId = new Map<number, number>();
  const orderLimit = Number(process.env.POPULAR_ORDER_LIMIT || 600);

  try {
    const orders = await fetchRecentOrders(orderLimit);

    for (let index = 0; index < orders.length; index += 12) {
      const batch = orders.slice(index, index + 12);
      const productsByOrder = await Promise.all(
        batch.map((order) =>
          bcFetchV2<BCOrderProduct[]>(`/orders/${order.id}/products`).catch(() => [])
        )
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
    }
  } catch (error) {
    console.error("[EMRN SmartSearch] order popularity unavailable", error);
  }

  return { bySku, byProductId };
}

export async function getAllProductsForSearch() {
  const [products, brandsMap, categoriesMap, popularity] = await Promise.all([
    fetchAllPages<BCProduct>(
      "/catalog/products?include=variants,images,custom_fields"
    ),
    getBrandsMap(),
    getCategoriesMap(),
    getOrderPopularityMap(),
  ]);

  const documents: any[] = [];

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

    const variantSkus = uniq(
      enabledVariants
        .map((variant) => normalizeSku(variant.sku))
        .filter(Boolean)
    );

    const allSkus = uniq([normalizeSku(product.sku), ...variantSkus]);

    const customFieldText = (product.custom_fields || [])
      .map((field) => `${field.name}: ${field.value}`)
      .join(" ");

    const description = trimSearchText(stripHtml(product.description), 1400);
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
      const popularityScore =
        (sku ? popularity.bySku.get(sku) || 0 : 0) ||
        popularity.byProductId.get(product.id) ||
        0;
      const variantPurchasingDisabled = variant ? variantIsPurchasingDisabled(variant) : false;
      const quoteOnly = parentQuoteOnly || variantPurchasingDisabled;
      const purchasable = !quoteOnly && !parentPurchasingDisabled && !variantPurchasingDisabled;

      const name = docName(product.name || "", label || optionText);

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

      const searchText = trimSearchText([
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
        .join(" "), 2600);

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
        price,
        sale_price: salePrice,
        retail_price: retailPrice,
        image,
        url: productUrl,
        inventory_level: Number(variant?.inventory_level ?? product.inventory_level ?? 0),
        popularity_score: popularityScore,
        availability: product.availability || "",
        availability_description: product.availability_description || "",
        purchasable,
        quote_only: quoteOnly,
        purchase_action: quoteOnly ? "quote_only" : "cart",
        purchase_message: quoteOnly
          ? product.availability_description ||
            product.price_hidden_label ||
            "Contact us for quote"
          : "",
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
