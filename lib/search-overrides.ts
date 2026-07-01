export type SearchRedirect = {
  terms: string[];
  url: string;
};

export type SearchOverrides = {
  redirects: SearchRedirect[];
  pinnedSkus: Record<string, string[]>;
  hiddenSkus: string[];
  noResultsSuggestions: Record<string, string[]>;
};

export const searchOverrides: SearchOverrides = {
  redirects: [
    {
      terms: ["student specials", "back to school"],
      url: "/student-specials/",
    },
  ],

  pinnedSkus: {
    gloves: [],
    masks: [],
    manikin: [],
    "first aid": [],
  },

  hiddenSkus: [],

  noResultsSuggestions: {
    gloves: ["nitrile gloves", "exam gloves", "surgical gloves"],
    masks: ["face masks", "n95 masks", "oxygen masks"],
    manikin: ["cpr manikin", "training manikin", "patient simulator"],
  },
};

export function findSearchRedirect(query: string) {
  const normalized = query.trim().toLowerCase();
  return searchOverrides.redirects.find((redirect) =>
    redirect.terms.some((term) => normalized === term || normalized.includes(term.toLowerCase()))
  );
}
