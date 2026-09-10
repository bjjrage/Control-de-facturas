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
