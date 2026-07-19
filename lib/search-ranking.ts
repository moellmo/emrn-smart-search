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

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(normalizeSearchText(term)));
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
  "ecg",
  "ekg",
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
  "monitor with printer",
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
  "mount",
  "bracket",
  "paper",
  "recording paper",
];

const accessoryIntentRules = [
  {
    match: ["aed", "defib", "defibrillator", "defibrillators", "defibrillateur", "défibrillateur", "dea"],
    accessories: ["pad", "pads", "electrode", "electrodes", "battery", "batteries", "cabinet", "case", "sign", "trainer", "training", "bracket", "mount"],
    demoteMain: ["automated external defibrillator", "defibrillator", "aed 3", "lifepak cr2", "heartstart frx", "heartstart onsite", "powerheart"],
  },
  {
    match: ["patient monitor", "patient monitors", "vital signs monitor", "vital sign monitor", "monitor", "monitors"],
    accessories: ["cuff", "cuffs", "hose", "tube", "tubing", "cable", "cables", "lead", "leads", "leadwire", "sensor", "sensors", "probe", "probes", "spo2", "ecg", "ekg", "paper", "roll"],
    demoteMain: ["patient monitor", "vital signs monitor", "vital sign monitor", "bedside monitor", "multiparameter monitor"],
  },
];

export function applyIntentRanking(hits: any[] = [], originalQuery: string, searchQuery = "") {
  const query = normalizeSearchText(`${originalQuery} ${searchQuery}`);
  const originalNormalizedQuery = normalizeSearchText(originalQuery);
  if (!hits.length || !query) return hits;
  const isAccessoryQuery = hasAny(originalNormalizedQuery, accessoryTerms);
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
        "patient monitor",
        "patient monitors",
        "patient monitoring",
        "vital signs monitor",
        "vital sign monitor",
        "vitals monitor",
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
      match: ["soin des plaies", "soins des plaies", "soins de plaies", "traitement des plaies", "wound care", "wound dressing", "wound dressings"],
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
      match: ["mannequin de cpr", "mannequin cpr", "mannequin de rcr", "mannequin rcr", "cpr manikin", "cpr manikins", "rcr"],
      prefer: ["ruth lee cpr manikin", "resusci anne", "cpr manikin", "cpr manikins", "cpr training manikin", "manikins", "nursing manikins", "medical training"],
      demote: ["valve", "adapter", "pads", "cartridge", "replacement", "injection site", "pericardiocentesis", "parts", "accessories", "plug belly", "plate", "skin", "arrhythmia simulator"],
    },
    {
      match: ["fournitures pour perfusion intraveineuse", "fournitures intraveineuses", "materiel intraveineux", "matériel intraveineux", "iv supplies", "iv administration", "iv solution", "iv catheter", "intravenous"],
      prefer: ["iv administration", "iv catheters", "iv catheter", "iv solution", "intravenous", "nexiva", "vacutainer", "sodium chloride", "saline"],
      demote: ["training", "trainer", "simulation", "furniture", "furnishings", "dresser", "bookcase", "cabinet", "drawer"],
    },
  ];

  const active = intents.filter((intent) => hasAny(query, intent.match));
  if (!active.length) return hits;

  const scoreHit = (hit: any) => {
    const text = ` ${docText(hit)} `;
    let intentScore = 0;
    const textScore = Number(hit.text_match || hit._text_match || 0);
    for (const rule of activeAccessoryRules) {
      if (hasAnyWholeWord(text, rule.accessories)) intentScore += 35;
      if (hasAny(text, rule.demoteMain) && !hasAnyWholeWord(text, rule.accessories)) intentScore -= 35;
    }
    for (const intent of active) {
      if (intent.skipDemote) continue;
      if ("preferStrong" in intent && intent.preferStrong && hasAny(text, intent.preferStrong)) intentScore += 35;
      if (hasAny(text, intent.prefer)) intentScore += 10;
      if ("demoteStrong" in intent && intent.demoteStrong && hasAny(text, intent.demoteStrong)) intentScore -= 45;
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
