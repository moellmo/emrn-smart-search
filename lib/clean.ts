export function stripHtml(input: string | null | undefined): string {
  if (!input) return "";

  return input
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeSku(input: string | null | undefined): string {
  return (input || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/_/g, "-");
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr.filter(Boolean)));
}
