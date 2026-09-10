/**
 * ERP EXECUTION FLYWHEEL (GATE 20)
 * El Doble Bucle de Retroalimentación Continua:
 * 
 * BUCLE 1 (Privado / Cost Engine):
 * Cada compra real, remisión de pañol o factura imputada a una obra en ejecución
 * alimenta inmediatamente la tabla `cost_observations` del tenant, actualizando
 * el Costo Presente Ponderado (CPP) para futuras licitaciones.
 * 
 * BUCLE 2 (Público / Inteligencia de Mercado):
 * Cada resultado oficial de apertura o adjudicación publicado en la DNCP
 * alimenta la tabla `procurement_bids` y actualiza la huella contextual
 * de los competidores (`competitor-intelligence`).
 */

import { CostObservation } from '../cost-engine/types';
import { calculateCostEstimate } from '../cost-engine/weighting';

export interface FlywheelExecutionPurchaseEvent {
  empresaId: string;
  projectId: string;
  invoiceId?: string;
  itemDescription: string;
  category: 'MATERIAL' | 'MANO_OBRA' | 'EQUIPO' | 'SUBCONTRATO' | 'COMBUSTIBLE' | 'OTRO';
  quantity: number;
  unit: string;
  unitPricePyg: number;
  purchaseDate: string;
}

export interface FlywheelTenderAwardEvent {
  tenderId: string;
  winnerRuc: string;
  winnerName: string;
  winningAmountPyg: number;
  referenceBudgetPyg: number;
  buyerName: string;
  category: string;
  awardDate: string;
}

export interface FlywheelCalibrationEffect {
  itemDescription: string;
  previousRecommendedPricePyg: number;
  newRecommendedPricePyg: number;
  priceDeltaPct: number;
  newConfidenceTier: string;
  totalObservations: number;
}

/**
 * Simula el impacto del bucle de ejecución:
 * Al comprar insumos en una obra, la estimación del Cost Engine se calibra en tiempo real.
 */
export function processFlywheelExecutionPurchase(
  existingObservations: CostObservation[],
  event: FlywheelExecutionPurchaseEvent,
  asOfDate: string = event.purchaseDate
): {
  updatedObservations: CostObservation[];
  effect: FlywheelCalibrationEffect;
} {
  const previousEstimate = calculateCostEstimate(
    existingObservations.filter(o => o.descripcionItem.toLowerCase().includes(event.itemDescription.toLowerCase())),
    asOfDate
  );

  const newObs: CostObservation = {
    id: `obs-flywheel-${Date.now()}`,
    empresaId: event.empresaId,
    projectId: event.projectId,
    fuente: 'FACTURA', // Compra real ejecutada en obra
    descripcionItem: event.itemDescription,
    categoriaInsumo: event.category,
    cantidad: event.quantity,
    unidad: event.unit,
    precioUnitario: event.unitPricePyg,
    moneda: 'PYG',
    fechaObservacion: event.purchaseDate,
    esVolatil: event.category === 'COMBUSTIBLE'
  };

  const updatedObservations = [...existingObservations, newObs];
  const newEstimate = calculateCostEstimate(
    updatedObservations.filter(o => o.descripcionItem.toLowerCase().includes(event.itemDescription.toLowerCase())),
    asOfDate
  );

  const deltaPct = previousEstimate.recommendedUnitPrice > 0
    ? Number((((newEstimate.recommendedUnitPrice - previousEstimate.recommendedUnitPrice) / previousEstimate.recommendedUnitPrice) * 100).toFixed(2))
    : 0;

  return {
    updatedObservations,
    effect: {
      itemDescription: event.itemDescription,
      previousRecommendedPricePyg: previousEstimate.recommendedUnitPrice,
      newRecommendedPricePyg: newEstimate.recommendedUnitPrice,
      priceDeltaPct: deltaPct,
      newConfidenceTier: newEstimate.confidenceTier,
      totalObservations: newEstimate.sampleSize
    }
  };
}

/**
 * Registra observaciones de costo real en base de datos desde una factura vinculada a una orden de compra o proyecto
 */
export async function recordCostObservationFromInvoice(
  supabase: any,
  params: {
    empresaId: string;
    invoiceId: string;
    providerId: string;
    orderId?: string;
    projectId?: string;
    itemDescription?: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    currency?: string;
    invoiceDate?: string;
  }
): Promise<void> {
  try {
    let description = params.itemDescription;
    let qty = params.quantity || 1;
    let unit = params.unit || "UN";
    let unitPrice = params.unitPrice || 0;
    let projectId = params.projectId;

    // Si tenemos orderId pero faltan datos de producto, consultar la orden
    if (params.orderId && (!description || !unitPrice)) {
      const { data: order } = await supabase
        .from("authorized_orders")
        .select("product, quantity, unit, unit_price, project_id, total_price")
        .eq("id", params.orderId)
        .maybeSingle();

      if (order) {
        description = description || order.product;
        qty = qty && qty > 0 ? qty : Number(order.quantity || 1);
        unit = unit || order.unit || "UN";
        unitPrice = unitPrice && unitPrice > 0 ? unitPrice : Number(order.unit_price || order.total_price);
        projectId = projectId || order.project_id;
      }
    }

    if (!description || !unitPrice || unitPrice <= 0) {
      return; // No hay suficiente información para crear observación válida
    }

    // Clasificar categoría automáticamente
    const descLower = description.toLowerCase();
    let categoria: 'MATERIAL' | 'MANO_OBRA' | 'EQUIPO' | 'SUBCONTRATO' | 'COMBUSTIBLE' | 'OTRO' = 'MATERIAL';
    if (descLower.includes('gasoil') || descLower.includes('diesel') || descLower.includes('combustible')) {
      categoria = 'COMBUSTIBLE';
    } else if (descLower.includes('alquiler') || descLower.includes('motoniveladora') || descLower.includes('retroexcavadora') || descLower.includes('pala')) {
      categoria = 'EQUIPO';
    } else if (descLower.includes('subcontrat') || descLower.includes('servicio de')) {
      categoria = 'SUBCONTRATO';
    } else if (descLower.includes('oficial') || descLower.includes('ayudante') || descLower.includes('jornal')) {
      categoria = 'MANO_OBRA';
    }

    await supabase.from("cost_observations").insert({
      empresa_id: params.empresaId,
      project_id: projectId || null,
      proveedor_id: params.providerId || null,
      fuente: "FACTURA",
      documento_id: params.invoiceId,
      descripcion_item: description,
      categoria_insumo: categoria,
      cantidad: qty,
      unidad: unit,
      precio_unitario: unitPrice,
      moneda: params.currency || "PYG",
      tipo_cambio: 1.0,
      fecha_observacion: params.invoiceDate || new Date().toISOString().split('T')[0],
      es_volatil: categoria === 'COMBUSTIBLE'
    });
  } catch (err) {
    console.error("[Flywheel] Error recording cost observation from invoice:", err);
  }
}
