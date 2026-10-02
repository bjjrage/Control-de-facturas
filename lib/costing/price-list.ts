import { calculateCostEstimate } from "@/lib/cost-engine/weighting";
import type { CostObservation } from "@/lib/cost-engine/types";

// ---------------------------------------------------------------------------
// Lista de precios de materiales: la última compra efectiva define el baseline;
// estimación de compras, CPP, cotización registrada y referencias APU/manual se
// exponen en campos separados. Nunca se muestra 0 por un precio que falta.
// ---------------------------------------------------------------------------

/** Prefijo del documento_id de las observaciones que vienen de una planilla de APU. */
export const PLANILLA_APU_PREFIX = "PLANILLA_APU:";
/** documento_id de las observaciones cargadas a mano desde la lista de precios. */
export const PRECIO_LISTA_DOC = "PRECIO_LISTA";

export function sourceLabel(fuente: string, documentoId: string | null | undefined): string {
  if (fuente === "MANUAL") {
    if (documentoId?.startsWith(PLANILLA_APU_PREFIX)) return "Planilla APU";
    return "Cargado a mano";
  }
  return (
    { FACTURA: "Factura", RECEPCION: "Recepción", ORDEN_COMPRA: "Orden de compra", COTIZACION: "Cotización" } as Record<string, string>
  )[fuente] ?? fuente;
}

export interface PriceListObservationInput {
  id: string;
  productoId: string;
  fuente: CostObservation["fuente"];
  documentoId: string | null;
  proveedorId: string | null;
  cantidad: number;
  unidad: string;
  precio: number;
  fecha: string;
  esVolatil: boolean;
}

export interface PriceListProductInput {
  id: string;
  nombre: string;
  unidad: string;
  rubro: string | null;
  costoPromedio: number | null;
}

export interface PriceListRow {
  productoId: string;
  nombre: string;
  unidad: string;
  rubro: string | null;
  /** Estimación basada en compras; CPP es fallback de valoración de stock. */
  precio: number | null;
  origen: "ULTIMA_COMPRA" | "ESTIMACION_COMPRA" | "CPP" | null;
  ultimaCompra: { precio: number; fecha: string; fuente: string; proveedorId: string | null } | null;
  ultimaCotizacion: { precio: number; fecha: string; proveedorId: string | null } | null;
  referenciaManualApu: { precio: number; fecha: string; fuente: string } | null;
  cpp: number | null;
  estimacion: number | null;
  observaciones: number;
}

export function buildPriceList(
  products: PriceListProductInput[],
  observations: PriceListObservationInput[],
  today: string
): PriceListRow[] {
  const byProduct = new Map<string, PriceListObservationInput[]>();
  for (const o of observations) {
    const list = byProduct.get(o.productoId) ?? [];
    list.push(o);
    byProduct.set(o.productoId, list);
  }
  return products.map((p) => {
    const obs = (byProduct.get(p.id) ?? []).sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
    const purchases = obs.filter((o) => o.fuente === "FACTURA" || o.fuente === "RECEPCION");
    const quotes = obs.filter((o) => o.fuente === "COTIZACION");
    const references = obs.filter((o) => o.fuente === "MANUAL");
    let estimacion: number | null = null;
    if (purchases.length > 0) {
      const estimate = calculateCostEstimate(
        purchases.slice(0, 100).map<CostObservation>((o) => ({
          id: o.id,
          empresaId: "",
          productoId: o.productoId,
          fuente: o.fuente,
          descripcionItem: p.nombre,
          categoriaInsumo: "MATERIAL",
          cantidad: o.cantidad,
          unidad: o.unidad,
          precioUnitario: o.precio,
          moneda: "PYG",
          fechaObservacion: o.fecha,
          esVolatil: o.esVolatil,
          estadoEvidencia: "VALIDA",
        })),
        today
      ).recommendedUnitPrice;
      if (estimate && estimate > 0) {
        estimacion = estimate;
      }
    }
    const lastPurchase = purchases[0];
    let precio: number | null = null;
    let origen: PriceListRow["origen"] = null;
    if (lastPurchase && lastPurchase.precio > 0) {
      precio = lastPurchase.precio;
      origen = "ULTIMA_COMPRA";
    } else if (estimacion != null) {
      precio = estimacion;
      origen = "ESTIMACION_COMPRA";
    } else if (p.costoPromedio != null && p.costoPromedio > 0) {
      precio = p.costoPromedio;
      origen = "CPP";
    }
    const lastQuote = quotes[0];
    const reference = references[0];
    return {
      productoId: p.id,
      nombre: p.nombre,
      unidad: p.unidad,
      rubro: p.rubro,
      precio,
      origen,
      ultimaCompra: lastPurchase ? { precio: lastPurchase.precio, fecha: lastPurchase.fecha, fuente: sourceLabel(lastPurchase.fuente, lastPurchase.documentoId), proveedorId: lastPurchase.proveedorId } : null,
      ultimaCotizacion: lastQuote ? { precio: lastQuote.precio, fecha: lastQuote.fecha, proveedorId: lastQuote.proveedorId } : null,
      referenciaManualApu: reference ? { precio: reference.precio, fecha: reference.fecha, fuente: sourceLabel(reference.fuente, reference.documentoId) } : null,
      cpp: p.costoPromedio != null && p.costoPromedio > 0 ? p.costoPromedio : null,
      estimacion,
      observaciones: obs.length,
    };
  });
}

export interface UnlinkedPurchase {
  descripcion: string;
  registros: number;
  ultimoPrecio: number;
  ultimaFecha: string;
  fuente: string;
}

/** Agrupa las compras que no están vinculadas a un material del catálogo, por descripción. */
export function groupUnlinkedPurchases(
  rows: { descripcion: string; precio: number; fecha: string; fuente: string; documentoId: string | null }[]
): UnlinkedPurchase[] {
  const groups = new Map<string, UnlinkedPurchase>();
  for (const r of rows) {
    if (r.fuente !== "FACTURA" && r.fuente !== "RECEPCION") continue;
    const key = r.descripcion;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { descripcion: r.descripcion, registros: 1, ultimoPrecio: r.precio, ultimaFecha: r.fecha, fuente: sourceLabel(r.fuente, r.documentoId) });
    } else {
      g.registros++;
      if (r.fecha > g.ultimaFecha) {
        g.ultimaFecha = r.fecha;
        g.ultimoPrecio = r.precio;
        g.fuente = sourceLabel(r.fuente, r.documentoId);
      }
    }
  }
  return [...groups.values()].sort((a, b) => b.registros - a.registros || (a.ultimaFecha < b.ultimaFecha ? 1 : -1));
}
