import { typesenseAdmin } from "./typesense";

export type SearchRedirect = {
  terms: string[];
  url: string;
};

export type PrivateCategoryRule = {
  enabled: boolean;
  label: string;
  categoryIds: number[];
  categoryNames: string[];
  allowedCustomerIds: string[];
};

export type NaturalLanguageRule = {
  categoryQueries: string[];
  recallQueries: string[];
  avoidTerms: string[];
};

export type SearchOverrides = {
  redirects: SearchRedirect[];
  pinnedSkus: Record<string, string[]>;
  brandPinnedSkus: Record<string, string[]>;
  categoryPinnedSkus: Record<string, string[]>;
  categoryIdPinnedSkus: Record<string, string[]>;
  hiddenSkus: string[];
  privateCategoryRules: PrivateCategoryRule[];
  boostTerms: Record<string, string[]>;
  noResultsSuggestions: Record<string, string[]>;
  naturalLanguageRules: Record<string, NaturalLanguageRule>;
};

export const defaultSearchOverrides: SearchOverrides = {
  redirects: [
    {
      terms: ["student specials", "back to school", "students"],
      url: "/student-specials/",
    },
    {
      terms: ["faq", "frequently asked questions"],
      url: "/faq-s/",
    },
  ],

  pinnedSkus: {
    gloves: [],
    gants: [],
    masks: [],
    masques: [],
    manikin: [],
    mannequin: [],
    "first aid": [],
    "premiers soins": [],
    syringe: [],
    seringue: [],
    "shower chair": [],
    "fauteuil de douche": [],
    "cat tourniquet": ["30001OR", "30001NO", "30001BL"],
    "combat application tourniquet": ["30001OR", "30001NO", "30001BL"],
    "bag valve mask": ["02FM5210-CS", "02RT1041", "004-4050", "004-4010F", "004-4010", "004-4025", "004-4025F", "004-4050F", "540-211-000", "845231", "845223", "845221", "845241", "845031", "MM-1056242"],
    "bag valve masks": ["02FM5210-CS", "02RT1041", "004-4050", "004-4010F", "004-4010", "004-4025", "004-4025F", "004-4050F", "540-211-000", "845231", "845223", "845221", "845241", "845031", "MM-1056242"],
    bvm: ["02FM5210-CS", "02RT1041", "004-4050", "004-4010F", "004-4010", "004-4025", "004-4025F", "004-4050F", "540-211-000", "845231", "845223", "845221", "845241", "845031", "MM-1056242"],
    "ballon masque": ["02FM5210-CS", "02RT1041", "004-4050", "004-4010F", "004-4010", "004-4025", "004-4025F", "004-4050F", "540-211-000", "845231", "845223", "845221", "845241", "845031", "MM-1056242"],
    "sac ambu": ["02FM5210-CS", "02RT1041", "004-4050", "004-4010F", "004-4010", "004-4025", "004-4025F", "004-4050F", "540-211-000", "845231", "845223", "845221", "845241", "845031", "MM-1056242"],
  },
  brandPinnedSkus: {},
  categoryPinnedSkus: {},
  categoryIdPinnedSkus: {},

  hiddenSkus: ["X-REDO-RETURN-PACKAGE-PROTECTION", "x-redo-return-package"],
  privateCategoryRules: [],

  boostTerms: {
    aed: ["defibrillator", "defibrillators", "automated external defibrillator"],
    "aed defibrillation": ["defibrillator", "defibrillators", "automated external defibrillator"],
    defibrillation: ["defibrillator", "defibrillators", "AED", "automated external defibrillator"],
    defibrillator: ["AED", "defibrillators", "automated external defibrillator"],
    defibrillators: ["AED", "defibrillator", "automated external defibrillator"],
    "aed pads": ["defibrillator pads", "aed electrodes"],
    "bp cuff": ["blood pressure cuff", "sphygmomanometer"],
    "blood pressure machine": ["blood pressure monitor", "sphygmomanometer"],
    "oxygen mask": ["non-rebreather mask", "medium concentration mask"],
    "cpr dummy": ["cpr manikin", "training manikin"],
    mannequin: ["manikin", "training manikin", "patient simulator"],
    bandaid: ["bandage", "adhesive bandage", "band-aid", "wound dressing"],
    bandaids: ["bandages", "adhesive bandages", "band-aids", "wound dressings"],
    "band aid": ["bandage", "adhesive bandage", "band-aid", "wound dressing"],
    "band aids": ["bandages", "adhesive bandages", "band-aids", "wound dressings"],
    "band-aid": ["bandage", "adhesive bandage", "wound dressing"],
    "band-aids": ["bandages", "adhesive bandages", "wound dressings"],
    bandage: ["adhesive bandage", "wound dressing", "dressing"],
    bandages: ["adhesive bandages", "wound dressings", "dressings"],
    pansement: ["wound dressing", "bandage"],
    ciseaux: ["scissors", "bandage scissors", "dressing scissors", "medical scissors", "shears"],
    "ciseaux à pansements": ["bandage scissors", "dressing scissors", "scissors", "bandage shears"],
    "ciseaux a pansements": ["bandage scissors", "dressing scissors", "scissors", "bandage shears"],
    seringue: ["syringe"],
    gants: ["gloves", "nitrile gloves", "exam gloves"],
    "cat tourniquet": ["combat application tourniquet", "CAT", "tourniquet"],
    "combat application tourniquet": ["CAT tourniquet", "tourniquet"],
  },

  noResultsSuggestions: {
    gloves: ["nitrile gloves", "exam gloves", "surgical gloves"],
    gants: ["gloves", "nitrile gloves", "exam gloves"],
    masks: ["face masks", "n95 masks", "oxygen masks"],
    masques: ["face masks", "n95 masks", "oxygen masks"],
    manikin: ["cpr manikin", "training manikin", "patient simulator"],
    mannequin: ["cpr manikin", "training manikin", "patient simulator"],
    syringe: ["3 ml syringe", "safety syringe", "needle syringe"],
    seringue: ["3 ml syringe", "safety syringe", "needle syringe"],
    bandaid: ["adhesive bandage", "bandage", "wound dressing"],
    bandaids: ["adhesive bandages", "bandages", "wound dressings"],
    "band aid": ["adhesive bandage", "bandage", "wound dressing"],
    "band aids": ["adhesive bandages", "bandages", "wound dressings"],
    ciseaux: ["bandage scissors", "dressing scissors", "medical scissors"],
    "ciseaux à pansements": ["bandage scissors", "dressing scissors", "medical scissors"],
    "shower chair": ["bath bench", "bath chair", "transfer bench"],
    "fauteuil de douche": ["shower chair", "bath bench", "transfer bench"],
  },

  naturalLanguageRules: {},
};

