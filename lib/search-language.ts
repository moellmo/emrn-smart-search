export type LanguageCode = "en" | "fr";

const accents: Record<string, string> = {
  à: "a", â: "a", ä: "a", æ: "ae", ç: "c",
  é: "e", è: "e", ê: "e", ë: "e",
  î: "i", ï: "i", ô: "o", ö: "o",
  ù: "u", û: "u", ü: "u", ÿ: "y", œ: "oe",
};

export function normalizeSearchText(value: string) {
  return String(value || "")
    .toLowerCase()
    .replace(/[àâäæçéèêëîïôöùûüÿœ]/g, (char) => accents[char] || char)
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9\s./-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const synonymPairs: Array<[string, string[]]> = [
  ["gants", ["gloves", "medical gloves", "exam gloves", "nitrile gloves", "surgical gloves"]],
  ["gant", ["glove", "gloves"]],
  ["masques", ["masks", "face masks", "respirators"]],
  ["masque", ["mask", "masks", "face mask"]],
  ["respirateur", ["respirator", "mask", "n95"]],
  ["respirateurs", ["respirators", "masks", "n95"]],
  ["pansement", ["dressing", "wound dressing", "bandage"]],
  ["pansements", ["dressings", "wound dressings", "bandages"]],
  ["bandage", ["bandage", "dressing", "wrap"]],
  ["bandages", ["bandages", "dressings", "wraps"]],
  ["seringue", ["syringe"]],
  ["seringues", ["syringes"]],
  ["aiguille", ["needle"]],
  ["aiguilles", ["needles"]],
  ["fauteuil roulant", ["wheelchair"]],
  ["fauteuils roulants", ["wheelchairs"]],
  ["oxygene", ["oxygen"]],
  ["oxygène", ["oxygen"]],
  ["masque oxygene", ["oxygen mask"]],
  ["masque à oxygène", ["oxygen mask"]],
  ["masque avec sac", ["non-rebreather mask", "oxygen mask", "bag valve mask"]],
  ["masque avec reservoir", ["non-rebreather mask", "oxygen mask"]],
  ["masque avec réservoir", ["non-rebreather mask", "oxygen mask"]],
  ["tensiometre", ["blood pressure", "sphygmomanometer", "bp cuff"]],
  ["tensiomètre", ["blood pressure", "sphygmomanometer", "bp cuff"]],
  ["brassard", ["cuff", "blood pressure cuff"]],
  ["stethoscope", ["stethoscope"]],
  ["stéthoscope", ["stethoscope"]],
  ["dea", ["aed", "defibrillator"]],
  ["defibrillateur", ["defibrillator", "aed"]],
  ["défibrillateur", ["defibrillator", "aed"]],
  ["rcr", ["cpr"]],
  ["mannequin rcr", ["cpr manikin", "training manikin"]],
  ["premiers soins", ["first aid"]],
  ["trousse premiers soins", ["first aid kit"]],
  ["trousse de premiers soins", ["first aid kit"]],
  ["chaise douche", ["shower chair"]],
  ["banc de transfert", ["transfer bench"]],
  ["canne", ["cane"]],
  ["deambulateur", ["walker", "rollator"]],
  ["déambulateur", ["walker", "rollator"]],
  ["glucometre", ["glucose meter", "glucometer"]],
  ["glucomètre", ["glucose meter", "glucometer"]],
  ["thermometre", ["thermometer"]],
  ["thermomètre", ["thermometer"]],
  ["compresses", ["gauze", "sponges"]],
  ["compresse", ["gauze", "sponge"]],
  ["ruban medical", ["medical tape"]],
  ["ruban médical", ["medical tape"]],
  ["lit medical", ["medical bed", "hospital bed"]],
  ["lit médical", ["medical bed", "hospital bed"]],
  ["bp cuff", ["blood pressure cuff", "sphygmomanometer"]],
  ["defib", ["defibrillator", "aed"]],
  ["defib pads", ["aed pads", "defibrillator pads"]],
  ["non rebreather", ["oxygen mask", "non-rebreather mask"]],
  ["ambu bag", ["bag valve mask", "bvm", "resuscitator"]],
  ["bvm", ["bag valve mask", "resuscitator"]],
];

export function detectQueryLanguage(query: string): LanguageCode {
  const normalized = normalizeSearchText(query);
  if (/[àâäçéèêëîïôöùûüÿœ]/i.test(query)) return "fr";
  if (synonymPairs.some(([term]) => normalized.includes(normalizeSearchText(term)) && /[a-z]/.test(term))) {
    const frenchOnly = ["gants","gant","masques","masque","pansement","seringue","aiguille","fauteuil","oxygene","oxygène","tensiometre","tensiomètre","brassard","défibrillateur","defibrillateur","premiers","trousse","deambulateur","déambulateur","thermometre","thermomètre","ruban"];
    if (frenchOnly.some((term) => normalized.includes(normalizeSearchText(term)))) return "fr";
  }
  return "en";
}

export function expandSearchQuery(query: string) {
  const normalized = normalizeSearchText(query);
  const additions = new Set<string>();

  for (const [term, synonyms] of synonymPairs) {
    const normalizedTerm = normalizeSearchText(term);
    if (normalized === normalizedTerm || normalized.includes(normalizedTerm)) {
      synonyms.forEach((synonym) => additions.add(synonym));
    }
  }

  return {
    original: query,
    expanded: [query, ...Array.from(additions)].join(" "),
    language: detectQueryLanguage(query),
    expansions: Array.from(additions),
  };
}

export function getFallbackTerms(query: string) {
  const normalized = normalizeSearchText(query);
  const suggestions = new Set<string>();

  for (const [term, synonyms] of synonymPairs) {
    const normalizedTerm = normalizeSearchText(term);
    if (normalized.includes(normalizedTerm) || normalizedTerm.includes(normalized)) {
      synonyms.slice(0, 4).forEach((synonym) => suggestions.add(synonym));
    }
  }

  if (!suggestions.size) {
    ["gloves", "masks", "first aid", "oxygen", "wound dressing", "syringe"].forEach((term) => suggestions.add(term));
  }

  return Array.from(suggestions).slice(0, 6);
}
