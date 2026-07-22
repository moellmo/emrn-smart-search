export const PRODUCT_COLLECTION_BASE = "emrn_products";
export const PRODUCT_COLLECTION_ALIAS =
  process.env.TYPESENSE_PRODUCT_COLLECTION_ALIAS || "emrn_products_live";

export const MIN_REINDEX_RECORDS = Number(
  process.env.TYPESENSE_MIN_REINDEX_RECORDS || 20000
);

export function versionedProductCollectionName(date = new Date()) {
  const stamp = date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.(\d+)Z$/, "_$1")
    .replace("T", "_");

  return `${PRODUCT_COLLECTION_BASE}_${stamp}`;
}
