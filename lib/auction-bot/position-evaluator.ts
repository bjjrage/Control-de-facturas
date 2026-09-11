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
  /**
   * True when there are not enough observed competitor offers to compute the
   * reference price for the requested targetRank (fewer offers than targetRank).
   * The engine must NOT invent a reference (e.g. undercutting the leader to
   * take #1 when the client only asked for Top 3) — it must WAIT/HALT instead.
   *
   * PENDING: validate against the real SBE whether an externally-known
   * reference (e.g. referential price) may be used here. Until then: no bid.
   */
  insufficientEvidence?: boolean;
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

  // Insufficient evidence: fewer competitor offers than the requested targetRank.
  // There is no observed occupant of the target-rank threshold, so there is no
  // legitimate reference price to undercut. Bidding here would mean inventing
  // behavior (e.g. taking #1 when the client only asked for Top 3).
  if (competitors.length < targetRank) {
    return {
      isSatisfied: false,
      targetRank,
      candidatePricePyg: null,
      referenceCompetitorPricePyg: null,
      insufficientEvidence: true,
      reason: `Evidencia insuficiente para el objetivo Top ${targetRank}: solo hay ${competitors.length} oferta(s) de competidores observada(s). No se genera lance sin referencia (pendiente validar contra SBE real).`,
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