const CONTROLS_COLLECTION = "emrn_search_controls";
const CONTROLS_DOC_ID = "main";
const CACHE_MS = 1000 * 30;

let cachedControls: { controls: SearchOverrides; expiresAt: number } | null = null;

export function normalizeOverrideQuery(query: string) {
  return String(query || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesOverrideTerm(normalizedQuery: string, normalizedTerm: string) {
  if (!normalizedQuery || !normalizedTerm) return false;
  if (normalizedQuery === normalizedTerm) return true;
  const pattern = new RegExp(`(^|\\s)${escapeRegExp(normalizedTerm)}(?=\\s|$)`);
  return pattern.test(normalizedQuery);
}

function cleanStringList(values: unknown) {
  if (!Array.isArray(values)) return [];
  return values
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function cleanStringMap(map: unknown) {
  const output: Record<string, string[]> = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return output;

  for (const [key, values] of Object.entries(map)) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey) continue;
    output[cleanKey] = cleanStringList(values);
  }

  return output;
}

function cleanNumberList(values: unknown) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0)
    )
  );
}

function cleanNaturalLanguageRules(map: unknown) {
  const output: Record<string, NaturalLanguageRule> = {};
  if (!map || typeof map !== "object" || Array.isArray(map)) return output;

  for (const [key, value] of Object.entries(map)) {
    const cleanKey = String(key || "").trim();
    if (!cleanKey || !value || typeof value !== "object" || Array.isArray(value)) continue;
    const rule = value as Partial<NaturalLanguageRule>;
    output[cleanKey] = {
      categoryQueries: cleanStringList(rule.categoryQueries),
      recallQueries: cleanStringList(rule.recallQueries),
      avoidTerms: cleanStringList(rule.avoidTerms),
    };
  }

  return output;
}

function cleanPrivateCategoryRules(values: unknown): PrivateCategoryRule[] {
  if (!Array.isArray(values)) return [];

  return values
    .map((rule) => ({
      enabled: rule?.enabled !== false,
      label: String(rule?.label || "").trim(),
      categoryIds: cleanNumberList(rule?.categoryIds),
      categoryNames: cleanStringList(rule?.categoryNames),
      allowedCustomerIds: cleanStringList(rule?.allowedCustomerIds).map((id) => id.replace(/[^0-9A-Za-z_-]/g, "")),
    }))
    .filter((rule) => rule.categoryIds.length || rule.categoryNames.length);
}

