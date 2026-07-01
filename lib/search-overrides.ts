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

export const searchOverrides: SearchOverrides = {
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

  // Add SKUs here to force products to the top for a search.
  // Example: gloves: ["AMDI147-9", "AMDI147-8.5"]
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

  // Add SKUs here to hide them from SmartSearch results.
  hiddenSkus: [],

  // Extra terms to add to the search query when a customer uses a phrase.
  // This is not translation. It is ranking help.
  boostTerms: {
    "aed pads": ["defibrillator pads", "aed electrodes"],
    "bp cuff": ["blood pressure cuff", "sphygmomanometer"],
    "blood pressure machine": ["blood pressure monitor", "sphygmomanometer"],
    "oxygen mask": ["non-rebreather mask", "medium concentration mask"],
    "cpr dummy": ["cpr manikin", "training manikin"],
    "mannequin": ["manikin", "training manikin", "patient simulator"],
    "pansement": ["wound dressing", "bandage"],
    "seringue": ["syringe"],
    "gants": ["gloves", "nitrile gloves", "exam gloves"],
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

export function normalizeOverrideQuery(query: string) {
  return String(query || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function findSearchRedirect(query: string) {
  const normalized = normalizeOverrideQuery(query);
  return searchOverrides.redirects.find((redirect) =>
    redirect.terms.some((term) => normalized === normalizeOverrideQuery(term))
  );
}

export function getPinnedSkusForQuery(query: string) {
  const normalized = normalizeOverrideQuery(query);
  const skus = new Set<string>();

  for (const [term, values] of Object.entries(searchOverrides.pinnedSkus)) {
    const normalizedTerm = normalizeOverrideQuery(term);
    if (normalized === normalizedTerm || normalized.includes(normalizedTerm)) {
      values.forEach((sku) => sku && skus.add(sku));
    }
  }

  return Array.from(skus);
}

export function getBoostTermsForQuery(query: string) {
  const normalized = normalizeOverrideQuery(query);
  const terms = new Set<string>();

  for (const [term, values] of Object.entries(searchOverrides.boostTerms)) {
    const normalizedTerm = normalizeOverrideQuery(term);
    if (normalized === normalizedTerm || normalized.includes(normalizedTerm)) {
      values.forEach((value) => value && terms.add(value));
    }
  }

  return Array.from(terms);
}

export function getNoResultsSuggestionsForQuery(query: string) {
  const normalized = normalizeOverrideQuery(query);
  const suggestions = new Set<string>();

  for (const [term, values] of Object.entries(searchOverrides.noResultsSuggestions)) {
    const normalizedTerm = normalizeOverrideQuery(term);
    if (normalized === normalizedTerm || normalized.includes(normalizedTerm)) {
      values.forEach((value) => value && suggestions.add(value));
    }
  }

  return Array.from(suggestions);
}
