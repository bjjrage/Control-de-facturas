// ---------------------------------------------------------------------------
// Importación masiva del APU/BOM por Excel (materiales, mano de obra, equipo).
//
// Mismo espíritu que resolveImportMapping (production-recipe.ts): sin fuzzy,
// sin inserts silenciosos, matching por código EXACTO. Difiere en que acá
// UNA partida puede tener VARIAS filas (varios insumos), así que el dedupe
// no es "una fila por partida" sino "una fila por (partida, insumo)".
// ---------------------------------------------------------------------------

export interface ApuBudgetItemCatalogEntry {
  id: string;
  code: string;
  unit?: string | null;
}

export interface ApuProductCatalogEntry {
  id: string;
  sku: string;
}

export interface ApuImportRowError {
  row: number;
  reason: string;
}

// --- Materiales --------------------------------------------------------

export interface ApuMaterialImportRowInput {
  itemCode: string;
  productSku: string;
  quantityPerUnit: number;
  desperdicioPct?: number;
}

export interface MappedApuMaterialRow {
  budgetItemId: string;
  productoId: string;
  cantidadPorUnidad: number;
  desperdicioPct: number;
}

export function resolveApuMaterialImportMapping(
  rows: ApuMaterialImportRowInput[],
  budgetItems: ApuBudgetItemCatalogEntry[],
  products: ApuProductCatalogEntry[]
): { mapped: MappedApuMaterialRow[]; errors: ApuImportRowError[] } {
  const itemByCode = new Map<string, ApuBudgetItemCatalogEntry[]>();
  for (const it of budgetItems) {
    const key = String(it.code ?? "").trim();
    if (!key) continue;
    if (!itemByCode.has(key)) itemByCode.set(key, []);
    itemByCode.get(key)!.push(it);
  }
  const productBySku = new Map<string, ApuProductCatalogEntry[]>();
  for (const p of products) {
    const key = String(p.sku ?? "").trim();
    if (!key) continue;
    if (!productBySku.has(key)) productBySku.set(key, []);
    productBySku.get(key)!.push(p);
  }

  const mapped: MappedApuMaterialRow[] = [];
  const errors: ApuImportRowError[] = [];
  const seenPairs = new Set<string>();

  (rows ?? []).forEach((r, idx) => {
    const rowNo = idx + 1;
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
    const itemCode = String(r.itemCode ?? "").trim();
    if (!itemCode) {
      errors.push({ row: rowNo, reason: "Código de partida vacío." });
      return;
    }
    const itemMatches = itemByCode.get(itemCode) ?? [];
    if (itemMatches.length === 0) {
      errors.push({ row: rowNo, reason: `Código de partida "${itemCode}" no existe en el presupuesto.` });
      return;
    }
    if (itemMatches.length > 1) {
      errors.push({ row: rowNo, reason: `Código de partida "${itemCode}" ambiguo (duplicado en el presupuesto).` });
      return;
    }
    const productSku = String(r.productSku ?? "").trim();
    if (!productSku) {
      errors.push({ row: rowNo, reason: "Código (SKU) de producto vacío." });
      return;
    }
    const productMatches = productBySku.get(productSku) ?? [];
    if (productMatches.length === 0) {
      errors.push({ row: rowNo, reason: `Producto con código "${productSku}" no existe en el catálogo.` });
      return;
    }
    if (productMatches.length > 1) {
      errors.push({ row: rowNo, reason: `Código de producto "${productSku}" ambiguo (duplicado en el catálogo).` });
      return;
    }
    const budgetItemId = itemMatches[0].id;
    const productoId = productMatches[0].id;
    const pairKey = `${budgetItemId}::${productoId}`;
    if (seenPairs.has(pairKey)) {
      errors.push({ row: rowNo, reason: `Fila duplicada: la partida "${itemCode}" ya tiene cargado el producto "${productSku}".` });
      return;
    }
    seenPairs.add(pairKey);
    mapped.push({ budgetItemId, productoId, cantidadPorUnidad: qty, desperdicioPct: desperdicio });
  });

  return { mapped, errors };
}

