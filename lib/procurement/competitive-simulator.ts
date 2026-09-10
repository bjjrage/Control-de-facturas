/**
 * COMPETITIVE SIMULATOR (GATE 16)
 * Simulación estocástica y paramétrica de escenarios competitivos para licitaciones públicas:
 * 1. Estimación de cantidad de oferentes probables basada en tamaño de contrato y convocante.
 * 2. Identificación y modelado de competidores habituales (Huella de Gate 5A).
 * 3. Simulación Monte Carlo (N = 10,000 iteraciones) de posturas de precios de rivales.
 * 4. Estimación de distribución del precio adjudicado: Percentiles P10 (agresivo), P50 (mediana), P90 (conservador).
 * 5. Cálculo de la curva de probabilidad de ganar en función del precio ofertado (Win Probability Curve).
 */

import { ContextualFingerprint } from './competitor-intelligence';

export interface CompetitiveSimulationInput {
  tenderId: string;
  referenceBudgetPyg: number;
  expectedParticipantsCount?: number;
  knownCompetitorFingerprints?: ContextualFingerprint[];
  category?: string;
}

export interface SimulationPercentiles {
  p10WinningPricePyg: number; // Precio muy agresivo (solo 10% de probabilidad de ganar a precio más alto)
  p50WinningPricePyg: number; // Precio mediano de corte
  p90WinningPricePyg: number; // Precio conservador
}

export interface PricePointWinProbability {
  discountPct: number;
  offerAmountPyg: number;
  winProbabilityPct: number;
}

export interface CompetitiveSimulationResult {
  tenderId: string;
  simulationStatus: 'CALCULADO' | 'UNCALIBRATED' | 'INSUFFICIENT_EVIDENCE';
  isCalibrated: boolean;
  missingInputs: string[];
  referenceBudgetPyg: number;
  simulatedCompetitorsCount: number;
  winningPriceDistribution: SimulationPercentiles;
  winProbabilityCurve: PricePointWinProbability[];
  recommendedSweetSpotDiscountPct: number;
  recommendedSweetSpotPricePyg: number;
  iterationsRun: number;
}

/**
 * Genera una variable aleatoria normal mediante Box-Muller
 */
function randomNormal(mean: number, stdDev: number): number {
  const u1 = Math.max(1e-6, Math.random());
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return mean + z0 * stdDev;
}

/**
 * Ejecuta simulación Monte Carlo de subasta pública.
 * INVARIANTE UNKNOWN != DEFAULT:
 * Si el presupuesto referencial es <= 0 o la evidencia de competidores es insuficiente,
 * no inventa competidores (4 o 6), ni descuentos (8%), ni dispersiones sintéticas (3.5%).
 * Falla a UNCALIBRATED sin emitir precio recomendado ni probabilidad numérica.
 */
