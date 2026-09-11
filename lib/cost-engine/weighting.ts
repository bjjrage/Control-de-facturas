/**
 * WEIGHTING & AGGREGATION ENGINE (GATE 5B)
 * Algoritmos matemáticos determinísticos:
 * 1. Jerarquía de fuentes (Factura > Recepción > OC > Cotización > Manual)
 * 2. Decaimiento temporal exponencial según volatilidad del insumo
 * 3. Atenuación logarítmica de volumen (Log volume dampening)
 * 4. Detección de dispersión / volatilidad y cálculo de percentiles (P25, Mediana, P75)
 * 5. Identificación de tendencia de precios (RISING, FALLING, STABLE, VOLATILE)
 */

import {
  CostObservation,
  CostSource,
  CostEstimate,
  CostTrend,
  CostConfidenceTier,
  WeightingBreakdown,
  CostEngineConfig
} from './types';

// Pesos canónicos por jerarquía de evidencia transaccional
export const DEFAULT_SOURCE_WEIGHTS: Record<CostSource, number> = {
  FACTURA: 1.0,      // Evidencia contable / fiscal vinculante con pago
  RECEPCION: 0.9,    // Remisión física entregada en obra
  ORDEN_COMPRA: 0.8, // Contrato comercial emitido al proveedor
  COTIZACION: 0.6,   // Oferta previa recibida (intención)
  MANUAL: 0.3        // Estimación de oficina técnica / referencia histórica
};

// Vidas medias por categoría de volatilidad (en días)
export const DEFAULT_HALF_LIVES = {
  volatile: 30, // Combustible, flete, acero internacional
  standard: 90, // Cemento, arena, ladrillos, triturados
  durable: 180  // Madera, tubos PVC, artefactos
};

/**
 * Calcula la ponderación por decaimiento exponencial:
 * Weight = e^(-lambda * days) donde lambda = ln(2) / halfLife
 */
export function calculateTimeDecayWeight(daysDiff: number, halfLifeDays: number): number {
  if (daysDiff <= 0) return 1.0;
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * daysDiff);
}

/**
 * Atenuación logarítmica de volumen para evitar que una compra masiva
 * distorsione monopólicamente el costo unitario de reposición:
 * Weight = 1 + ln(1 + cantidad)
 */
export function calculateVolumeDampenedWeight(quantity: number): number {
  if (quantity <= 0) return 1.0;
  return 1.0 + Math.log(1.0 + quantity);
}

/**
 * Calcula percentiles de un arreglo numérico ordenado
 */
