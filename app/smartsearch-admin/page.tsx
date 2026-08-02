"use client";

import { useMemo, useState } from "react";

type SearchRedirect = {
  terms: string[];
  url: string;
};

type PrivateCategoryRule = {
  enabled: boolean;
  label: string;
  categoryIds: number[];
  categoryNames: string[];
  allowedCustomerIds: string[];
};

type NaturalLanguageRule = {
  categoryQueries: string[];
  recallQueries: string[];
  avoidTerms: string[];
};

type SearchOverrides = {
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

type PinScope = "query" | "brand" | "category" | "category_id";

type PreviewProduct = {
  name?: string;
  parent_name?: string;
  sku?: string;
  brand?: string;
  image?: string;
  url?: string;
  smart_reasons?: string[];
};

type ReindexStatus = {
  ok?: boolean;
  status?: "running" | "success" | "failed" | "completed_unconfirmed";
  started_at?: number;
  finished_at?: number;
  live_alias?: string;
  target_collection?: string;
  previous_collection?: string;
  total_records?: number;
  indexed_records?: number;
  failed_count?: number;
  min_records?: number;
  alias_swapped?: boolean;
  error?: string;
  interrupted?: boolean;
  ms?: number;
};

const PREVIEW_PAGE_SIZE = 48;
const ADMIN_PASSWORD_KEY = "emrn-smartsearch-admin-password";

const blankControls: SearchOverrides = {
  redirects: [],
  pinnedSkus: {},
  brandPinnedSkus: {},
  categoryPinnedSkus: {},
  categoryIdPinnedSkus: {},
  hiddenSkus: [],
  privateCategoryRules: [],
  boostTerms: {},
  noResultsSuggestions: {},
  naturalLanguageRules: {},
};

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function joinCsv(values: string[] = []) {
  return values.join(", ");
}

function mapToRows(map: Record<string, string[]> = {}) {
  return Object.entries(map).map(([term, values]) => ({
    term,
    values: joinCsv(values),
  }));
}

function rowsToMap(rows: Array<{ term: string; values: string }>) {
  const output: Record<string, string[]> = {};

  for (const row of rows) {
    const term = row.term.trim();
    if (!term) continue;
    output[term] = splitCsv(row.values);
  }

  return output;
}

function rowsToBulk(label: string, rows: Array<{ term: string; values: string }>) {
  return rows
    .filter((row) => row.term.trim() && row.values.trim())
    .map((row) => `${label}: ${row.term.trim()} => ${row.values.trim()}`);
}

function redirectsToBulk(rows: Array<{ terms: string; url: string }>) {
  return rows
    .filter((row) => row.terms.trim() && row.url.trim())
    .map((row) => `redirect: ${row.terms.trim()} => ${row.url.trim()}`);
}

function formatDateTime(value?: number) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(ms?: number) {
  if (!ms) return "Not finished";
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} sec`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} sec`;
}

function parseNaturalLanguageRulesJson(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, NaturalLanguageRule> : {};
  } catch {
    return {};
  }
}

function validateNaturalLanguageRulesJson(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    return true;
  } catch {
    return false;
  }
}

function formatNaturalLanguageRules(rules: Record<string, NaturalLanguageRule> = {}) {
  return JSON.stringify(rules, null, 2);
}

