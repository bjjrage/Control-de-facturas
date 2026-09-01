import { CurrencyCode } from "./types";

export function formatMoney(value: number | null | undefined, currency: CurrencyCode = "PYG") {
  if (value === null || value === undefined) return "-";
  const decimals = currency === "PYG" ? 0 : 2;
  return new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value) + " " + currency;
}

export function formatNumber(value: number | null | undefined, decimals = 2) {
  if (value === null || value === undefined) return "-";
  return new Intl.NumberFormat("es-PY", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("es-PY", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
}

export function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("es-PY", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function pctDiff(value: number, base: number) {
  if (base === 0) return 0;
  return ((value - base) / base) * 100;
}
