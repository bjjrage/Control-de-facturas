import { describe, it, expect } from 'vitest';
import { evaluateAuctionStep } from '../engine';
import { calculateAutoLimitPyg, freezePolicy } from '../policy';
import { AuctionBotStateMachine } from '../state-machine';
import { AuctionState, FrozenAuctionPolicy } from '../types';

/**
 * Reconciliation hardening (Fix 6) + invalid timestamps fail closed (Fix 7).
 * A price match alone never ACCEPTs: scope, freshness and bid identity must
 * be proven first. Anything unprovable → AMBIGUOUS → HALTED.
 */
describe('Reconciliation Hardening — Scope, Freshness & Bid Identity', () => {
  const baseTime = '2026-09-10T20:00:00.000Z';
  const submitTime = '2026-09-10T20:00:05.000Z';

  function buildPolicy(): FrozenAuctionPolicy {
    return freezePolicy({
      policyId: 'pol-recon',
      auctionId: 'auc-recon',
      groupId: 'grp-recon',
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
      autoLimitPyg: calculateAutoLimitPyg(1_000_000, 200),
      mipymePolicy: {
        enabled: false,
        executionMode: 'OBSERVE',
        defenseStepPyg: 10,
        economicLimitMode: 'USE_CURRENT_AUTO_LIMIT',
      },
      executionMode: 'BOUNDED_AUTO',
      maxStalenessMs: 5000,
      authorizedBy: 'operador@empresa.com.py',
    });
  }

  function buildLiveState(): AuctionState {
    return {
      auctionId: 'auc-recon',
      groupId: 'grp-recon',
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
  }

  /** Machine in RECONCILING with a deterministic submission at submitTime. */
  function reconcilingMachine() {
    const policy = buildPolicy();
    const state = buildLiveState();
    const machine = new AuctionBotStateMachine(policy);
    machine.startMonitoring();
    machine.beginEvaluation();
    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('BID_CANDIDATE');
    expect(decision.candidatePricePyg).toBe(994_990);
    machine.handleDecision(decision, state);
    expect(machine.recheckCandidate(state, { nowIso: baseTime }).valid).toBe(true);
    machine.startSubmission('bid-recon-1', { submittedAtIso: submitTime });
    machine.markSubmissionUnknown('Socket timeout');
    expect(machine.getState()).toBe('RECONCILING');
    return machine;
  }

  it('ACCEPTS when the matched offer provably postdates the submission', () => {
    const machine = reconcilingMachine();
    const state: AuctionState = {
      ...buildLiveState(),
      observedAt: submitTime,
      rankedOffers: [
        { rank: 1, participantId: 'our-firm', isOurOffer: true, pricePyg: 994_990, timestamp: '2026-09-10T20:00:06.000Z' },
        { rank: 2, participantId: 'comp-1', isOurOffer: false, pricePyg: 995_000, timestamp: baseTime },
      ],
      ourRank: 1,
      ourCurrentPricePyg: 994_990,
    };
    const result = machine.reconcileWithState(state, { observationIsAuthoritative: true }, { nowIso: submitTime });
    expect(result.outcome).toBe('ACCEPTED');
    expect(result.foundRank).toBe(1);
    expect(machine.getState()).toBe('MONITORING');
  });

  it('goes AMBIGUOUS → HALTED on auction/group mismatch, even with a price match', () => {
    const machine = reconcilingMachine();
    const state: AuctionState = {
      ...buildLiveState(),
      auctionId: 'auc-other',
      observedAt: submitTime,
      rankedOffers: [
        { rank: 1, participantId: 'our-firm', isOurOffer: true, pricePyg: 994_990, timestamp: '2026-09-10T20:00:06.000Z' },
      ],
      ourRank: 1,
      ourCurrentPricePyg: 994_990,
    };
    const result = machine.reconcileWithState(state, { observationIsAuthoritative: true }, { nowIso: submitTime });
    expect(result.outcome).toBe('AMBIGUOUS');
    expect(machine.getState()).toBe('HALTED');
  });

  it('goes AMBIGUOUS → HALTED on stale observation, even with a price match', () => {
    const machine = reconcilingMachine();
    const state: AuctionState = {
      ...buildLiveState(),
      observedAt: submitTime,
      rankedOffers: [
        { rank: 1, participantId: 'our-firm', isOurOffer: true, pricePyg: 994_990, timestamp: '2026-09-10T20:00:06.000Z' },
      ],
      ourRank: 1,
      ourCurrentPricePyg: 994_990,
    };
    const result = machine.reconcileWithState(state, { observationIsAuthoritative: true }, { nowIso: '2026-09-10T20:05:00.000Z' });
    expect(result.outcome).toBe('AMBIGUOUS');
    expect(machine.getState()).toBe('HALTED');
  });

  it('goes AMBIGUOUS → HALTED on invalid observedAt (fail-closed timestamps)', () => {
    const machine = reconcilingMachine();
    const state: AuctionState = { ...buildLiveState(), observedAt: 'not-a-date' };
    const result = machine.reconcileWithState(state, { observationIsAuthoritative: true }, { nowIso: submitTime });
    expect(result.outcome).toBe('AMBIGUOUS');
    expect(machine.getState()).toBe('HALTED');
  });

  it('does NOT accept an identical OLDER offer (previous bid confusion) → AMBIGUOUS → HALTED', () => {
    const machine = reconcilingMachine();
    // Our price 994_990 is visible, but its timestamp PREDATES the submission:
    // this may be a previous identical bid of ours, not the submitted one.
    const state: AuctionState = {
      ...buildLiveState(),
      observedAt: submitTime,
      rankedOffers: [
        { rank: 1, participantId: 'our-firm', isOurOffer: true, pricePyg: 994_990, timestamp: baseTime },
        { rank: 2, participantId: 'comp-1', isOurOffer: false, pricePyg: 995_000, timestamp: baseTime },
      ],
      ourRank: 1,
      ourCurrentPricePyg: 994_990,
    };
    const result = machine.reconcileWithState(state, { observationIsAuthoritative: true }, { nowIso: submitTime });
    expect(result.outcome).toBe('AMBIGUOUS');
    expect(machine.getState()).toBe('HALTED');
  });

  it('goes AMBIGUOUS → HALTED when the matched offer has no parseable timestamp', () => {
    const machine = reconcilingMachine();
    const state: AuctionState = {
      ...buildLiveState(),
      observedAt: submitTime,
      rankedOffers: [
        { rank: 1, participantId: 'our-firm', isOurOffer: true, pricePyg: 994_990, timestamp: '' },
        { rank: 2, participantId: 'comp-1', isOurOffer: false, pricePyg: 995_000, timestamp: baseTime },
      ],
      ourRank: 1,
      ourCurrentPricePyg: 994_990,
    };
    const result = machine.reconcileWithState(state, { observationIsAuthoritative: true }, { nowIso: submitTime });
    expect(result.outcome).toBe('AMBIGUOUS');
    expect(machine.getState()).toBe('HALTED');
  });
});
