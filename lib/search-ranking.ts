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

function docNameText(hit: any) {
  const doc = hit.document || {};
  return normalizeSearchText([
    doc.name,
    doc.parent_name,
    doc.variant_label,
    doc.option_text,
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

const bagIntentTerms = [
  "medical bag",
  "medical bags",
  "medic bag",
  "medic bags",
  "trauma bag",
  "trauma bags",
  "ems bag",
  "emt bag",
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
  "ecg monitoring electrode",
  "ekg diagnostic electrode",
  "resting ekg",
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
      match: ["first aid kit", "first aid kits", "trousse de premiers soins", "trousses de premiers soins", "trousse de premiers secours", "trousses de premiers secours", "trousse premiers soins", "trousses premiers soins", "trousse premiers secours", "trousses premiers secours"],
      prefer: firstAidKitTerms,
      preferStrong: ["first aid kit", "first aid kits", "csa first aid kit", "type 1 first aid kit", "type 2 first aid kit", "type 3 first aid kit", "emergency kit", "trauma kit", "medical kit", "ifak"],
      demote: firstAidKitDemoteTerms,
      demoteStrong: firstAidKitDemoteTerms,
    },
    {
      match: ["medical bag", "medical bags", "medic bag", "medic bags", "trauma bag", "trauma bags", "ems bag", "emt bag", "first aid bag", "first aid bags", "jump bag", "jump bags", "rescue bag", "rescue bags"],
      prefer: bagIntentTerms,
      preferStrong: ["medical bag", "medical bags", "first aid bag", "first aid bags", "trauma bag", "trauma bags", "ems bag", "emt bag", "jump bag", "jump bags", "rescue bag", "rescue bags", "oxygen bag", "oxygen bags", "backpack", "pouch"],
      demote: bagDemoteTerms,
      demoteStrong: bagDemoteTerms,
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

  const scoreHit = (hit: any) => {
    const text = ` ${docText(hit)} `;
    const nameText = ` ${docNameText(hit)} `;
    const categoryText = ` ${docCategories(hit).join(" ")} `;
    let intentScore = categoryPhraseScore(hit, originalQuery, searchQuery);
    const textScore = Number(hit.text_match || hit._text_match || 0);
    const isFirstAidKitQuery = hasAny(query, ["first aid kit", "first aid kits", "trousse de premiers soins", "trousses de premiers soins", "trousse de premiers secours", "trousses de premiers secours", "trousse premiers soins", "trousses premiers soins", "trousse premiers secours", "trousses premiers secours"]);
    if (isFirstAidKitQuery) {
      const nameLooksLikeKit = hasAny(nameText, firstAidKitTerms);
      const nameLooksLikeLooseSupply = hasAny(nameText, firstAidKitDemoteTerms);
      if (nameLooksLikeKit && !nameLooksLikeLooseSupply) intentScore += 320;
      else if (nameLooksLikeKit) intentScore += 160;
      else intentScore -= 420;
    }
    const isMedicalBagQuery = hasAny(query, ["medical bag", "medical bags", "medic bag", "medic bags", "trauma bag", "trauma bags", "ems bag", "emt bag", "first aid bag", "first aid bags", "jump bag", "jump bags", "rescue bag", "rescue bags"]);
    if (isMedicalBagQuery) {
      const inMedicalBags = categoryText.includes(" medical bags ");
      const namedLikeBag = hasAny(nameText, bagIntentTerms);
      if (inMedicalBags) intentScore += 220;
      else if (namedLikeBag) intentScore += 120;
      else intentScore -= 500;
      if (!inMedicalBags && hasAny(nameText, bagDemoteTerms)) intentScore -= 150;
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
      if (monitorUnitName && !monitorAccessoryName) intentScore += 260;
      else if (hasAny(nameText, patientMonitorUnitTerms)) intentScore += 90;
      if (monitorAccessoryName || hasAny(nameText, patientMonitorDemoteTerms)) intentScore -= 320;
    }
    for (const rule of activeAccessoryRules) {
      if (hasAnyWholeWord(text, rule.accessories)) intentScore += 35;
      if (hasAny(text, rule.demoteMain) && !hasAnyWholeWord(text, rule.accessories)) intentScore -= 35;
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
