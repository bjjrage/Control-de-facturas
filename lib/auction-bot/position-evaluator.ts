/**
 * SBE AUCTION BOT - Unified Position Goal Evaluator
 * Pure position logic without temporal leakage or strategy duplication.
 * Calculates the minimal bid needed to achieve or hold any target rank.
 */

import { AuctionState } from './types';

export interface PositionGoalResult {
  isSatisfied: boolean;
  targetRank: number;
  candidatePricePyg: number | null;
  referenceCompetitorPricePyg: number | null;
  reason: string;
}

/**
 * Evaluates whether the firm currently satisfies the position goal,
 * and if not, calculates the MINIMAL bid needed to take the target rank.
 * 
 * @param state Canonical auction state
 * @param targetRank Target rank position (e.g. 1 for leader, 2 for Top 2, 3 for Top 3)
 * @param defenseStepPyg Free positive integer PYG to undercut the target competitor
 */
export function evaluatePositionGoal(
  state: AuctionState,
  targetRank: number,
  defenseStepPyg: number
): PositionGoalResult {
  // Check if current position already satisfies the goal (e.g. rank 1 satisfies targetRank 1, 2, or 3)
  if (state.ourRank !== null && state.ourRank <= targetRank) {
    return {
      isSatisfied: true,
      targetRank,
      candidatePricePyg: null,
      referenceCompetitorPricePyg: null,
      reason: `Posición objetivo cumplida (actual: #${state.ourRank}, objetivo: Top ${targetRank}).`,
    };
  }

  // Filter competitor offers sorted by price ascending
  const competitors = state.rankedOffers
    .filter((offer) => !offer.isOurOffer)
    .sort((a, b) => a.pricePyg - b.pricePyg);

  if (competitors.length === 0) {
    return {
      isSatisfied: true,
      targetRank,
      candidatePricePyg: null,
      referenceCompetitorPricePyg: null,
      reason: 'No se detectaron ofertas de competidores en la subasta.',
    };
  }

  // Identify the competitor currently occupying the threshold of our target rank.
  // Example for targetRank = 2:
  // If competitors = [Comp1 @ 900k, Comp2 @ 950k]:
  // targetIdx = min(2 - 1, 2 - 1) = 1 -> Comp2 @ 950k.
  // Candidate = 950k - defenseStep. That places our offer at rank #2 without gifting price against Comp1!
  const targetIdx = Math.min(targetRank - 1, competitors.length - 1);
  const targetCompetitor = competitors[targetIdx];
  const candidatePricePyg = targetCompetitor.pricePyg - defenseStepPyg;

  return {
    isSatisfied: false,
    targetRank,
    candidatePricePyg,
    referenceCompetitorPricePyg: targetCompetitor.pricePyg,
    reason: `Recuperar posición #${targetRank} superando al competidor del puesto #${targetIdx + 1} (₲${targetCompetitor.pricePyg.toLocaleString()}) por ₲${defenseStepPyg.toLocaleString()}.`,
  };
}