export default function SmartSearchAdminPage() {
  const [password, setPassword] = useState(() => {
    try {
      return typeof window === "undefined" ? "" : window.localStorage.getItem(ADMIN_PASSWORD_KEY) || "";
    } catch {
      return "";
    }
  });
  const [rememberPassword, setRememberPassword] = useState(() => {
    try {
      return typeof window !== "undefined" && Boolean(window.localStorage.getItem(ADMIN_PASSWORD_KEY));
    } catch {
      return false;
    }
  });
  const [status, setStatus] = useState("");
  const [loaded, setLoaded] = useState(false);

  const [hiddenSkus, setHiddenSkus] = useState("");
  const [privateCategoryRows, setPrivateCategoryRows] = useState<Array<{ enabled: boolean; label: string; categoryIds: string; categoryNames: string; allowedCustomerIds: string }>>([]);
  const [redirects, setRedirects] = useState<Array<{ terms: string; url: string }>>([]);
  const [pinnedRows, setPinnedRows] = useState<Array<{ term: string; values: string }>>([]);
  const [brandPinnedRows, setBrandPinnedRows] = useState<Array<{ term: string; values: string }>>([]);
  const [categoryPinnedRows, setCategoryPinnedRows] = useState<Array<{ term: string; values: string }>>([]);
  const [categoryIdPinnedRows, setCategoryIdPinnedRows] = useState<Array<{ term: string; values: string }>>([]);
  const [boostRows, setBoostRows] = useState<Array<{ term: string; values: string }>>([]);
  const [noResultsRows, setNoResultsRows] = useState<Array<{ term: string; values: string }>>([]);
  const [naturalLanguageRulesJson, setNaturalLanguageRulesJson] = useState("{}");
  const [naturalRulePhrase, setNaturalRulePhrase] = useState(() => {
    try {
      return typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("natural_phrase") || "";
    } catch {
      return "";
    }
  });
  const [naturalRuleCategories, setNaturalRuleCategories] = useState("");
  const [naturalRuleTerms, setNaturalRuleTerms] = useState(() => {
    try {
      return typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("natural_terms") || "";
    } catch {
      return "";
    }
  });
  const [naturalRuleAvoid, setNaturalRuleAvoid] = useState("");
  const [naturalRuleTestStatus, setNaturalRuleTestStatus] = useState(() => {
    try {
      return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("approve_mapping") === "1"
        ? "Review this suggested mapping, then click Add / update rule and Save all controls."
        : "";
    } catch {
      return "";
    }
  });
  const [showNaturalLanguageJson, setShowNaturalLanguageJson] = useState(false);
  const [bulkRules, setBulkRules] = useState("");
  const [twoWaySynonyms, setTwoWaySynonyms] = useState(true);
  const [reindexStatus, setReindexStatus] = useState<ReindexStatus | null>(null);
  const [savedRuntime, setSavedRuntime] = useState<SearchOverrides>(blankControls);
  const [effectiveControls, setEffectiveControls] = useState<SearchOverrides>(blankControls);
  const [defaultControls, setDefaultControls] = useState<SearchOverrides>(blankControls);
  const [controlScope, setControlScope] = useState<PinScope>("query");
  const [controlTerm, setControlTerm] = useState("");
  const [controlPinnedSkus, setControlPinnedSkus] = useState("");
  const [controlSynonyms, setControlSynonyms] = useState("");
  const [controlSuggestions, setControlSuggestions] = useState("");
  const [previewProducts, setPreviewProducts] = useState<PreviewProduct[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewStatus, setPreviewStatus] = useState("");
  const [previewPage, setPreviewPage] = useState(0);
  const [previewFound, setPreviewFound] = useState(0);
  const [previewHasMore, setPreviewHasMore] = useState(false);
  const [showAllSavedPinShortcuts, setShowAllSavedPinShortcuts] = useState(false);

  const runtime = useMemo<SearchOverrides>(
    () => ({
      redirects: redirects
        .map((row) => ({
          terms: splitCsv(row.terms),
          url: row.url.trim(),
        }))
        .filter((row) => row.terms.length && row.url),
      pinnedSkus: rowsToMap(pinnedRows),
      brandPinnedSkus: rowsToMap(brandPinnedRows),
      categoryPinnedSkus: rowsToMap(categoryPinnedRows),
      categoryIdPinnedSkus: rowsToMap(categoryIdPinnedRows),
      hiddenSkus: splitCsv(hiddenSkus),
      privateCategoryRules: privateCategoryRows
        .map((row) => ({
          enabled: row.enabled,
          label: row.label.trim(),
          categoryIds: splitCsv(row.categoryIds).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0),
          categoryNames: splitCsv(row.categoryNames),
          allowedCustomerIds: splitCsv(row.allowedCustomerIds),
        }))
        .filter((row) => row.categoryIds.length || row.categoryNames.length),
      boostTerms: twoWaySynonyms ? rowsToBidirectionalMap(boostRows) : rowsToMap(boostRows),
      noResultsSuggestions: rowsToMap(noResultsRows),
      naturalLanguageRules: parseNaturalLanguageRulesJson(naturalLanguageRulesJson),
    }),
    [redirects, pinnedRows, brandPinnedRows, categoryPinnedRows, categoryIdPinnedRows, boostRows, noResultsRows, naturalLanguageRulesJson, hiddenSkus, privateCategoryRows, twoWaySynonyms]
  );

  function savePasswordPreference(value: string, remember: boolean) {
    setPassword(value);
    setRememberPassword(remember);
    try {
      if (remember && value) window.localStorage.setItem(ADMIN_PASSWORD_KEY, value);
      else window.localStorage.removeItem(ADMIN_PASSWORD_KEY);
    } catch {
      // Storage may be disabled by the browser.
    }
  }

  async function loadControls() {
    setStatus("Loading...");
    const res = await fetch("/api/search-controls", {
      headers: {
        "x-smartsearch-admin-password": password,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || "Could not load controls.");
      return;
    }

    const controls: SearchOverrides = data.runtime || blankControls;
    setSavedRuntime(controls);
    setEffectiveControls(data.effective || controls);
    setDefaultControls(data.defaults || blankControls);
    setReindexStatus(data.reindexStatus || null);

    setRedirects(
      (controls.redirects || []).map((redirect) => ({
        terms: joinCsv(redirect.terms),
        url: redirect.url,
      }))
    );
    setPinnedRows(mapToRows(controls.pinnedSkus));
    setBrandPinnedRows(mapToRows(controls.brandPinnedSkus));
    setCategoryPinnedRows(mapToRows(controls.categoryPinnedSkus));
    setCategoryIdPinnedRows(mapToRows(controls.categoryIdPinnedSkus));
    setBoostRows(mapToRows(controls.boostTerms));
    setNoResultsRows(mapToRows(controls.noResultsSuggestions));
    setNaturalLanguageRulesJson(formatNaturalLanguageRules(controls.naturalLanguageRules));
    setHiddenSkus(joinCsv(controls.hiddenSkus));
    setPrivateCategoryRows(
      (controls.privateCategoryRules || []).map((rule) => ({
        enabled: rule.enabled !== false,
        label: rule.label || "",
        categoryIds: joinCsv((rule.categoryIds || []).map(String)),
        categoryNames: joinCsv(rule.categoryNames || []),
        allowedCustomerIds: joinCsv(rule.allowedCustomerIds || []),
      }))
    );
    setLoaded(true);
    setStatus(
      `Loaded ${Object.keys(controls.boostTerms || {}).length} saved synonym rule(s), ${Object.keys(controls.pinnedSkus || {}).length} search pin(s), ${Object.keys(controls.brandPinnedSkus || {}).length} brand pin(s), and ${Object.keys(controls.categoryPinnedSkus || {}).length + Object.keys(controls.categoryIdPinnedSkus || {}).length} category pin(s).`
    );
  }

  async function saveControls() {
    if (!validateNaturalLanguageRulesJson(naturalLanguageRulesJson)) {
      setStatus("Natural language rules must be valid JSON before saving.");
      return;
    }

    setStatus("Saving...");
    const res = await fetch("/api/search-controls", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-smartsearch-admin-password": password,
      },
      body: JSON.stringify({ runtime }),
    });

    const data = await res.json();

    if (!res.ok) {
      setStatus(data.error || "Could not save controls.");
      return;
    }

    const saved: SearchOverrides = data.runtime || runtime;
    setSavedRuntime(saved);
    setEffectiveControls(data.effective || saved);
    setPinnedRows(mapToRows(saved.pinnedSkus));
    setBrandPinnedRows(mapToRows(saved.brandPinnedSkus));
    setCategoryPinnedRows(mapToRows(saved.categoryPinnedSkus));
    setCategoryIdPinnedRows(mapToRows(saved.categoryIdPinnedSkus));
    setBoostRows(mapToRows(saved.boostTerms));
    setNoResultsRows(mapToRows(saved.noResultsSuggestions));
    setNaturalLanguageRulesJson(formatNaturalLanguageRules(saved.naturalLanguageRules));
    setHiddenSkus(joinCsv(saved.hiddenSkus));
    setPrivateCategoryRows(
      (saved.privateCategoryRules || []).map((rule) => ({
        enabled: rule.enabled !== false,
        label: rule.label || "",
        categoryIds: joinCsv((rule.categoryIds || []).map(String)),
        categoryNames: joinCsv(rule.categoryNames || []),
        allowedCustomerIds: joinCsv(rule.allowedCustomerIds || []),
      }))
    );
    setRedirects(
      (saved.redirects || []).map((redirect) => ({
        terms: joinCsv(redirect.terms),
        url: redirect.url,
      }))
    );
    setStatus(
      `Saved ${Object.keys(saved.boostTerms || {}).length} synonym rule(s), ${Object.keys(saved.pinnedSkus || {}).length} search pin(s), ${Object.keys(saved.brandPinnedSkus || {}).length} brand pin(s), and ${Object.keys(saved.categoryPinnedSkus || {}).length + Object.keys(saved.categoryIdPinnedSkus || {}).length} category pin(s). SmartSearch will update within about 30 seconds.`
    );
  }

  function addNaturalLanguageRuleFromBuilder() {
    const phrase = naturalRulePhrase.trim();
    if (!phrase) {
      setNaturalRuleTestStatus("Add a phrase before saving the rule.");
      return;
    }

    if (!validateNaturalLanguageRulesJson(naturalLanguageRulesJson)) {
      setNaturalRuleTestStatus("Fix the JSON editor first, then add the form rule.");
      return;
    }

    const rules = parseNaturalLanguageRulesJson(naturalLanguageRulesJson);
    rules[phrase] = {
      categoryQueries: splitCsv(naturalRuleCategories),
      recallQueries: splitCsv(naturalRuleTerms),
      avoidTerms: splitCsv(naturalRuleAvoid),
    };
    setNaturalLanguageRulesJson(formatNaturalLanguageRules(rules));
    setNaturalRuleTestStatus(`Rule ready for "${phrase}". Click Save all controls to publish it.`);
  }

  function loadNaturalLanguageRuleIntoBuilder(phrase: string, rule: NaturalLanguageRule) {
    setNaturalRulePhrase(phrase);
    setNaturalRuleCategories(joinCsv(rule.categoryQueries || []));
    setNaturalRuleTerms(joinCsv(rule.recallQueries || []));
    setNaturalRuleAvoid(joinCsv(rule.avoidTerms || []));
    setNaturalRuleTestStatus(`Loaded "${phrase}". Edit the form, then Add / update rule and Save all controls.`);
  }

  function fillClinicRuleExample() {
    setNaturalRulePhrase("clinic supplies");
    setNaturalRuleCategories("Nursing Supplies, Diagnostics, Wound Care, PPE & Infection Control, Needles & Syringes, First Aid Kits & Supplies");
    setNaturalRuleTerms("exam gloves, masks, otoscope, stethoscope, wound dressing, sharps container, syringe, first aid kit");
    setNaturalRuleAvoid("office binder, copy paper, marker");
    setNaturalRuleTestStatus("Example loaded. Test it, then Add / update rule and Save all controls.");
  }

  async function testNaturalLanguageRule() {
    const phrase = naturalRulePhrase.trim();
    if (!phrase) {
      setNaturalRuleTestStatus("Add a phrase to test.");
      return;
    }

    setNaturalRuleTestStatus("Testing autocomplete...");
    try {
      const params = new URLSearchParams({ q: phrase });
      const res = await fetch(`/api/autocomplete?${params.toString()}`, { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNaturalRuleTestStatus(data.error || "Autocomplete test failed.");
        return;
      }
      const categories = ((data.facets || []).find((facet: { field?: string }) => facet.field === "categories")?.values || [])
        .slice(0, 6)
        .map((item: { value?: string }) => item.value)
        .filter(Boolean)
        .join(", ");
      setNaturalRuleTestStatus(
        `Test found ${(data.products || []).length} autocomplete product(s). Top categories: ${categories || "none yet"}.`
      );
    } catch (error) {
      setNaturalRuleTestStatus(error instanceof Error ? error.message : "Autocomplete test failed.");
    }
  }

  function exportBulkRules() {
    const lines = [
      ...rowsToBulk("pin", pinnedRows),
      ...rowsToBulk("pin-brand", brandPinnedRows),
      ...rowsToBulk("pin-category", categoryPinnedRows),
      ...rowsToBulk("pin-category-id", categoryIdPinnedRows),
      ...rowsToBulk("boost", boostRows),
      ...rowsToBulk("suggest", noResultsRows),
      ...splitCsv(hiddenSkus).map((sku) => `hide: ${sku}`),
      ...privateCategoryRows
        .filter((row) => row.categoryIds.trim() || row.categoryNames.trim())
        .map((row) => {
          const categories = [row.categoryIds.trim() ? `ids ${row.categoryIds.trim()}` : "", row.categoryNames.trim() ? `names ${row.categoryNames.trim()}` : ""].filter(Boolean).join("; ");
          const customers = row.allowedCustomerIds.trim() ? ` => ${row.allowedCustomerIds.trim()}` : "";
          return `hide-category: ${row.label.trim() || categories} | ${categories}${customers}`;
        }),
      ...redirectsToBulk(redirects),
    ];
    setBulkRules(lines.join("\n"));
    setStatus("Exported current rules into the bulk editor.");
  }

  function applyBulkRules() {
    const nextPinned = [...pinnedRows];
    const nextBrandPinned = [...brandPinnedRows];
    const nextCategoryPinned = [...categoryPinnedRows];
    const nextCategoryIdPinned = [...categoryIdPinnedRows];
    const nextBoost = [...boostRows];
    const nextNoResults = [...noResultsRows];
    const nextRedirects = [...redirects];
    const nextPrivateCategories = [...privateCategoryRows];
    const nextHidden = new Set(splitCsv(hiddenSkus));
    let applied = 0;

    for (const rawLine of bulkRules.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;

      const match = line.match(/^(pin|pinned|sku|pin-brand|brand-pin|pin-category|category-pin|pin-category-id|category-id-pin|boost|synonym|synonyms|suggest|suggestion|suggestions|hide|hidden|hide-category|private-category|redirect)\s*:\s*(.+)$/i);
      const type = (match?.[1] || "boost").toLowerCase();
      const body = (match?.[2] || line).trim();

      if (type === "hide-category" || type === "private-category") {
        const [leftPart, customerPart = ""] = body.split(/\s*=>\s*/);
        const [labelPart, detailsPart = ""] = leftPart.split(/\s*\|\s*/);
        const details = detailsPart || labelPart;
        const idMatch = details.match(/\bids?\s+([^;]+)/i);
        const nameMatch = details.match(/\bnames?\s+([^;]+)/i);
        nextPrivateCategories.push({
          enabled: true,
          label: labelPart.trim(),
          categoryIds: idMatch ? idMatch[1].trim() : (/^\d+(?:\s*,\s*\d+)*$/.test(details.trim()) ? details.trim() : ""),
          categoryNames: nameMatch ? nameMatch[1].trim() : (idMatch ? "" : details.trim()),
          allowedCustomerIds: customerPart.trim(),
        });
        applied += 1;
        continue;
      }

      if (type === "hide" || type === "hidden") {
        splitCsv(body).forEach((sku) => nextHidden.add(sku));
        applied += 1;
        continue;
      }

      const [termPart, valuesPart] = body.split(/\s*=>\s*/);
      const term = String(termPart || "").trim();
      const values = String(valuesPart || "").trim();
      if (!term || !values) continue;

      if (type === "pin" || type === "pinned" || type === "sku") {
        nextPinned.push({ term, values });
      } else if (type === "pin-brand" || type === "brand-pin") {
        nextBrandPinned.push({ term, values });
      } else if (type === "pin-category" || type === "category-pin") {
        nextCategoryPinned.push({ term, values });
      } else if (type === "pin-category-id" || type === "category-id-pin") {
        nextCategoryIdPinned.push({ term, values });
      } else if (type === "suggest" || type === "suggestion" || type === "suggestions") {
        nextNoResults.push({ term, values });
      } else if (type === "redirect") {
        nextRedirects.push({ terms: term, url: values });
      } else {
        nextBoost.push({ term, values });
      }
      applied += 1;
    }

    setPinnedRows(nextPinned);
    setBrandPinnedRows(nextBrandPinned);
    setCategoryPinnedRows(nextCategoryPinned);
    setCategoryIdPinnedRows(nextCategoryIdPinned);
    setBoostRows(nextBoost);
    setNoResultsRows(nextNoResults);
    setRedirects(nextRedirects);
    setPrivateCategoryRows(nextPrivateCategories);
    setHiddenSkus(Array.from(nextHidden).join(", "));
    setStatus(`Applied ${applied} bulk rule${applied === 1 ? "" : "s"}. Click Save to publish.`);
  }

  function upsertMappedRow(
    rows: Array<{ term: string; values: string }>,
    setRows: (rows: Array<{ term: string; values: string }>) => void,
    term: string,
    values: string
  ) {
    const cleanTerm = term.trim();
    const cleanValues = values.trim();
    if (!cleanTerm || !cleanValues) {
      setStatus("Add a search term and values first.");
      return false;
    }

    const index = rows.findIndex((row) => row.term.trim().toLowerCase() === cleanTerm.toLowerCase());
    if (index >= 0) {
      const next = [...rows];
      next[index] = { term: cleanTerm, values: cleanValues };
      setRows(next);
    } else {
      setRows([{ term: cleanTerm, values: cleanValues }, ...rows]);
    }
    return true;
  }

  function pinRowsForScope(scope: PinScope) {
    if (scope === "brand") return { rows: brandPinnedRows, setRows: setBrandPinnedRows, label: "brand" };
    if (scope === "category") return { rows: categoryPinnedRows, setRows: setCategoryPinnedRows, label: "category" };
    if (scope === "category_id") return { rows: categoryIdPinnedRows, setRows: setCategoryIdPinnedRows, label: "category ID" };
    return { rows: pinnedRows, setRows: setPinnedRows, label: "search term" };
  }

  function previewUrlForScope(pageToLoad: number) {
    const cleanTerm = controlTerm.trim();
    const params = new URLSearchParams({
      q: controlScope === "query" ? cleanTerm : "*",
      per_page: String(PREVIEW_PAGE_SIZE),
      page: String(pageToLoad),
    });

    if (controlScope === "brand") params.set("brand", cleanTerm);
    if (controlScope === "category") params.set("category", cleanTerm);
    if (controlScope === "category_id") params.set("category_id", cleanTerm);

    return `/api/search?${params.toString()}`;
  }

  function addPinnedFromBuilder() {
    const scopedPins = pinRowsForScope(controlScope);
    if (upsertMappedRow(scopedPins.rows, scopedPins.setRows, controlTerm, controlPinnedSkus)) {
      setStatus(`Pinned SKUs added for this ${scopedPins.label}. Put the most important SKU first, then click Save.`);
    }
  }

  function loadSavedPinnedRule(term: string, skus: string[], scope: PinScope = "query") {
    setControlScope(scope);
    setControlTerm(term);
    setControlPinnedSkus(joinCsv(skus));
    setStatus(`Loaded pinned rule for "${term}". Edit the SKU order, then click Add / update pins and Save.`);
  }

  function addSynonymsFromBuilder() {
    if (upsertMappedRow(boostRows, setBoostRows, controlTerm, controlSynonyms)) {
      setStatus("Synonyms added. Click Save to publish.");
    }
  }

  function addSuggestionsFromBuilder() {
    if (upsertMappedRow(noResultsRows, setNoResultsRows, controlTerm, controlSuggestions)) {
      setStatus("No-results suggestions added. Click Save to publish.");
    }
  }

  function openSearchTest() {
    const cleanTerm = controlTerm.trim();
    if (!cleanTerm) {
      setStatus("Enter a search term, brand, category, or category ID to test.");
      return;
    }
    window.open(previewUrlForScope(1), "_blank", "noopener,noreferrer");
  }

  function openAutocompleteTest() {
    const cleanTerm = controlTerm.trim();
    if (!cleanTerm || controlScope !== "query") {
      setStatus("Enter a search term to test.");
      return;
    }
    window.open(`/api/autocomplete?q=${encodeURIComponent(cleanTerm)}`, "_blank", "noopener,noreferrer");
  }

  function pinPreviewSku(sku: string) {
    const cleanSku = sku.trim();
    if (!cleanSku) return;
    const current = splitCsv(controlPinnedSkus);
    const next = [cleanSku, ...current.filter((item) => item.toLowerCase() !== cleanSku.toLowerCase())];
    setControlPinnedSkus(joinCsv(next));
    setStatus(`${cleanSku} added to the front of the pinned SKU order. Click Add / update pins, then Save.`);
  }

  function clearSpecificSearchControl() {
    setControlTerm("");
    setControlScope("query");
    setControlPinnedSkus("");
    setControlSynonyms("");
    setControlSuggestions("");
    setPreviewProducts([]);
    setPreviewStatus("");
    setPreviewPage(0);
    setPreviewFound(0);
    setPreviewHasMore(false);
    setStatus("Specific Search Control cleared.");
  }

  async function loadLiveResults() {
    await loadPreviewPage(1, false);
  }

  async function loadMoreLiveResults() {
    await loadPreviewPage(previewPage + 1, true);
  }

  async function loadPreviewPage(pageToLoad: number, append: boolean) {
    const cleanTerm = controlTerm.trim();
    if (!cleanTerm) {
      setPreviewStatus("Enter a search term, brand, category, or category ID first.");
      return;
    }

    setPreviewLoading(true);
    setPreviewStatus(append ? "Loading more live results..." : "Loading live results...");
    try {
      const res = await fetch(previewUrlForScope(pageToLoad), {
        headers: password ? { "x-smartsearch-admin-password": password } : {},
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load live results.");
      const products = (data.hits || []).map((hit: { document?: PreviewProduct }) => hit.document || {});
      const found = Number(data.found || products.length || 0);
      const nextProducts = append ? [...previewProducts] : [];
      const seen = new Set(nextProducts.map((product) => `${product.sku || ""}:${product.name || ""}`));
      for (const product of products) {
        const key = `${product.sku || ""}:${product.name || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        nextProducts.push(product);
      }

      setPreviewFound(found);
      setPreviewPage(pageToLoad);
      setPreviewProducts(nextProducts);
      setPreviewHasMore(nextProducts.length < found && products.length > 0);
      setPreviewStatus(`Showing ${nextProducts.length} of ${found || nextProducts.length} live result${(found || nextProducts.length) === 1 ? "" : "s"}.`);
    } catch (error) {
      if (!append) setPreviewProducts([]);
      setPreviewStatus(error instanceof Error ? error.message : "Could not load live results.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function reindexNow() {
    setStatus("Reindexing products. This can take about a minute...");
    const res = await fetch("/api/reindex", {
      method: "POST",
      headers: {
        "x-smartsearch-admin-password": password,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      setReindexStatus(data || null);
      setStatus(data.error || "Could not run reindex.");
      return;
    }

    setReindexStatus(data || null);
    setStatus(`Reindex complete: ${data.total_records || 0} records, ${data.failed_count || 0} failed.`);
  }

  return (
    <main style={{ fontFamily: "Inter, Arial, sans-serif", background: "#eef3f8", color: "#111827", minHeight: "100vh", padding: 24 }}>
      <section style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ background: "linear-gradient(135deg,#fff,#fff7f7)", border: "1px solid #efd6d6", borderRadius: 22, padding: 24, marginBottom: 18 }}>
          <div style={{ color: "#c34d50", fontWeight: 900, letterSpacing: ".08em", fontSize: 12, textTransform: "uppercase" }}>
            EMRN SmartSearch Admin
          </div>
          <h1 style={{ margin: "8px 0 8px", fontSize: 34 }}>Search Controls</h1>
          <p style={{ margin: 0, color: "#64748b" }}>
            Quickly pin SKUs, hide discontinued items, add redirects, improve query boosts, and customize no-results suggestions.
          </p>

          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="password"
              value={password}
              onChange={(event) => savePasswordPreference(event.target.value, rememberPassword)}
              placeholder="Admin password"
              style={{ flex: "1 1 280px", height: 48, border: "1px solid #e5e7eb", borderRadius: 999, padding: "0 16px", minWidth: 0 }}
            />
            <label style={{ ...outlineButtonStyle, height: 48, gap: 8 }}>
              <input
                type="checkbox"
                checked={rememberPassword}
                onChange={(event) => savePasswordPreference(password, event.target.checked)}
              />
              Remember
            </label>
            <button onClick={loadControls} style={buttonStyle("#14365d")}>Load</button>
            <button onClick={saveControls} disabled={!loaded} style={buttonStyle("#c34d50")}>Save</button>
            <button onClick={reindexNow} style={buttonStyle("#166534")}>Reindex</button>
            <a href="/smartsearch-admin/analytics" style={linkButtonStyle}>Analytics page</a>
          </div>
          <p style={{ margin: "10px 0 0", color: "#64748b", fontSize: 12 }}>
            Remember stores the password only in this browser on this device. The analytics page will auto-fill the same saved password.
          </p>

          {status && (
            <p
              style={{
                margin: "12px 0 0",
                color: /saved|loaded|complete|test event saved|cleared|added|exported|applied/i.test(status) ? "#166534" : "#b91c1c",
                fontWeight: 800,
              }}
            >
              {status}
            </p>
          )}

          <div style={{ marginTop: 18, border: "1px solid #e5e7eb", borderRadius: 16, background: "#ffffff", padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 12, color: "#64748b", fontWeight: 900, textTransform: "uppercase", letterSpacing: ".08em" }}>
                  Nightly Reindex
                </div>
                <h2 style={{ margin: "4px 0 0", fontSize: 20 }}>Last run status</h2>
              </div>
              <span
                style={{
                  borderRadius: 999,
                  padding: "8px 12px",
                  fontWeight: 900,
                  color: reindexStatus?.status === "success" ? "#166534" : (reindexStatus?.status === "running" || reindexStatus?.status === "completed_unconfirmed") && !reindexStatus?.interrupted ? "#92400e" : "#b91c1c",
                  background: reindexStatus?.status === "success" ? "#dcfce7" : (reindexStatus?.status === "running" || reindexStatus?.status === "completed_unconfirmed") && !reindexStatus?.interrupted ? "#fef3c7" : "#fee2e2",
                }}
              >
                {reindexStatus?.interrupted ? "INTERRUPTED" : reindexStatus?.status ? reindexStatus.status.toUpperCase() : "NOT LOADED"}
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
              <ReindexStat label="Finished" value={formatDateTime(reindexStatus?.finished_at)} />
              <ReindexStat label="Products" value={`${(reindexStatus?.indexed_records || reindexStatus?.total_records || 0).toLocaleString()}`} />
              <ReindexStat label="Failed imports" value={`${reindexStatus?.failed_count || 0}`} />
              <ReindexStat label="Duration" value={formatDuration(reindexStatus?.ms)} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 10 }}>
              <ReindexStat label="Live alias" value={reindexStatus?.live_alias || "emrn_products_live"} />
              <ReindexStat label="Current target" value={reindexStatus?.target_collection || "No run recorded yet"} />
            </div>

            {reindexStatus?.error && (
              <div style={{ marginTop: 10, border: "1px solid #fecaca", borderRadius: 12, background: "#fff1f2", color: "#991b1b", padding: 12, fontWeight: 800 }}>
                {reindexStatus.error}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
          <Panel title="Specific Search Control" help="Use this when one search term, brand page, or category page needs hand control. Pin SKUs to force result order. Search terms can also use synonyms and no-results suggestions. Save after adding.">
            <div style={{ display: "grid", gap: 10 }}>
              <label style={fieldLabelStyle}>
                Control type
                <select
                  value={controlScope}
                  onChange={(event) => {
                    setControlScope(event.target.value as PinScope);
                    setPreviewProducts([]);
                    setPreviewStatus("");
                    setPreviewPage(0);
                    setPreviewFound(0);
                    setPreviewHasMore(false);
                  }}
                  style={inputStyle}
                >
                  <option value="query">Search term</option>
                  <option value="brand">Brand page</option>
                  <option value="category">Category name</option>
                  <option value="category_id">Category ID</option>
                </select>
              </label>
              <label style={fieldLabelStyle}>
                {controlScope === "brand" ? "Brand name" : controlScope === "category" ? "Category name" : controlScope === "category_id" ? "Category ID" : "Search term"}
                <input
                  value={controlTerm}
                  onChange={(event) => {
                    setControlTerm(event.target.value);
                    setPreviewProducts([]);
                    setPreviewStatus("");
                    setPreviewPage(0);
                    setPreviewFound(0);
                    setPreviewHasMore(false);
                  }}
                  placeholder={controlScope === "brand" ? "BD" : controlScope === "category" ? "IV Administration" : controlScope === "category_id" ? "123" : "fournitures pour perfusion intraveineuse"}
                  style={inputStyle}
                />
              </label>
              <label style={fieldLabelStyle}>
                Pinned SKUs, first result first
                <input
                  value={controlPinnedSkus}
                  onChange={(event) => setControlPinnedSkus(event.target.value)}
                  placeholder="BD383580, BD383578, BD383577"
                  style={inputStyle}
                />
              </label>
              <label style={fieldLabelStyle}>
                Synonyms / extra terms
                <input
                  value={controlSynonyms}
                  onChange={(event) => setControlSynonyms(event.target.value)}
                  placeholder="IV supplies, IV catheter, IV administration"
                  style={inputStyle}
                  disabled={controlScope !== "query"}
                />
              </label>
              <label style={fieldLabelStyle}>
                No-results suggestions
                <input
                  value={controlSuggestions}
                  onChange={(event) => setControlSuggestions(event.target.value)}
                  placeholder="IV catheters, saline, IV administration sets"
                  style={inputStyle}
                  disabled={controlScope !== "query"}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12 }}>
              <button onClick={addPinnedFromBuilder} style={buttonStyle("#c34d50")}>Add / update pins</button>
              <button onClick={addSynonymsFromBuilder} disabled={controlScope !== "query"} style={buttonStyle("#14365d")}>Add / update synonyms</button>
              <button onClick={addSuggestionsFromBuilder} disabled={controlScope !== "query"} style={buttonStyle("#334155")}>Add suggestions</button>
              <button onClick={() => void loadLiveResults()} style={buttonStyle("#166534")}>{previewLoading ? "Loading..." : `Load first ${PREVIEW_PAGE_SIZE}`}</button>
              <button onClick={openAutocompleteTest} disabled={controlScope !== "query"} style={outlineButtonStyle}>Test autocomplete</button>
              <button onClick={openSearchTest} style={outlineButtonStyle}>Test full search</button>
              <button onClick={clearSpecificSearchControl} style={outlineButtonStyle}>Clear fields</button>
            </div>
            <p style={{ margin: "12px 0 0", color: "#64748b", lineHeight: 1.45 }}>
              Pins are strongest: they force chosen SKUs to the top for that search term, brand page, or category page. Synonyms only apply to search terms.
            </p>
            {previewStatus && <p style={{ margin: "10px 0 0", color: previewStatus.includes("Could not") ? "#b91c1c" : "#166534", fontWeight: 800 }}>{previewStatus}</p>}
            {previewProducts.length ? (
              <div style={{ display: "grid", gap: 8, marginTop: 12, maxHeight: 420, overflow: "auto", border: "1px solid #e5e7eb", borderRadius: 14, padding: 10, background: "#f8fafc" }}>
                {previewProducts.map((product, index) => (
                  <div key={`${product.sku || product.name}-${index}`} style={{ display: "grid", gridTemplateColumns: "54px 1fr auto", gap: 10, alignItems: "center", border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff", padding: 10 }}>
                    <div style={{ width: 54, height: 54, border: "1px solid #eef2f7", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", background: "#fff" }}>
                      {product.image ? <img src={product.image} alt="" style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /> : <span style={{ color: "#94a3b8", fontSize: 11 }}>No img</span>}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ color: "#111827", display: "block", overflowWrap: "anywhere" }}>{product.parent_name || product.name || "Untitled product"}</strong>
                      <div style={{ color: "#64748b", fontSize: 13, marginTop: 3 }}>
                        {product.brand || "EMRN"} {product.sku ? `• SKU: ${product.sku}` : ""}
                      </div>
                      {product.smart_reasons?.length ? (
                        <div style={{ color: "#166534", fontSize: 12, fontWeight: 800, marginTop: 4 }}>{product.smart_reasons.slice(0, 2).join(", ")}</div>
                      ) : null}
                    </div>
                    <button onClick={() => pinPreviewSku(product.sku || "")} disabled={!product.sku} style={smallActionButtonStyle}>
                      Pin
                    </button>
                  </div>
                ))}
                {previewHasMore ? (
                  <button onClick={() => void loadMoreLiveResults()} disabled={previewLoading} style={{ ...outlineButtonStyle, justifySelf: "center", marginTop: 4 }}>
                    {previewLoading ? "Loading..." : `Load more results (${previewProducts.length}/${previewFound})`}
                  </button>
                ) : null}
              </div>
            ) : null}
            {Object.keys(savedRuntime.pinnedSkus || {}).length ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: "#64748b", fontWeight: 900, fontSize: 12, marginBottom: 6 }}>Load saved pinned rule</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {(showAllSavedPinShortcuts ? Object.entries(savedRuntime.pinnedSkus) : Object.entries(savedRuntime.pinnedSkus).slice(0, 8)).map(([term, skus]) => (
                    <button key={term} onClick={() => loadSavedPinnedRule(term, skus)} style={outlineButtonStyle}>{term}</button>
                  ))}
                </div>
                {Object.keys(savedRuntime.pinnedSkus).length > 8 ? (
                  <button onClick={() => setShowAllSavedPinShortcuts(!showAllSavedPinShortcuts)} style={{ ...outlineButtonStyle, marginTop: 8 }}>
                    {showAllSavedPinShortcuts ? "Show fewer saved pins" : `View all ${Object.keys(savedRuntime.pinnedSkus).length} saved pins`}
                  </button>
                ) : null}
              </div>
            ) : null}
            {Object.keys(savedRuntime.brandPinnedSkus || {}).length || Object.keys(savedRuntime.categoryPinnedSkus || {}).length || Object.keys(savedRuntime.categoryIdPinnedSkus || {}).length ? (
              <div style={{ marginTop: 12 }}>
                <div style={{ color: "#64748b", fontWeight: 900, fontSize: 12, marginBottom: 6 }}>Load saved brand/category rule</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {Object.entries(savedRuntime.brandPinnedSkus || {}).slice(0, 6).map(([term, skus]) => (
                    <button key={`brand-${term}`} onClick={() => loadSavedPinnedRule(term, skus, "brand")} style={outlineButtonStyle}>Brand: {term}</button>
                  ))}
                  {Object.entries(savedRuntime.categoryPinnedSkus || {}).slice(0, 6).map(([term, skus]) => (
                    <button key={`category-${term}`} onClick={() => loadSavedPinnedRule(term, skus, "category")} style={outlineButtonStyle}>Category: {term}</button>
                  ))}
                  {Object.entries(savedRuntime.categoryIdPinnedSkus || {}).slice(0, 6).map(([term, skus]) => (
                    <button key={`category-id-${term}`} onClick={() => loadSavedPinnedRule(term, skus, "category_id")} style={outlineButtonStyle}>Category ID: {term}</button>
                  ))}
                </div>
              </div>
            ) : null}
          </Panel>

          <Panel title="Bulk Keyword Rules" help="Paste many rules at once. Use pin, synonym, suggest, hide, or redirect. Example: synonym: cat tourniquet => combat application tourniquet, CAT">
            <textarea
              value={bulkRules}
              onChange={(event) => setBulkRules(event.target.value)}
              placeholder={"boost: cat tourniquet => combat application tourniquet, CAT\npin: cat tourniquet => 30001OR, 30001NO, 30001BL\nhide: X-REDO-RETURN-PACKAGE-PROTECTION\nredirect: student specials => /student-specials/"}
              style={{ ...textareaStyle, minHeight: 220 }}
            />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
              <button onClick={applyBulkRules} style={buttonStyle("#14365d")}>Apply bulk rules</button>
              <button onClick={exportBulkRules} style={outlineButtonStyle}>Export current rules</button>
            </div>
          </Panel>

          <Panel title="Pinned SKUs" help="Put specific SKUs at the top for a search term. Example: term gloves, values AMDI147-9, AMDI147-8.5">
            <Rows rows={pinnedRows} setRows={setPinnedRows} leftLabel="Search term" rightLabel="SKUs, comma separated" />
            <SavedRules title="Saved pinned SKUs" map={savedRuntime.pinnedSkus} emptyText="No saved pinned SKUs yet." />
          </Panel>

          <Panel title="Brand & Category Pins" help="Put specific SKUs at the top when a customer is browsing a brand page or filtered category page. Use the live preview above to find and pin products, or edit rows here.">
            <h3 style={subheadStyle}>Brand page pins</h3>
            <Rows rows={brandPinnedRows} setRows={setBrandPinnedRows} leftLabel="Brand name" rightLabel="SKUs, comma separated" />
            <SavedRules title="Saved brand pins" map={savedRuntime.brandPinnedSkus} emptyText="No saved brand pins yet." />
            <h3 style={subheadStyle}>Category name pins</h3>
            <Rows rows={categoryPinnedRows} setRows={setCategoryPinnedRows} leftLabel="Category name" rightLabel="SKUs, comma separated" />
            <SavedRules title="Saved category name pins" map={savedRuntime.categoryPinnedSkus} emptyText="No saved category name pins yet." />
            <h3 style={subheadStyle}>Category ID pins</h3>
            <Rows rows={categoryIdPinnedRows} setRows={setCategoryIdPinnedRows} leftLabel="Category ID" rightLabel="SKUs, comma separated" />
            <SavedRules title="Saved category ID pins" map={savedRuntime.categoryIdPinnedSkus} emptyText="No saved category ID pins yet." />
          </Panel>

          <Panel title="Hidden SKUs" help="Hide discontinued or unwanted SKUs from SmartSearch. Comma separated.">
            <textarea
              value={hiddenSkus}
              onChange={(event) => setHiddenSkus(event.target.value)}
              placeholder="OLD-SKU-123, DISCONTINUED-456"
              style={textareaStyle}
            />
          </Panel>

          <Panel title="Hidden / Private Categories" help="Hide every product assigned to a category from SmartSearch. Leave allowed customers blank to hide from everyone; add customer IDs to make it visible only for those clients.">
            <PrivateCategoryRows rows={privateCategoryRows} setRows={setPrivateCategoryRows} />
            <SavedPrivateCategoryRules rules={savedRuntime.privateCategoryRules} />
          </Panel>

          <Panel title="Redirects" help="Send exact searches to a landing page. Example: student specials → /student-specials/">
            <RedirectRows rows={redirects} setRows={setRedirects} />
          </Panel>

          <Panel title="Synonyms" help="Type a keyword and the terms SmartSearch should also search for. Example: glove → gloves, gants, nitrile gloves. Use the × button to undo/remove a saved synonym row.">
            <label style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, fontWeight: 900 }}>
              <input
                type="checkbox"
                checked={twoWaySynonyms}
                onChange={(event) => setTwoWaySynonyms(event.target.checked)}
              />
              Multi-directional synonyms
            </label>
            <p style={{ margin: "0 0 12px", color: "#475569", lineHeight: 1.45 }}>
              On means glove also finds gloves, and gloves also finds glove. Synonyms add extra search terms; they do not guarantee order. Use pinned SKUs when specific products must appear first.
            </p>
            <Rows rows={boostRows} setRows={setBoostRows} leftLabel="Keyword" rightLabel="Synonyms, comma separated" />
            <SavedRules title="Saved synonyms" map={savedRuntime.boostTerms} emptyText="No saved synonyms yet." />
          </Panel>

          <Panel title="Natural Language Rules" help="Editable broad-query planner rules. A saved phrase here overrides the built-in mapping for that phrase. Use categoryQueries for category recall, recallQueries for product terms, and avoidTerms to push wrong literal matches down.">
            <div style={{ display: "grid", gap: 10, marginBottom: 14, padding: 12, border: "1px solid #e5e7eb", borderRadius: 14, background: "#f8fafc" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={fieldLabelStyle}>
                  Phrase
                  <input
                    value={naturalRulePhrase}
                    onChange={(event) => setNaturalRulePhrase(event.target.value)}
                    placeholder="doctor office supplies"
                    style={inputStyle}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  Categories
                  <input
                    value={naturalRuleCategories}
                    onChange={(event) => setNaturalRuleCategories(event.target.value)}
                    placeholder="Nursing Supplies, Diagnostics, Wound Care"
                    style={inputStyle}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  Product terms
                  <input
                    value={naturalRuleTerms}
                    onChange={(event) => setNaturalRuleTerms(event.target.value)}
                    placeholder="exam gloves, masks, otoscope, blood pressure cuff"
                    style={inputStyle}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  Avoid terms
                  <input
                    value={naturalRuleAvoid}
                    onChange={(event) => setNaturalRuleAvoid(event.target.value)}
                    placeholder="office binder, copy paper"
                    style={inputStyle}
                  />
                </label>
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" onClick={addNaturalLanguageRuleFromBuilder} style={buttonStyle("#14365d")}>
                  Add / update rule
                </button>
                <button type="button" onClick={() => void testNaturalLanguageRule()} style={outlineButtonStyle}>
                  Test autocomplete
                </button>
                <button type="button" onClick={fillClinicRuleExample} style={outlineButtonStyle}>
                  Load clinic example
                </button>
                {naturalRuleTestStatus ? <span style={{ color: /found|ready/i.test(naturalRuleTestStatus) ? "#166534" : "#b91c1c", fontWeight: 800 }}>{naturalRuleTestStatus}</span> : null}
              </div>
            </div>
            <SavedNaturalLanguageRules
              rules={parseNaturalLanguageRulesJson(naturalLanguageRulesJson)}
              onLoad={loadNaturalLanguageRuleIntoBuilder}
            />
            <button type="button" onClick={() => setShowNaturalLanguageJson(!showNaturalLanguageJson)} style={{ ...outlineButtonStyle, marginTop: 12 }}>
              {showNaturalLanguageJson ? "Hide JSON editor" : "Show JSON editor"}
            </button>
            {showNaturalLanguageJson ? (
              <>
                <textarea
                  value={naturalLanguageRulesJson}
                  onChange={(event) => setNaturalLanguageRulesJson(event.target.value)}
                  placeholder={'{\n  "clinic supplies": {\n    "categoryQueries": ["Nursing Supplies", "Diagnostics", "Wound Care"],\n    "recallQueries": ["exam gloves", "otoscope", "blood pressure cuff"],\n    "avoidTerms": ["office binder", "copy paper"]\n  }\n}'}
                  style={{ ...textareaStyle, minHeight: 220, marginTop: 10, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13 }}
                />
                <p style={{ margin: "10px 0 0", color: validateNaturalLanguageRulesJson(naturalLanguageRulesJson) ? "#166534" : "#b91c1c", fontWeight: 800 }}>
                  {validateNaturalLanguageRulesJson(naturalLanguageRulesJson) ? "JSON is valid." : "JSON has an error."}
                </p>
              </>
            ) : null}
          </Panel>

          <Panel title="No-Results Suggestions" help="Suggestions to show when a search has no results.">
            <Rows rows={noResultsRows} setRows={setNoResultsRows} leftLabel="Search term" rightLabel="Suggestions, comma separated" />
          </Panel>

          <Panel title="Test Links" help="Use these after saving.">
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a style={linkButtonStyle} href="/smartsearch-lab" target="_blank">Open Lab</a>
              <a style={linkButtonStyle} href="/api/search?q=gloves" target="_blank">API: gloves</a>
              <a style={linkButtonStyle} href="/api/search?q=gants" target="_blank">API: gants</a>
            </div>
          </Panel>

          <Panel title="Effective Rules View" help="This shows the rules SmartSearch is actually using: your saved rules plus built-in defaults.">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              <SavedRules title="All active pinned SKUs" map={effectiveControls.pinnedSkus} emptyText="Load controls to view active pinned SKUs." compact />
              <SavedRules title="All active brand pins" map={effectiveControls.brandPinnedSkus} emptyText="Load controls to view active brand pins." compact />
              <SavedRules title="All active category name pins" map={effectiveControls.categoryPinnedSkus} emptyText="Load controls to view active category name pins." compact />
              <SavedRules title="All active category ID pins" map={effectiveControls.categoryIdPinnedSkus} emptyText="Load controls to view active category ID pins." compact />
              <SavedRules title="All active synonyms" map={effectiveControls.boostTerms} emptyText="Load controls to view active synonyms." compact />
              <SavedRules title="Built-in pinned SKUs" map={defaultControls.pinnedSkus} emptyText="No default pinned SKUs." compact />
              <SavedRules title="Built-in brand pins" map={defaultControls.brandPinnedSkus} emptyText="No default brand pins." compact />
              <SavedRules title="Built-in category name pins" map={defaultControls.categoryPinnedSkus} emptyText="No default category name pins." compact />
              <SavedRules title="Built-in category ID pins" map={defaultControls.categoryIdPinnedSkus} emptyText="No default category ID pins." compact />
              <SavedRules title="Built-in synonyms" map={defaultControls.boostTerms} emptyText="No default synonyms." compact />
              <SavedPrivateCategoryRules rules={effectiveControls.privateCategoryRules} title="All active hidden/private categories" compact />
            </div>
          </Panel>
        </div>
      </section>
    </main>
  );
}

function SavedRules({
  title,
  map = {},
  emptyText,
  compact = false,
}: {
  title: string;
  map?: Record<string, string[]>;
  emptyText: string;
  compact?: boolean;
}) {
  const rows = Object.entries(map || {}).filter(([, values]) => values.length).sort(([a], [b]) => a.localeCompare(b));
  const [showAll, setShowAll] = useState(false);
  const previewCount = compact ? 4 : 6;
  const visibleRows = showAll ? rows : rows.slice(0, previewCount);

  return (
    <div style={{ marginTop: 14, border: "1px solid #e5e7eb", borderRadius: 14, background: "#f8fafc", padding: 12 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 15, color: "#111827" }}>
        {title}{rows.length ? ` (${rows.length})` : ""}
      </h3>
      {rows.length ? (
        <>
          <div style={{ maxHeight: showAll ? (compact ? 220 : 320) : "none", overflow: showAll ? "auto" : "visible", display: "grid", gap: 8 }}>
            {visibleRows.map(([term, values]) => (
              <div key={term} style={{ display: "grid", gridTemplateColumns: compact ? "1fr" : "160px 1fr", gap: 8, padding: 10, border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}>
                <strong style={{ color: "#14365d", overflowWrap: "anywhere" }}>{term}</strong>
                <span style={{ color: "#334155", overflowWrap: "anywhere" }}>{values.join(", ")}</span>
              </div>
            ))}
          </div>
          {rows.length > visibleRows.length || showAll ? (
            <button onClick={() => setShowAll(!showAll)} style={{ ...outlineButtonStyle, marginTop: 10 }}>
              {showAll ? "Show fewer" : `View all ${rows.length} saved rules`}
            </button>
          ) : null}
        </>
      ) : (
        <p style={{ color: "#64748b", margin: 0 }}>{emptyText}</p>
      )}
    </div>
  );
}

function SavedNaturalLanguageRules({
  rules = {},
  onLoad,
}: {
  rules?: Record<string, NaturalLanguageRule>;
  onLoad: (phrase: string, rule: NaturalLanguageRule) => void;
}) {
  const rows = Object.entries(rules || {}).sort(([a], [b]) => a.localeCompare(b));
  const [showAll, setShowAll] = useState(false);
  const visibleRows = showAll ? rows : rows.slice(0, 6);

  return (
    <div style={{ marginTop: 14, border: "1px solid #e5e7eb", borderRadius: 14, background: "#fff", padding: 12 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 15, color: "#111827" }}>
        Saved natural-language rules{rows.length ? ` (${rows.length})` : ""}
      </h3>
      {rows.length ? (
        <>
          <div style={{ display: "grid", gap: 8, maxHeight: showAll ? 320 : "none", overflow: showAll ? "auto" : "visible" }}>
            {visibleRows.map(([phrase, rule]) => (
              <div key={phrase} style={{ display: "grid", gridTemplateColumns: "180px 1fr auto", gap: 10, padding: 10, border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc", alignItems: "start" }}>
                <strong style={{ color: "#14365d", overflowWrap: "anywhere" }}>{phrase}</strong>
                <div style={{ color: "#334155", fontSize: 13, lineHeight: 1.45, overflowWrap: "anywhere" }}>
                  <div><b>Categories:</b> {(rule.categoryQueries || []).join(", ") || "none"}</div>
                  <div><b>Product terms:</b> {(rule.recallQueries || []).join(", ") || "none"}</div>
                  {(rule.avoidTerms || []).length ? <div><b>Avoid:</b> {(rule.avoidTerms || []).join(", ")}</div> : null}
                </div>
                <button type="button" onClick={() => onLoad(phrase, rule)} style={smallActionButtonStyle}>Edit</button>
              </div>
            ))}
          </div>
          {rows.length > visibleRows.length || showAll ? (
            <button type="button" onClick={() => setShowAll(!showAll)} style={{ ...outlineButtonStyle, marginTop: 10 }}>
              {showAll ? "Show fewer" : `View all ${rows.length} saved rules`}
            </button>
          ) : null}
        </>
      ) : (
        <p style={{ color: "#64748b", margin: 0 }}>No saved natural-language rules yet. Use the form above to add one.</p>
      )}
    </div>
  );
}

function SavedPrivateCategoryRules({
  rules = [],
  title = "Saved hidden/private categories",
  compact = false,
}: {
  rules?: PrivateCategoryRule[];
  title?: string;
  compact?: boolean;
}) {
  const activeRules = rules || [];
  const [showAll, setShowAll] = useState(false);
  const previewCount = compact ? 4 : 6;
  const visibleRules = showAll ? activeRules : activeRules.slice(0, previewCount);

  return (
    <div style={{ marginTop: 14, border: "1px solid #e5e7eb", borderRadius: 14, background: "#f8fafc", padding: 12 }}>
      <h3 style={{ margin: "0 0 10px", fontSize: 15, color: "#111827" }}>
        {title}{activeRules.length ? ` (${activeRules.length})` : ""}
      </h3>
      {activeRules.length ? (
        <>
          <div style={{ maxHeight: showAll ? (compact ? 220 : 260) : "none", overflow: showAll ? "auto" : "visible", display: "grid", gap: 8 }}>
            {visibleRules.map((rule, index) => (
              <div key={`${rule.label}-${index}`} style={{ padding: 10, border: "1px solid #e2e8f0", borderRadius: 12, background: "#fff" }}>
                <strong style={{ color: rule.enabled === false ? "#64748b" : "#14365d", overflowWrap: "anywhere" }}>
                  {rule.label || `Category rule ${index + 1}`} {rule.enabled === false ? "(off)" : ""}
                </strong>
                <div style={{ color: "#334155", marginTop: 6, overflowWrap: "anywhere" }}>
                  {rule.categoryIds?.length ? `IDs: ${rule.categoryIds.join(", ")}` : ""}
                  {rule.categoryIds?.length && rule.categoryNames?.length ? " | " : ""}
                  {rule.categoryNames?.length ? `Names: ${rule.categoryNames.join(", ")}` : ""}
                </div>
                <div style={{ color: "#64748b", marginTop: 5 }}>
                  {rule.allowedCustomerIds?.length ? `Visible only to customers: ${rule.allowedCustomerIds.join(", ")}` : "Hidden from everyone"}
                </div>
              </div>
            ))}
          </div>
          {activeRules.length > visibleRules.length || showAll ? (
            <button onClick={() => setShowAll(!showAll)} style={{ ...outlineButtonStyle, marginTop: 10 }}>
              {showAll ? "Show fewer" : `View all ${activeRules.length} saved rules`}
            </button>
          ) : null}
        </>
      ) : (
        <p style={{ color: "#64748b", margin: 0 }}>No hidden/private category rules yet.</p>
      )}
    </div>
  );
}

function rowsToBidirectionalMap(rows: Array<{ term: string; values: string }>) {
  const output: Record<string, Set<string>> = {};

  for (const row of rows) {
    const term = row.term.trim();
    const values = splitCsv(row.values);
    if (!term || !values.length) continue;
    output[term] = output[term] || new Set<string>();
    values.forEach((value) => {
      output[term].add(value);
      output[value] = output[value] || new Set<string>();
      output[value].add(term);
      values.filter((other) => other !== value).forEach((other) => output[value].add(other));
    });
  }

  return Object.fromEntries(Object.entries(output).map(([term, values]) => [term, Array.from(values)]));
}

function PrivateCategoryRows({
  rows,
  setRows,
}: {
  rows: Array<{ enabled: boolean; label: string; categoryIds: string; categoryNames: string; allowedCustomerIds: string }>;
  setRows: (rows: Array<{ enabled: boolean; label: string; categoryIds: string; categoryNames: string; allowedCustomerIds: string }>) => void;
}) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "74px 1fr 1fr 1fr 1fr 38px", gap: 8, color: "#64748b", fontWeight: 900, fontSize: 12, marginBottom: 6 }}>
        <div>On</div>
        <div>Label</div>
        <div>Category IDs</div>
        <div>Category names</div>
        <div>Allowed customer IDs</div>
        <div />
      </div>

      {rows.map((row, index) => (
        <div key={index} style={{ display: "grid", gridTemplateColumns: "74px 1fr 1fr 1fr 1fr 38px", gap: 8, marginBottom: 8 }}>
          <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 40, border: "1px solid #e5e7eb", borderRadius: 12, background: "#fff" }}>
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(event) => {
                const next = [...rows];
                next[index] = { ...row, enabled: event.target.checked };
                setRows(next);
              }}
            />
          </label>
          <input
            value={row.label}
            placeholder="Cite of Barrie"
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, label: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <input
            value={row.categoryIds}
            placeholder="123, 456"
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, categoryIds: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <input
            value={row.categoryNames}
            placeholder="Cite of Barrie"
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, categoryNames: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <input
            value={row.allowedCustomerIds}
            placeholder="Blank = everyone hidden"
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, allowedCustomerIds: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <button onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))} style={smallButtonStyle}>×</button>
        </div>
      ))}

      <button onClick={() => setRows([...rows, { enabled: true, label: "", categoryIds: "", categoryNames: "", allowedCustomerIds: "" }])} style={outlineButtonStyle}>
        + Add category rule
      </button>
    </div>
  );
}

function Panel({ title, help, children }: { title: string; help: string; children: React.ReactNode }) {
  return (
    <section style={{ background: "#fff", border: "1px solid #d8e1ea", borderRadius: 18, padding: 18, boxShadow: "0 10px 24px rgba(15,23,42,.05)" }}>
      <h2 style={{ margin: 0, fontSize: 22, color: "#111827" }}>{title}</h2>
      <p style={{ color: "#64748b", margin: "6px 0 14px", lineHeight: 1.4 }}>{help}</p>
      {children}
    </section>
  );
}

function Rows({
  rows,
  setRows,
  leftLabel,
  rightLabel,
}: {
  rows: Array<{ term: string; values: string }>;
  setRows: (rows: Array<{ term: string; values: string }>) => void;
  leftLabel: string;
  rightLabel: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const previewCount = 5;
  const visibleRows = showAll ? rows : rows.slice(0, previewCount);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 38px", gap: 8, color: "#64748b", fontWeight: 900, fontSize: 12, marginBottom: 6 }}>
        <div>{leftLabel}</div>
        <div>{rightLabel}</div>
        <div />
      </div>

      {visibleRows.map((row, actualIndex) => {
        return (
        <div key={actualIndex} style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 38px", gap: 8, marginBottom: 8 }}>
          <input
            value={row.term}
            onChange={(event) => {
              const next = [...rows];
              next[actualIndex] = { ...row, term: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <input
            value={row.values}
            onChange={(event) => {
              const next = [...rows];
              next[actualIndex] = { ...row, values: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <button onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== actualIndex))} style={smallButtonStyle}>×</button>
        </div>
      )})}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={() => {
          setRows([{ term: "", values: "" }, ...rows]);
          setShowAll(false);
        }} style={outlineButtonStyle}>+ Add row</button>
        {rows.length > previewCount ? (
          <button onClick={() => setShowAll(!showAll)} style={outlineButtonStyle}>
            {showAll ? "Show fewer" : `View all ${rows.length} rows`}
          </button>
        ) : null}
        {rows.length > previewCount && !showAll ? (
          <span style={{ color: "#64748b", fontWeight: 800 }}>{rows.length - previewCount} more hidden</span>
        ) : null}
      </div>
    </div>
  );
}

function RedirectRows({
  rows,
  setRows,
}: {
  rows: Array<{ terms: string; url: string }>;
  setRows: (rows: Array<{ terms: string; url: string }>) => void;
}) {
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 38px", gap: 8, color: "#64748b", fontWeight: 900, fontSize: 12, marginBottom: 6 }}>
        <div>Search terms</div>
        <div>URL</div>
        <div />
      </div>

      {rows.map((row, index) => (
        <div key={index} style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 38px", gap: 8, marginBottom: 8 }}>
          <input
            value={row.terms}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, terms: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <input
            value={row.url}
            onChange={(event) => {
              const next = [...rows];
              next[index] = { ...row, url: event.target.value };
              setRows(next);
            }}
            style={inputStyle}
          />
          <button onClick={() => setRows(rows.filter((_, rowIndex) => rowIndex !== index))} style={smallButtonStyle}>×</button>
        </div>
      ))}

      <button onClick={() => setRows([...rows, { terms: "", url: "" }])} style={outlineButtonStyle}>+ Add redirect</button>
    </div>
  );
}

function ReindexStat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid #e5e7eb", borderRadius: 12, background: "#f8fafc", padding: 12, minWidth: 0 }}>
      <div style={{ color: "#64748b", fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: ".04em" }}>{label}</div>
      <div style={{ marginTop: 5, color: "#111827", fontSize: 15, fontWeight: 900, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

function buttonStyle(background: string) {
  return {
    height: 48,
    border: 0,
    borderRadius: 999,
    background,
    color: "#fff",
    padding: "0 22px",
    fontWeight: 900,
    cursor: "pointer",
  };
}

const inputStyle = {
  height: 40,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: "0 10px",
  minWidth: 0,
  color: "#111827",
  background: "#fff",
};

const fieldLabelStyle = {
  display: "grid",
  gap: 6,
  color: "#475569",
  fontSize: 13,
  fontWeight: 900,
};

const subheadStyle = {
  margin: "18px 0 10px",
  color: "#14365d",
  fontSize: 15,
};

const textareaStyle = {
  width: "100%",
  minHeight: 160,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  padding: 12,
  resize: "vertical" as const,
  color: "#111827",
  background: "#fff",
};

const smallButtonStyle = {
  height: 40,
  border: 0,
  borderRadius: 12,
  background: "#fee2e2",
  color: "#991b1b",
  fontWeight: 900,
  cursor: "pointer",
};

const smallActionButtonStyle = {
  height: 38,
  border: 0,
  borderRadius: 999,
  background: "#c34d50",
  color: "#fff",
  padding: "0 14px",
  fontWeight: 900,
  cursor: "pointer",
};

const outlineButtonStyle = {
  height: 40,
  border: "1px solid #e5e7eb",
  borderRadius: 999,
  background: "#fff",
  padding: "0 14px",
  fontWeight: 900,
  color: "#14365d",
  cursor: "pointer",
};

const linkButtonStyle = {
  display: "inline-flex",
  alignItems: "center",
  height: 40,
  border: "1px solid #e5e7eb",
  borderRadius: 999,
  background: "#fff",
  padding: "0 14px",
  fontWeight: 900,
  color: "#14365d",
  textDecoration: "none",
};
