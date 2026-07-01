import { getPinnedSkusForQuery, SearchOverrides } from "./search-overrides";

export function applyHiddenSkuFilter(hits: any[] = [], controls: SearchOverrides) {
  if (!controls.hiddenSkus.length) return hits;

  const hidden = new Set(controls.hiddenSkus.map((sku) => sku.toLowerCase()));

  return hits.filter((hit) => {
    const sku = String(hit.document?.sku || "").toLowerCase();
    const allSkus = Array.isArray(hit.document?.all_skus)
      ? hit.document.all_skus.map((value: string) => String(value).toLowerCase())
      : [];

    return !hidden.has(sku) && !allSkus.some((value: string) => hidden.has(value));
  });
}

export function applyPinnedSkuRanking(hits: any[] = [], originalQuery: string, controls: SearchOverrides) {
  const pinnedSkus = getPinnedSkusForQuery(originalQuery, controls);
  if (!pinnedSkus.length) return hits;

  const pinned = pinnedSkus.map((sku) => sku.toLowerCase());
  const rankForHit = (hit: any) => {
    const sku = String(hit.document?.sku || "").toLowerCase();
    const allSkus = Array.isArray(hit.document?.all_skus)
      ? hit.document.all_skus.map((value: string) => String(value).toLowerCase())
      : [];

    const skuRank = pinned.indexOf(sku);
    if (skuRank >= 0) return skuRank;

    for (const value of allSkus) {
      const rank = pinned.indexOf(value);
      if (rank >= 0) return rank;
    }

    return 999999;
  };

  return [...hits].sort((a, b) => {
    const ar = rankForHit(a);
    const br = rankForHit(b);
    if (ar !== br) return ar - br;
    return 0;
  });
}

export function explainResult(hit: any, originalQuery: string, controls: SearchOverrides) {
  const doc = hit.document || {};
  const pinnedSkus = getPinnedSkusForQuery(originalQuery, controls).map((sku) => sku.toLowerCase());
  const sku = String(doc.sku || "").toLowerCase();

  const reasons: string[] = [];

  if (pinnedSkus.includes(sku)) reasons.push("Pinned SKU");
  if (doc.sku && String(originalQuery).toLowerCase().includes(String(doc.sku).toLowerCase())) reasons.push("SKU match");
  if (doc.name && String(doc.name).toLowerCase().includes(String(originalQuery).toLowerCase())) reasons.push("Name match");
  if (doc.parent_name && String(doc.parent_name).toLowerCase().includes(String(originalQuery).toLowerCase())) reasons.push("Parent product match");
  if (doc.brand && String(doc.brand).toLowerCase().includes(String(originalQuery).toLowerCase())) reasons.push("Brand match");

  if (!reasons.length) reasons.push("Typesense text match");

  return reasons;
}
