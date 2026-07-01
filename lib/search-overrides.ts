import { typesenseAdmin } from "./typesense";

export type SearchRedirect = {
  terms: string[];
  url: string;
};

export type SearchOverrides = {
  redirects: SearchRedirect[];
  pinnedSkus: Record<string, string[]>;
  hiddenSkus: string[];
  boostTerms: Record<string, string[]>;
  noResultsSuggestions: Record<string, string[]>;
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
  },

  hiddenSkus: [],

  boostTerms: {
    "aed pads": ["defibrillator pads", "aed electrodes"],
    "bp cuff": ["blood pressure cuff", "sphygmomanometer"],
    "blood pressure machine": ["blood pressure monitor", "sphygmomanometer"],
    "oxygen mask": ["non-rebreather mask", "medium concentration mask"],
    "cpr dummy": ["cpr manikin", "training manikin"],
    mannequin: ["manikin", "training manikin", "patient simulator"],
    pansement: ["wound dressing", "bandage"],
    seringue: ["syringe"],
    gants: ["gloves", "nitrile gloves", "exam gloves"],
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
    "shower chair": ["bath bench", "bath chair", "transfer bench"],
    "fauteuil de douche": ["shower chair", "bath bench", "transfer bench"],
  },
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
    hiddenSkus: cleanStringList(input?.hiddenSkus),
    boostTerms: cleanStringMap(input?.boostTerms),
    noResultsSuggestions: cleanStringMap(input?.noResultsSuggestions),
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
    hiddenSkus: Array.from(new Set([...defaultSearchOverrides.hiddenSkus, ...cleanRuntime.hiddenSkus])),
    boostTerms: {
      ...defaultSearchOverrides.boostTerms,
      ...cleanRuntime.boostTerms,
    },
    noResultsSuggestions: {
      ...defaultSearchOverrides.noResultsSuggestions,
      ...cleanRuntime.noResultsSuggestions,
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
    const doc: any = await typesenseAdmin
      .collections(CONTROLS_COLLECTION)
      .documents(CONTROLS_DOC_ID)
      .retrieve();

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

  for (const [term, values] of Object.entries(controls.pinnedSkus)) {
    const normalizedTerm = normalizeOverrideQuery(term);
    if (normalized === normalizedTerm || normalized.includes(normalizedTerm)) {
      values.forEach((sku) => sku && skus.add(sku));
    }
  }

  return Array.from(skus);
}

export function getBoostTermsForQuery(query: string, controls = defaultSearchOverrides) {
  const normalized = normalizeOverrideQuery(query);
  const terms = new Set<string>();

  for (const [term, values] of Object.entries(controls.boostTerms)) {
    const normalizedTerm = normalizeOverrideQuery(term);
    if (normalized === normalizedTerm || normalized.includes(normalizedTerm)) {
      values.forEach((value) => value && terms.add(value));
    }
  }

  return Array.from(terms);
}

export function getNoResultsSuggestionsForQuery(query: string, controls = defaultSearchOverrides) {
  const normalized = normalizeOverrideQuery(query);
  const suggestions = new Set<string>();

  for (const [term, values] of Object.entries(controls.noResultsSuggestions)) {
    const normalizedTerm = normalizeOverrideQuery(term);
    if (normalized === normalizedTerm || normalized.includes(normalizedTerm)) {
      values.forEach((value) => value && suggestions.add(value));
    }
  }

  return Array.from(suggestions);
}
