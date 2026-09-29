import { calculateCostEstimate } from "@/lib/cost-engine/weighting";
import type { CostObservation } from "@/lib/cost-engine/types";

// ---------------------------------------------------------------------------
// Lista de precios de materiales de la empresa: para cada producto, el precio
// de referencia y de dónde salió. Todo sale de cost_observations (facturas,
// recepciones, órdenes de compra, cotizaciones y cargas manuales) más el costo
// promedio del stock. Nunca se muestra 0 por un precio que falta.
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
  /** Precio con el que costea la obra si no hay uno elegido; null si no hay ninguno. */
  precio: number | null;
  origen: "HISTORIAL" | "COSTO_PROMEDIO" | null;
  ultimo: { precio: number; fecha: string; fuente: string; proveedorId: string | null } | null;
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
    let precio: number | null = null;
    let origen: PriceListRow["origen"] = null;
    if (obs.length > 0) {
      const estimate = calculateCostEstimate(
        obs.slice(0, 100).map<CostObservation>((o) => ({
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
        precio = estimate;
        origen = "HISTORIAL";
      }
    }
    if (precio == null && p.costoPromedio != null && p.costoPromedio > 0) {
      precio = p.costoPromedio;
      origen = "COSTO_PROMEDIO";
    }
    const last = obs[0];
    return {
      productoId: p.id,
      nombre: p.nombre,
      unidad: p.unidad,
      rubro: p.rubro,
      precio,
      origen,
      ultimo: last ? { precio: last.precio, fecha: last.fecha, fuente: sourceLabel(last.fuente, last.documentoId), proveedorId: last.proveedorId } : null,
      observaciones: obs.length,
    };
  });
}
