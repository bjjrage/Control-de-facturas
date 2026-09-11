import { describe, it, expect } from 'vitest';
import { evaluateAuctionStep } from '../engine';
import { freezePolicy } from '../policy';
import { AuctionState } from '../types';

describe('Independence of Position Goal vs Timing Strategy', () => {
  const baseTime = '2026-09-10T20:00:00.000Z';

  function buildPolicy(
    targetRank: number,
    normalBehavior: 'WAIT' | 'ACTIVE',
    safeBehavior: 'WAIT' | 'ACTIVE',
    enterInEntryWindow: boolean = true,
    defendInCloseRisk: boolean = true
  ) {
    return freezePolicy({
      policyId: 'pol-timing',
      auctionId: 'auc-time',
      groupId: 'grp-time',
      scope: 'ITEM',
      positionStrategy: `TARGET_TOP_${targetRank}` as any,
      targetRank,
      defenseStepPyg: 10,
      normalPhaseBehavior: normalBehavior,
      safeWindowBehavior: safeBehavior,
      enterTargetPositionInEntryWindow: enterInEntryWindow,
      defendImmediatelyInCloseRisk: defendInCloseRisk,
      targetPricePyg: 1_000_000,
      autoDefenseToleranceBps: 200,
      autoLimitPyg: 980_000,
      mipymePolicy: {
        enabled: true,
        executionMode: 'BOUNDED_AUTO',
        defenseStepPyg: 10,
        economicLimitMode: 'USE_CURRENT_AUTO_LIMIT',
      },
      executionMode: 'BOUNDED_AUTO',
      maxStalenessMs: 5000,
      authorizedBy: 'supervisor@empresa.com.py',
    });
  }

  // Displaced state: 3 competitors ahead of us, we are at rank 4 (1.030.000)
  const displacedState: AuctionState = {
    auctionId: 'auc-time',
    groupId: 'grp-time',
    scope: 'ITEM',
    phase: 'NORMAL_BIDDING',
    timingWindow: 'NOT_APPLICABLE',
    closeRisk: false,
    status: 'ACTIVE',
    rankedOffers: [
      { rank: 1, participantId: 'comp-1', isOurOffer: false, pricePyg: 1_000_000, timestamp: baseTime },
      { rank: 2, participantId: 'comp-2', isOurOffer: false, pricePyg: 1_010_000, timestamp: baseTime },
      { rank: 3, participantId: 'comp-3', isOurOffer: false, pricePyg: 1_020_000, timestamp: baseTime },
      { rank: 4, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_030_000, timestamp: baseTime },
    ],
    ourRank: 4,
    ourCurrentPricePyg: 1_030_000,
    observedAt: baseTime,
  };

  it('tactically waits in NORMAL_BIDDING regardless of targetRank (e.g. targetRank = 3)', () => {
    // Target rank = 3, but timing policy says WAIT in normal bidding
    const policy = buildPolicy(3, 'WAIT', 'WAIT');
    const decision = evaluateAuctionStep(displacedState, policy, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('WAIT');
    expect(decision.reasonCode).toBe('TACTICAL_WAIT_NORMAL_PHASE');
    expect(decision.candidatePricePyg).toBeNull();
  });

  it('bids in NORMAL_BIDDING when normalPhaseBehavior is ACTIVE for targetRank = 3', () => {
    const policy = buildPolicy(3, 'ACTIVE', 'WAIT');
    const decision = evaluateAuctionStep(displacedState, policy, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('BID_CANDIDATE');
    expect(decision.targetRank).toBe(3);
    // Undercuts Comp 3 (1.020.000) by 10 -> 1.019.990
    expect(decision.candidatePricePyg).toBe(1_019_990);
  });

  it('tactically waits during SAFE_WINDOW in RANDOM_CLOSE phase', () => {
    const policy = buildPolicy(2, 'WAIT', 'WAIT');
    const safeState: AuctionState = {
      ...displacedState,
      phase: 'RANDOM_CLOSE',
      timingWindow: 'SAFE_WINDOW',
    };

    const decision = evaluateAuctionStep(safeState, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('WAIT');
    expect(decision.reasonCode).toBe('TACTICAL_WAIT_SAFE_WINDOW');
  });

  it('triggers ENTRY_POSITION_REQUIRED during ENTRY_WINDOW for targetRank = 2', () => {
    const policy = buildPolicy(2, 'WAIT', 'WAIT');
    const entryState: AuctionState = {
      ...displacedState,
      phase: 'RANDOM_CLOSE',
      timingWindow: 'ENTRY_WINDOW',
    };

    const decision = evaluateAuctionStep(entryState, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('BID_CANDIDATE');
    expect(decision.targetRank).toBe(2);
    expect(decision.reasonCode).toBe('ENTRY_POSITION_REQUIRED');
    // Undercuts Comp 2 (1.010.000) by 10 -> 1.009.990
    expect(decision.candidatePricePyg).toBe(1_009_990);
  });

  it('activates immediate defense during CLOSE_RISK_WINDOW when closeRisk is TRUE', () => {
    const policy = buildPolicy(1, 'WAIT', 'WAIT');
    const riskState: AuctionState = {
      ...displacedState,
      phase: 'RANDOM_CLOSE',
      timingWindow: 'CLOSE_RISK_WINDOW',
      closeRisk: true,
    };

    const decision = evaluateAuctionStep(riskState, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('BID_CANDIDATE');
    expect(decision.targetRank).toBe(1);
    expect(decision.reasonCode).toBe('TARGET_POSITION_DEFENSE_REQUIRED');
    expect(decision.candidatePricePyg).toBe(999_990); // 1.000.000 - 10
  });

  it('WAITS in ENTRY_WINDOW when enterTargetPositionInEntryWindow is false', () => {
    const policy = buildPolicy(2, 'WAIT', 'WAIT', false, true);
    const entryState: AuctionState = {
      ...displacedState,
      phase: 'RANDOM_CLOSE',
      timingWindow: 'ENTRY_WINDOW',
    };

    const decision = evaluateAuctionStep(entryState, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('WAIT');
    expect(decision.reasonCode).toBe('ENTRY_WINDOW_DISABLED_BY_POLICY');
    expect(decision.candidatePricePyg).toBeNull();
  });

  it('WAITS in CLOSE_RISK_WINDOW when defendImmediatelyInCloseRisk is false', () => {
    const policy = buildPolicy(1, 'WAIT', 'WAIT', true, false);
    const riskState: AuctionState = {
      ...displacedState,
      phase: 'RANDOM_CLOSE',
      timingWindow: 'CLOSE_RISK_WINDOW',
      closeRisk: true,
    };

    const decision = evaluateAuctionStep(riskState, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('WAIT');
    expect(decision.reasonCode).toBe('CLOSE_RISK_DEFENSE_DISABLED_BY_POLICY');
    expect(decision.candidatePricePyg).toBeNull();
  });

  it('WAITS on closeRisk flag alone when defendImmediatelyInCloseRisk is false', () => {
    const policy = buildPolicy(1, 'ACTIVE', 'ACTIVE', true, false);
    const riskState: AuctionState = {
      ...displacedState,
      phase: 'RANDOM_CLOSE',
      timingWindow: 'NOT_APPLICABLE',
      closeRisk: true,
    };

    const decision = evaluateAuctionStep(riskState, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('WAIT');
    expect(decision.reasonCode).toBe('CLOSE_RISK_DEFENSE_DISABLED_BY_POLICY');
    expect(decision.candidatePricePyg).toBeNull();
  });
});
