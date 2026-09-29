// ---------------------------------------------------------------------------
// Cada línea cotizada en un RFQ de costeo alimenta la base de precios
// (cost_observations), así la próxima obra ya arranca con precios recientes.
//
// Moneda: cost_observations guarda todo en PYG. El portal no pide tipo de
// cambio, así que una cotización en otra moneda entra como
// REVISION_REQUERIDA sin precio (mismo criterio que las facturas en USD sin
// tipo de cambio, lib/procurement/flywheel.ts) — nunca se inventa la
// conversión.
// ---------------------------------------------------------------------------

export interface QuotedLine {
  productoId: string | null;
  descripcion: string;
  cantidad: number;
  unidad: string;
  precioUnitario: number | null;
}

export interface CostObservationInsert {
  empresa_id: string;
  producto_id: string | null;
  project_id: string | null;
  proveedor_id: string | null;
  fuente: "COTIZACION";
  documento_id: string;
  descripcion_item: string;
  categoria_insumo: "MATERIAL";
  cantidad: number;
  unidad: string;
  precio_unitario: number | null;
  moneda: "PYG";
  moneda_original: string;
  precio_unitario_original: number;
  tipo_cambio: number | null;
  fecha_observacion: string;
  estado_evidencia: "VALIDA" | "REVISION_REQUERIDA";
}

export function buildQuoteCostObservations(args: {
  empresaId: string;
  projectId: string | null;
  providerId: string | null;
  quoteVersionId: string;
  currency: string;
  fecha: string;
  lines: QuotedLine[];
}): CostObservationInsert[] {
  const isPyg = args.currency === "PYG";
  const out: CostObservationInsert[] = [];
  for (const l of args.lines) {
    if (l.precioUnitario == null || !Number.isFinite(l.precioUnitario) || l.precioUnitario <= 0) continue;
    if (!(l.cantidad > 0)) continue;
    const descripcion = l.descripcion.trim();
    const unidad = l.unidad.trim().toUpperCase();
    if (!descripcion || !unidad) continue;
    out.push({
      empresa_id: args.empresaId,
      producto_id: l.productoId,
      project_id: args.projectId,
      proveedor_id: args.providerId,
      fuente: "COTIZACION",
      documento_id: args.quoteVersionId,
      descripcion_item: descripcion,
      categoria_insumo: "MATERIAL",
      cantidad: l.cantidad,
      unidad,
      precio_unitario: isPyg ? l.precioUnitario : null,
      moneda: "PYG",
      moneda_original: args.currency,
      precio_unitario_original: l.precioUnitario,
      tipo_cambio: null,
      fecha_observacion: args.fecha,
      estado_evidencia: isPyg ? "VALIDA" : "REVISION_REQUERIDA",
    });
  }
  return out;
}

/**
 * Total de una cotización multi-ítem: Σ precio × cantidad de las líneas
 * cotizadas, calculado en el servidor (nunca se confía en el total del
 * cliente). Las líneas sin precio no cuentan (el proveedor no las cotiza).
 */
export function quoteTotal(lines: { precioUnitario: number | null; cantidad: number }[]): number {
  let total = 0;
  for (const l of lines) {
    if (l.precioUnitario == null || !Number.isFinite(l.precioUnitario) || l.precioUnitario <= 0) continue;
    total += l.precioUnitario * l.cantidad;
  }
  return Math.round(total * 100) / 100;
}