export function sanitizeSearchOverrides(input: Partial<SearchOverrides> | null | undefined): SearchOverrides {
  return {
    redirects: Array.isArray(input?.redirects)
      ? input.redirects
          .map((redirect) => ({
            terms: cleanStringList(redirect?.terms),
            url: String(redirect?.url || "").trim(),
          }))
          .filter((redirect) => redirect.terms.length && redirect.url)
      : [],

    pinnedSkus: cleanStringMap(input?.pinnedSkus),
    brandPinnedSkus: cleanStringMap(input?.brandPinnedSkus),
    categoryPinnedSkus: cleanStringMap(input?.categoryPinnedSkus),
    categoryIdPinnedSkus: cleanStringMap(input?.categoryIdPinnedSkus),
    hiddenSkus: cleanStringList(input?.hiddenSkus),
    privateCategoryRules: cleanPrivateCategoryRules(input?.privateCategoryRules),
    boostTerms: cleanStringMap(input?.boostTerms),
    noResultsSuggestions: cleanStringMap(input?.noResultsSuggestions),
    naturalLanguageRules: cleanNaturalLanguageRules(input?.naturalLanguageRules),
  };
}

export function mergeSearchOverrides(runtime?: Partial<SearchOverrides> | null): SearchOverrides {
  const cleanRuntime = sanitizeSearchOverrides(runtime);

  return {
    redirects: [...defaultSearchOverrides.redirects, ...cleanRuntime.redirects],
    pinnedSkus: {
      ...defaultSearchOverrides.pinnedSkus,
      ...cleanRuntime.pinnedSkus,
    },
    brandPinnedSkus: {
      ...defaultSearchOverrides.brandPinnedSkus,
      ...cleanRuntime.brandPinnedSkus,
    },
    categoryPinnedSkus: {
      ...defaultSearchOverrides.categoryPinnedSkus,
      ...cleanRuntime.categoryPinnedSkus,
    },
    categoryIdPinnedSkus: {
      ...defaultSearchOverrides.categoryIdPinnedSkus,
      ...cleanRuntime.categoryIdPinnedSkus,
    },
    hiddenSkus: Array.from(new Set([...defaultSearchOverrides.hiddenSkus, ...cleanRuntime.hiddenSkus])),
    privateCategoryRules: [...defaultSearchOverrides.privateCategoryRules, ...cleanRuntime.privateCategoryRules],
    boostTerms: {
      ...defaultSearchOverrides.boostTerms,
      ...cleanRuntime.boostTerms,
    },
    noResultsSuggestions: {
      ...defaultSearchOverrides.noResultsSuggestions,
      ...cleanRuntime.noResultsSuggestions,
    },
    naturalLanguageRules: {
      ...defaultSearchOverrides.naturalLanguageRules,
      ...cleanRuntime.naturalLanguageRules,
    },
  };
}

async function ensureControlsCollection() {
  try {
    await typesenseAdmin.collections(CONTROLS_COLLECTION).retrieve();
  } catch {
    await typesenseAdmin.collections().create({
      name: CONTROLS_COLLECTION,
      fields: [
        { name: "id", type: "string" },
        { name: "config_json", type: "string" },
        { name: "updated_at", type: "int64" },
      ],
    });
  }
}

export async function getRuntimeSearchOverrides() {
  await ensureControlsCollection();

  try {
    const doc = await typesenseAdmin
      .collections(CONTROLS_COLLECTION)
      .documents(CONTROLS_DOC_ID)
      .retrieve() as { config_json?: string };

    return sanitizeSearchOverrides(JSON.parse(doc.config_json || "{}"));
  } catch {
    return sanitizeSearchOverrides({});
  }
}

export async function saveRuntimeSearchOverrides(overrides: Partial<SearchOverrides>) {
  await ensureControlsCollection();

  const clean = sanitizeSearchOverrides(overrides);

  await typesenseAdmin.collections(CONTROLS_COLLECTION).documents().upsert({
    id: CONTROLS_DOC_ID,
    config_json: JSON.stringify(clean),
    updated_at: Date.now(),
  });

  cachedControls = null;
  return clean;
}

export async function getEffectiveSearchOverrides() {
  if (cachedControls && cachedControls.expiresAt > Date.now()) return cachedControls.controls;

  const runtime = await getRuntimeSearchOverrides();
  const controls = mergeSearchOverrides(runtime);

  cachedControls = {
    controls,
    expiresAt: Date.now() + CACHE_MS,
  };

  return controls;
}

function findInControls(query: string, controls: SearchOverrides) {
  const normalized = normalizeOverrideQuery(query);
  return {
    normalized,
    controls,
  };
}

export function findSearchRedirect(query: string, controls = defaultSearchOverrides) {
  const { normalized } = findInControls(query, controls);

  return controls.redirects.find((redirect) =>
    redirect.terms.some((term) => normalized === normalizeOverrideQuery(term))
  );
}

export async function findSearchRedirectAsync(query: string) {
  return findSearchRedirect(query, await getEffectiveSearchOverrides());
}