// --- Mano de obra y equipo (sin catálogo: rol/tipo son texto libre) ----

export interface ApuLaborImportRowInput {
  itemCode: string;
  rol: string;
  horasPorUnidad: number;
  costoHora: number;
}

export interface MappedApuLaborRow {
  budgetItemId: string;
  rol: string;
  horasPorUnidad: number;
  costoHora: number;
}

export interface ApuEquipmentImportRowInput {
  itemCode: string;
  tipoEquipo: string;
  horasPorUnidad: number;
  costoHora: number;
}

export interface MappedApuEquipmentRow {
  budgetItemId: string;
  tipoEquipo: string;
  horasPorUnidad: number;
  costoHora: number;
}

function resolveApuFreeTextImportMapping<TRow extends { itemCode: string; horasPorUnidad: number; costoHora: number }, TMapped>(
  rows: TRow[],
  budgetItems: ApuBudgetItemCatalogEntry[],
  labelField: (row: TRow) => string,
  labelName: string,
  build: (budgetItemId: string, label: string, row: TRow) => TMapped
): { mapped: TMapped[]; errors: ApuImportRowError[] } {
  const itemByCode = new Map<string, ApuBudgetItemCatalogEntry[]>();
  for (const it of budgetItems) {
    const key = String(it.code ?? "").trim();
    if (!key) continue;
    if (!itemByCode.has(key)) itemByCode.set(key, []);
    itemByCode.get(key)!.push(it);
  }

  const mapped: TMapped[] = [];
  const errors: ApuImportRowError[] = [];
  const seenPairs = new Set<string>();

  (rows ?? []).forEach((r, idx) => {
    const rowNo = idx + 1;
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
    const itemCode = String(r.itemCode ?? "").trim();
    if (!itemCode) {
      errors.push({ row: rowNo, reason: "Código de partida vacío." });
      return;
    }
    const itemMatches = itemByCode.get(itemCode) ?? [];
    if (itemMatches.length === 0) {
      errors.push({ row: rowNo, reason: `Código de partida "${itemCode}" no existe en el presupuesto.` });
      return;
    }
    if (itemMatches.length > 1) {
      errors.push({ row: rowNo, reason: `Código de partida "${itemCode}" ambiguo (duplicado en el presupuesto).` });
      return;
    }
    const label = labelField(r).trim();
    if (!label) {
      errors.push({ row: rowNo, reason: `${labelName} vacío.` });
      return;
    }
    const budgetItemId = itemMatches[0].id;
    const pairKey = `${budgetItemId}::${label.toLowerCase()}`;
    if (seenPairs.has(pairKey)) {
      errors.push({ row: rowNo, reason: `Fila duplicada: la partida "${itemCode}" ya tiene cargado "${label}".` });
      return;
    }
    seenPairs.add(pairKey);
    mapped.push(build(budgetItemId, label, r));
  });

  return { mapped, errors };
}

export function resolveApuLaborImportMapping(
  rows: ApuLaborImportRowInput[],
  budgetItems: ApuBudgetItemCatalogEntry[]
): { mapped: MappedApuLaborRow[]; errors: ApuImportRowError[] } {
  return resolveApuFreeTextImportMapping(
    rows,
    budgetItems,
    (r) => r.rol,
    "Rol",
    (budgetItemId, label, r) => ({
      budgetItemId,
      rol: label,
      horasPorUnidad: Number(r.horasPorUnidad),
      costoHora: Number(r.costoHora),
    })
  );
}

export function resolveApuEquipmentImportMapping(
  rows: ApuEquipmentImportRowInput[],
  budgetItems: ApuBudgetItemCatalogEntry[]
): { mapped: MappedApuEquipmentRow[]; errors: ApuImportRowError[] } {
  return resolveApuFreeTextImportMapping(
    rows,
    budgetItems,
    (r) => r.tipoEquipo,
    "Tipo de equipo",
    (budgetItemId, label, r) => ({
      budgetItemId,
      tipoEquipo: label,
      horasPorUnidad: Number(r.horasPorUnidad),
      costoHora: Number(r.costoHora),
    })
  );
}
