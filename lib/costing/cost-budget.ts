// ---------------------------------------------------------------------------
// Presupuesto de COSTO: cuánto le cuesta a la empresa ejecutar cada partida,
// a precios de hoy. Separado del presupuesto de VENTA (budget_items.unit_price).
//
// Costo unitario de una partida = 4 patas del APU:
//   materiales   Σ cantidad/unidad × (1 + desperdicio) × precio del insumo
//   mano de obra Σ horas/unidad × costo hora (jornal de la categoría)
//   equipo       Σ horas/unidad × costo hora
//   subcontrato  Σ precio por unidad de partida
//
// Ley del producto: si falta el precio de un material, el costo de esa
// partida es null (con la lista de faltantes). Nunca se suma como 0.
// ---------------------------------------------------------------------------

export type CostPriceSource = "COTIZACION" | "ESTIMACION" | "HISTORICO" | "MANUAL" | "FACTURA" | "RECEPCION" | "CPP";

export interface ResolvedPrice {
  precio: number;
  fuente: CostPriceSource;
  quoteVersionItemId?: string | null;
  adopted?: boolean;
  fecha?: string | null;
  documentoId?: string | null;
  proveedorId?: string | null;
  adoptedAt?: string | null;
  adoptedBy?: string | null;
}

export interface CostMaterialLine {
  budgetItemId: string;
  productoId: string;
  cantidadPorUnidad: number;
  desperdicioPct: number;
}

export interface CostHourLine {
  budgetItemId: string;
  horasPorUnidad: number;
  costoHora: number;
}

export interface CostSubcontractLine {
  budgetItemId: string;
  precioPorUnidad: number;
}

export interface CostPartidaInput {
  id: string;
  quantity: number | null;
  unitPrice: number | null;
}

export interface PartidaCost {
  budgetItemId: string;
  tieneApu: boolean;
  costoMaterial: number | null;
  costoManoObra: number;
  costoEquipo: number;
  costoSubcontrato: number;
  costoUnitario: number | null;
  costoTotal: number | null;
  faltantes: string[];
  margenUnitario: number | null;
  margenPct: number | null;
}

export function computePartidaCosts(
  partidas: CostPartidaInput[],
  lines: {
    materials: CostMaterialLine[];
    labor: CostHourLine[];
    equipment: CostHourLine[];
    subcontracts: CostSubcontractLine[];
  },
  prices: Map<string, ResolvedPrice>
): Record<string, PartidaCost> {
  const out: Record<string, PartidaCost> = {};
  const ensure = (id: string): PartidaCost => {
    if (!out[id]) {
      out[id] = {
        budgetItemId: id,
        tieneApu: false,
        costoMaterial: 0,
        costoManoObra: 0,
        costoEquipo: 0,
        costoSubcontrato: 0,
        costoUnitario: null,
        costoTotal: null,
        faltantes: [],
        margenUnitario: null,
        margenPct: null,
      };
    }
    return out[id];
  };

  for (const m of lines.materials) {
    const c = ensure(m.budgetItemId);
    c.tieneApu = true;
    const price = prices.get(m.productoId);
    if (!price) {
      if (!c.faltantes.includes(m.productoId)) c.faltantes.push(m.productoId);
      continue;
    }
    c.costoMaterial = (c.costoMaterial ?? 0) + m.cantidadPorUnidad * (1 + m.desperdicioPct / 100) * price.precio;
  }
  for (const l of lines.labor) {
    const c = ensure(l.budgetItemId);
    c.tieneApu = true;
    c.costoManoObra += l.horasPorUnidad * l.costoHora;
  }
  for (const e of lines.equipment) {
    const c = ensure(e.budgetItemId);
    c.tieneApu = true;
    c.costoEquipo += e.horasPorUnidad * e.costoHora;
  }
  for (const s of lines.subcontracts) {
    const c = ensure(s.budgetItemId);
    c.tieneApu = true;
    c.costoSubcontrato += s.precioPorUnidad;
  }

  const byId = new Map(partidas.map((p) => [p.id, p]));
  for (const c of Object.values(out)) {
    if (c.faltantes.length > 0) {
      c.costoMaterial = null;
      continue;
    }
    c.costoUnitario = (c.costoMaterial ?? 0) + c.costoManoObra + c.costoEquipo + c.costoSubcontrato;
    const partida = byId.get(c.budgetItemId);
    const qty = partida?.quantity;
    c.costoTotal = qty != null ? c.costoUnitario * qty : null;
    const venta = partida?.unitPrice;
    if (venta != null) {
      c.margenUnitario = venta - c.costoUnitario;
      c.margenPct = venta > 0 ? (c.margenUnitario / venta) * 100 : null;
    }
  }
  return out;
}

