import { describe, it, expect } from 'vitest';
import { evaluateAuctionStep } from '../engine';
import { freezePolicy } from '../policy';
import { AuctionState, FrozenAuctionPolicy } from '../types';

describe('Deterministic Strategy Engine - Free Defense Step & Auto Limit Semantics', () => {
  const baseTime = '2026-09-10T20:00:00.000Z';

  function buildPolicy(defenseStepPyg: number, toleranceBps: number = 200): FrozenAuctionPolicy {
    const targetPrice = 1_000_000;
    const autoLimit = Math.floor((targetPrice * (10000 - toleranceBps)) / 10000);

    return freezePolicy({
      policyId: 'pol-eng-01',
      auctionId: 'auc-01',
      groupId: 'grp-01',
      scope: 'ITEM',
      positionStrategy: 'TARGET_RANK_1',
      targetRank: 1,
      defenseStepPyg,
      normalPhaseBehavior: 'ACTIVE',
      safeWindowBehavior: 'ACTIVE',
      enterTargetPositionInEntryWindow: true,
      defendImmediatelyInCloseRisk: true,
      targetPricePyg: targetPrice,
      autoDefenseToleranceBps: toleranceBps,
      autoLimitPyg: autoLimit,
      mipymePolicy: {
        enabled: true,
        executionMode: 'BOUNDED_AUTO',
        defenseStepPyg: defenseStepPyg,
        economicLimitMode: 'USE_CURRENT_AUTO_LIMIT',
      },
      executionMode: 'BOUNDED_AUTO',
      maxStalenessMs: 5000,
      authorizedBy: 'analista@empresa.com.py',
    });
  }

  function buildState(competitorPricePyg: number, ourPricePyg: number = 1_050_000): AuctionState {
    return {
      auctionId: 'auc-01',
      groupId: 'grp-01',
      scope: 'ITEM',
      phase: 'RANDOM_CLOSE',
      timingWindow: 'CLOSE_RISK_WINDOW',
      closeRisk: true,
      status: 'ACTIVE',
      rankedOffers: [
        { rank: 1, participantId: 'comp-1', isOurOffer: false, pricePyg: competitorPricePyg, timestamp: baseTime },
        { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: ourPricePyg, timestamp: baseTime },
      ],
      ourRank: 2,
      ourCurrentPricePyg: ourPricePyg,
      observedAt: baseTime,
    };
  }

  it('correctly executes non-standard free defense steps (defenseStep = 7, 23, 5000)', () => {
    // Case 1: defenseStep = 7
    const policy7 = buildPolicy(7);
    const state1 = buildState(995_000);
    const decision1 = evaluateAuctionStep(state1, policy7, undefined, { currentTimestampIso: baseTime });
    expect(decision1.action).toBe('BID_CANDIDATE');
    expect(decision1.candidatePricePyg).toBe(994_993); // 995.000 - 7
    expect(decision1.defenseStepAppliedPyg).toBe(7);

    // Case 2: defenseStep = 23
    const policy23 = buildPolicy(23);
    const state2 = buildState(995_000);
    const decision2 = evaluateAuctionStep(state2, policy23, undefined, { currentTimestampIso: baseTime });
    expect(decision2.action).toBe('BID_CANDIDATE');
    expect(decision2.candidatePricePyg).toBe(994_977); // 995.000 - 23
    expect(decision2.defenseStepAppliedPyg).toBe(23);

    // Case 3: defenseStep = 5.000
    const policy5k = buildPolicy(5_000);
    const state3 = buildState(995_000);
    const decision3 = evaluateAuctionStep(state3, policy5k, undefined, { currentTimestampIso: baseTime });
    expect(decision3.action).toBe('BID_CANDIDATE');
    expect(decision3.candidatePricePyg).toBe(990_000); // 995.000 - 5.000
    expect(decision3.defenseStepAppliedPyg).toBe(5_000);
  });

  it('allows crossing below Target Price when candidate is within current policy Auto Limit', () => {
    const policy = buildPolicy(10, 200); // 2% tolerance -> Auto Limit = 980.000
    const state = buildState(999_999); // competitor undercut target 1.000.000

    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('BID_CANDIDATE');
    expect(decision.candidatePricePyg).toBe(999_989); // 999.999 - 10
    expect(decision.targetPricePyg).toBe(1_000_000);
    expect(decision.autoLimitPyg).toBe(980_000);
    expect(decision.candidatePricePyg! < decision.targetPricePyg).toBe(true);
    expect(decision.candidatePricePyg! >= decision.autoLimitPyg).toBe(true);
  });

  it('stops with ECONOMIC_LIMIT_BREACHED when candidate breaches current policy Auto Limit', () => {
    const policy = buildPolicy(10, 200); // Auto Limit = 980.000
    const state = buildState(980_005); // candidate would be 979.995 < 980.000

    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('STOP');
    expect(decision.reasonCode).toBe('ECONOMIC_LIMIT_BREACHED');
    expect(decision.candidatePricePyg).toBe(979_995);
    expect(decision.reasonDescription).toContain('Límite de defensa automática');
  });

  it('prevents micro-decrement erosion by continuously testing cumulative candidate price', () => {
    const policy = buildPolicy(1, 200); // defenseStep = 1, Auto Limit = 980.000

    const sequence = [
      { comp: 999_999, expectedAction: 'BID_CANDIDATE', expectedCand: 999_998 },
      { comp: 980_002, expectedAction: 'BID_CANDIDATE', expectedCand: 980_001 },
      { comp: 980_001, expectedAction: 'BID_CANDIDATE', expectedCand: 980_000 }, // exactly hits Auto Limit
      { comp: 980_000, expectedAction: 'STOP', expectedCand: 979_999 }, // breaches Auto Limit -> STOP
      { comp: 850_000, expectedAction: 'STOP', expectedCand: 849_999 }, // deep below Auto Limit -> STOP
    ];

    for (const item of sequence) {
      const state = buildState(item.comp);
      const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });
      expect(decision.action).toBe(item.expectedAction);
      expect(decision.candidatePricePyg).toBe(item.expectedCand);
    }
  });
});
