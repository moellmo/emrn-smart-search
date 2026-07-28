import { applyIntentRanking } from "./search-ranking";
import { normalizeSearchText } from "./search-language";

type SearchHit = { document?: Record<string, unknown>; [key: string]: unknown };

const frenchAliases: Record<string, string[]> = {
  seringue: ["syringe"],
  seringues: ["syringes", "syringe"],
  aiguille: ["needle"],
  aiguilles: ["needles", "needle"],
  cathéter: ["catheter"],
  catheter: ["catheter"],
  gants: ["gloves", "glove"],
  gant: ["glove"],
  pansement: ["dressing", "bandage"],
  pansements: ["dressings", "bandages"],
  stérile: ["sterile"],
  sterile: ["sterile"],
  sécurité: ["safety"],
  securite: ["safety"],
  sans: ["without", "no"],
  avec: ["with"],
  taille: ["size"],
  boîte: ["box"],
  boîtes: ["boxes"],
  remplacement: ["replacement"],
  accessoire: ["accessory"],
  accessoires: ["accessories"],
  grand: ["large"],
  grands: ["large"],
  grande: ["large"],
  grandes: ["large"],
};

const stopWords = new Set([
  "a", "an", "and", "are", "at", "by", "can", "do", "find", "for", "from", "get", "have", "i", "in",
  "is", "me", "need", "of", "on", "or", "please", "show", "the", "to", "want", "with", "without",
  "avec", "dans", "des", "je", "les", "ma", "mon", "ou", "pour", "sans", "une", "un", "avec",
]);

const rolePairs: Array<{ primary: string[]; related: string[] }> = [
  { primary: ["syringe", "syringes", "seringue", "seringues"], related: ["needle", "needles", "aiguille", "aiguilles"] },
  { primary: ["needle", "needles", "aiguille", "aiguilles"], related: ["syringe", "syringes", "seringue", "seringues"] },
  { primary: ["glove", "gloves", "gant", "gants"], related: ["bag", "bags", "kit", "kits"] },
  { primary: ["dressing", "dressings", "bandage", "bandages", "pansement", "pansements"], related: ["walker", "wheelchair", "cane", "crutch"] },
];

const genericAccessoryTerms = [
  "accessory", "accessories", "cannula", "cannulas", "catheter", "catheters",
  "flush", "posiflush", "saline", "irrigation", "prefilled", "kit", "kits", "tray", "trays",
  "training", "trainer", "atomization", "tip", "tips", "pharmacy", "convenience", "pad", "pads",
  "electrode", "electrodes", "battery", "batteries", "cable", "cables", "cuff", "cuffs", "sensor",
  "probe", "lead", "leads", "mount", "bracket", "replacement", "paper", "case",
];

const combinationProductSignals = [
  "with", "attached", "cannula", "atomization", "mucosal", "vial access", "dual cannula",
  "flush", "prefilled", "convenience", "tray", "bundle", "kit", "device",
];

const specialtySyringeSignals = [
  "bulb", "ear/ulcer", "insulin", "oral", "irrigation", "flush", "prefilled", "atomization",
  "vial access", "dual cannula", "convenience", "training",
];

const mainEquipmentTerms = [
  "aed", "defibrillator", "defibrillators", "patient monitor", "patient monitors", "vital signs monitor",
  "monitor", "monitors", "ecg machine", "ekg machine", "wheelchair", "stretcher", "oxygen concentrator",
  "syringe", "syringes", "needle", "needles", "glove", "gloves", "dressing", "dressings",
  "first aid kit", "first aid kits", "csa first aid kit", "manikin", "manikins", "mannequin", "mannequins",
];

const trainingTerms = [
  "training", "trainer", "manikin", "manikins", "mannequin", "mannequins", "simulation", "simulator",
  "simulated", "practice", "practise", "demo", "educational", "student", "dummy", "dummies", "medical training",
  "formation", "entrainement", "entraînement", "pratique", "mannequin", "simulation", "médicament simulé",
];

