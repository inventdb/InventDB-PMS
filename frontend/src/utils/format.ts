// Small formatting helpers shared across the UI.

export function formatCurrency(value: unknown): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return n.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function formatCurrencyPrecise(value: unknown): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}

export function formatNumber(value: unknown): string {
  const n = toNumber(value);
  if (n === null) return "—";
  return n.toLocaleString();
}

export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function formatDate(value: unknown): string {
  if (!value) return "—";
  const s = String(value);
  const d = new Date(s.length <= 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatCell(value: unknown, type: string): string {
  if (type === "boolean") {
    if (value === null || value === undefined || value === "") return "—";
    return value === true || value === "true" ? "Yes" : "No";
  }
  if (value === null || value === undefined || value === "") return "—";
  switch (type) {
    case "currency":
      return formatCurrency(value);
    case "date":
      return formatDate(value);
    case "number":
      return formatNumber(value);
    default:
      return String(value);
  }
}

export function titleCase(text: string): string {
  return text.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
