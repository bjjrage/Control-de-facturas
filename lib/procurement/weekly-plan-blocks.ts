import type {
  BudgetItem,
  WeeklyPlanCalculationSummary,
  WeeklyPlanInputMode,
} from "@/lib/types";
import type { PreviewWeeklyPlanItemInput } from "./weekly-plan-shared";

// ---------------------------------------------------------------------------
// Planificación por BLOQUE / RUBRO (V2).
//
// Contrato canónico (investigado en datos reales):
// - `budget_items.parent_id` es la única jerarquía FK. Semilla canónica:
//   padre con unit/quantity NULL + hijas con parent_id + quantity > 0.
// - Datos históricos/Excel pueden traer parent_id NULL con código jerárquico
//   ("2.1", "01.01"): se agrupa por raíz del código como hace el Gantt.
// - NO hay tabla "blocks": el bloque se DERIVA del presupuesto existente.
//
// El modo bloque NO es un motor: solo transforma
//   BLOQUE + PP + PARTIDAS SELECCIONADAS
// en el mismo array de targets que consume calculateWeeklyPlanRequirements
// (vía previewWeeklyPlanAction). Sin duplicar BOM/stock/inbound/caja/clima.
// ---------------------------------------------------------------------------

export interface BlockGroup {
  /** Estable: `id:<parentId>` | `root:<segmento>` | `flat` (partidas sueltas). */
  key: string;
  /** Código visible: del padre ("02") o de la raíz ("10"). "" si sueltas. */
  code: string;
  /** Descripción del padre o "Rubro <raíz>" / "Partidas sin rubro". */
  description: string;
  parentId: string | null;
  isVirtual: boolean;
  /** Partidas ejecutables (quantity > 0), ordenadas por sort_order. */
  children: BudgetItem[];
}