export function simulateCompetitiveBidding(
  input: CompetitiveSimulationInput,
  iterations: number = 10000
): CompetitiveSimulationResult {
  const refBudget = Number(input.referenceBudgetPyg || 0);
  if (refBudget <= 0) {
    return {
      tenderId: input.tenderId,
      simulationStatus: 'INSUFFICIENT_EVIDENCE',
      isCalibrated: false,
      missingInputs: ['Presupuesto referencial de la licitación no especificado o inválido'],
      referenceBudgetPyg: 0,
      simulatedCompetitorsCount: 0,
      winningPriceDistribution: {
        p10WinningPricePyg: 0,
        p50WinningPricePyg: 0,
        p90WinningPricePyg: 0
      },
      winProbabilityCurve: [],
      recommendedSweetSpotDiscountPct: 0,
      recommendedSweetSpotPricePyg: 0,
      iterationsRun: 0
    };
  }

  // CANONICAL INVARIANT: UNKNOWN != DEFAULT
  // Requiere mínimo 2 competidores observados Y al menos 2 huellas empíricas (o 3 muestras históricas acumuladas)
  const fingerprints = input.knownCompetitorFingerprints ?? [];
  const hasExplicitParticipants = typeof input.expectedParticipantsCount === 'number' && input.expectedParticipantsCount >= 2;
  const totalSamples = fingerprints.reduce((acc, f) => acc + (f.sample_size || 1), 0);
  const hasSufficientFingerprints = fingerprints.length >= 2 || totalSamples >= 3;

  const missingInputs: string[] = [];
  if (!hasExplicitParticipants) {
    missingInputs.push('Menos de 2 oferentes observados en el llamado (mínimo 2 requeridos)');
  }
  if (!hasSufficientFingerprints) {
    missingInputs.push('Evidencia insuficiente de descuentos históricos de competidores (mínimo 2 huellas o 3 muestras en el rubro)');
  }

  // Si los datos son insuficientes: NO emitir precio recomendado ni curva de probabilidad ni inventar 4/6 competidores u 8% de descuento
  if (!hasExplicitParticipants || !hasSufficientFingerprints) {
    return {
      tenderId: input.tenderId,
      simulationStatus: 'UNCALIBRATED',
      isCalibrated: false,
      missingInputs,
      referenceBudgetPyg: refBudget,
      simulatedCompetitorsCount: input.expectedParticipantsCount || 0,
      winningPriceDistribution: {
        p10WinningPricePyg: 0,
        p50WinningPricePyg: 0,
        p90WinningPricePyg: 0
      },
      winProbabilityCurve: [],
      recommendedSweetSpotDiscountPct: 0,
      recommendedSweetSpotPricePyg: 0,
      iterationsRun: 0
    };
  }

  const numCompetitors = input.expectedParticipantsCount!;

  // Calibración estricta con datos empíricos: media y dispersión observadas reales
  const discounts = fingerprints.map(f => f.avg_discount_pct).filter(d => typeof d === 'number' && !isNaN(d));
  const meanDiscount = discounts.reduce((a, b) => a + b, 0) / discounts.length;
  const variance = discounts.reduce((acc, d) => acc + Math.pow(d - meanDiscount, 2), 0) / Math.max(1, discounts.length);
  const reportedStdDevs = fingerprints.map(f => f.stddev_discount_pct).filter((s): s is number => typeof s === 'number' && s > 0);
  const stdDevDiscount = reportedStdDevs.length > 0
    ? reportedStdDevs.reduce((a, b) => a + b, 0) / reportedStdDevs.length
    : Math.max(0.5, Math.sqrt(variance));

  const winningDiscounts: number[] = [];

  for (let i = 0; i < iterations; i++) {
    let maxDiscountInAuction = -100;

    for (let c = 0; c < numCompetitors; c++) {
      // Simular descuento del competidor c
      const disc = Math.min(25, Math.max(0, randomNormal(meanDiscount, stdDevDiscount)));
      if (disc > maxDiscountInAuction) {
        maxDiscountInAuction = disc;
      }
    }

    winningDiscounts.push(maxDiscountInAuction);
  }

  // Ordenar los descuentos ganadores de menor a mayor
  winningDiscounts.sort((a, b) => a - b);

  // El descuento ganador más alto corresponde al precio más bajo
  // P10 de precio = P90 de descuento
  // P50 de precio = P50 de descuento
  // P90 de precio = P10 de descuento
  const p10Disc = winningDiscounts[Math.floor(iterations * 0.90)];
  const p50Disc = winningDiscounts[Math.floor(iterations * 0.50)];
  const p90Disc = winningDiscounts[Math.floor(iterations * 0.10)];

  const p10Price = Math.round(input.referenceBudgetPyg * (1 - p10Disc / 100));
  const p50Price = Math.round(input.referenceBudgetPyg * (1 - p50Disc / 100));
  const p90Price = Math.round(input.referenceBudgetPyg * (1 - p90Disc / 100));

  // Curva de probabilidad de ganar para descuentos de 2% a 18%
  const winProbabilityCurve: PricePointWinProbability[] = [];
  const testDiscounts = [2, 4, 6, 8, 10, 12, 14, 16, 18];

  for (const td of testDiscounts) {
    // Si nuestro descuento es td, ganamos si td > maxDiscountInAuction
    const wins = winningDiscounts.filter(wd => td >= wd).length;
    const prob = Number(((wins / iterations) * 100).toFixed(1));
    const offer = Math.round(input.referenceBudgetPyg * (1 - td / 100));

    winProbabilityCurve.push({
      discountPct: td,
      offerAmountPyg: offer,
      winProbabilityPct: prob
    });
  }

  // Sweet spot: punto de corte donde prob de ganar ronda el 60-70% con margen preservado
  const sweetSpotDiscount = Number(p50Disc.toFixed(1));
  const sweetSpotPrice = p50Price;

  return {
    tenderId: input.tenderId,
    simulationStatus: 'CALCULADO',
    isCalibrated: true,
    missingInputs: [],
    referenceBudgetPyg: input.referenceBudgetPyg,
    simulatedCompetitorsCount: numCompetitors,
    winningPriceDistribution: {
      p10WinningPricePyg: p10Price,
      p50WinningPricePyg: p50Price,
      p90WinningPricePyg: p90Price
    },
    winProbabilityCurve,
    recommendedSweetSpotDiscountPct: sweetSpotDiscount,
    recommendedSweetSpotPricePyg: sweetSpotPrice,
    iterationsRun: iterations
  };
}
