import { normalizeInventoryImportText, findUniqueExactInventoryMatch } from "@/lib/inventory/initial-stock-import";

// ---------------------------------------------------------------------------
// Plantillas de APU a nivel EMPRESA (no por obra): la receta que la
// constructora ya tiene armada (materiales/mano de obra/equipo por tipo de
// ítem, ej. "Mampostería de elevación con ladrillo común"), cargada UNA vez
// y reutilizable en cualquier obra futura. El match contra las partidas de
// un presupuesto es por DESCRIPCIÓN normalizada (exacta, única) — no por
// código, porque el código de partida varía de obra en obra pero el nombre
// del trabajo es el mismo. Fail-closed: ambiguo o sin match → no se aplica,
// se informa para revisión manual (nunca se inventa ni se aplica a ciegas).
// ---------------------------------------------------------------------------

export interface ApuTemplateCatalogEntry {
  id: string;
  nombre: string;
}

export interface BudgetItemForTemplateMatch {
  id: string;
  description: string;
}

export interface ApuTemplateMatch {
  budgetItemId: string;
  templateId: string;
}

export interface ApuTemplateMatchResult {
  matched: ApuTemplateMatch[];
  unmatched: { budgetItemId: string; description: string }[];
}

/**
 * Matchea partidas de una obra contra las plantillas de la empresa por
 * descripción normalizada exacta y única. No matchea partidas que ya
 * tengan APU cargado (se filtran antes de llamar esta función).
 */
export function matchBudgetItemsToApuTemplates(
  budgetItems: BudgetItemForTemplateMatch[],
  templates: ApuTemplateCatalogEntry[]
): ApuTemplateMatchResult {
  const templateOptions = templates.map((t) => ({ id: t.id, name: t.nombre }));
  const matched: ApuTemplateMatch[] = [];
  const unmatched: { budgetItemId: string; description: string }[] = [];
  for (const item of budgetItems) {
    const found = findUniqueExactInventoryMatch(item.description, templateOptions);
    if (found) {
      matched.push({ budgetItemId: item.id, templateId: found.id });
    } else {
      unmatched.push({ budgetItemId: item.id, description: item.description });
    }
  }
  return { matched, unmatched };
}

// --- Importación masiva de plantillas (una sola vez, a nivel empresa) -----

export interface ApuTemplateImportRowError {
  row: number;
  reason: string;
}

export interface ApuTemplateMaterialImportRowInput {
  templateNombre: string;
  productSku: string;
  quantityPerUnit: number;
  desperdicioPct?: number;
}

export interface MappedApuTemplateMaterialRow {
  templateNombre: string;
  productoId: string;
  cantidadPorUnidad: number;
  desperdicioPct: number;
}

export function resolveApuTemplateMaterialImportMapping(
  rows: ApuTemplateMaterialImportRowInput[],
  products: { id: string; sku: string }[]
): { mapped: MappedApuTemplateMaterialRow[]; errors: ApuTemplateImportRowError[] } {
  const productBySku = new Map<string, { id: string; sku: string }[]>();
  for (const p of products) {
    const key = String(p.sku ?? "").trim();
    if (!key) continue;
    if (!productBySku.has(key)) productBySku.set(key, []);
    productBySku.get(key)!.push(p);
  }
  const mapped: MappedApuTemplateMaterialRow[] = [];
  const errors: ApuTemplateImportRowError[] = [];
  const seenPairs = new Set<string>();

  (rows ?? []).forEach((r, idx) => {
    const rowNo = idx + 1;
    const nombre = String(r.templateNombre ?? "").trim();
    if (!nombre) {
      errors.push({ row: rowNo, reason: "Nombre de plantilla vacío." });
      return;
    }
    const qty = Number(r.quantityPerUnit);
    if (!Number.isFinite(qty) || qty <= 0) {
      errors.push({ row: rowNo, reason: "Cantidad por unidad inválida (debe ser > 0)." });
      return;
    }
    const desperdicio = r.desperdicioPct != null ? Number(r.desperdicioPct) : 0;
    if (!Number.isFinite(desperdicio) || desperdicio < 0 || desperdicio > 100) {
      errors.push({ row: rowNo, reason: "% de desperdicio inválido (0-100)." });
      return;
    }
    const sku = String(r.productSku ?? "").trim();
    if (!sku) {
      errors.push({ row: rowNo, reason: "Código (SKU) de producto vacío." });
      return;
    }
    const productMatches = productBySku.get(sku) ?? [];
    if (productMatches.length === 0) {
      errors.push({ row: rowNo, reason: `Producto con código "${sku}" no existe en el catálogo.` });
      return;
    }
    if (productMatches.length > 1) {
      errors.push({ row: rowNo, reason: `Código de producto "${sku}" ambiguo (duplicado en el catálogo).` });
      return;
    }
    const normNombre = normalizeInventoryImportText(nombre);
    const pairKey = `${normNombre}::${productMatches[0].id}`;
    if (seenPairs.has(pairKey)) {
      errors.push({ row: rowNo, reason: `Fila duplicada: "${nombre}" ya tiene cargado el producto "${sku}".` });
      return;
    }
    seenPairs.add(pairKey);
    mapped.push({ templateNombre: nombre, productoId: productMatches[0].id, cantidadPorUnidad: qty, desperdicioPct: desperdicio });
  });

  return { mapped, errors };
}