export interface ProjectCostTotals {
  costoTotal: number;
  ventaTotal: number;
  margen: number;
  margenPct: number | null;
  partidasConCosto: number;
  partidasSinApu: number;
  partidasIncompletas: number;
  completo: boolean;
}

/**
 * Totales de la obra. `completo` es false si alguna partida con cantidad no
 * tiene APU o tiene faltantes: en ese caso el costo total es parcial y la
 * UI tiene que decirlo, no mostrarlo como si fuera el costo real.
 */
export function computeProjectCostTotals(
  partidas: CostPartidaInput[],
  costs: Record<string, PartidaCost>
): ProjectCostTotals {
  let costoTotal = 0;
  let ventaTotal = 0;
  let partidasConCosto = 0;
  let partidasSinApu = 0;
  let partidasIncompletas = 0;
  for (const p of partidas) {
    if (!p.quantity) continue;
    ventaTotal += p.quantity * (p.unitPrice ?? 0);
    const c = costs[p.id];
    if (!c || !c.tieneApu) {
      partidasSinApu++;
      continue;
    }
    if (c.costoTotal === null) {
      partidasIncompletas++;
      continue;
    }
    costoTotal += c.costoTotal;
    partidasConCosto++;
  }
  const margen = ventaTotal - costoTotal;
  return {
    costoTotal,
    ventaTotal,
    margen,
    margenPct: ventaTotal > 0 ? (margen / ventaTotal) * 100 : null,
    partidasConCosto,
    partidasSinApu,
    partidasIncompletas,
    completo: partidasSinApu === 0 && partidasIncompletas === 0,
  };
}

export interface QuoteCandidate {
  quoteVersionItemId: string;
  precio: number;
  venceEl: string | null;
}

/**
 * Selección automática por capas: adopción humana del proyecto, última compra
 * efectiva, estimación basada en compras y CPP de inventario. Las cotizaciones
 * se conservan fuera del selector para no convertir señal de mercado en costo.
 * Sin fuentes disponibles → null (faltante). Nunca 0 por default.
 */
export function suggestMaterialPrice(args: {
  chosen?: ResolvedPrice | null;
  lastPurchase?: ResolvedPrice | null;
  quotes?: QuoteCandidate[];
  estimate?: number | null;
  costoPromedio?: number | null;
  today: string;
}): ResolvedPrice | null {
  if (args.chosen && Number.isFinite(args.chosen.precio) && args.chosen.precio > 0) return { ...args.chosen, adopted: true };
  if (args.lastPurchase && Number.isFinite(args.lastPurchase.precio) && args.lastPurchase.precio > 0) return args.lastPurchase;
  if (args.estimate != null && Number.isFinite(args.estimate) && args.estimate > 0) return { precio: args.estimate, fuente: "ESTIMACION" };
  if (args.costoPromedio != null && Number.isFinite(args.costoPromedio) && args.costoPromedio > 0) return { precio: args.costoPromedio, fuente: "CPP" };
  return null;
}

/**
 * Vencimiento de una cotización a partir de su validez ("30 dias",
 * "2 semanas", "1 meses") contada desde que se envió. Validez ilegible →
 * null (se trata como vigente: no se descarta un precio por no poder leer
 * la fecha).
 */
export function offerExpiryDate(submittedAt: string | null, offerValidity: string | null): string | null {
  if (!submittedAt || !offerValidity) return null;
  // RFQ 2.0 supplies a factual absolute expiry, not an inferred duration.
  if (/^\d{4}-\d{2}-\d{2}(?:[T ].*)?$/.test(offerValidity.trim())) {
    const absolute = new Date(offerValidity.trim());
    return Number.isFinite(absolute.getTime()) ? absolute.toISOString().slice(0, 10) : null;
  }
  const m = offerValidity.trim().toLowerCase().match(/^(\d+(?:[.,]\d+)?)\s*(d[ií]as?|semanas?|mes(?:es)?)$/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  const start = new Date(submittedAt);
  if (!Number.isFinite(n) || Number.isNaN(start.getTime())) return null;
  const unit = m[2];
  if (unit.startsWith("d")) start.setUTCDate(start.getUTCDate() + Math.round(n));
  else if (unit.startsWith("s")) start.setUTCDate(start.getUTCDate() + Math.round(n * 7));
  else start.setUTCMonth(start.getUTCMonth() + Math.round(n));
  return start.toISOString().slice(0, 10);
}
