export type InitialStockColumnKey = "material" | "quantity" | "unit" | "location" | "unitCost" | "currency" | "exchangeRate";

export const INITIAL_STOCK_COLUMNS: { key: InitialStockColumnKey; label: string; required: boolean }[] = [
  { key: "material", label: "Material", required: true },
  { key: "quantity", label: "Cantidad", required: true },
  { key: "unit", label: "Unidad", required: false },
  { key: "location", label: "Ubicación", required: true },
  { key: "unitCost", label: "Costo unitario", required: true },
  { key: "currency", label: "Moneda", required: true },
  { key: "exchangeRate", label: "Tipo de cambio a PYG", required: false },
];

const SYNONYMS: Record<InitialStockColumnKey, string[]> = {
  material: ["material", "materiales", "producto", "nombre", "insumo", "description"],
  quantity: ["cantidad", "existencia", "stock", "qty", "quantity"],
  unit: ["unidad", "unit", "um"],
  location: ["ubicacion", "deposito", "almacen", "obra", "location", "warehouse"],
  unitCost: ["costo unitario", "costo", "cost", "unit cost", "precio unitario"],
  currency: ["moneda", "currency", "divisa"],
  exchangeRate: ["tipo de cambio", "exchange rate", "tc", "cambio a pyg", "rate"],
};

export function normalizeInventoryImportText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function findUniqueExactInventoryMatch<T extends { id: string; name: string }>(
  value: string,
  options: readonly T[],
): T | null {
  const key = normalizeInventoryImportText(value);
  if (!key) return null;
  const matches = options.filter((option) => normalizeInventoryImportText(option.name) === key);
  return matches.length === 1 ? matches[0] : null;
}

export function parseInventoryImportNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  let normalized = value.trim().replace(/[\s\u00a0]/g, "").replace(/[^0-9,.-]/g, "");
  if (!normalized || !/^-?[0-9.,]+$/.test(normalized)) return null;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? "," : ".";
    const grouping = decimal === "," ? /\./g : /,/g;
    normalized = normalized.replace(grouping, "").replace(decimal, ".");
  } else if (comma >= 0) {
    const tail = normalized.length - comma - 1;
    normalized = tail === 3 && comma > 0 ? normalized.replace(/,/g, "") : normalized.replace(",", ".");
  } else if (dot >= 0 && normalized.length - dot - 1 === 3 && dot > 0) {
    normalized = normalized.replace(/\./g, "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseInventoryImportCurrency(value: string): "PYG" | "USD" | "EUR" | "BRL" | "ARS" | null {
  const normalized = normalizeInventoryImportText(value).toUpperCase();
  const codes = ["PYG", "USD", "EUR", "BRL", "ARS"] as const;
  const code = codes.find((candidate) => normalized === candidate);
  if (code) return code;
  if (["guarani", "guaranies", "gs", "gs.", "₲"].includes(value.trim().toLocaleLowerCase("es"))) return "PYG";
  if (normalized === "real" || normalized === "reales") return "BRL";
  if (normalized === "euro" || normalized === "euros") return "EUR";
  if (normalized === "dolar" || normalized === "dolares") return null;
  if (normalized === "peso argentino" || normalized === "pesos argentinos") return "ARS";
  return null;
}

export function detectInitialStockColumnMapping(headers: readonly string[]): Record<InitialStockColumnKey, number> {
  const normalizedHeaders = headers.map(normalizeInventoryImportText);
  return Object.fromEntries(INITIAL_STOCK_COLUMNS.map(({ key }) => {
    const synonyms = SYNONYMS[key].map(normalizeInventoryImportText);
    let bestIndex = -1;
    let bestScore = -1;
    normalizedHeaders.forEach((header, index) => {
      const score = synonyms.reduce((best, synonym) => {
        const isWholePhrase = ` ${header} `.includes(` ${synonym} `);
        return isWholePhrase ? Math.max(best, synonym.length) : best;
      }, -1);
      if (score > bestScore) {
        bestIndex = index;
        bestScore = score;
      }
    });
    return [key, bestScore >= 0 ? bestIndex : -1];
  })) as Record<InitialStockColumnKey, number>;
}