export function getPinnedSkusForQuery(query: string, controls = defaultSearchOverrides) {
  const normalized = normalizeOverrideQuery(query);
  const skus = new Set<string>();
  const matches: Array<{ term: string; values: string[]; exact: boolean }> = [];

  for (const [term, values] of Object.entries(controls.pinnedSkus)) {
    const normalizedTerm = normalizeOverrideQuery(term);
    if (matchesOverrideTerm(normalized, normalizedTerm)) {
      matches.push({ term: normalizedTerm, values, exact: normalized === normalizedTerm });
    }
  }

  const exactMatches = matches.filter((match) => match.exact);
  const activeMatches = exactMatches.length
    ? exactMatches
    : matches.filter((match) => match.term.length === Math.max(...matches.map((item) => item.term.length)));

  activeMatches
    .sort((a, b) => {
      if (a.exact !== b.exact) return a.exact ? -1 : 1;
      return b.term.length - a.term.length;
    })
    .forEach((match) => {
      match.values.forEach((sku) => sku && skus.add(sku));
    });

  return Array.from(skus);
}

function addMappedPinsForValue(
  skus: Set<string>,
  map: Record<string, string[]> = {},
  value: string | number | null | undefined,
  exact = false
) {
  const normalized = normalizeOverrideQuery(String(value || ""));
  if (!normalized) return;

  for (const [term, values] of Object.entries(map)) {
    const normalizedTerm = normalizeOverrideQuery(term);
    const matches = exact ? normalized === normalizedTerm : matchesOverrideTerm(normalized, normalizedTerm);
    if (matches) values.forEach((sku) => sku && skus.add(sku));
  }
}

export function getPinnedSkusForContext(
  context: {
    query?: string | null;
    brand?: string | null;
    category?: string | null;
    categoryId?: string | number | null;
    categoryIds?: Array<string | number> | null;
  },
  controls = defaultSearchOverrides
) {
  const skus = new Set<string>();

  getPinnedSkusForQuery(context.query || "", controls).forEach((sku) => sku && skus.add(sku));
  addMappedPinsForValue(skus, controls.brandPinnedSkus, context.brand, true);
  addMappedPinsForValue(skus, controls.categoryPinnedSkus, context.category);
  addMappedPinsForValue(skus, controls.categoryIdPinnedSkus, context.categoryId, true);

  for (const id of context.categoryIds || []) {
    addMappedPinsForValue(skus, controls.categoryIdPinnedSkus, id, true);
  }

  return Array.from(skus);
}

export function getBoostTermsForQuery(query: string, controls = defaultSearchOverrides) {
  const normalized = normalizeOverrideQuery(query);
  const terms = new Set<string>();

  for (const [term, values] of Object.entries(controls.boostTerms)) {
    const normalizedTerm = normalizeOverrideQuery(term);
    if (matchesOverrideTerm(normalized, normalizedTerm)) {
      values.forEach((value) => value && terms.add(value));
    }
    for (const value of values) {
      const normalizedValue = normalizeOverrideQuery(value);
      if (normalizedValue && matchesOverrideTerm(normalized, normalizedValue)) {
        terms.add(term);
        values.forEach((sibling) => sibling && sibling !== value && terms.add(sibling));
      }
    }
  }

  return Array.from(terms);
}

export function getNoResultsSuggestionsForQuery(query: string, controls = defaultSearchOverrides) {
  const normalized = normalizeOverrideQuery(query);
  const suggestions = new Set<string>();

  for (const [term, values] of Object.entries(controls.noResultsSuggestions)) {
    const normalizedTerm = normalizeOverrideQuery(term);
    if (matchesOverrideTerm(normalized, normalizedTerm)) {
      values.forEach((value) => value && suggestions.add(value));
    }
  }

  return Array.from(suggestions);
}

function normalizeCustomerId(customerId: string | null | undefined) {
  return String(customerId || "").trim().replace(/[^0-9A-Za-z_-]/g, "");
}

export function getBlockedPrivateCategoryRules(customerId: string | null | undefined, controls = defaultSearchOverrides) {
  const normalizedCustomerId = normalizeCustomerId(customerId);

  return controls.privateCategoryRules.filter((rule) => {
    if (!rule.enabled) return false;
    return !rule.allowedCustomerIds.some((id) => normalizeCustomerId(id) === normalizedCustomerId);
  });
}

export function getAllowedPrivateCategoryRules(customerId: string | null | undefined, controls = defaultSearchOverrides) {
  const normalizedCustomerId = normalizeCustomerId(customerId);

  return controls.privateCategoryRules.filter((rule) => {
    if (!rule.enabled) return false;
    return rule.allowedCustomerIds.some((id) => normalizeCustomerId(id) === normalizedCustomerId);
  });
}

export function getHiddenCategoryRules(controls = defaultSearchOverrides) {
  return controls.privateCategoryRules.filter((rule) => rule.enabled);
}
