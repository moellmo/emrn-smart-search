import { getBlockedPrivateCategoryRules, getPinnedSkusForQuery, SearchOverrides } from "./search-overrides";
import { normalizeSearchText } from "./search-language";

export function applyHiddenSkuFilter(hits: any[] = [], controls: SearchOverrides) {
  if (!controls.hiddenSkus.length) return hits;

  const hidden = controls.hiddenSkus.map((sku) => sku.toLowerCase());

  return hits.filter((hit) => {
    const sku = String(hit.document?.sku || "").toLowerCase();
    const allSkus = Array.isArray(hit.document?.all_skus)
      ? hit.document.all_skus.map((value: string) => String(value).toLowerCase())
      : [];

    return !hidden.some((value) => sku === value || sku.startsWith(value)) &&
      !allSkus.some((skuValue: string) => hidden.some((value) => skuValue === value || skuValue.startsWith(value)));
  });
}

export function applyPrivateCategoryFilter(hits: any[] = [], customerId: string | null | undefined, controls: SearchOverrides) {
  const blockedRules = getBlockedPrivateCategoryRules(customerId, controls);
  if (!blockedRules.length) return hits;

  return hits.filter((hit) => {
    const doc = hit.document || {};
    const categoryIds = Array.isArray(doc.category_ids) ? doc.category_ids.map((id: unknown) => Number(id)) : [];
    const categories = Array.isArray(doc.categories)
      ? doc.categories.map((name: unknown) => normalizeSearchText(String(name || "")))
      : [];

    return !blockedRules.some((rule) => {
      const blockedById = rule.categoryIds.some((id) => categoryIds.includes(Number(id)));
      const blockedByName = rule.categoryNames.some((name) => categories.includes(normalizeSearchText(name)));
      return blockedById || blockedByName;
    });
  });
}

export function applyPinnedSkuRanking(hits: any[] = [], originalQuery: string, controls: SearchOverrides) {
  return applyPinnedSkuListRanking(hits, getPinnedSkusForQuery(originalQuery, controls));
}

function normalizeDimensionText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[×✕]/g, "x")
    .replace(/[″”"]/g, " ")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9./x\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dimensionPairs(value: string) {
  return Array.from(normalizeDimensionText(value).matchAll(/\b(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)\b/g))
    .map((match) => [Number(match[1]), Number(match[2])] as const);
}

function sameDimensionPair(left: readonly [number, number], right: readonly [number, number]) {
  return (left[0] === right[0] && left[1] === right[1]) ||
    (left[0] === right[1] && left[1] === right[0]);
}

// Small, fast attribute pass for the pre-V2 ranking pipeline. It intentionally
// avoids broad candidate expansion and only corrects high-confidence intent
// signals that customers expect to hold across product variants.
export function applyFastAttributeRanking(hits: any[] = [], originalQuery: string) {
  const original = normalizeSearchText(String(originalQuery || "").replace(/[×✕]/g, "x"))
    .replace(/\bgrand(?:s|e|es)?\b/g, "large")
    .replace(/\bpetit(?:s|e|es)?\b/g, "small")
    .replace(/\bmoyen(?:s|ne|nes)?\b/g, "medium")
    .replace(/\bgants?\b/g, "gloves")
    .replace(/\bcompresses?\b/g, "gauze");
  if (!original || original === "*" || !hits.length) return hits;

  const requestedVolume = /\b(\d+(?:\.\d+)?)\s*(?:ml|cc)\b/.exec(original);
  const requestedDimensions = dimensionPairs(originalQuery);
  const requestedGauge = /\b(\d{1,2})\s*(?:g|ga|gauge)\b/.exec(original)?.[1];
  const requestedFrenchSize = /\b(\d+(?:\.\d+)?)\s*(?:fr|french)\b/.exec(original)?.[1];
  const requestedNamedSize = /\b(?:size|taille)\s*#?\s*(\d+(?:\.\d+)?)\b/.exec(original)?.[1];
  const requestedMaterials = ["latex", "nitrile", "vinyl", "neoprene"].filter((term) => original.includes(term));
  const requestedSize = /\b(x[- ]?small|small|medium|large|x[- ]?large)\b/.exec(original)?.[1]?.replace(/[- ]/g, "");
  const syringeQuery = /\bsyring(?:e|es)\b/.test(original);
  const needleQuery = /\bneedles?\b/.test(original);
  const gloveQuery = /\bgloves?\b/.test(original);
  const gauzeQuery = /\b(?:gauze|sponges?)\b/.test(original);
  const explicitSyringeRelationship = /\b(?:with|attached|exchangeable|blunt\s+fill)\s+needles?\b/.test(original);
  const explicitSyringeSpecialty = /\b(?:bulb|oral|insulin|irrigation|flush|prefilled|air\s*\/\s*water|ear\s*\/\s*ulcer)\b/.test(original);
  const explicitAccessory = /\b(?:accessor(?:y|ies)|replacement|parts?)\b/.test(original);

  const score = (hit: any) => {
    const doc = hit.document || {};
    const title = normalizeSearchText([doc.name, doc.variant_label, doc.option_text].filter(Boolean).join(" "));
    const parent = normalizeSearchText(String(doc.parent_name || ""));
    const categories = normalizeSearchText(Array.isArray(doc.categories) ? doc.categories.join(" ") : String(doc.categories || ""));
    const fields = `${title} ${parent} ${categories}`;
    const productText = `${title} ${parent}`;
    const rawProductText = [doc.name, doc.parent_name, doc.variant_label, doc.option_text].filter(Boolean).join(" ").toLowerCase();
    const titleDimensions = dimensionPairs(`${doc.name || ""} ${doc.parent_name || ""} ${doc.variant_label || ""} ${doc.option_text || ""}`);
    const fieldDimensions = dimensionPairs(`${doc.name || ""} ${doc.parent_name || ""} ${doc.variant_label || ""} ${doc.option_text || ""} ${Array.isArray(doc.categories) ? doc.categories.join(" ") : doc.categories || ""}`);
    let value = 0;

    if (requestedDimensions.length) {
      const exactTitleDimension = requestedDimensions.some((requested) => titleDimensions.some((listed) => sameDimensionPair(requested, listed)));
      const exactFieldDimension = requestedDimensions.some((requested) => fieldDimensions.some((listed) => sameDimensionPair(requested, listed)));
      if (exactTitleDimension) value += 8000;
      else if (titleDimensions.length) value -= 4000;
      else if (exactFieldDimension) value += 4000;
      else if (fieldDimensions.length) value -= 2000;
    }

    if (requestedGauge) {
      const gaugePattern = new RegExp(`\\b${requestedGauge}\\s*(?:g|ga|gauge)\\b`);
      const hasExactGauge = gaugePattern.test(productText);
      const hasOtherGauge = /\b\d{1,2}\s*(?:g|ga|gauge)\b/.test(productText);
      if (hasExactGauge) value += 5000;
      else if (hasOtherGauge) value -= 4000;
    }

    if (requestedFrenchSize) {
      const frenchSizePattern = new RegExp(`\\b${requestedFrenchSize}\\s*(?:fr|french)\\b`);
      const hasExactFrenchSize = frenchSizePattern.test(productText);
      const hasOtherFrenchSize = /\b\d+(?:\.\d+)?\s*(?:fr|french)\b/.test(productText);
      if (hasExactFrenchSize) value += 6000;
      else if (hasOtherFrenchSize) value -= 4500;
    }

    if (requestedNamedSize) {
      const namedSizePattern = new RegExp(`\\b(?:size|taille)\\s*#?\\s*${requestedNamedSize}\\b|(?:^|\\s)#\\s*${requestedNamedSize}\\b`);
      const hasExactNamedSize = namedSizePattern.test(rawProductText);
      const hasOtherNamedSize = /\b(?:size|taille)\s*#?\s*\d+(?:\.\d+)?\b|(?:^|\s)#\s*\d+(?:\.\d+)?\b/.test(rawProductText);
      if (hasExactNamedSize) value += 6000;
      else if (hasOtherNamedSize) value -= 4500;
    }

    if (requestedVolume) {
      const requested = Number(requestedVolume[1]);
      const titleVolumes = Array.from(`${title} ${parent}`.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:ml|cc)\b/g)).map((match) => Number(match[1]));
      const allVolumes = Array.from(fields.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:ml|cc)\b/g)).map((match) => Number(match[1]));
      const compactTitle = `${title} ${parent}`.replace(/\s+/g, "");
      const compactFields = fields.replace(/\s+/g, "");
      const exactCompactVolume = [`${requested}ml`, `${requested}cc`];
      const hasExactTitleVolume = exactCompactVolume.some((token) => compactTitle.includes(token));
      const hasOtherTitleVolume = titleVolumes.some((volume) => volume !== requested);
      const hasExactFieldVolume = exactCompactVolume.some((token) => compactFields.includes(token));
      const hasOtherFieldVolume = allVolumes.some((volume) => volume !== requested);
      if (hasExactTitleVolume) value += 10000;
      else if (hasOtherTitleVolume) value -= 10000;
      else if (hasExactFieldVolume) value += 5000;
      else if (hasOtherFieldVolume) value -= 5000;
    }

    if (requestedMaterials.length) {
      if (requestedMaterials.some((material) => productText.includes(material))) value += 1800;
      if (!requestedMaterials.some((material) => productText.includes(material))) value -= 2400;
      if (requestedMaterials.some((material) => !productText.includes(material)) && ["latex", "nitrile", "vinyl", "neoprene"].some((material) => productText.includes(material))) value -= 3200;
      if (requestedMaterials.includes("latex") && /\blatex[- ]?free\b/.test(productText)) value -= 3200;
    }

    if (requestedSize) {
      const listedSize = fields.match(/\b(?:x[- ]?small|small|medium|large|x[- ]?large)\b/)?.[0] ||
        fields.match(/\b(?:size|taille)\s*:?\s*(xs|s|m|l|xl)\b/)?.[1] ||
        fields.match(/(?:^|[\s,])(?:xs|xl|m|l)(?=[\s,\-]|$)/)?.[0].trim();
      const normalizedListedSize = listedSize?.replace(/[- ]/g, "").replace(/^xs$/, "xsmall").replace(/^s$/, "small").replace(/^m$/, "medium").replace(/^l$/, "large").replace(/^xl$/, "xlarge");
      if (normalizedListedSize === requestedSize) value += 1600;
      else if (normalizedListedSize) value -= 1800;
      else value -= 600;
    }

    if (gloveQuery) {
      if (/\bgloves?\b/.test(productText)) value += 800;
      else value -= 1200;
    }

    if (gauzeQuery) {
      if (/\b(?:gauze|sponges?)\b/.test(productText)) value += 1800;
      else value -= 1800;
    }

    if (syringeQuery && !explicitAccessory && !explicitSyringeSpecialty && !explicitSyringeRelationship) {
      if (/\bsyring(?:e|es)\b/.test(title) || /\bsyring(?:e|es)\b/.test(parent)) value += 700;
      if (/\b(?:with|attached|exchangeable|blunt\s+fill)\s+needles?\b|\bcannula\b/.test(title)) value -= 1800;
      if (/\b(?:bulb|oral|insulin|irrigation|flush|prefilled|ear\s*\/\s*ulcer)\b/.test(title)) value -= 1000;
    }

    if (needleQuery && !syringeQuery && !explicitAccessory) {
      if (/\bneedles?\b/.test(title) || /\bneedles?\b/.test(parent)) value += 1100;
      if (/\bsyring(?:e|es)\b/.test(title) && !/\bneedles?\b/.test(title)) value -= 1800;
    }

    return value;
  };

  return [...hits].sort((a, b) => score(b) - score(a));
}