export function calculatePercentile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];

  const index = (percentile / 100) * (sortedValues.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

/**
 * Determina la vida media correspondiente para la observación
 */
export function resolveHalfLife(obs: CostObservation, config?: CostEngineConfig): number {
  const halfLives = { ...DEFAULT_HALF_LIVES, ...config?.halfLifeDays };
  if (obs.esVolatil || obs.categoriaInsumo === 'COMBUSTIBLE') {
    return halfLives.volatile;
  }
  if (obs.categoriaInsumo === 'EQUIPO' || obs.categoriaInsumo === 'SUBCONTRATO') {
    return halfLives.durable;
  }
  return halfLives.standard;
}

/**
 * Realiza el cálculo puro del Cost Estimate a partir de observaciones
 */
export function calculateCostEstimate(
  observations: CostObservation[],
  asOfDateStr: string = new Date().toISOString().split('T')[0],
  config?: CostEngineConfig
): CostEstimate {
  const sourceWeights = { ...DEFAULT_SOURCE_WEIGHTS, ...config?.sourceWeights };
  const volatilityThreshold = config?.volatilityThresholdPercent ?? 15.0; // 15% CV

  // Filtrar estrictamente observaciones computables con estado de evidencia VALIDA
  const validObservations = observations.filter(
    (obs): obs is CostObservation & { precioUnitario: number } => {
      if (obs.estadoEvidencia && obs.estadoEvidencia !== 'VALIDA') return false;
      if (obs.precioUnitario === null || obs.precioUnitario === undefined || !Number.isFinite(obs.precioUnitario) || obs.precioUnitario < 0) return false;
      return true;
    }
  );

  if (validObservations.length === 0) {
    return {
      itemDescription: observations[0]?.descripcionItem || 'Sin observaciones válidas',
      unit: observations[0]?.unidad || 'UN',
      recommendedUnitPrice: 0,
      priceRange: { min: 0, p25: 0, median: 0, p75: 0, max: 0 },
      sampleSize: 0,
      totalVolumeObserved: 0,
      volatilityPercentage: 0,
      trend: 'STABLE',
      confidenceTier: 'INSUFICIENTE',
      asOfDate: asOfDateStr,
      latestObservationDate: null,
      weightingDetails: [],
      isVolatileMarket: false
    };
  }

  const asOfDate = new Date(asOfDateStr);
  let totalWeightedPrice = 0;
  let totalWeight = 0;
  let totalVolume = 0;
  const weightingDetails: WeightingBreakdown[] = [];
  const prices: number[] = [];

  // Ordenar por fecha cronológica ascendente para calcular tendencias
  const sortedObs = [...validObservations].sort(
    (a, b) => new Date(a.fechaObservacion).getTime() - new Date(b.fechaObservacion).getTime()
  );

  for (const obs of sortedObs) {
    const obsDate = new Date(obs.fechaObservacion);
    const daysDiff = Math.max(0, Math.floor((asOfDate.getTime() - obsDate.getTime()) / (1000 * 60 * 60 * 24)));
    const halfLife = resolveHalfLife(obs, config);

    const sWeight = sourceWeights[obs.fuente] ?? 0.5;
    const tWeight = calculateTimeDecayWeight(daysDiff, halfLife);
    const vWeight = calculateVolumeDampenedWeight(obs.cantidad);

    // Peso final combinado
    const combinedWeight = sWeight * tWeight * vWeight;

    totalWeightedPrice += obs.precioUnitario * combinedWeight;
    totalWeight += combinedWeight;
    totalVolume += obs.cantidad;
    prices.push(obs.precioUnitario);

    weightingDetails.push({
      observationId: obs.id,
      fecha: obs.fechaObservacion,
      fuente: obs.fuente,
      precioUnitario: obs.precioUnitario,
      cantidad: obs.cantidad,
      sourceWeight: Number(sWeight.toFixed(2)),
      timeDecayWeight: Number(tWeight.toFixed(4)),
      volumeWeight: Number(vWeight.toFixed(3)),
      combinedWeight: Number(combinedWeight.toFixed(4)),
      effectivePrice: obs.precioUnitario
    });
  }

  const recommendedPrice = totalWeight > 0 ? Math.round(totalWeightedPrice / totalWeight) : 0;

  // Estadísticas y dispersión
  const sortedPrices = [...prices].sort((a, b) => a - b);
  const min = sortedPrices[0];
  const max = sortedPrices[sortedPrices.length - 1];
  const p25 = Math.round(calculatePercentile(sortedPrices, 25));
  const median = Math.round(calculatePercentile(sortedPrices, 50));
  const p75 = Math.round(calculatePercentile(sortedPrices, 75));

  // Desviación estándar y coeficiente de variación
  const mean = prices.reduce((acc, p) => acc + p, 0) / prices.length;
  const variance = prices.reduce((acc, p) => acc + Math.pow(p - mean, 2), 0) / prices.length;
  const stdDev = Math.sqrt(variance);
  const volatilityPercentage = mean > 0 ? Number(((stdDev / mean) * 100).toFixed(2)) : 0;
  const isVolatileMarket = volatilityPercentage >= volatilityThreshold;

  // Detección de tendencia (comparando mitad más antigua vs mitad más reciente)
  let trend: CostTrend = 'STABLE';
  if (isVolatileMarket) {
    trend = 'VOLATILE';
  } else if (sortedObs.length >= 3) {
    const half = Math.floor(sortedObs.length / 2);
    const earlyPrices = sortedObs.slice(0, half).map(o => o.precioUnitario);
    const latePrices = sortedObs.slice(half).map(o => o.precioUnitario);

    const earlyAvg = earlyPrices.reduce((a, b) => a + b, 0) / earlyPrices.length;
    const lateAvg = latePrices.reduce((a, b) => a + b, 0) / latePrices.length;

    const changeRatio = (lateAvg - earlyAvg) / earlyAvg;
    if (changeRatio >= 0.05) trend = 'RISING';
    else if (changeRatio <= -0.05) trend = 'FALLING';
    else trend = 'STABLE';
  }

  // Nivel de confianza
  // ALTA: >= 4 observaciones, al menos 1 FACTURA/RECEPCION, fecha reciente (< 60 días), baja volatilidad
  // MEDIA: >= 2 observaciones, fuentes sólidas
  // BAJA: 1 observación o solo cotizaciones viejas
  // INSUFICIENTE: sin datos válidos
  let confidenceTier: CostConfidenceTier = 'INSUFICIENTE';
  const latestObs = sortedObs[sortedObs.length - 1];
  const daysSinceLatest = Math.max(0, Math.floor((asOfDate.getTime() - new Date(latestObs.fechaObservacion).getTime()) / (1000 * 60 * 60 * 24)));
  const hasHardEvidence = sortedObs.some(o => o.fuente === 'FACTURA' || o.fuente === 'RECEPCION');

  if (sortedObs.length >= 4 && hasHardEvidence && daysSinceLatest <= 90 && volatilityPercentage < 25) {
    confidenceTier = 'ALTA';
  } else if (sortedObs.length >= 2 && daysSinceLatest <= 180) {
    confidenceTier = 'MEDIA';
  } else if (sortedObs.length >= 1) {
    confidenceTier = 'BAJA';
  }

  return {
    itemDescription: validObservations[0].descripcionItem,
    unit: validObservations[0].unidad,
    recommendedUnitPrice: recommendedPrice,
    priceRange: { min, p25, median, p75, max },
    sampleSize: validObservations.length,
    totalVolumeObserved: totalVolume,
    volatilityPercentage,
    trend,
    confidenceTier,
    asOfDate: asOfDateStr,
    latestObservationDate: latestObs.fechaObservacion,
    weightingDetails,
    isVolatileMarket
  };
}