export interface ApuTemplateLaborImportRowInput {
  templateNombre: string;
  rol: string;
  horasPorUnidad: number;
  costoHora: number;
}

export interface MappedApuTemplateLaborRow {
  templateNombre: string;
  rol: string;
  horasPorUnidad: number;
  costoHora: number;
}

export interface ApuTemplateEquipmentImportRowInput {
  templateNombre: string;
  tipoEquipo: string;
  horasPorUnidad: number;
  costoHora: number;
}

export interface MappedApuTemplateEquipmentRow {
  templateNombre: string;
  tipoEquipo: string;
  horasPorUnidad: number;
  costoHora: number;
}

function resolveApuTemplateFreeTextImportMapping<
  TRow extends { templateNombre: string; horasPorUnidad: number; costoHora: number },
  TMapped
>(
  rows: TRow[],
  labelField: (row: TRow) => string,
  labelName: string,
  build: (templateNombre: string, label: string, row: TRow) => TMapped
): { mapped: TMapped[]; errors: ApuTemplateImportRowError[] } {
  const mapped: TMapped[] = [];
  const errors: ApuTemplateImportRowError[] = [];
  const seenPairs = new Set<string>();

  (rows ?? []).forEach((r, idx) => {
    const rowNo = idx + 1;
    const nombre = String(r.templateNombre ?? "").trim();
    if (!nombre) {
      errors.push({ row: rowNo, reason: "Nombre de plantilla vacío." });
      return;
    }
    const horas = Number(r.horasPorUnidad);
    if (!Number.isFinite(horas) || horas <= 0) {
      errors.push({ row: rowNo, reason: "Horas por unidad ejecutada inválidas (debe ser > 0)." });
      return;
    }
    const costo = Number(r.costoHora);
    if (!Number.isFinite(costo) || costo < 0) {
      errors.push({ row: rowNo, reason: "Costo por hora inválido." });
      return;
    }
    const label = labelField(r).trim();
    if (!label) {
      errors.push({ row: rowNo, reason: `${labelName} vacío.` });
      return;
    }
    const normNombre = normalizeInventoryImportText(nombre);
    const pairKey = `${normNombre}::${label.toLowerCase()}`;
    if (seenPairs.has(pairKey)) {
      errors.push({ row: rowNo, reason: `Fila duplicada: "${nombre}" ya tiene cargado "${label}".` });
      return;
    }
    seenPairs.add(pairKey);
    mapped.push(build(nombre, label, r));
  });

  return { mapped, errors };
}

export function resolveApuTemplateLaborImportMapping(
  rows: ApuTemplateLaborImportRowInput[]
): { mapped: MappedApuTemplateLaborRow[]; errors: ApuTemplateImportRowError[] } {
  return resolveApuTemplateFreeTextImportMapping(
    rows,
    (r) => r.rol,
    "Rol",
    (templateNombre, label, r) => ({
      templateNombre,
      rol: label,
      horasPorUnidad: Number(r.horasPorUnidad),
      costoHora: Number(r.costoHora),
    })
  );
}

export function resolveApuTemplateEquipmentImportMapping(
  rows: ApuTemplateEquipmentImportRowInput[]
): { mapped: MappedApuTemplateEquipmentRow[]; errors: ApuTemplateImportRowError[] } {
  return resolveApuTemplateFreeTextImportMapping(
    rows,
    (r) => r.tipoEquipo,
    "Tipo de equipo",
    (templateNombre, label, r) => ({
      templateNombre,
      tipoEquipo: label,
      horasPorUnidad: Number(r.horasPorUnidad),
      costoHora: Number(r.costoHora),
    })
  );
}