export function applyPinnedAwareFastAttributeRanking(hits: any[] = [], originalQuery: string, pinnedSkus: string[] = []) {
  if (!pinnedSkus.length) return applyFastAttributeRanking(hits, originalQuery);
  const pinned = new Set(pinnedSkus.map((sku) => String(sku).toLowerCase()));
  const isPinned = (hit: any) => {
    const sku = String(hit.document?.sku || "").toLowerCase();
    const allSkus = Array.isArray(hit.document?.all_skus)
      ? hit.document.all_skus.map((value: unknown) => String(value).toLowerCase())
      : [];
    return pinned.has(sku) || allSkus.some((value: string) => pinned.has(value));
  };
  const pinnedHits = hits.filter(isPinned);
  const otherHits = hits.filter((hit) => !isPinned(hit));
  const hasSpecificAttribute = /\b(?:x[- ]?small|small|medium|large|x[- ]?large|\d+(?:\.\d+)?\s*(?:ml|cc|fr|french)|latex|nitrile|vinyl|neoprene|\d+(?:\.\d+)?\s*(?:x|×)\s*\d+(?:\.\d+)?|\d{1,2}\s*(?:g|ga|gauge)|(?:size|taille)\s*#?\s*\d+(?:\.\d+)?)\b/i.test(originalQuery);
  const rankedPinnedHits = applyFastAttributeRanking(pinnedHits, originalQuery);
  return [
    ...(hasSpecificAttribute ? rankedPinnedHits : applyPinnedSkuListRanking(rankedPinnedHits, pinnedSkus)),
    ...applyFastAttributeRanking(otherHits, originalQuery),
  ];
}

export function applyPinnedSkuListRanking(hits: any[] = [], pinnedSkus: string[] = []) {
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
      if (rank >= 0) return pinned.length + rank;
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

export function applyBrandQueryRanking(hits: any[] = [], originalQuery: string) {
  const normalizedQuery = normalizeSearchText(originalQuery);
  if (!hits.length || !normalizedQuery || normalizedQuery === "*") return hits;
  const words = normalizedQuery.split(" ").filter(Boolean);
  if (words.length > 3 || normalizedQuery.length > 40) return hits;

  const brandScore = (hit: any) => {
    const brand = normalizeSearchText(String(hit.document?.brand || ""));
    if (!brand) return 0;
    if (brand === normalizedQuery) return 3;
    if (brand.startsWith(normalizedQuery)) return 2;
    if (brand.includes(normalizedQuery)) return 1;
    return 0;
  };

  return [...hits].sort((a, b) => brandScore(b) - brandScore(a));
}

function docText(hit: any) {
  const doc = hit.document || {};
  return normalizeSearchText([
    doc.name,
    doc.parent_name,
    doc.brand,
    doc.sold_by,
    Array.isArray(doc.categories) ? doc.categories.join(" ") : doc.categories,
    doc.variant_label,
    doc.option_text,
    doc.search_text,
  ].filter(Boolean).join(" "));
}

function docNameText(hit: any) {
  const doc = hit.document || {};
  return normalizeSearchText([
    doc.name,
    doc.parent_name,
    doc.variant_label,
    doc.option_text,
  ].filter(Boolean).join(" "));
}

function docProductTitleText(hit: any) {
  const doc = hit.document || {};
  return normalizeSearchText([
    doc.name,
    doc.parent_name,
    doc.brand,
  ].filter(Boolean).join(" "));
}

function docCategories(hit: any) {
  const categories = hit.document?.categories;
  const values = Array.isArray(categories) ? categories : [categories];
  return values.map((value) => normalizeSearchText(String(value || ""))).filter(Boolean);
}

function singularCategoryPhrase(value: string) {
  return value.endsWith("s") && value.length > 3 ? value.slice(0, -1) : value;
}

function categoryPhraseScore(hit: any, originalQuery: string, searchQuery: string) {
  const queries = Array.from(
    new Set(
      [originalQuery, searchQuery]
        .map((value) => normalizeSearchText(value))
        .filter((value) => value && value !== "*" && value.length >= 3)
    )
  );
  if (!queries.length) return 0;

  let score = 0;
  for (const category of docCategories(hit)) {
    const categorySingular = singularCategoryPhrase(category);
    for (const query of queries) {
      const querySingular = singularCategoryPhrase(query);
      if (category === query || categorySingular === querySingular) score = Math.max(score, 95);
      else if (query.length >= 5 && (category.includes(query) || query.includes(category) || categorySingular.includes(querySingular) || querySingular.includes(categorySingular))) score = Math.max(score, 55);
    }
  }
  return score;
}

function originalNamePhraseScore(nameText: string, originalQuery: string) {
  const normalized = normalizeSearchText(originalQuery);
  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);

  if (tokens.length < 2) return 0;
  if (` ${nameText} `.includes(` ${normalized} `)) return 900;

  const matchingTokens = tokens.filter((token) => new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(nameText));
  if (matchingTokens.length === tokens.length) return 560;
  if (tokens.length >= 3 && matchingTokens.length >= tokens.length - 1) return 260;
  if (matchingTokens.length >= 2) return 90;
  return 0;
}

const exactTermStopWords = new Set([
  "a", "an", "and", "are", "for", "from", "in", "is", "of", "on", "or", "the", "to", "with",
  "at", "by", "can", "do", "find", "get", "have", "i", "me", "need", "please", "show", "want",
  "without", "pour", "avec", "dans", "des", "les", "ou", "une", "un", "je", "cherche", "mon", "ma",
]);

function singularSearchTerm(value: string) {
  if (value.endsWith("ies") && value.length > 4) return `${value.slice(0, -3)}y`;
  if (value.endsWith("s") && value.length > 3) return value.slice(0, -1);
  return value;
}

function hasExactTitleTerm(titleText: string, term: string) {
  const variants = Array.from(new Set([term, singularSearchTerm(term)]));
  return variants.some((variant) => hasAnyWholeWord(titleText, [variant]));
}

function exactRequestedTermScore(nameText: string, originalQuery: string) {
  const normalized = normalizeSearchText(originalQuery);
  if (!normalized || normalized === "*") return 0;

  const terms = Array.from(new Set(normalized.split(" ").filter((term) =>
    term.length >= 3 && /[a-z]/.test(term) && !exactTermStopWords.has(term)
  )));
  if (!terms.length || terms.length > 6) return 0;

  const matchingTerms = terms.filter((term) => hasExactTitleTerm(nameText, term));
  if (!matchingTerms.length) return 0;

  // This is intentionally based on the customer's original words, not the
  // expanded/translated query. Related products still remain eligible, but a
  // product explicitly named for the requested term wins the tie-break.
  if (matchingTerms.length === terms.length) return 1050 + matchingTerms.length * 80;
  return matchingTerms.length * 620;
}

function focusedProductPhraseScore(hit: any, originalQuery: string, isAccessoryQuery: boolean) {
  const normalized = normalizeSearchText(originalQuery);
  if (!normalized || normalized === "*") return 0;
  if (/\b(supplies|supply|stuff|things|equipment|products|items|fournitures|materiel|matériel)\b/.test(normalized)) return 0;

  const tokens = normalized
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !["for", "the", "and", "with", "pour", "les", "des", "avec"].includes(token));
  if (tokens.length < 2) return 0;

  const titleText = ` ${docProductTitleText(hit)} `;
  const fullText = ` ${docText(hit)} `;
  const allInTitle = tokens.every((token) => new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(titleText));
  const allInText = tokens.every((token) => new RegExp(`(^|\\s)${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(fullText));
  const accessoryTitleTerms = [
    "accessory",
    "accessories",
    "replacement",
    "replacement part",
    "refill",
    "refill fluid",
    "fluid",
    "gel",
    "part",
    "parts",
    "mount",
    "bracket",
    "adapter",
    "battery",
    "charger",
    "cable",
    "leadwire",
    "lead wire",
    "electrode",
    "electrodes",
    "paper",
    "recording paper",
    "carrying bag",
    "software",
    "viewer",
    "probe",
    "sensor",
  ];
  const accessoryTitle = hasAny(titleText, accessoryTitleTerms);

  let score = 0;
  if (allInTitle) score += 680;
  else if (allInText) score += 180;
  if (!isAccessoryQuery && accessoryTitle) score -= 900;
  return score;
}

function hasAny(text: string, terms: string[]) {
  const looseText = text.replace(/[./-]/g, " ");
  return terms.some((term) => {
    const normalizedTerm = normalizeSearchText(term);
    if (!normalizedTerm) return false;
    return text.includes(normalizedTerm) || looseText.includes(normalizedTerm.replace(/[./-]/g, " "));
  });
}

function hasAnyWholeWord(text: string, terms: string[]) {
  return terms.some((term) => {
    const normalized = normalizeSearchText(term);
    if (!normalized) return false;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(text);
  });
}

const accessoryTerms = [
  "pad",
  "pads",
  "electrode",
  "electrodes",
  "battery",
  "batteries",
  "cabinet",
  "case",
  "bag",
  "cover",
  "trainer",
  "training",
  "accessory",
  "accessories",
  "part",
  "parts",
  "replacement",
  "cuff",
  "cuffs",
  "hose",
  "tube",
  "tubing",
  "cable",
  "cables",
  "lead",
  "leads",
  "leadwire",
  "lead wire",
  "sensor",
  "sensors",
  "probe",
  "probes",
  "spo2",
  "charger",
  "power supply",
  "adapter",
  "connector",
  "filter",
  "filters",
  "paper",
  "roll",
  "refill",
  "cartridge",
  "bracket",
  "mount",
  "shelf",
  "storage",
];

const mainEquipmentDemote = [
  ...accessoryTerms,
  "manual",
  "wall sign",
  "signage",
  "quick reference",
  "reference card",
  "recording paper",
  "printer paper",
  "graph paper",
  "thermal paper",
  "disposable",
  "consumable",
  "consumables",
];

const stretcherUnitTerms = [
  "ambulance cot",
  "transport cot",
  "emergency cot",
  "proflexx ambulance cot",
  "ambulance stretcher",
  "transport stretcher",
  "scoop stretcher",
  "basket stretcher",
  "folding stretcher",
  "rescue stretcher",
  "pole stretcher",
  "portable stretcher",
  "evacuation stretcher",
  "stretcher",
  "stretchers",
  "litter",
  "35x-nm",
  "35x nm",
  "35x proflexx",
];

const stretcherAccessoryDemote = [
  ...accessoryTerms,
  "accessory",
  "accessories",
  "restraint",
  "restraints",
  "strap",
  "straps",
  "harness",
  "mount",
  "wall mount",
  "ambulance wall mount",
  "wheel cup",
  "wheel cups",
  "cup",
  "cups",
  "handle",
  "handles",
  "handle assembly",
  "assembly kit",
  "kit",
  "replacement",
  "replacement part",
  "mattress",
  "bolster",
  "holder",
  "iv pole",
  "pole holder",
  "platform",
  "instrument platform",
  "fastener",
  "fastening",
  "dressing",
  "dressings",
  "bandage",
  "bandages",
  "wrap",
  "gauze",
  "tourniquet",
  "splint",
  "cold pack",
  "tape",
];

const bagIntentTerms = [
  "medical bag",
  "medical bags",
  "medic bag",
  "medic bags",
  "trauma bag",
  "trauma bags",
  "ems bag",
  "ems bags",
  "emt bag",
  "emt bags",
  "medical backpack",
  "medical backpacks",
  "ems backpack",
  "ems backpacks",
  "trauma backpack",
  "trauma backpacks",
  "medpac",
  "statpack",
  "statpacks",
  "first aid bag",
  "first aid bags",
  "jump bag",
  "jump bags",
  "rescue bag",
  "rescue bags",
  "oxygen bag",
  "oxygen bags",
  "backpack",
  "backpacks",
  "pouch",
  "pouches",
];

const bagDemoteTerms = [
  "sick bag",
  "emesis bag",
  "emesis bags",
  "amniotic sac",
  "amniotic sacs",
  "simulated amniotic",
  "plastic bag",
  "bio bag",
  "bio bags",
  "biohazard bag",
  "autoclavable",
  "specimen bag",
  "cold pack",
  "ice pack",
  "valve",
  "filter",
  "adapter",
  "replacement",
  "receptacle",
  "cushion",
  "catheter",
  "bottle",
  "prep pad",
  "alcohol prep",
  "first aid kit pouch",
  "pad sterile",
];

const firstAidKitTerms = [
  "first aid kit",
  "first aid kits",
  "csa first aid kit",
  "type 1 first aid kit",
  "type 2 first aid kit",
  "type 3 first aid kit",
  "emergency kit",
  "trauma kit",
  "ifak",
  "medical kit",
  "response kit",
  "kit",
];

const firstAidKitDemoteTerms = [
  "bandage",
  "bandages",
  "gauze",
  "sponge",
  "sponges",
  "dressing",
  "dressings",
  "tape",
  "refill",
  "replacement",
  "bottle",
  "pads",
  "pad",
  "wipe",
  "wipes",
  "compress",
  "compresses",
  "tourniquet",
  "splint",
  "accessory",
  "accessories",
];

const patientMonitorUnitTerms = [
  "patient monitor",
  "patient monitors",
  "vital signs monitor",
  "vital sign monitor",
  "vital signs",
  "bedside monitor",
  "spot monitor",
  "multiparameter monitor",
  "multi-parameter monitor",
  "multi parameter monitor",
  "fetal monitor",
  "maternal monitor",
  "fetal & maternal monitor",
  "ecg machine",
  "ekg machine",
  "ecg monitor",
  "ekg monitor",
  "ecg unit",
  "ekg unit",
  "electrocardiograph",
  "electrocardiographs",
  "diagnostic ecg",
  "resting ecg",
  "resting ekg",
  "monitor with printer",
  "edan ecg",
  "edan se",
  "se-1200",
  "se1200",
  "se-1201",
  "se1201",
  "se-1202",
  "se1202",
  "se-301",
  "se301",
  "edan im3",
  "edan m3",
  "edan x",
  "im3",
  "im8",
  "im70",
  "im80",
  "elite v5",
  "connex",
  "propaq",
  "spot vital signs",
  "welch allyn",
  "mindray",
];

const patientMonitorDemoteTerms = [
  ...mainEquipmentDemote,
  "patient alarm",
  "bed alarm",
  "chair alarm",
  "alarm",
  "alarms",
  "pressure-sensitive",
  "pressure sensitive",
  "reset button",
  "replacement",
  "extension tube",
  "adult cuff",
  "child cuff",
  "cuff",
  "cuffs",
  "hose",
  "tube",
  "tubing",
  "leadwire",
  "lead wire",
  "lead wires",
  "sensor",
  "probe",
  "roll stand",
  "stand",
  "ecg monitoring electrode",
  "ekg diagnostic electrode",
  "monitoring electrode",
  "electrode",
  "electrodes",
  "mount",
  "bracket",
  "paper",
  "recording paper",
  "electrode",
  "electrodes",
  "monitoring electrode",
  "diagnostic electrode",
  "resting ekg diagnostic electrode",
  "red dot",
];

const manikinUnitTerms = [
  "cpr manikin",
  "cpr manikins",
  "training manikin",
  "training manikins",
  "simulation manikin",
  "simulation manikins",
  "patient simulator",
  "patient simulators",
  "rescue dummy",
  "rescue dummies",
  "emergency dummy",
  "emergency dummies",
  "water rescue manikin",
  "water rescue manikins",
  "nursing manikin",
  "nursing manikins",
  "medical training manikin",
  "manikin",
  "manikins",
  "mannequin",
  "mannequins",
  "dummy",
  "dummies",
  "resusci anne",
  "prestan",
  "ambu man",
  "little anne",
  "ruth lee",
  "ferno rescue emergency dummy",
  "little baby qcpr",
  "little family qcpr",
  "little junior qcpr",
  "little anne qcpr",
];

const qcprUnitTerms = [
  "little baby qcpr",
  "little family qcpr",
  "little junior qcpr",
  "little anne qcpr",
  "little baby",
  "little family",
  "little junior",
  "little anne",
  "qcpr manikin",
  "qcpr manikins",
  "cpr manikin",
  "cpr manikins",
  "cpr training manikin",
  "resusci anne qcpr",
  "laerdal qcpr",
];

const qcprAccessoryDemoteTerms = [
  "accessory",
  "accessories",
  "parts",
  "part",
  "foreign object",
  "foreign objects",
  "skin",
  "skins",
  "face skin",
  "faces",
  "face",
  "limb",
  "limbs",
  "arm",
  "arms",
  "leg",
  "legs",
  "case",
  "carry case",
  "carrying case",
  "bag",
  "bags",
  "replacement",
  "replaceable",
  "valve",
  "filter",
  "adapter",
  "connectors",
  "connector",
  "airway",
  "airways",
  "lung",
  "lungs",
  "spring",
  "reflector",
  "skillguide",
  "skill guide",
  "upgrade kit",
];

const manikinAccessoryDemoteTerms = [
  "parts and accessories",
  "manikin parts",
  "dummy accessories",
  "accessory",
  "accessories",
  "replacement",
  "replaceable",
  "skin",
  "skins",
  "face skin",
  "lung",
  "lungs",
  "airway",
  "airways",
  "valve",
  "adapter",
  "pads",
  "cartridge",
  "injection site",
  "pericardiocentesis",
  "plug belly",
  "plate",
  "harness",
  "vest",
  "carry bag",
  "carry bags",
  "carrying bag",
  "carrying bags",
  "storage bag",
  "storage bags",
  "taser training vest",
  "arrhythmia simulator",
];

const cprMaskTerms = [
  "cpr mask",
  "cpr masks",
  "cpr pocket mask",
  "pocket mask",
  "pocket masks",
  "cpr pocket ventilator",
  "pocket ventilator",
  "resuscitation mask",
  "resuscitation masks",
  "barrier device",
  "barrier devices",
  "face shield",
  "face shields",
  "masque rcr",
  "masques rcr",
  "rcr mask",
  "rcr masks",
];

const cprMaskDemoteTerms = [
  "smart bag",
  "manual ventilation",
  "bag valve",
  "oxygen reservoir",
  "oxygen tubing",
  "n95",
  "kn95",
  "respirator",
  "respirators",
  "particulate",
  "surgical mask",
  "procedure mask",
  "earloop",
  "tie back",
  "oxygen mask",
  "nebulizer",
];

const oxygenMaskTerms = [
  "oxygen mask",
  "oxygen masks",
  "non-rebreather",
  "non rebreather",
  "non-rebreathing",
  "rebreathing",
  "air soft mask",
  "oxygen therapy mask",
  "aerosol mask",
  "nebulizer mask",
  "medium concentration mask",
  "high concentration mask",
  "mask with tubing",
];

const oxygenMaskDemoteTerms = [
  "n95",
  "kn95",
  "particulate",
  "respirator",
  "respirators",
  "surgical mask",
  "procedure mask",
  "earloop",
  "tie back",
  "box dispenser",
  "dispenser",
  "cpr pocket mask",
  "pocket mask",
  "face shield",
];

const beltTerms = [
  "belt",
  "belts",
  "ceinture",
  "ceintures",
  "gait belt",
  "transfer belt",
  "escape belt",
  "stretcher belt",
  "cot belt",
  "safety belt",
  "seat belt",
  "seatbelt",
];

const beltDemoteTerms = [
  "denture",
  "dentures",
  "denture cup",
  "denture cleanser",
  "denture adhesive",
  "event marker",
  "recording paper",
  "probe",
  "gel",
];

const stairChairTerms = [
  "stair chair",
  "stairchair",
  "stair chairs",
  "stairchairs",
  "carry chair",
  "carry chairs",
  "transcend carry chair",
  "evacuation chair",
  "evac chair",
];

const stairChairDemoteTerms = [
  "accessory",
  "accessories",
  "strap",
  "straps",
  "restraint",
  "restraints",
  "replacement",
  "mount",
  "bracket",
  "track",
  "tread",
  "handle",
  "wheel",
  "wheels",
];

const gloveTerms = [
  "glove",
  "gloves",
  "exam glove",
  "exam gloves",
  "nitrile glove",
  "nitrile gloves",
  "surgical glove",
  "surgical gloves",
  "medical glove",
  "medical gloves",
  "gant",
  "gants",
];

const gloveDemoteTerms = [
  "bag",
  "bags",
  "kit",
  "kits",
  "ob kit",
  "duffel",
  "backpack",
  "tourniquet",
  "mount",
  "walker",
];

const dressingTerms = [
  "wound dressing",
  "wound dressings",
  "dressing",
  "dressings",
  "bandage",
  "bandages",
  "gauze",
  "compress",
  "compresses",
  "pansement",
  "pansements",
];

const dressingDemoteTerms = [
  "walker",
  "knee walker",
  "cane",
  "crutch",
  "wheelchair",
  "mobility",
  "manikin",
  "simulator",
  "bag",
];

const scissorsTerms = [
  "bandage scissor",
  "paramedic scissor",
  "medical scissor",
  "scissors",
  "scissor",
  "medical scissors",
  "bandage scissors",
  "dressing scissors",
  "surgical scissors",
  "operating scissors",
  "shears",
  "ciseaux",
  "ciseau",
  "ciseaux a pansements",
  "ciseaux à pansements",
];

const scissorsDemoteTerms = [
  "bandage",
  "bandages",
  "adhesive bandage",
  "dressing",
  "dressings",
  "elastic adhesive",
  "athletic tape",
  "tape",
  "wrap",
  "ob kit",
  "kit",
  "gauze",
  "compress",
  "compresses",
  "manikin",
  "simulator",
];

const scalpelTerms = [
  "scalpel",
  "scalpels",
  "scalpel blade",
  "scalpel blades",
  "surgical blade",
  "surgical blades",
  "knife",
  "knives",
];

const scalpelDemoteTerms = [
  "trauma trainer",
  "trainer",
  "training",
  "simulator",
  "manikin",
  "dummy",
];

const accessoryIntentRules = [
  {
    match: ["aed", "defib", "defibrillator", "defibrillators", "defibrillateur", "défibrillateur", "dea"],
    accessories: ["pad", "pads", "electrode", "electrodes", "battery", "batteries", "cabinet", "case", "sign", "trainer", "training", "bracket", "mount"],
    demoteMain: ["automated external defibrillator", "defibrillator", "defibrillator kit", "defibrillator kits", "aed kit", "aed kits", "aed 3", "lifepak cr2", "heartstart frx", "heartstart onsite", "powerheart"],
  },
  {
    match: ["dummy", "dummies", "manikin", "manikins", "mannequin", "mannequins", "training manikin", "patient simulator", "qcpr", "q cpr"],
    accessories: ["accessory", "accessories", "part", "parts", "foreign object", "foreign objects", "skin", "face", "case", "limb", "limbs", "arm", "arms", "leg", "legs", "valve", "filter", "pad", "pads", "insert", "inserts"],
    demoteMain: ["cpr manikin", "training manikin", "patient simulator", "rescue dummy", "manikin", "manikins", "mannequin", "mannequins", "little baby qcpr", "little family qcpr", "little anne qcpr", "prestan", "resusci anne"],
  },
  {
    match: ["patient monitor", "patient monitors", "vital signs monitor", "vital sign monitor", "monitor", "monitors"],
    accessories: ["cuff", "cuffs", "hose", "tube", "tubing", "cable", "cables", "lead", "leads", "leadwire", "sensor", "sensors", "probe", "probes", "spo2", "paper", "roll"],
    demoteMain: ["patient monitor", "vital signs monitor", "vital sign monitor", "bedside monitor", "multiparameter monitor"],
  },
];

const explicitAccessoryQueryTerms = [
  ...accessoryTerms,
  "accessory",
  "accessories",
  "paper",
  "pad",
  "pads",
  "part",
  "parts",
  "replacement",
  "recording paper",
  "thermal paper",
  "electrode",
  "electrodes",
  "lead",
  "leads",
  "leadwire",
  "lead wire",
  "cable",
  "cables",
  "bag",
  "carrying bag",
  "case",
  "software",
  "viewer",
  "usb",
  "sentinel",
  "trainer",
  "training",
  "skin",
  "face",
  "valve",
  "filter",
];

export function applyIntentRanking(hits: any[] = [], originalQuery: string, searchQuery = "") {
  const query = normalizeSearchText(`${originalQuery} ${searchQuery}`);
  const originalNormalizedQuery = normalizeSearchText(originalQuery);
  if (!hits.length || !query) return hits;
  const isAccessoryQuery = hasAny(originalNormalizedQuery, explicitAccessoryQueryTerms);
  const activeAccessoryRules = accessoryIntentRules.filter(
    (rule) => hasAny(query, rule.match) && hasAny(originalNormalizedQuery, rule.accessories)
  );

  const intents = [
    {
      match: ["fauteuil roulant", "fauteuils roulants", "wheelchair", "wheelchairs"],
      prefer: ["wheelchairs", "wheelchair", "manual wheelchair", "transport wheelchair"],
      demote: ["seatbelt", "seat belt", "anti-theft", "anti tippers", "anti-tippers", "accessory", "accessories", "cushion", "positioning", "caster", "arm rail", "parts"],
    },
    {
      match: ["aide a la marche", "aides a la marche", "aide à la marche", "aides à la marche", "mobility aids", "walking aids", "marchette", "marchettes", "marcheur", "marcheurs", "marcheuse", "marcheuses", "deambulateur", "déambulateur", "walker", "walkers", "rollator"],
      prefer: ["walker", "walkers", "rollator", "rollators", "cane", "canes", "crutch", "crutches", "mobility aids", "mobility"],
      demote: ["suture", "sleeve", "stops iv", "iv", "needle", "accessory", "accessories", "tips", "glides", "wheels", "parts", "basket"],
    },
    {
      match: ["defibrillateur", "défibrillateur", "defibrillator", "defibrillators", "aed", "dea"],
      prefer: [
        "philips",
        "heartstart",
        "heartstart onsite",
        "heartstart frx",
        "zoll",
        "zoll aed",
        "aed plus",
        "aed 3",
        "physio control",
        "physio-control",
        "lifepak",
        "lifepak cr2",
        "lifepak cr plus",
        "onsite defibrillator",
        "home defibrillator",
        "defibrillator kits",
        "defibrillator",
        "automated external defibrillator",
        "powerheart",
        "heartsine",
        "samaritan",
      ],
      demote: mainEquipmentDemote,
      skipDemote: isAccessoryQuery,
    },
    {
      match: [
        "ecg",
        "ekg",
        "ecg machine",
        "ekg machine",
        "ecg monitor",
        "ekg monitor",
        "edan ecg",
        "edan machine",
        "electrocardiograph",
        "electrocardiographs",
        "diagnostic ecg",
        "resting ecg",
        "resting ekg",
      ],
      prefer: patientMonitorUnitTerms,
      preferStrong: [
        "ecg machine",
        "ekg machine",
        "ecg monitor",
        "ekg monitor",
        "electrocardiograph",
        "diagnostic ecg",
        "resting ecg",
        "resting ekg",
        "edan ecg",
        "edan se",
        "se-1200",
        "se1200",
        "se-1201",
        "se1201",
        "se-1202",
        "se1202",
        "se-301",
        "se301",
        "patient monitor",
        "vital signs monitor",
        "vital sign monitor",
      ],
      demote: patientMonitorDemoteTerms,
      demoteStrong: [
        "accessory",
        "accessories",
        "carrying bag",
        "bag",
        "software",
        "viewer",
        "usb",
        "sentinel",
        "electrode",
        "electrodes",
        "leadwire",
        "lead wire",
        "lead wires",
        "cable",
        "cables",
        "paper",
        "recording paper",
        "thermal paper",
        "roll",
        "adapter",
        "battery",
        "cart",
        "mount",
        "bracket",
      ],
      skipDemote: isAccessoryQuery,
    },
    {
      match: [
        "patient monitor",
        "patient monitors",
        "patient monitoring",
        "vital signs monitor",
        "vital sign monitor",
        "vitals monitor",
        "ecg monitor",
        "ekg monitor",
        "medical monitor",
        "medical monitors",
        "monitor",
        "monitors",
        "moniteur patient",
        "moniteurs patient",
        "moniteur de patient",
        "moniteurs de patient",
        "moniteur de signes vitaux",
        "moniteurs de signes vitaux",
      ],
      prefer: patientMonitorUnitTerms,
      preferStrong: ["patient monitor", "vital signs monitor", "vital sign monitor", "bedside monitor", "spot monitor", "multiparameter monitor", "multi-parameter monitor", "fetal monitor", "maternal monitor", "edan im3", "im3", "im8", "im70", "im80", "elite v5", "connex", "propaq"],
      demote: patientMonitorDemoteTerms,
      demoteStrong: ["patient alarm", "bed alarm", "chair alarm", "alarm", "alarms", "pressure-sensitive", "pressure sensitive", "replacement", "extension tube", "adult cuff", "child cuff", "cuff", "cuffs", "hose", "tube", "tubing", "leadwire", "lead wire", "sensor", "probe", "paper", "stand", "mount", "bracket"],
      skipDemote: isAccessoryQuery,
    },
    {
      match: ["first aid kit", "first aid kits", "trousse de premiers soins", "trousses de premiers soins", "trousse de premiers secours", "trousses de premiers secours", "trousse premiers soins", "trousses premiers soins", "trousse premiers secours", "trousses premiers secours"],
      prefer: firstAidKitTerms,
      preferStrong: ["first aid kit", "first aid kits", "csa first aid kit", "type 1 first aid kit", "type 2 first aid kit", "type 3 first aid kit", "emergency kit", "trauma kit", "medical kit", "ifak"],
      demote: firstAidKitDemoteTerms,
      demoteStrong: firstAidKitDemoteTerms,
    },
    {
      match: ["medical bag", "medical bags", "medic bag", "medic bags", "trauma bag", "trauma bags", "ems bag", "emt bag", "first aid bag", "first aid bags", "jump bag", "jump bags", "rescue bag", "rescue bags", "sac medical", "sac médical", "sacs medicaux", "sacs médicaux"],
      prefer: bagIntentTerms,
      preferStrong: ["medical bag", "medical bags", "first aid bag", "first aid bags", "trauma bag", "trauma bags", "ems bag", "emt bag", "jump bag", "jump bags", "rescue bag", "rescue bags", "oxygen bag", "oxygen bags", "backpack", "pouch"],
      demote: bagDemoteTerms,
      demoteStrong: bagDemoteTerms,
    },
    {
      match: ["soin des plaies", "soins des plaies", "soins de plaies", "traitement des plaies", "wound care", "wound dressing", "wound dressings", "bandaid", "bandaids", "band aid", "band aids", "band-aid", "band-aids", "bandage", "bandages"],
      prefer: ["wound care", "wound dressing", "wound dressings", "dressings", "gauze", "bandage", "bandages"],
      demote: ["manikin", "manikins", "training", "trainer", "simulator", "skin", "cpr", "torso"],
    },
    {
      match: ["brancard", "brancards", "civiere", "civière", "stretchers", "stretcher", "scoop stretcher", "transport stretcher", "ambulance stretcher"],
      prefer: stretcherUnitTerms,
      preferStrong: ["ambulance cot", "proflexx ambulance cot", "35x-nm", "35x nm", "35x proflexx", "scoop stretcher", "basket stretcher", "folding stretcher", "transport stretcher", "ambulance stretcher", "rescue stretcher"],
      demote: stretcherAccessoryDemote,
      demoteStrong: ["accessory", "accessories", "restraint", "restraints", "strap", "straps", "harness", "mount", "wall mount", "ambulance wall mount", "wheel cup", "handle assembly", "assembly kit", "replacement", "replacement part", "mattress", "bolster", "holder", "iv pole", "platform", "instrument platform"],
    },
    {
      match: ["qcpr", "q cpr", "little baby qcpr", "little family qcpr", "little junior qcpr", "little anne qcpr"],
      prefer: qcprUnitTerms,
      preferStrong: ["little baby qcpr", "little family qcpr", "little junior qcpr", "little anne qcpr", "qcpr manikin", "laerdal qcpr"],
      demote: qcprAccessoryDemoteTerms,
      demoteStrong: qcprAccessoryDemoteTerms,
    },
    {
      match: ["mannequin de cpr", "mannequin cpr", "mannequin de rcr", "mannequin rcr", "cpr manikin", "cpr manikins", "rcr"],
      prefer: ["ruth lee cpr manikin", "resusci anne", "cpr manikin", "cpr manikins", "cpr training manikin", "manikins", "nursing manikins", "medical training"],
      demote: ["valve", "adapter", "pads", "cartridge", "replacement", "injection site", "pericardiocentesis", "parts", "accessories", "plug belly", "plate", "skin", "arrhythmia simulator"],
    },
    {
      match: ["dummy", "dummies", "manikin", "manikins", "mannequin", "mannequins", "training manikin", "training manikins", "patient simulator", "patient simulators"],
      prefer: manikinUnitTerms,
      preferStrong: ["cpr manikin", "training manikin", "patient simulator", "rescue dummy", "emergency dummy", "water rescue manikin", "nursing manikin", "ferno rescue emergency dummy", "prestan", "resusci anne"],
      demote: manikinAccessoryDemoteTerms,
      demoteStrong: manikinAccessoryDemoteTerms,
    },
    {
      match: ["oxygen mask", "oxygen masks", "masque oxygene", "masque oxygène", "masque d oxygene", "masque d’oxygène", "masques oxygene", "masques oxygène"],
      prefer: oxygenMaskTerms,
      preferStrong: ["oxygen mask", "oxygen masks", "non-rebreather", "non rebreather", "high concentration", "medium concentration"],
      demote: oxygenMaskDemoteTerms,
      demoteStrong: oxygenMaskDemoteTerms,
    },
    {
      match: ["cpr mask", "cpr masks", "masque rcr", "masques rcr", "rcr mask", "rcr masks"],
      prefer: cprMaskTerms,
      preferStrong: ["cpr pocket mask", "cpr pocket ventilator", "pocket mask", "pocket ventilator", "resuscitation mask", "barrier device"],
      demote: cprMaskDemoteTerms,
      demoteStrong: cprMaskDemoteTerms,
    },
    {
      match: ["ceinture", "ceintures", "belt", "belts"],
      prefer: beltTerms,
      preferStrong: ["gait belt", "transfer belt", "escape belt", "stretcher belt", "cot belt", "safety belt", "seat belt", "seatbelt"],
      demote: beltDemoteTerms,
      demoteStrong: beltDemoteTerms,
    },
    {
      match: ["stair chair", "stairchair", "stair chairs", "stairchairs"],
      prefer: stairChairTerms,
      preferStrong: ["stair chair", "stairchair", "carry chair", "transcend carry chair", "evacuation chair"],
      demote: stairChairDemoteTerms,
      demoteStrong: stairChairDemoteTerms,
    },
    {
      match: ["glove", "gloves", "gant", "gants"],
      prefer: gloveTerms,
      preferStrong: ["exam glove", "exam gloves", "nitrile glove", "nitrile gloves", "surgical glove", "surgical gloves", "medical glove", "medical gloves"],
      demote: gloveDemoteTerms,
      demoteStrong: gloveDemoteTerms,
    },
    {
      match: ["bandaid", "bandaids", "band aid", "band aids", "band-aid", "band-aids", "bandage", "bandages", "pansement", "pansements", "wound dressing", "wound dressings", "dressing", "dressings"],
      prefer: dressingTerms,
      preferStrong: ["wound dressing", "wound dressings", "dressing", "dressings", "bandage", "bandages", "gauze"],
      demote: dressingDemoteTerms,
      demoteStrong: dressingDemoteTerms,
    },
    {
      match: ["scalpel", "scalpels", "knife", "knives"],
      prefer: scalpelTerms,
      preferStrong: ["scalpel", "scalpels", "scalpel blade", "scalpel blades", "surgical blade", "surgical blades"],
      demote: scalpelDemoteTerms,
      demoteStrong: scalpelDemoteTerms,
    },
    {
      match: ["fournitures pour perfusion intraveineuse", "fournitures intraveineuses", "materiel intraveineux", "matériel intraveineux", "iv supplies", "iv administration", "iv solution", "iv catheter", "intravenous"],
      prefer: ["iv administration", "iv catheters", "iv catheter", "iv solution", "intravenous", "nexiva", "vacutainer", "sodium chloride", "saline"],
      demote: ["training", "trainer", "simulation", "furniture", "furnishings", "dresser", "bookcase", "cabinet", "drawer"],
    },
  ];

  const active = intents.filter((intent) => hasAny(query, intent.match));

  const scoreHit = (hit: any) => {
    const text = ` ${docText(hit)} `;
    const nameText = ` ${docNameText(hit)} `;
    const categoryText = ` ${docCategories(hit).join(" ")} `;
    let intentScore = categoryPhraseScore(hit, originalQuery, searchQuery);
    intentScore += originalNamePhraseScore(nameText, originalQuery);
    intentScore += exactRequestedTermScore(nameText, originalQuery);
    intentScore += focusedProductPhraseScore(hit, originalQuery, isAccessoryQuery);
    const textScore = Number(hit.text_match || hit._text_match || 0);
    const isFirstAidKitQuery = hasAny(query, ["first aid kit", "first aid kits", "trousse de premiers soins", "trousses de premiers soins", "trousse de premiers secours", "trousses de premiers secours", "trousse premiers soins", "trousses premiers soins", "trousse premiers secours", "trousses premiers secours"]);
    if (isFirstAidKitQuery) {
      const nameLooksLikeKit = hasAny(nameText, firstAidKitTerms);
      const nameLooksLikeLooseSupply = hasAny(nameText, firstAidKitDemoteTerms);
      if (nameLooksLikeKit && !nameLooksLikeLooseSupply) intentScore += 320;
      else if (nameLooksLikeKit) intentScore += 160;
      else intentScore -= 420;
    }
    const isMedicalBagQuery = hasAny(query, ["medical bag", "medical bags", "medic bag", "medic bags", "trauma bag", "trauma bags", "ems bag", "emt bag", "first aid bag", "first aid bags", "jump bag", "jump bags", "rescue bag", "rescue bags", "sac medical", "sac médical", "sacs medicaux", "sacs médicaux"]);
    if (isMedicalBagQuery) {
      const inMedicalBags = categoryText.includes(" medical bags ");
      const namedLikeBag = hasAny(nameText, bagIntentTerms);
      const namedCoreBag = hasAny(nameText, [
        "medical bag", "medical bags", "medic bag", "medic bags", "trauma bag", "trauma bags",
        "ems bag", "ems bags", "emt bag", "emt bags", "jump bag", "jump bags", "rescue bag", "rescue bags",
        "medical backpack", "medical backpacks", "ems backpack", "ems backpacks", "trauma backpack", "trauma backpacks",
        "medpac", "statpack", "statpacks",
      ]);
      const namedWeakContainer = hasAny(nameText, ["pouch", "pouches", "case", "cases", "pack", "packs"]);
      if (namedCoreBag) intentScore += 520;
      else if (inMedicalBags) intentScore += 220;
      else if (namedLikeBag) intentScore += 120;
      else intentScore -= 500;
      if (namedWeakContainer && !namedCoreBag && !inMedicalBags) intentScore -= 220;
      if (hasAny(nameText, bagDemoteTerms)) intentScore -= 420;
    }
    const isPatientMonitorQuery = hasAny(query, ["patient monitor", "patient monitors", "patient monitoring", "vital signs monitor", "vital sign monitor", "vitals monitor", "moniteur patient", "moniteur de patient", "moniteur de signes vitaux"]);
    if (isPatientMonitorQuery) {
      const monitorAccessoryName = hasAny(nameText, [
        "accessory", "accessories", "cuff", "cuffs", "electrode", "electrodes", "leadwire", "lead wire", "lead wires",
        "paper", "recording paper", "alarm", "alarms", "sensor", "probe", "hose", "tube", "tubing", "mount", "bracket", "stand", "station", "stations", "central monitoring", "monitoring station",
      ]);
      const monitorUnitName = hasAny(nameText, [
        "patient monitor", "patient monitors", "vital signs monitor", "vital sign monitor", "bedside monitor", "spot monitor",
        "multiparameter monitor", "multi-parameter monitor", "multi parameter monitor", "fetal monitor", "maternal monitor",
        "edan ix series monitors", "monitors with touchscreen", "m3 vital signs", "m3a vital signs", "im3s edan", "edan im3", "edan im60", "edan x12", "connex spot", "spot vital sign", "holter", "fetal monitor", "co-oximeter", "pulse oximeter",
      ]);
      if (monitorUnitName && !monitorAccessoryName) intentScore += 520;
      else if (hasAny(nameText, patientMonitorUnitTerms)) intentScore += 180;
      if (monitorAccessoryName || hasAny(nameText, patientMonitorDemoteTerms)) intentScore -= 620;
    }
    const isEcgEquipmentQuery = hasAny(query, ["ecg", "ekg", "ecg machine", "ekg machine", "edan machine", "edan ecg", "electrocardiograph"]);
    if (isEcgEquipmentQuery && !isAccessoryQuery) {
      const ecgAccessoryName = hasAny(nameText, [
        "accessory", "accessories", "carrying bag", "bag", "software", "viewer", "usb", "sentinel",
        "electrode", "electrodes", "leadwire", "lead wire", "lead wires", "lead", "leads", "cable", "cables",
        "paper", "recording paper", "thermal paper", "roll", "adapter", "battery", "cart", "mount", "bracket",
      ]);
      const ecgUnitName = hasAny(nameText, [
        "ecg machine", "ekg machine", "ecg monitor", "ekg monitor", "electrocardiograph", "diagnostic ecg",
        "resting ecg", "resting ekg", "edan ecg", "edan se", "se-1200", "se1200", "se-1201", "se1201", "se-1202", "se1202", "se-301", "se301",
        "patient monitor", "vital signs monitor", "vital sign monitor", "bedside monitor", "multiparameter monitor",
      ]);
      const ecgUnitIndexed = hasAny(text, [
        "ecg machine", "ekg machine", "ecg monitor", "ekg monitor", "electrocardiograph", "diagnostic ecg",
        "heart rate monitoring", "cardiac monitoring", "vital signs monitor", "patient monitor",
      ]);
      if (ecgUnitName && !ecgAccessoryName) intentScore += 900;
      else if (ecgUnitIndexed && !ecgAccessoryName) intentScore += 420;
      if (ecgAccessoryName) intentScore -= 900;
    }
    const isOximeterQuery = hasAny(query, ["oximeter", "oximeters", "oxymeter", "oxymeters", "pulse oximeter", "pulse ox", "spo2 monitor", "oximetre", "oximètre", "saturometre", "saturomètre"]);
    if (isOximeterQuery && !isAccessoryQuery) {
      const oximeterUnit = hasAny(nameText, ["pulse oximeter", "pulse ox", "finger pulse oximeter", "fingertip pulse oximeter", "spo2 monitor", "co-oximeter", "oximeter"]);
      const oximeterAccessory = hasAny(nameText, ["accessory", "accessories", "sensor", "sensors", "probe", "probes", "cable", "extension cable", "adapter", "battery"]);
      if (oximeterUnit && !oximeterAccessory) intentScore += 560;
      if (oximeterAccessory) intentScore -= 760;
    }
    const isCannulaQuery = hasAny(query, ["nasal cannula", "nasal canula", "oxygen cannula", "canule nasale", "line onner cannula", "liner cannula"]);
    if (isCannulaQuery) {
      const cannulaName = hasAny(nameText, ["nasal cannula", "oxygen nasal cannula", "oxygen cannula", "cannula"]);
      if (cannulaName) intentScore += 520;
      else intentScore -= 420;
    }
    const isBluePhantomQuery = hasAny(query, ["blue phantom"]);
    if (isBluePhantomQuery && !isAccessoryQuery) {
      const bluePhantomName = hasAny(nameText, ["blue phantom"]);
      const refillName = hasAny(nameText, ["refill", "refill fluid", "fluid", "gel"]);
      const modelName = hasAny(nameText, ["branched", "vessel", "model", "models", "phantom"]);
      if (bluePhantomName && modelName && !refillName) intentScore += 760;
      else if (bluePhantomName && !refillName) intentScore += 420;
      if (refillName) intentScore -= 900;
    }
    const isQcprQuery = hasAny(query, ["qcpr", "q cpr"]);
    const isQcprPartsQuery = hasAny(originalNormalizedQuery, ["accessory", "accessories", "part", "parts", "foreign object", "foreign objects", "skin", "face", "case", "limb", "limbs", "arm", "arms", "leg", "legs", "valve", "filter"]);
    if (isQcprQuery && !isQcprPartsQuery) {
      const nameLooksLikeQcprUnit = hasAny(nameText, qcprUnitTerms);
      const nameLooksLikeQcprAccessory = hasAny(nameText, qcprAccessoryDemoteTerms);
      if (nameLooksLikeQcprUnit && !nameLooksLikeQcprAccessory) intentScore += 520;
      else if (nameLooksLikeQcprUnit) intentScore += 160;
      if (nameLooksLikeQcprAccessory) intentScore -= 520;
    }
    const isManikinQuery = hasAny(query, ["dummy", "dummies", "manikin", "manikins", "mannequin", "mannequins", "training manikin", "patient simulator", "qcpr", "q cpr"]);
    if (isManikinQuery) {
      const isManikinAccessoryQuery = hasAny(originalNormalizedQuery, ["accessory", "accessories", "part", "parts", "foreign object", "foreign objects", "skin", "face", "case", "limb", "limbs", "arm", "arms", "leg", "legs", "valve", "filter", "pad", "pads", "insert", "inserts"]);
      const nameLooksLikeUnit = hasAny(nameText, manikinUnitTerms);
      const nameLooksLikeAccessory = hasAny(nameText, manikinAccessoryDemoteTerms);
      const categoryLooksLikeTraining = categoryText.includes(" medical training ") || categoryText.includes(" manikins ");
      if (isManikinAccessoryQuery) {
        if (nameLooksLikeAccessory) intentScore += 620;
        if (nameLooksLikeUnit && !nameLooksLikeAccessory) intentScore -= 520;
      } else {
        if ((nameLooksLikeUnit || categoryLooksLikeTraining) && !nameLooksLikeAccessory) intentScore += 280;
        else if (nameLooksLikeUnit) intentScore += 90;
        if (nameLooksLikeAccessory) intentScore -= 340;
      }
    }
    const isCprMaskQuery = hasAny(originalNormalizedQuery, ["cpr mask", "cpr masks", "masque rcr", "masques rcr", "rcr mask", "rcr masks"]);
    if (isCprMaskQuery) {
      const nameLooksLikeCprMask = hasAny(nameText, cprMaskTerms);
      if (hasAny(nameText, ["cpr pocket mask", "pocket mask", "cpr pocket ventilator", "pocket ventilator"])) intentScore += 860;
      else if (nameLooksLikeCprMask) intentScore += 520;
      else intentScore -= 680;
      if (hasAny(nameText, cprMaskDemoteTerms)) intentScore -= 360;
    }
    const isOxygenMaskQuery = hasAny(originalNormalizedQuery, ["oxygen mask", "oxygen masks", "masque oxygene", "masque oxygène", "masque d oxygene", "masque d’oxygène", "masques oxygene", "masques oxygène"]);
    if (isOxygenMaskQuery) {
      const nameLooksLikeOxygenMask = hasAny(nameText, oxygenMaskTerms) || categoryText.includes(" oxygen masks ");
      if (nameLooksLikeOxygenMask) intentScore += 460;
      else intentScore -= 560;
      if (hasAny(nameText, oxygenMaskDemoteTerms)) intentScore -= 380;
    }
    const isBvmQuery = hasAny(originalNormalizedQuery, ["bag valve mask", "bag valve masks", "bvm", "ambu bag", "sac ambu", "ballon masque", "ballon autoremplisseur"]);
    if (isBvmQuery) {
      const nameLooksLikeBvm = hasAny(nameText, ["bag valve mask", "bag valve masks", "bvm", "manual resuscitator", "resuscitator", "ambu bag", "smart bag", "manual ventilation"]);
      const nameLooksLikeGenericMask = hasAny(nameText, ["n95", "kn95", "procedure mask", "surgical mask", "face mask", "paper face mask", "earloop", "oxygen mask", "aerosol mask", "nebulizer mask"]);
      if (nameLooksLikeBvm) intentScore += 900;
      else intentScore -= 700;
      if (nameLooksLikeGenericMask) intentScore -= 900;
    }
    const isBloodPressureCuffQuery = hasAny(originalNormalizedQuery, ["blood pressure cuff", "bp cuff", "brassard", "brassard de tension"]);
    if (isBloodPressureCuffQuery && !isAccessoryQuery) {
      const nameLooksLikeBpCuff = hasAny(nameText, ["blood pressure cuff", "bp cuff", "sphygmomanometer", "adult cuff", "child cuff"]);
      const nameLooksLikeTrainingOrReplacement = hasAny(nameText, ["training", "trainer", "replacement", "manikin", "simulator", "assembly"]);
      if (nameLooksLikeBpCuff && !nameLooksLikeTrainingOrReplacement) intentScore += 520;
      else if (nameLooksLikeBpCuff) intentScore += 120;
      if (nameLooksLikeTrainingOrReplacement) intentScore -= 520;
    }
    const isBeltQuery = hasAny(query, ["ceinture", "ceintures", "belt", "belts"]);
    if (isBeltQuery) {
      const nameLooksLikeBelt = hasAny(nameText, beltTerms);
      if (nameLooksLikeBelt) intentScore += 240;
      else intentScore -= 520;
      if (hasAny(nameText, beltDemoteTerms)) intentScore -= 360;
    }
    const isStairChairQuery = hasAny(query, ["stair chair", "stairchair", "stair chairs", "stairchairs"]);
    if (isStairChairQuery) {
      const nameLooksLikeStairChair = hasAny(nameText, stairChairTerms);
      const nameLooksLikeStairAccessory = hasAny(nameText, stairChairDemoteTerms);
      if (nameLooksLikeStairChair && !nameLooksLikeStairAccessory) intentScore += 300;
      else if (nameLooksLikeStairChair) intentScore += 80;
      if (nameLooksLikeStairAccessory) intentScore -= 220;
    }
    const isGloveQuery = hasAny(query, ["glove", "gloves", "gant", "gants"]);
    if (isGloveQuery) {
      const nameLooksLikeGlove = hasAny(nameText, gloveTerms);
      if (nameLooksLikeGlove) intentScore += 420;
      else intentScore -= 620;
      if (hasAny(nameText, gloveDemoteTerms)) intentScore -= 420;
    }
    const isScissorsQuery = hasAny(originalNormalizedQuery, ["scissors", "scissor", "ciseaux", "ciseau", "ciseaux a pansements", "ciseaux à pansements", "medical scissors", "bandage scissors", "dressing scissors"]);
    if (isScissorsQuery) {
      const nameLooksLikeScissors = hasAny(nameText, scissorsTerms);
      if (nameLooksLikeScissors) intentScore += 620;
      else intentScore -= 760;
      if (!nameLooksLikeScissors && hasAny(nameText, scissorsDemoteTerms)) intentScore -= 420;
    }
    const isDressingQuery = !isScissorsQuery && hasAny(originalNormalizedQuery, ["bandaid", "bandaids", "band aid", "band aids", "band-aid", "band-aids", "bandage", "bandages", "pansement", "pansements", "wound dressing", "wound dressings", "dressing", "dressings"]);
    if (isDressingQuery) {
      const nameLooksLikeDressing = hasAny(nameText, dressingTerms);
      const categoryLooksLikeDressing = hasAny(categoryText, ["first aid", "wound care", "bandage", "bandages", "dressing", "dressings", "gauze"]);
      if (nameLooksLikeDressing) intentScore += 520;
      else if (categoryLooksLikeDressing) intentScore += 220;
      else intentScore -= 760;
      if (hasAny(nameText, dressingDemoteTerms)) intentScore -= 380;
    }
    const isScalpelQuery = hasAny(query, ["scalpel", "scalpels", "knife", "knives"]);
    if (isScalpelQuery) {
      const nameLooksLikeScalpel = hasAny(nameText, scalpelTerms);
      if (nameLooksLikeScalpel) intentScore += 360;
      else intentScore -= 560;
      if (hasAny(nameText, scalpelDemoteTerms)) intentScore -= 360;
    }
    for (const rule of activeAccessoryRules) {
      const hasRequestedAccessoryName = hasAnyWholeWord(nameText, rule.accessories);
      const hasRequestedAccessoryText = hasAnyWholeWord(text, rule.accessories);
      if (hasRequestedAccessoryName) intentScore += 900;
      else if (hasRequestedAccessoryText) intentScore += 160;
      if (hasAny(nameText, rule.demoteMain) && !hasRequestedAccessoryName) intentScore -= 900;
    }
    for (const intent of active) {
      if (intent.skipDemote) continue;
      if ("preferStrong" in intent && intent.preferStrong && hasAny(nameText, intent.preferStrong)) intentScore += 35;
      if (hasAny(nameText, intent.prefer)) intentScore += 10;
      if ("demoteStrong" in intent && intent.demoteStrong && hasAny(text, intent.demoteStrong)) intentScore -= 80;
      if (hasAny(text, intent.demote)) intentScore -= 20;
    }
    return { intentScore, textScore };
  };

  return [...hits].sort((a, b) => {
    const aScore = scoreHit(a);
    const bScore = scoreHit(b);
    if (aScore.intentScore !== bScore.intentScore) return bScore.intentScore - aScore.intentScore;
    return bScore.textScore - aScore.textScore;
  });
}

export function explainResult(hit: any, originalQuery: string, controls: SearchOverrides, pinnedSkuOverride?: string[]) {
  const doc = hit.document || {};
  const pinnedSkus = (pinnedSkuOverride || getPinnedSkusForQuery(originalQuery, controls)).map((sku) => sku.toLowerCase());
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
