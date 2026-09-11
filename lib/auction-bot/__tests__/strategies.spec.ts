import { describe, it, expect } from 'vitest';
import { evaluatePositionGoal } from '../position-evaluator';
import { AuctionState } from '../types';

describe('Unified Position Goal Evaluator Specification', () => {
  const baseTime = '2026-09-10T20:00:00.000Z';

  function makeState(
    ourRank: number | null,
    competitorPrices: number[],
    ourPrice: number | null = 1_000_000
  ): AuctionState {
    const offers = competitorPrices.map((price, idx) => ({
      rank: idx + 1,
      participantId: `comp-${idx + 1}`,
      isOurOffer: false,
      pricePyg: price,
      timestamp: baseTime,
    }));

    if (ourRank !== null && ourPrice !== null) {
      offers.splice(ourRank - 1, 0, {
        rank: ourRank,
        participantId: 'our-firm',
        isOurOffer: true,
        pricePyg: ourPrice,
        timestamp: baseTime,
      });
      // re-rank
      offers.forEach((o, i) => {
        o.rank = i + 1;
      });
    }

    return {
      auctionId: 'auc-pos',
      groupId: 'grp-pos',
      scope: 'ITEM',
      phase: 'RANDOM_CLOSE',
      timingWindow: 'CLOSE_RISK_WINDOW',
      closeRisk: true,
      status: 'ACTIVE',
      rankedOffers: offers,
      ourRank,
      ourCurrentPricePyg: ourPrice,
      observedAt: baseTime,
    };
  }

  it('Target Rank 1: calculates minimal bid undercutting leader by defenseStep', () => {
    const state = makeState(2, [990_000], 1_000_000);
    const result = evaluatePositionGoal(state, 1, 10);

    expect(result.isSatisfied).toBe(false);
    expect(result.targetRank).toBe(1);
    expect(result.candidatePricePyg).toBe(989_990); // 990.000 - 10
  });

  it('Target Rank 2: takes rank #2 with minimal concession without regalar margen against #1', () => {
    // Comp 1 @ 900.000, Comp 2 @ 950.000, Our Firm @ 990.000 (Rank 3)
    const state = makeState(3, [900_000, 950_000], 990_000);
    const result = evaluatePositionGoal(state, 2, 23); // free defenseStep = 23

    expect(result.isSatisfied).toBe(false);
    expect(result.targetRank).toBe(2);
    // Undercuts Comp 2 (950.000) by 23 -> 949.977
    // Does NOT bid below 900.000! Saves 49.977 PYG of margin!
    expect(result.candidatePricePyg).toBe(949_977);
  });

  it('Target Rank 3: takes rank #3 with minimal concession', () => {
    // Comp 1 @ 850k, Comp 2 @ 900k, Comp 3 @ 960k, Our Firm @ 990k (Rank 4)
    const state = makeState(4, [850_000, 900_000, 960_000], 990_000);
    const result = evaluatePositionGoal(state, 3, 5_000); // defenseStep = 5.000

    expect(result.isSatisfied).toBe(false);
    expect(result.targetRank).toBe(3);
    // Undercuts Comp 3 (960.000) by 5.000 -> 955.000
    expect(result.candidatePricePyg).toBe(955_000);
  });

  it('Target Rank N: extensible to arbitrary rank (e.g. Target Rank 5)', () => {
    const state = makeState(null, [800_000, 850_000, 900_000, 920_000, 950_000], null);
    const result = evaluatePositionGoal(state, 5, 100);

    expect(result.isSatisfied).toBe(false);
    expect(result.targetRank).toBe(5);
    // Undercuts 5th competitor (950.000) by 100 -> 949.900
    expect(result.candidatePricePyg).toBe(949_900);
  });

  it('reports isSatisfied: true when our firm already occupies targetRank or better', () => {
    // We are rank 2, target is Top 3 -> satisfied
    const stateRank2 = makeState(2, [900_000, 960_000], 930_000);
    const result = evaluatePositionGoal(stateRank2, 3, 10);

    expect(result.isSatisfied).toBe(true);
    expect(result.candidatePricePyg).toBeNull();

    // We are rank 1, target is Rank 1 -> satisfied
    const stateRank1 = makeState(1, [950_000], 920_000);
    const result1 = evaluatePositionGoal(stateRank1, 1, 10);
    expect(result1.isSatisfied).toBe(true);
    expect(result1.candidatePricePyg).toBeNull();
  });
});