const manikinTerms = [
  "manikin", "manikins", "mannequin", "mannequins", "qcpr", "crash kelly", "little anne",
  "little baby", "little family", "little junior", "rescue dummy", "patient simulator",
];

const fullManikinSignals = [
  "manikin", "mannequin", "qcpr", "crash kelly", "little anne", "little baby", "little family",
  "little junior", "rescue dummy", "patient simulator", "full body", "torso manikin",
];

const manikinAccessorySignals = [
  "replacement face", "replacement lung", "replacement airway", "replacement skin", "manikin accessory",
  "manikin accessories", "manikin part", "manikin parts", "carry bag", "carrying bag", "face skin",
  "skillguide", "extension cable", "feedback device", "rate monitor", "manikin cable",
  "shirt", "shirts", "vest", "vests", "chest cover", "head assembly", "mouth/nose",
];

const componentSignals = [
  "assembly", "hardware set", "genitalia", "arm assembly", "leg assembly", "reservoir", "neck cradle",
  "replacement", "airway", "lung", "skin", "face", "head assembly", "torso assembly", "part",
];

function textFrom(doc: Record<string, unknown>, keys: string[]) {
  return normalizeSearchText(keys.map((key) => doc[key]).filter(Boolean).join(" "));
}

function words(value: string) {
  return normalizeSearchText(value)
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2 && (/[a-z]/.test(term) || /\d/.test(term)) && !stopWords.has(term));
}

function singular(value: string) {
  if (value.endsWith("ies") && value.length > 4) return `${value.slice(0, -3)}y`;
  if (value.endsWith("s") && value.length > 3) return value.slice(0, -1);
  return value;
}

function aliasesFor(term: string) {
  return Array.from(new Set([term, singular(term), ...(frenchAliases[term] || [])].map(normalizeSearchText).filter(Boolean)));
}

