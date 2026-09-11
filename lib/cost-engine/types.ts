/**
 * TYPES DEFINITION: COST ENGINE V1 (GATE 5B)
 * Modelos y tipos para la agregación de costos ponderados, decaimiento temporal y dispersión.
 */

export type CostSource = 'FACTURA' | 'RECEPCION' | 'ORDEN_COMPRA' | 'COTIZACION' | 'MANUAL';

export type InputCategory = 'MATERIAL' | 'MANO_OBRA' | 'EQUIPO' | 'SUBCONTRATO' | 'COMBUSTIBLE' | 'OTRO';

export type CostTrend = 'RISING' | 'STABLE' | 'FALLING' | 'VOLATILE';

export type CostConfidenceTier = 'ALTA' | 'MEDIA' | 'BAJA' | 'INSUFICIENTE';

export interface CostObservation {
  id: string;
  empresaId: string;
  productoId?: string;
  projectId?: string;
  proveedorId?: string;
  fuente: CostSource;
  documentoId?: string;
  descripcionItem: string;
  categoriaInsumo: InputCategory;
  cantidad: number;
  unidad: string;
  precioUnitario: number | null; // En PYG (normalizado), o null si es no computable / en revisión
  moneda: 'PYG' | 'USD';
  monedaOriginal?: string | null;
  precioUnitarioOriginal?: number | null;
  tipoCambio?: number;
  fechaObservacion: string; // ISO date YYYY-MM-DD
  esVolatil?: boolean;
  estadoEvidencia: 'VALIDA' | 'REVISION_REQUERIDA' | 'OBSOLETA' | 'DESCARTADA';
}

export interface WeightingBreakdown {
  observationId: string;
  fecha: string;
  fuente: CostSource;
  precioUnitario: number;
  cantidad: number;
  sourceWeight: number;    // Factor por tipo de fuente (1.0 a 0.3)
  timeDecayWeight: number; // Factor por decaimiento exponencial
  volumeWeight: number;    // Factor por volumen dampening
  combinedWeight: number;  // Producto normalizado
  effectivePrice: number;  // Precio aportado
}

export interface CostEstimate {
  itemDescription: string;
  unit: string;
  recommendedUnitPrice: number; // Precio sugerido ponderado / costo de reposición (replacement cost)
  priceRange: {
    min: number;
    p25: number;
    median: number;
    p75: number;
    max: number;
  };
  sampleSize: number;
  totalVolumeObserved: number;
  volatilityPercentage: number; // Coeficiente de variación (stdDev / media) * 100
  trend: CostTrend;
  confidenceTier: CostConfidenceTier;
  asOfDate: string;
  latestObservationDate: string | null;
  weightingDetails: WeightingBreakdown[];
  isVolatileMarket: boolean;
}

export interface CostEngineConfig {
  sourceWeights?: Partial<Record<CostSource, number>>;
  halfLifeDays?: {
    volatile: number;
    standard: number;
    durable: number;
  };
  volatilityThresholdPercent?: number; // Ej: 15%
  outlierZScoreThreshold?: number; // Ej: 2.5
}
