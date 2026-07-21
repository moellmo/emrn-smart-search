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
      const nameLooksLikeUnit = hasAny(nameText, manikinUnitTerms);
      const nameLooksLikeAccessory = hasAny(nameText, manikinAccessoryDemoteTerms);
      const categoryLooksLikeTraining = categoryText.includes(" medical training ") || categoryText.includes(" manikins ");
      if ((nameLooksLikeUnit || categoryLooksLikeTraining) && !nameLooksLikeAccessory) intentScore += 280;
      else if (nameLooksLikeUnit) intentScore += 90;
      if (nameLooksLikeAccessory) intentScore -= 340;
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