function hasTerm(text: string, term: string) {
  return aliasesFor(term).some((candidate) => new RegExp(`(^|\\s)${candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(text));
}

function phraseIn(text: string, phrase: string) {
  const normalized = normalizeSearchText(phrase);
  return Boolean(normalized) && (` ${text} `.includes(` ${normalized} `) || text.includes(normalized));
}

function specificAttributeTerms(query: string) {
  const normalized = normalizeSearchText(query)
    .replace(/\b(?:grand|grands|grande|grandes)\b/g, "large")
    .replace(/\b(?:petit|petite|petits|petites)\b/g, "small")
    .replace(/\b(?:moyen|moyenne|moyens|moyennes)\b/g, "medium");
  const terms = normalized.match(/\b(?:x[- ]?small|small|medium|large|x[- ]?large|grand|grands|grande|grandes|petit|petite|petits|petites|moyen|moyenne|moyens|moyennes|\d+(?:\.\d+)?\s*(?:ml|cc|g|ga|gauge|mm))\b|\b\d+\s*x\s*\d+\b/g) || [];
  const sizeAliases: Record<string, string> = {
    grand: "large", grands: "large", grande: "large", grandes: "large",
    petit: "small", petite: "small", petits: "small", petites: "small",
    moyen: "medium", moyenne: "medium", moyens: "medium", moyennes: "medium",
  };
  return Array.from(new Set(terms.map((term) => {
    const compact = term.replace(/\s+/g, "").replace(/-/g, "");
    return sizeAliases[compact] || compact;
  })));
}

function hasSpecificAttributeQuery(query: string) {
  return specificAttributeTerms(query).length > 0;
}

function requestedTerms(originalQuery: string, searchQuery: string) {
  const original = words(originalQuery);
  const translated = words(searchQuery).filter((term) => !stopWords.has(term));
  return Array.from(new Set([...original, ...translated.map((term) => singular(term))]));
}

function negativeTerms(originalQuery: string) {
  const normalized = normalizeSearchText(originalQuery);
  const terms = normalized.split(/\s+/).filter(Boolean);
  const negative = new Set<string>();
  for (let index = 0; index < terms.length; index++) {
    if (!["without", "no", "sans", "excluding", "exclude"].includes(terms[index])) continue;
    const next = terms[index + 1];
    if (next) aliasesFor(next).forEach((term) => negative.add(term));
  }
  const onlyIndex = terms.indexOf("only");
  if (onlyIndex > 0) {
    const requested = terms[onlyIndex - 1];
    const pair = rolePairs.find((item) => item.primary.some((term) => aliasesFor(term).includes(singular(requested))));
    pair?.related.forEach((term) => aliasesFor(term).forEach((alias) => negative.add(alias)));
  }
  return Array.from(negative);
}

function fieldScore(hit: SearchHit, originalQuery: string, searchQuery: string, canonicalQuery = "") {
  const doc = hit.document || {};
  const sku = normalizeSearchText(String(doc.sku || ""));
  const brand = textFrom(doc, ["brand"]);
  const title = textFrom(doc, ["name", "variant_label", "option_text"]);
  const parent = textFrom(doc, ["parent_name"]);
  const categories = textFrom(doc, ["categories"]);
  const attributes = textFrom(doc, ["variant_label", "option_text", "custom_fields_text"]);
  const searchable = textFrom(doc, ["name", "parent_name", "brand", "categories", "variant_label", "option_text", "search_text", "description", "custom_fields_text"]);
  const price = Math.max(0, Number(doc.price || 0));
  const original = normalizeSearchText(originalQuery);
  const originalTerms = words(originalQuery);
  const translatedTerms = words(searchQuery).filter((term) => !stopWords.has(term));
  const canonicalTerms = words(canonicalQuery).filter((term) => !stopWords.has(term));
  const negative = negativeTerms(originalQuery);
  const positiveOriginalTerms = originalTerms.filter((term) => !negative.some((item) => aliasesFor(term).includes(item)));
  const firstAidKitIntent = /\bfirst\s+aid\s+(?:kit|kits)\b/.test(original);
  const requestedAccessoryTerms = originalTerms.filter((term) =>
    genericAccessoryTerms.some((accessory) => aliasesFor(term).includes(accessory)) &&
    !(firstAidKitIntent && ["kit", "kits"].includes(singular(term)))
  );
  const requestedAccessory = requestedAccessoryTerms.length > 0;
  const requestedTraining = originalTerms.some((term) => trainingTerms.some((training) => aliasesFor(term).includes(normalizeSearchText(training)) || normalizeSearchText(term) === normalizeSearchText(training)));
  const manikinIntent = manikinTerms.some((term) => hasTerm(original, term) || phraseIn(original, term));
  const explicitManikinComponentQuery = manikinIntent && /\b(?:part|parts|accessor(?:y|ies)|replacement|assembly|face|lung|airway|skin|cable)\b/.test(original);
  const explicitComponentIntent = requestedAccessory || /\b(?:part|parts|accessor(?:y|ies)|replacement|refill|compatible|compatibility)\b/.test(original);
  const componentCategory = /\b(?:parts?\s+(?:(?:and)\s+)?accessories|replacement parts?|accessories)\b/.test(categories);
  let score = 0;

  const requestedAttributes = specificAttributeTerms(originalQuery);
  const attributeTextWithSpaces = normalizeSearchText(`${title} ${attributes} ${parent}`);
  if (requestedAttributes.length) {
    const attributeText = attributeTextWithSpaces
      .replace(/\s+/g, "")
      .replace(/-/g, "");
    for (const attribute of requestedAttributes) {
      const requestedSize = /^(x?small|medium|large|x?large)$/.test(attribute);
      const matches = requestedSize
        ? new RegExp(`(^|\\s|:|/|\\()${attribute.replace("x", "x[- ]?")}($|\\s|/|\\)|,)`, "i").test(attributeTextWithSpaces)
        : attributeText.includes(attribute);
      if (matches) score += 1450;
      else score -= 1250;
    }

    // A product whose title explicitly says another size should not be
    // treated as an exact match just because the parent family matches.
    const requestedSize = requestedAttributes.find((term) => /^(x?small|medium|large|x?large)$/.test(term));
    if (requestedSize) {
      const listedSizes = attributeText.match(/x?small|medium|large|x?large/g) || [];
      if (listedSizes.some((size) => size !== requestedSize)) score -= 1100;
    }
  }

  const materialTerms = ["nitrile", "latex", "vinyl", "neoprene", "polyethylene", "chloroprene", "poly", "copolymer"];
  const requestedMaterials = materialTerms.filter((term) => hasTerm(original, term));
  if (requestedMaterials.length) {
    const materialText = normalizeSearchText(`${title} ${parent} ${categories}`);
    for (const material of requestedMaterials) {
      if (materialText.includes(material)) score += 800;
      for (const other of materialTerms) {
        if (other !== material && materialText.includes(other)) score -= 5000;
      }
    }
  }

  const requestedMl = requestedAttributes.find((term) => /^\d+(?:\.\d+)?ml$/.test(term));
  if (requestedMl) {
    const requestedValue = Number(requestedMl.replace("ml", ""));
    const syringeSizes = Array.from(attributeTextWithSpaces.matchAll(/(\d+(?:\.\d+)?)\s*ml\s+syringe/gi))
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value));
    if (syringeSizes.some((value) => value !== requestedValue)) score -= 1800;
  }

  const hasExplicitPositiveRelationship = /\b(?:with|avec)\b/.test(original);

  if (sku && (original === sku || original.includes(sku))) score += 3000;
  if (brand && (original === brand || original.startsWith(`${brand} `))) score += 850;
  if (original.length >= 3 && phraseIn(title, original)) score += 1600;
  if (positiveOriginalTerms.length > 1 && positiveOriginalTerms.every((term) => hasTerm(title, term))) score += 900;

  if (firstAidKitIntent) {
    if (phraseIn(title, "first aid kit")) score += 1500;
    if (phraseIn(parent, "first aid kit")) score += 900;
    if (phraseIn(categories, "first aid")) score += 650;
  }

  if (manikinIntent) {
    const componentProduct = componentSignals.some((term) => phraseIn(title, term) || phraseIn(parent, term));
    const fullManikin = !componentProduct && fullManikinSignals.some((term) => phraseIn(title, term) || phraseIn(parent, term));
    const manikinCategory = fullManikinSignals.some((term) => phraseIn(categories, term));
    const accessoryCategory = /\b(?:manikin|mannequin)\s+parts?\s+(?:(?:and)\s+)?accessories\b/.test(categories) ||
      /\bparts?\s+(?:(?:and)\s+)?accessories\b/.test(categories);
    const accessoryOnly = accessoryCategory || manikinAccessorySignals.some((term) => phraseIn(title, term) || phraseIn(parent, term));
    if (fullManikin) score += 2200;
    else if (manikinCategory) score += 1200;
    if (!explicitManikinComponentQuery && accessoryOnly && !fullManikin) score -= 5200;
    // Price is only a supporting signal: complete training manikins are
    // generally much more expensive than replacement components, but price
    // must never outrank product/category/name matches.
    if (!explicitManikinComponentQuery && fullManikin && price >= 300) score += Math.min(900, Math.log1p(price) * 130);
    if (!explicitManikinComponentQuery && accessoryOnly && price < 300) score -= 500;
  }

  for (const term of positiveOriginalTerms) {
    if (hasTerm(title, term)) score += 520;
    else if (hasTerm(parent, term)) score += 360;
    else if (hasTerm(categories, term)) score += 420;
    else if (hasTerm(attributes, term)) score += /\d|ml|g|mm|inch|in|sterile|safety/.test(term) ? 360 : 110;
    else if (hasTerm(searchable, term)) score += 45;
  }

  // Translation/expansion helps recall, but it must not overpower the
  // customer's original words when deciding what appears first.
  for (const term of translatedTerms) {
    if (!originalTerms.some((originalTerm) => aliasesFor(originalTerm).includes(term))) {
      if (hasTerm(title, term)) score += 120;
      else if (hasTerm(categories, term)) score += 80;
      else if (hasTerm(searchable, term)) score += 20;
    }
  }

  // Manual French mappings and translator-selected canonical terms receive
  // English-equivalent weight. Other translated recall terms stay lower.
  for (const term of canonicalTerms) {
    if (hasTerm(title, term)) score += 520;
    else if (hasTerm(parent, term)) score += 360;
    else if (hasTerm(categories, term)) score += 420;
    else if (hasTerm(searchable, term)) score += 45;
  }

  for (const term of negative) {
    // Broad family categories such as "Needles & Syringes" are not enough to
    // prove that a product includes the excluded item.
    const isExplicitlyNeedleFree = /(?:without|w o|w\/o|no|sans)\s+(?:needle|needles|aiguille|aiguilles)/.test(`${title} ${parent}`);
    if (!isExplicitlyNeedleFree && (hasTerm(title, term) || hasTerm(parent, term))) score -= 12000;
  }

  const normalizedOriginal = normalizeSearchText(originalQuery);
  const requestedNeedleFree = /\b(?:needle[- ]?free|without\s+(?:the\s+)?needles?|no\s+(?:the\s+)?needles?)\b/.test(original);
  for (const pair of rolePairs) {
    const primaryRequested = pair.primary.some((term) =>
      normalizedOriginal.includes(normalizeSearchText(term)) &&
      !negative.some((item) => aliasesFor(term).includes(item))
    );
    const relatedRequested = pair.related.some((term) =>
      normalizedOriginal.includes(normalizeSearchText(term)) &&
      !negative.some((item) => aliasesFor(term).includes(item))
    );
    if (!primaryRequested) continue;
    const hasPrimary = pair.primary.some((term) => hasTerm(title, term) || hasTerm(categories, term));
    const hasPrimaryInTitle = pair.primary.some((term) => hasTerm(title, term));
    // Categories such as "Needles & Syringes" are intentionally broad and
    // should not make a standalone product look like a combination product.
    const hasCombinationCategory = /\b(?:syringe|syringes)\s+with\s+needles?\b|\bwith\s+needles?\b|\bneedles?\s+with\s+syringes?\b/.test(categories);
    const hasRelated = pair.related.some((term) => hasTerm(title, term)) || (hasCombinationCategory && hasPrimaryInTitle);
    const hasRelatedInTitle = pair.related.some((term) => hasTerm(title, term));
    const hasExactPrimaryCategory = pair.primary.some((term) => {
      const singularTerm = singular(term);
      return categories.split(/\s+/).some((category) => category === term || category === singularTerm);
    });
    const needleCollectionCategory = pair.primary.some((term) => term.startsWith("needle")) &&
      /\b(?:blood collection|collection)\s+needles?\s+(?:and\s+)?(?:kits?|sets?)\b|\biv\s+(?:sets?|tubing)\b|\bneedles?\s+and\s+kits?\b/.test(categories);
    const needleProductCategory = pair.primary.some((term) => term.startsWith("needle")) &&
      /\b(?:pen needle|standard needles?|blunt fill needle|safety hypodermic needles?)\b/.test(categories);
    const needleFreeRecord = /\b(?:without|w\/o|no|sans)\s+(?:the\s+)?needles?\b/.test(`${title} ${parent}`) ||
      /\bneedle[- ]?free\b/.test(`${title} ${parent}`);
    const actualNeedleProduct = pair.primary.some((term) => term.startsWith("needle")) &&
      !needleFreeRecord && (hasTerm(title, "needle") || hasTerm(parent, "needle"));
    const safetyNeedleProduct = pair.primary.some((term) => term.startsWith("needle")) &&
      /\bsafety\s+(?:hypodermic\s+)?needles?\b/.test(`${title} ${parent}`) &&
      !/\bsafety\s+syringe/.test(`${title} ${parent}`);
    const actualPrimaryProduct = pair.primary.some((term) => hasTerm(title, term) || hasTerm(parent, term));
    if (hasPrimary) score += 520;
    if (hasExactPrimaryCategory) score += 900;
    if (actualPrimaryProduct) score += 900;
    if (needleProductCategory) score += 1800;
    if (actualNeedleProduct) score += 2200;
    if (safetyNeedleProduct) score += 4500;
    if (pair.primary.some((term) => term.startsWith("needle")) && needleFreeRecord && !requestedNeedleFree) score -= 9000;
    // Broad catalog categories frequently contain "Needles" even when the
    // record is a sharps container, blood-collection set, holder, or vascular
    // access product. Keep those records searchable, but keep real needle
    // products together throughout deeper pages for a plain "needle" query.
    if (hasPrimary && !actualPrimaryProduct && !hasRelatedInTitle) {
      score -= pair.primary.some((term) => term.startsWith("needle")) ? 3600 : 2200;
    }
    if (needleCollectionCategory && !hasExplicitPositiveRelationship) score -= 1800;
    if (relatedRequested) {
      if (hasPrimary && !hasRelated) score -= 900;
      if (/(?:without|w o|sans)\s+(?:needle|needles|aiguille|aiguilles)/.test(title)) score -= 4000;
    } else {
      // For a plain product query, prefer the requested product by itself.
      // Exact attributes such as 3 ml must not make a syringe-with-needle
      // combination outrank a standalone 3 ml syringe.
      const isNeedleFree = /(?:without|w o|w\/o|no|sans)\s+(?:needle|needles|aiguille|aiguilles)/.test(`${title} ${parent}`);
      if (hasRelated && hasPrimary && !isNeedleFree) score -= hasExplicitPositiveRelationship ? 1000 : 4500;
      else if (hasRelated) score -= 180;
    }

    if (!hasExplicitPositiveRelationship && hasPrimaryInTitle && !hasRelatedInTitle &&
      combinationProductSignals.some((term) => phraseIn(title, term) || phraseIn(parent, term))) {
      score -= 2200;
    }
    if (negative.length && combinationProductSignals.some((term) => phraseIn(title, term) || phraseIn(parent, term))) {
      score -= 4000;
    }
    if (!hasExplicitPositiveRelationship && !hasPrimaryInTitle && hasRelatedInTitle) score -= 4200;
    if (primaryRequested && pair.primary.some((term) => term.startsWith("needle")) && /\bneedle[- ]?free\b/.test(title)) score -= 6000;
    if (!hasExplicitPositiveRelationship && hasCombinationCategory) score -= 2800;
    const syringePrimary = pair.primary.some((term) => term.startsWith("syringe"));
    if (syringePrimary && requestedNeedleFree) {
      if (needleFreeRecord) score += 9000;
      else if (hasRelatedInTitle) score -= 9000;
    }
    const explicitSyringeSpecialty = specialtySyringeSignals.some((term) => phraseIn(original, term));
    const hasSyringeSpecialty = specialtySyringeSignals.some((term) => phraseIn(title, term) || phraseIn(parent, term));
    if (syringePrimary && !explicitSyringeSpecialty && hasSyringeSpecialty) score -= 2400;
  }

  const requestedPrimary = rolePairs.some((pair) => pair.primary.some((term) => original.includes(normalizeSearchText(term)))) || firstAidKitIntent || manikinIntent;
  if (requestedPrimary && !requestedAccessory && genericAccessoryTerms.some((term) => hasTerm(title, term))) score -= 1000;

  if (requestedAccessory) {
    const broadAccessoryRequested = requestedAccessoryTerms.some((term) => aliasesFor(term).some((alias) => ["accessory", "accessories"].includes(alias)));
    const hasRequestedAccessory = broadAccessoryRequested
      ? genericAccessoryTerms.some((term) => hasTerm(title, term) || hasTerm(parent, term))
      : requestedAccessoryTerms.some((term) => hasTerm(title, term) || hasTerm(parent, term));
    const hasMainEquipment = mainEquipmentTerms.some((term) => hasTerm(title, term) || hasTerm(parent, term) || hasTerm(categories, term));
    const hasOtherAccessory = genericAccessoryTerms.some((term) => hasTerm(title, term) || hasTerm(categories, term));
    if (hasRequestedAccessory) score += 700;
    if (hasOtherAccessory && !hasRequestedAccessory) score -= 500;
    if (hasMainEquipment && !hasRequestedAccessory) score -= 1500;
  }

  // This applies across the catalog, not only to manikins: when a customer
  // searches for a broad product term, a catalog record classified as a part
  // or accessory should remain available but should not outrank the complete
  // product. Explicit part/accessory searches opt back into those records.
  if (componentCategory && !explicitComponentIntent) score -= 5200;

  const hasTrainingSignal = trainingTerms.some((term) => hasTerm(title, term) || hasTerm(parent, term) || hasTerm(categories, term));
  if (hasTrainingSignal && !requestedTraining) score -= 1400;
  if (hasTrainingSignal && requestedTraining) score += 500;

  return score;
}

function popularityBonus(hit: SearchHit) {
  const popularity = Math.max(0, Number(hit.document?.popularity_score || 0));
  return Math.min(140, Math.log1p(popularity) * 18);
}

function parentKey(hit: SearchHit) {
  const doc = hit.document || {};
  return normalizeSearchText(String(doc.parent_name || doc.name || doc.product_id || doc.sku || ""));
}

function groupVariants(hits: SearchHit[]) {
  const groups = new Map<string, { hits: SearchHit[]; firstIndex: number; bestScore: number }>();
  hits.forEach((hit, index) => {
    const key = parentKey(hit);
    const score = Number((hit as any).__searchV2Score || 0);
    const group = groups.get(key);
    if (group) {
      group.hits.push(hit);
      group.bestScore = Math.max(group.bestScore, score);
    } else {
      groups.set(key, { hits: [hit], firstIndex: index, bestScore: score });
    }
  });

  return Array.from(groups.values())
    .sort((a, b) => b.bestScore - a.bestScore || a.firstIndex - b.firstIndex)
    .flatMap((group) => group.hits.sort((a, b) => {
      return Number((b as any).__searchV2Score || 0) - Number((a as any).__searchV2Score || 0);
    }));
}

export function applySearchRankingV2(hits: SearchHit[] = [], originalQuery: string, searchQuery = "", canonicalQuery = "") {
  if (!hits.length || !normalizeSearchText(originalQuery)) return hits;
  // Existing intent rules remain active, but only from the customer's original
  // words. The translated query is used for field-aware recall matching below.
  const base = applyIntentRanking(hits, originalQuery, "");
  const ranked = base.map((hit) => ({
    ...hit,
    __searchV2Score: fieldScore(hit, originalQuery, searchQuery, canonicalQuery) + popularityBonus(hit),
  }));
  const ordered = hasSpecificAttributeQuery(originalQuery) ? ranked.sort((a, b) => {
    return Number((b as any).__searchV2Score || 0) - Number((a as any).__searchV2Score || 0);
  }) : groupVariants(ranked);
  return ordered.map(({ __searchV2Score, ...hit }) => hit);
}

export function searchIntentTier(hit: SearchHit, originalQuery: string, searchQuery = "", canonicalQuery = "") {
  const score = fieldScore(hit, originalQuery, searchQuery, canonicalQuery);
  return score >= 900 ? "primary" : score >= 250 ? "related" : "broad";
}
