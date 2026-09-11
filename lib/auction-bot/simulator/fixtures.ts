/**
 * SBE AUCTION BOT - Canonical Simulation Fixtures (Sanitized V0 + MIPYME)
 */

import { AuctionState, FrozenAuctionPolicy, SbeConstraints } from '../types';
import { freezePolicy } from '../policy';

export const BASE_POLICY: FrozenAuctionPolicy = freezePolicy({
  policyId: 'pol-sim-001',
  auctionId: 'lic-dncp-2026-001',
  groupId: 'item-1',
  scope: 'ITEM',
  positionStrategy: 'TARGET_RANK_1',
  targetRank: 1,
  defenseStepPyg: 10,
  normalPhaseBehavior: 'WAIT',
  safeWindowBehavior: 'WAIT',
  enterTargetPositionInEntryWindow: true,
  defendImmediatelyInCloseRisk: true,
  targetPricePyg: 1_000_000,
  autoDefenseToleranceBps: 200, // 200 bps = 2.00% -> autoLimit = 980.000
  autoLimitPyg: 980_000,
  mipymePolicy: {
    enabled: true,
    executionMode: 'BOUNDED_AUTO',
    defenseStepPyg: 10,
    economicLimitMode: 'USE_CURRENT_AUTO_LIMIT',
  },
  executionMode: 'BOUNDED_AUTO',
  maxStalenessMs: 5000,
  authorizedBy: 'operaciones@empresa.com.py',
});

export const DEFAULT_SBE_CONSTRAINTS: SbeConstraints = {
  minimumDecrementPyg: 1,
  minimumOfferPyg: 100_000,
  maximumOfferPyg: 10_000_000,
  stepMultiplePyg: 1,
};

export interface SimulationEvent {
  step: number;
  eventDescription: string;
  state: AuctionState;
  expectedAction: 'WAIT' | 'BID_CANDIDATE' | 'STOP' | 'HALT';
  expectedCandidatePricePyg?: number;
}

/**
 * Creates the user's canonical scenario sequence:
 * Target: 1.000.000, Tolerance: 200 bps (AutoLimit: 980.000), Step: 10
 * Strategy: Maintain #1, Wait during normal lances, enter in entry window, defend in close-risk.
 */
