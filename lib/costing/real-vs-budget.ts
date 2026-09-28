// ---------------------------------------------------------------------------
// Control de costos: costo REAL contra costo PRESUPUESTADO a la fecha, por
// partida. Presupuestado a la fecha = costo total de la partida × % de avance
// ejecutado (así una partida al 40 % se compara contra el 40 % de su costo,
// no contra el total). Real = consumo de materiales + partes de personal
// imputados + certificados de subcontratistas aprobados/pagados.
// ---------------------------------------------------------------------------

export interface RealVsBudgetInput {
  partidas: { id: string; quantity: number | null; costoTotal: number | null }[];
  executedByItem: Record<string, number>;
  realMaterial: Record<string, number>;
  realLabor: Record<string, number>;
  realSubcontract: Record<string, number>;
}

export interface RealVsBudgetRow {
  budgetItemId: string;
  avancePct: number;
  presupuestadoALaFecha: number | null;
  realMaterial: number;
  realManoObra: number;
  realSubcontrato: number;
  real: number;
  desvio: number | null;
  desvioPct: number | null;
}

export function computeRealVsBudget(input: RealVsBudgetInput): RealVsBudgetRow[] {
  const rows: RealVsBudgetRow[] = [];
  for (const p of input.partidas) {
    const qty = Number(p.quantity) || 0;
    const exec = Number(input.executedByItem[p.id]) || 0;
    const avance = qty > 0 ? Math.min(exec / qty, 1) : 0;
    const realMaterial = input.realMaterial[p.id] ?? 0;
    const realManoObra = input.realLabor[p.id] ?? 0;
    const realSubcontrato = input.realSubcontract[p.id] ?? 0;
    const real = realMaterial + realManoObra + realSubcontrato;
    if (real === 0 && exec === 0) continue;
    const presupuestado = p.costoTotal == null ? null : p.costoTotal * avance;
    const desvio = presupuestado == null ? null : real - presupuestado;
    rows.push({
      budgetItemId: p.id,
      avancePct: Math.round(avance * 1000) / 10,
      presupuestadoALaFecha: presupuestado,
      realMaterial,
      realManoObra,
      realSubcontrato,
      real,
      desvio,
      desvioPct: desvio != null && presupuestado != null && presupuestado > 0 ? (desvio / presupuestado) * 100 : null,
    });
  }
  return rows.sort((a, b) => (b.desvio ?? -Infinity) - (a.desvio ?? -Infinity));
}