/** Segmentos de un código jerárquico ("02.10" → ["02","10"]). */
export function codeSegments(code: string | null | undefined): string[] {
  return String(code ?? "")
    .split(".")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * ¿`child` desciende estrictamente de `parent` por segmentos?
 * Evita confusiones ingenuas de prefijo: "20" NO es hijo de "2",
 * "2.10" NO es hijo de "2.1", "2.1" SÍ es hijo de "2".
 */
export function isDescendantCode(
  child: string | null | undefined,
  parent: string | null | undefined
): boolean {
  const c = codeSegments(child);
  const p = codeSegments(parent);
  if (p.length === 0 || c.length <= p.length) return false;
  for (let i = 0; i < p.length; i++) {
    if (c[i] !== p[i]) return false;
  }
  return true;
}

function isExecutable(item: BudgetItem): boolean {
  return Number(item.quantity) > 0;
}

function bySort(a: BudgetItem, b: BudgetItem): number {
  if ((a.sort_order ?? 0) !== (b.sort_order ?? 0)) {
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  }
  return String(a.code ?? "").localeCompare(String(b.code ?? ""), undefined, {
    numeric: true,
  });
}

/**
 * Deriva bloques (partición de las partidas ejecutables):
 * 1. Hijas con parent_id válido → bloque del padre (`id:<parentId>`).
 * 2. Resto con código jerárquico → bloque por raíz (`root:<raíz>`,
 *    con fila padre real si existe, si no virtual "Rubro <raíz>").
 * 3. Resto plano (sin parent ni puntos) → bloque virtual "Partidas sin rubro".
 * Cada ejecutable pertenece a exactamente UN bloque. Orden por sort_order.
 */
export function buildBlockGroups(items: BudgetItem[]): BlockGroup[] {
  const byId = new Map<string, BudgetItem>();
  for (const it of items) byId.set(it.id, it);

  const executables = items.filter(isExecutable).sort(bySort);

  const blocks = new Map<string, BlockGroup>();
  const flatChildren: BudgetItem[] = [];

  const ensureParentBlock = (parent: BudgetItem): BlockGroup => {
    const key = `id:${parent.id}`;
    let g = blocks.get(key);
    if (!g) {
      g = {
        key,
        code: parent.code ?? "",
        description: parent.description ?? "Rubro",
        parentId: parent.id,
        isVirtual: false,
        children: [],
      };
      blocks.set(key, g);
    }
    return g;
  };

  const ensureRootBlock = (root: string, allItems: BudgetItem[]): BlockGroup => {
    const key = `root:${root}`;
    let g = blocks.get(key);
    if (!g) {
      const parentRow = allItems.find(
        (it) => !isExecutable(it) && codeSegments(it.code).length === 1 && codeSegments(it.code)[0] === root
      );
      g = {
        key,
        code: parentRow?.code ?? root,
        description: parentRow?.description ?? `Rubro ${root}`,
        parentId: parentRow?.id ?? null,
        isVirtual: !parentRow,
        children: [],
      };
      blocks.set(key, g);
    }
    return g;
  };

  for (const child of executables) {
    // 1. parent_id canónico y válido.
    if (child.parent_id && byId.has(child.parent_id)) {
      ensureParentBlock(byId.get(child.parent_id)!).children.push(child);
      continue;
    }
    // 2. Agrupación por raíz del código (huérfanas de importaciones planas).
    // Seguro por construcción: se compara el segmento raíz por igualdad
    // exacta (nunca startsWith ingenuo), así "20.1" va a "20" y "2.10" a "2".
    const segs = codeSegments(child.code);
    if (segs.length >= 2) {
      ensureRootBlock(segs[0], items).children.push(child);
      continue;
    }
    // 3. Partida suelta sin jerarquía.
    flatChildren.push(child);
  }

  // Ordenar hijas por sort_order.
  for (const g of blocks.values()) g.children.sort(bySort);
  flatChildren.sort(bySort);

  const out = [...blocks.values()].filter((g) => g.children.length > 0);
  if (flatChildren.length > 0) {
    out.push({
      key: "flat",
      code: "",
      description: "Partidas sin rubro",
      parentId: null,
      isVirtual: true,
      children: flatChildren,
    });
  }

  // Orden de bloques: por sort_order mínimo de sus hijas (orden del presupuesto).
  const minSort = (g: BlockGroup) =>
    Math.min(...g.children.map((c) => c.sort_order ?? 0));
  out.sort((a, b) => {
    const d = minSort(a) - minSort(b);
    if (d !== 0) return d;
    return a.code.localeCompare(b.code, undefined, { numeric: true });
  });
  return out;
}

export interface BlockChildOverride {
  inputMode: WeeklyPlanInputMode;
  inputValue: number;
}

export interface BlockSelection {
  /** Puntos porcentuales contractuales del bloque (default útil y editable). */
  pp: number;
  front: string;
  excludedIds: string[];
  /** Edición individual por partida (reemplaza al pp del bloque). */
  overrides: Record<string, BlockChildOverride>;
}

/**
 * Semántica V1 explícita y determinista: "+N pp del bloque" =
 * "+N puntos porcentuales contractuales en cada partida ejecutable
 * seleccionada del bloque" (target físico = contractual × pp/100,
 * capado por remanente en el engine, NO aquí).
 * Las excluidas NO se envían al engine. Los overrides reemplazan al pp.
 */
export function blockSelectionTargets(
  block: BlockGroup,
  sel: BlockSelection
): PreviewWeeklyPlanItemInput[] {
  const excluded = new Set(sel.excludedIds ?? []);
  const pp = Math.max(0, Number(sel.pp) || 0);
  const front = sel.front?.trim() ? sel.front.trim() : "Sector A";
  const out: PreviewWeeklyPlanItemInput[] = [];
  for (const child of block.children) {
    if (excluded.has(child.id)) continue;
    const ov = sel.overrides?.[child.id];
    if (ov) {
      out.push({
        budgetItemId: child.id,
        frontLabel: front,
        inputMode: ov.inputMode,
        inputValue: Math.max(0, Number(ov.inputValue) || 0),
      });
    } else {
      out.push({
        budgetItemId: child.id,
        frontLabel: front,
        inputMode: "CONTRACT_PERCENTAGE_POINTS",
        inputValue: pp,
      });
    }
  }
  return out;
}

/**
 * Avance ponderado por valor del bloque (misma definición que el engine
 * global: ejecutado capeado a contractual, ponderado por precio).
 */
export function blockWeightedProgress(
  block: BlockGroup,
  executedByItem: Record<string, number>
): { currentPct: number; contractualValue: number; executedValue: number } {
  let contractualValue = 0;
  let executedValue = 0;
  for (const c of block.children) {
    const qty = Number(c.quantity) || 0;
    const price = Number(c.unit_price) || 0;
    contractualValue += qty * price;
    executedValue += Math.min(Number(executedByItem[c.id]) || 0, qty) * price;
  }
  const currentPct =
    contractualValue > 0
      ? Number(((executedValue / contractualValue) * 100).toFixed(2))
      : 0;
  return {
    currentPct,
    contractualValue: Math.round(contractualValue),
    executedValue: Math.round(executedValue),
  };
}

export interface AggregatedMaterial {
  producto_id: string;
  producto_nombre: string;
  unidad_medida: string;
  costo_unitario: number | null;
  requerido: number;
  cubierto_stock: number;
  cubierto_inbound: number;
  faltante: number;
  caja: number;
}

/**
 * Agregado por producto del cálculo (display del bloque). Suma particionada:
 * el engine ya deduce stock→inbound sin doble conteo entre frentes, así que
 * sumar por producto conserva los totales del summary (testeado).
 */
export function aggregateMaterialsByProduct(
  calc: WeeklyPlanCalculationSummary
): AggregatedMaterial[] {
  const acc = new Map<string, AggregatedMaterial>();
  for (const item of calc.items ?? []) {
    for (const m of item.materials ?? []) {
      const prev = acc.get(m.producto_id);
      if (prev) {
        prev.requerido += m.demanda_bruta;
        prev.cubierto_stock += m.cubierto_por_stock;
        prev.cubierto_inbound += m.cubierto_por_inbound;
        prev.faltante += m.deficit_compra_neta;
        prev.caja += m.caja_adicional_requerida;
      } else {
        acc.set(m.producto_id, {
          producto_id: m.producto_id,
          producto_nombre: m.producto_nombre,
          unidad_medida: m.unidad_medida,
          costo_unitario: m.costo_unitario,
          requerido: m.demanda_bruta,
          cubierto_stock: m.cubierto_por_stock,
          cubierto_inbound: m.cubierto_por_inbound,
          faltante: m.deficit_compra_neta,
          caja: m.caja_adicional_requerida,
        });
      }
    }
  }
  const out = [...acc.values()].map((a) => ({
    ...a,
    requerido: Number(a.requerido.toFixed(4)),
    cubierto_stock: Number(a.cubierto_stock.toFixed(4)),
    cubierto_inbound: Number(a.cubierto_inbound.toFixed(4)),
    faltante: Number(a.faltante.toFixed(4)),
    caja: Math.round(a.caja),
  }));
  out.sort((a, b) => b.caja - a.caja);
  return out;
}
