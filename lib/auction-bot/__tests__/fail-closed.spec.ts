import { describe, it, expect } from 'vitest';
import { evaluateAuctionStep } from '../engine';
import { freezePolicy } from '../policy';
import { AuctionState, SbeConstraints } from '../types';

describe('Fail-Closed Safety Guardrails Specification (Sanitized V0)', () => {
  const baseTime = '2026-09-10T20:00:00.000Z';

  const policy = freezePolicy({
    policyId: 'pol-fail-closed',
    auctionId: 'auc-secure-01',
    groupId: 'grp-secure-01',
    scope: 'ITEM',
    positionStrategy: 'TARGET_RANK_1',
    targetRank: 1,
    defenseStepPyg: 10,
    normalPhaseBehavior: 'ACTIVE',
    safeWindowBehavior: 'ACTIVE',
    enterTargetPositionInEntryWindow: true,
    defendImmediatelyInCloseRisk: true,
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
    maxStalenessMs: 3000,
    authorizedBy: 'seguridad@empresa.com.py',
  });

  const baseActiveState: AuctionState = {
    auctionId: 'auc-secure-01',
    groupId: 'grp-secure-01',
    scope: 'ITEM',
    phase: 'RANDOM_CLOSE',
    timingWindow: 'CLOSE_RISK_WINDOW',
    closeRisk: true,
    status: 'ACTIVE',
    rankedOffers: [
      { rank: 1, participantId: 'comp-1', isOurOffer: false, pricePyg: 995_000, timestamp: baseTime },
      { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_000_000, timestamp: baseTime },
    ],
    ourRank: 2,
    ourCurrentPricePyg: 1_000_000,
    observedAt: baseTime,
  };

  it('HALTS when state age exceeds maxStalenessMs (stale state)', () => {
    const evaluatedAt = '2026-09-10T20:00:10.000Z';
    const decision = evaluateAuctionStep(baseActiveState, policy, undefined, { currentTimestampIso: evaluatedAt });

    expect(decision.action).toBe('HALT');
    expect(decision.reasonCode).toBe('STALE_STATE');
    expect(decision.candidatePricePyg).toBeNull();
  });

  it('STOPS when auction status or phase is CLOSED', () => {
    const closedState: AuctionState = {
      ...baseActiveState,
      status: 'CLOSED',
      phase: 'CLOSED',
    };

    const decision = evaluateAuctionStep(closedState, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('STOP');
    expect(decision.reasonCode).toBe('AUCTION_CLOSED');
  });

  it('WAITS when auction is PAUSED by the buyer', () => {
    const pausedState: AuctionState = {
      ...baseActiveState,
      status: 'PAUSED',
      phase: 'PAUSED',
    };

    const decision = evaluateAuctionStep(pausedState, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('WAIT');
    expect(decision.reasonCode).toBe('AUCTION_PAUSED');
  });

  it('HALTS when auction status is UNKNOWN', () => {
    const unknownState: AuctionState = {
      ...baseActiveState,
      status: 'UNKNOWN',
    };

    const decision = evaluateAuctionStep(unknownState, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('HALT');
    expect(decision.reasonCode).toBe('UNKNOWN_STATE');
  });

  it('HALTS when policy auctionId or groupId mismatches observed state', () => {
    const mismatchedState: AuctionState = {
      ...baseActiveState,
      auctionId: 'other-auction-999',
    };

    const decision = evaluateAuctionStep(mismatchedState, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('HALT');
    expect(decision.reasonCode).toBe('POLICY_MISMATCH');
  });

  it('HALTS with POLICY_CONSTRAINT_VIOLATION when candidate offer violates SBE technical platform constraints', () => {
    const strictConstraints: SbeConstraints = {
      minimumDecrementPyg: 500,
      stepMultiplePyg: 100,
    };

    const decision = evaluateAuctionStep(baseActiveState, policy, strictConstraints, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('HALT');
    expect(decision.reasonCode).toBe('POLICY_CONSTRAINT_VIOLATION');
  });
});