export function createCanonicalUserScenario(baseTimeIso: string = '2026-09-10T20:00:00.000Z'): SimulationEvent[] {
  const t0 = new Date(baseTimeIso);
  const addSeconds = (s: number) => new Date(t0.getTime() + s * 1000).toISOString();

  return [
    {
      step: 1,
      eventDescription: 'Inicio de subasta en Fase Normal de lances. Estamos en #1 con ₲1.050.000.',
      state: {
        auctionId: 'lic-dncp-2026-001',
        groupId: 'item-1',
        scope: 'ITEM',
        phase: 'NORMAL_BIDDING',
        timingWindow: 'NOT_APPLICABLE',
        closeRisk: false,
        status: 'ACTIVE',
        rankedOffers: [
          { rank: 1, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_050_000, timestamp: addSeconds(0) },
          { rank: 2, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 1_060_000, timestamp: addSeconds(0) },
        ],
        ourRank: 1,
        ourCurrentPricePyg: 1_050_000,
        observedAt: addSeconds(5),
      },
      expectedAction: 'WAIT', // Already #1
    },
    {
      step: 2,
      eventDescription: 'Competidor Alpha nos desplaza a #2 con ₲1.020.000 durante Fase Normal. La política exige esperar en lances para ocultar estrategia.',
      state: {
        auctionId: 'lic-dncp-2026-001',
        groupId: 'item-1',
        scope: 'ITEM',
        phase: 'NORMAL_BIDDING',
        timingWindow: 'NOT_APPLICABLE',
        closeRisk: false,
        status: 'ACTIVE',
        rankedOffers: [
          { rank: 1, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 1_020_000, timestamp: addSeconds(10) },
          { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_050_000, timestamp: addSeconds(0) },
        ],
        ourRank: 2,
        ourCurrentPricePyg: 1_050_000,
        observedAt: addSeconds(12),
      },
      expectedAction: 'WAIT', // Tactical wait in NORMAL_BIDDING
    },
    {
      step: 3,
      eventDescription: 'Ingreso a Fase Aleatoria (Safe Window). Aún no hay riesgo de cierre (closeRisk = false). El bot continúa en espera táctica.',
      state: {
        auctionId: 'lic-dncp-2026-001',
        groupId: 'item-1',
        scope: 'ITEM',
        phase: 'RANDOM_CLOSE',
        timingWindow: 'SAFE_WINDOW',
        closeRisk: false,
        status: 'ACTIVE',
        rankedOffers: [
          { rank: 1, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 1_010_000, timestamp: addSeconds(30) },
          { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_050_000, timestamp: addSeconds(0) },
        ],
        ourRank: 2,
        ourCurrentPricePyg: 1_050_000,
        observedAt: addSeconds(35),
      },
      expectedAction: 'WAIT', // Tactical wait in SAFE_WINDOW
    },
    {
      step: 4,
      eventDescription: 'Transición a Entry Window. Ventana previa al posible cierre. El bot busca alcanzar el objetivo #1 superando al líder (1.010.000 - 10 = 1.009.990).',
      state: {
        auctionId: 'lic-dncp-2026-001',
        groupId: 'item-1',
        scope: 'ITEM',
        phase: 'RANDOM_CLOSE',
        timingWindow: 'ENTRY_WINDOW',
        closeRisk: false,
        status: 'ACTIVE',
        rankedOffers: [
          { rank: 1, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 1_010_000, timestamp: addSeconds(50) },
          { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_050_000, timestamp: addSeconds(0) },
        ],
        ourRank: 2,
        ourCurrentPricePyg: 1_050_000,
        observedAt: addSeconds(55),
      },
      expectedAction: 'BID_CANDIDATE',
      expectedCandidatePricePyg: 1_009_990,
    },
    {
      step: 5,
      eventDescription: 'El bot ingresa a #1 con 1.009.990 en Close-Risk Window (closeRisk = true). Estando en #1, el bot espera.',
      state: {
        auctionId: 'lic-dncp-2026-001',
        groupId: 'item-1',
        scope: 'ITEM',
        phase: 'RANDOM_CLOSE',
        timingWindow: 'CLOSE_RISK_WINDOW',
        closeRisk: true,
        status: 'ACTIVE',
        rankedOffers: [
          { rank: 1, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_009_990, timestamp: addSeconds(60) },
          { rank: 2, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 1_010_000, timestamp: addSeconds(50) },
        ],
        ourRank: 1,
        ourCurrentPricePyg: 1_009_990,
        observedAt: addSeconds(62),
      },
      expectedAction: 'WAIT', // Already #1
    },
    {
      step: 6,
      eventDescription: 'Competidor Alpha contraoferta a 999.999 (perfora el Target 1.000.000). En Close-Risk, el bot defiende de inmediato porque está dentro de la tolerancia autorizada (AutoLimit: 980.000). Candidate: 999.989.',
      state: {
        auctionId: 'lic-dncp-2026-001',
        groupId: 'item-1',
        scope: 'ITEM',
        phase: 'RANDOM_CLOSE',
        timingWindow: 'CLOSE_RISK_WINDOW',
        closeRisk: true,
        status: 'ACTIVE',
        rankedOffers: [
          { rank: 1, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 999_999, timestamp: addSeconds(70) },
          { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_009_990, timestamp: addSeconds(60) },
        ],
        ourRank: 2,
        ourCurrentPricePyg: 1_009_990,
        observedAt: addSeconds(71),
      },
      expectedAction: 'BID_CANDIDATE',
      expectedCandidatePricePyg: 999_989, // 999.999 - 10
    },
    {
      step: 7,
      eventDescription: 'Micro-decrementos agresivos del competidor hasta 980.005. El lance necesario sería 979.995, el cual perfora el AutoLimit (980.000). El bot debe frenar de inmediato con STOP.',
      state: {
        auctionId: 'lic-dncp-2026-001',
        groupId: 'item-1',
        scope: 'ITEM',
        phase: 'RANDOM_CLOSE',
        timingWindow: 'CLOSE_RISK_WINDOW',
        closeRisk: true,
        status: 'ACTIVE',
        rankedOffers: [
          { rank: 1, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 980_005, timestamp: addSeconds(90) },
          { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 999_989, timestamp: addSeconds(75) },
        ],
        ourRank: 2,
        ourCurrentPricePyg: 999_989,
        observedAt: addSeconds(91),
      },
      expectedAction: 'STOP', // Reaches 980.000 limit
    },
    {
      step: 8,
      eventDescription: 'Fase aleatoria concluye. Ingreso a POST_RANDOM con beneficio MIPYME AVAILABLE. Mejor precio: ₲990.000. Step MIPYME: 10. Candidate: ₲989.990 (dentro de AutoLimit 980.000).',
      state: {
        auctionId: 'lic-dncp-2026-001',
        groupId: 'item-1',
        scope: 'ITEM',
        phase: 'POST_RANDOM',
        timingWindow: 'EXPIRED',
        closeRisk: false,
        status: 'ACTIVE',
        rankedOffers: [
          { rank: 1, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 990_000, timestamp: addSeconds(100) },
          { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 999_989, timestamp: addSeconds(75) },
        ],
        ourRank: 2,
        ourCurrentPricePyg: 999_989,
        observedAt: addSeconds(102),
        postRandom: {
          mipymeBenefitStatus: 'AVAILABLE',
          deadlineMs: 120_000,
          ourFinalRank: 2,
          bestPricePyg: 990_000,
        },
      },
      expectedAction: 'BID_CANDIDATE',
      expectedCandidatePricePyg: 989_990,
    },
    {
      step: 9,
      eventDescription: 'Cierre definitivo de la subasta (CLOSED).',
      state: {
        auctionId: 'lic-dncp-2026-001',
        groupId: 'item-1',
        scope: 'ITEM',
        phase: 'CLOSED',
        timingWindow: 'EXPIRED',
        closeRisk: false,
        status: 'CLOSED',
        rankedOffers: [
          { rank: 1, participantId: 'our-firm', isOurOffer: true, pricePyg: 989_990, timestamp: addSeconds(105) },
          { rank: 2, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 990_000, timestamp: addSeconds(100) },
        ],
        ourRank: 1,
        ourCurrentPricePyg: 989_990,
        observedAt: addSeconds(110),
      },
      expectedAction: 'STOP',
    },
  ];
}
