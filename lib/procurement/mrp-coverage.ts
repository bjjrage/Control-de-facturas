// ---------------------------------------------------------------------------
// Cobertura MRP (V3): asignación determinista por producto.
//
// Orden de cobertura (nunca automático fuera de este orden):
//   1. stock del depósito de la obra
//   2. stock central REALMENTE disponible (físico - reservas ACTIVE)
//   3. inbound válido (llega a tiempo: fecha <= needed_by)
//   4. faltante a comprar (min 0, nunca negativo)
//
// NO es un motor de materiales: la necesidad BRUTA viene del engine
// existente (BOM × cantidad física). Esto solo ASIGNA cobertura.
// Las reservas de otras obras y el stock de otras obras JAMÁS entran.
// ---------------------------------------------------------------------------

export interface MrpGrossLine {
  producto_id: string;
  producto_nombre: string;
  unidad_medida: string;
  /** Costo canónico (productos.costo_promedio vía join). null = no computable. */
  costo_unitario: number | null;
  /** Demanda bruta del engine (target × BOM × desperdicio). */
  requerido: number;
  /** Cubierto por stock de obra (engine, primera fuente). */
  cubierto_obra: number;
}

export interface MrpCoverageLine extends MrpGrossLine {
  cubierto_central: number;
  cubierto_inbound: number;
  /** purchase_shortage = max(0, requerido - obra - central - inbound). */
  comprar: number;
  /** comprar × costo, o null si el costo no es computable (NO 0 falso). */
  caja: number | null;
  costo_no_disponible: boolean;
}

export interface MrpCoverageSummary {
  lines: MrpCoverageLine[];
  total_requerido_valor: number;
  total_cubierto_obra_valor: number;
  total_cubierto_central_valor: number;
  total_cubierto_inbound_valor: number;
  total_comprar_cantidad: number;
  total_caja_adicional: number;
  costos_pendientes: number;
}

/**
 * Compara líneas centrales cliente (referencia, NO autoritativa) vs
 * recalculadas server-side. true solo si mismo conjunto e iguales dentro
 * de eps. Cualquier divergencia (tamper, stock movido) => recalcular.
 */
export function compareCentralLines(
  server: { producto_id: string; quantity: number }[],
  client: { producto_id: string; quantity: number }[],
  eps = 1e-6
): boolean {
  if (server.length !== client.length) return false;
  const byId = new Map(server.map((l) => [l.producto_id, Number(l.quantity) || 0]));
  for (const c of client) {
    if (!byId.has(c.producto_id)) return false;
    if (Math.abs((byId.get(c.producto_id) as number) - (Number(c.quantity) || 0)) > eps) {
      return false;
    }
  }
  return true;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Agrega el bruto por producto ANTES de asignar cobertura: dos partidas
 * pueden consumir el mismo material y el central/inbound debe descontarse
 * una sola vez (sin doble conteo). El engine ya particiona obra sin solape;
 * aquí se conserva esa partición al sumar.
 */
function aggregateGrossByProduct(
  gross: MrpGrossLine[]
): (MrpGrossLine & { requerido: number; cubierto_obra: number })[] {
  const acc = new Map<string, MrpGrossLine & { requerido: number; cubierto_obra: number }>();
  for (const g of gross ?? []) {
    const prev = acc.get(g.producto_id);
    const req = Math.max(0, num(g.requerido));
    const obra = Math.max(0, num(g.cubierto_obra));
    if (prev) {
      prev.requerido = Number((prev.requerido + req).toFixed(4));
      prev.cubierto_obra = Number((prev.cubierto_obra + obra).toFixed(4));
    } else {
      acc.set(g.producto_id, { ...g, requerido: req, cubierto_obra: obra });
    }
  }
  return [...acc.values()];
}

/**
 * Asigna cobertura por producto. Pura y determinista.
 * centralAvailable/inbound son cantidades ASIGNABLES ya neteadas por el
 * llamador (reservas descontadas, fechas validadas): aquí solo se reparte.
 */
export function allocateMaterialCoverage(args: {
  gross: MrpGrossLine[];
  centralAvailableByProduct: Record<string, number>;
  validInboundByProduct: Record<string, number>;
}): MrpCoverageSummary {
  const { gross, centralAvailableByProduct, validInboundByProduct } = args;
  const lines: MrpCoverageLine[] = [];

  let total_requerido_valor = 0;
  let total_cubierto_obra_valor = 0;
  let total_cubierto_central_valor = 0;
  let total_cubierto_inbound_valor = 0;
  let total_comprar_cantidad = 0;
  let total_caja_adicional = 0;
  let costos_pendientes = 0;

  for (const g of aggregateGrossByProduct(gross)) {
    const requerido = g.requerido;
    const cubierto_obra = Math.min(requerido, g.cubierto_obra);
    const afterObra = requerido - cubierto_obra;

    const centralAvail = Math.max(0, num(centralAvailableByProduct[g.producto_id]));
    const cubierto_central = Math.min(afterObra, centralAvail);
    const afterCentral = afterObra - cubierto_central;

    const inboundAvail = Math.max(0, num(validInboundByProduct[g.producto_id]));
    const cubierto_inbound = Math.min(afterCentral, inboundAvail);

    const comprar = Math.max(0, afterCentral - cubierto_inbound);

    const hasCost = g.costo_unitario !== null && Number(g.costo_unitario) > 0;
    const unitCost = hasCost ? Number(g.costo_unitario) : 0;
    // NULL cost → caja null + flag (NUNCA Gs. 0 falso).
    const caja = hasCost ? Math.round(comprar * unitCost) : null;
    if (!hasCost && comprar > 0) costos_pendientes += 1;

    total_requerido_valor += Math.round(requerido * unitCost);
    total_cubierto_obra_valor += Math.round(cubierto_obra * unitCost);
    total_cubierto_central_valor += Math.round(cubierto_central * unitCost);
    total_cubierto_inbound_valor += Math.round(cubierto_inbound * unitCost);
    total_comprar_cantidad += comprar;
    total_caja_adicional += caja ?? 0;

    lines.push({
      ...g,
      requerido: Number(requerido.toFixed(4)),
      cubierto_obra: Number(cubierto_obra.toFixed(4)),
      cubierto_central: Number(cubierto_central.toFixed(4)),
      cubierto_inbound: Number(cubierto_inbound.toFixed(4)),
      comprar: Number(comprar.toFixed(4)),
      caja,
      costo_no_disponible: !hasCost,
    });
  }

  lines.sort((a, b) => (b.caja ?? 0) - (a.caja ?? 0));

  return {
    lines,
    total_requerido_valor: Math.round(total_requerido_valor),
    total_cubierto_obra_valor: Math.round(total_cubierto_obra_valor),
    total_cubierto_central_valor: Math.round(total_cubierto_central_valor),
    total_cubierto_inbound_valor: Math.round(total_cubierto_inbound_valor),
    total_comprar_cantidad: Number(total_comprar_cantidad.toFixed(4)),
    total_caja_adicional: Math.round(total_caja_adicional),
    costos_pendientes,
  };
}
