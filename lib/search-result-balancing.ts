import { normalizeSearchText } from "./search-language";

const productFamilySignals: Array<[string, string[]]> = [
  ["gloves", ["glove", "gloves", "nitrile", "exam glove"]],
  ["masks", ["mask", "masks", "n95", "respirator", "face shield"]],
  ["wound-dressings", ["wound", "dressing", "dressings", "gauze", "bandage", "telfa", "tegaderm"]],
  ["needles-syringes", ["needle", "needles", "syringe", "syringes", "catheter", "injection"]],
  ["sharps", ["sharp", "sharps", "biohazard"]],
  ["diagnostic-ear", ["otoscope", "specula", "speculum", "ear"]],
  ["diagnostic-heart", ["stethoscope", "littmann"]],
  ["diagnostic-bp", ["blood pressure", "bp cuff", "cuff", "sphygmomanometer"]],
  ["diagnostic-vitals", ["thermometer", "oximeter", "pulse oximeter", "monitor"]],
  ["infection-control", ["antiseptic", "alcohol", "swab", "towelette", "wipe", "disinfect"]],
  ["first-aid", ["first aid", "kit", "trauma", "tourniquet", "splint"]],
  ["iv", ["iv", "intravenous", "infusion", "saline"]],
];

function hitDocument(hit: any) {
  return hit?.document || {};
}

export function productFamilyKey(hit: any) {
  const doc = hitDocument(hit);
  const categories = Array.isArray(doc.categories) ? doc.categories.join(" ") : String(doc.categories || "");
  const text = normalizeSearchText(
    [doc.name, doc.parent_name, doc.brand, categories, doc.variant_label, doc.option_text, doc.search_text]
      .filter(Boolean)
      .join(" ")
  );

  for (const [family, terms] of productFamilySignals) {
    if (terms.some((term) => text.includes(normalizeSearchText(term)))) return family;
  }

  return normalizeSearchText(String(doc.parent_name || doc.name || doc.sku || "other")).split(" ").slice(0, 3).join("-");
}

export function balanceHitsByProductFamily(hits: any[] = [], limit = 48) {
  if (hits.length < 3) return hits;

  const buckets = new Map<string, any[]>();
  for (const hit of hits) {
    const key = productFamilyKey(hit) || "other";
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(hit);
  }

  if (buckets.size < 2) return hits;

  const bucketKeys = Array.from(buckets.entries())
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([key]) => key);
  const balanced: any[] = [];
  let added = true;

  while (added && balanced.length < Math.min(hits.length, limit)) {
    added = false;
    for (const key of bucketKeys) {
      const next = buckets.get(key)?.shift();
      if (next) {
        balanced.push(next);
        added = true;
      }
    }
  }

  return [...balanced, ...bucketKeys.flatMap((key) => buckets.get(key) || [])];
}
