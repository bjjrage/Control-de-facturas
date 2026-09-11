import { describe, it, expect } from 'vitest';
import { evaluateAuctionStep } from '../engine';
import { calculateAutoLimitPyg, freezePolicy } from '../policy';
import { AuctionBotStateMachine } from '../state-machine';
import {
  HumanAuthorizationRequiredError,
  ObserveModeSubmissionError,
  StaleCandidateError,
} from '../errors';
import { AuctionState, ExecutionMode, FrozenAuctionPolicy } from '../types';

/**
 * Submission guards: execution-mode enforcement (Fix 3) + pre-submit
 * recheck barrier (Fix 4). None of these guarantees may rely on the UI.
 */
describe('Submission Guards — Execution Mode & Pre-Submit Recheck', () => {
  const baseTime = '2026-09-10T20:00:00.000Z';

  function buildPolicy(mode: ExecutionMode): FrozenAuctionPolicy {
    return freezePolicy({
      policyId: 'pol-guard',
      auctionId: 'auc-guard',
      groupId: 'grp-guard',
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
      executionMode: mode,
      maxStalenessMs: 5000,
      authorizedBy: 'operador@empresa.com.py',
    });
  }

  function buildDisplacedState(): AuctionState {
    return {
      auctionId: 'auc-guard',
      groupId: 'grp-guard',
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

  /** Drives a machine to BID_READY with the candidate bound to `state`. */
  function machineWithCandidate(mode: ExecutionMode, state?: AuctionState) {
    const policy = buildPolicy(mode);
    const st = state ?? buildDisplacedState();
    const machine = new AuctionBotStateMachine(policy);
    machine.startMonitoring();
    machine.beginEvaluation();
    const decision = evaluateAuctionStep(st, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('BID_CANDIDATE');
    machine.handleDecision(decision, st);
    expect(machine.getState()).toBe('BID_READY');
    return { machine, policy, state: st };
  }

  it('OBSERVE mode can never startSubmission, even with a valid recheck', () => {
    const { machine, state } = machineWithCandidate('OBSERVE');
    const recheck = machine.recheckCandidate(state, { nowIso: baseTime });
    expect(recheck.valid).toBe(true);
    expect(() => machine.startSubmission('bid-observe')).toThrow(ObserveModeSubmissionError);
    expect(machine.getState()).toBe('BID_READY');
  });

  it('ASSISTED mode rejects startSubmission without explicit human authorization', () => {
    const { machine, state } = machineWithCandidate('ASSISTED');
    const recheck = machine.recheckCandidate(state, { nowIso: baseTime });
    expect(recheck.valid).toBe(true);
    expect(() => machine.startSubmission('bid-assisted-noauth')).toThrow(HumanAuthorizationRequiredError);
  });

  it('ASSISTED mode submits after grantHumanAuthorization, and the grant is single-use', () => {
    const { machine, state } = machineWithCandidate('ASSISTED');
    expect(machine.recheckCandidate(state, { nowIso: baseTime }).valid).toBe(true);

    machine.grantHumanAuthorization('supervisor@empresa.com.py');
    const submission = machine.startSubmission('bid-assisted-1', { submittedAtIso: baseTime });
    expect(submission.status).toBe('SUBMITTING');
    expect(machine.getContext().pendingHumanAuthorization).toBeNull();

    // New cycle: a fresh candidate requires a FRESH grant.
    machine.confirmSubmission();
    expect(machine.getState()).toBe('MONITORING');
    machine.beginEvaluation();
    const policy = machine.getContext().policy;
    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });
    machine.handleDecision(decision, state);
    expect(machine.recheckCandidate(state, { nowIso: baseTime }).valid).toBe(true);
    expect(() => machine.startSubmission('bid-assisted-2')).toThrow(HumanAuthorizationRequiredError);
  });

  it('ASSISTED mode accepts an inline humanAuthorizationId on startSubmission', () => {
    const { machine, state } = machineWithCandidate('ASSISTED');
    expect(machine.recheckCandidate(state, { nowIso: baseTime }).valid).toBe(true);
    const submission = machine.startSubmission('bid-assisted-inline', {
      submittedAtIso: baseTime,
      humanAuthorizationId: 'supervisor@empresa.com.py',
    });
    expect(submission.status).toBe('SUBMITTING');
    const grants = machine.getContext().history.filter((h) => h.trigger === 'HUMAN_AUTHORIZATION_CONSUMED');
    expect(grants).toHaveLength(1);
  });

  it('BOUNDED_AUTO submits without human authorization', () => {
    const { machine, state } = machineWithCandidate('BOUNDED_AUTO');
    expect(machine.recheckCandidate(state, { nowIso: baseTime }).valid).toBe(true);
    const submission = machine.startSubmission('bid-auto', { submittedAtIso: baseTime });
    expect(submission.status).toBe('SUBMITTING');
  });

  it('rejects startSubmission without a prior pre-submit recheck (stale candidate)', () => {
    const { machine } = machineWithCandidate('BOUNDED_AUTO');
    expect(() => machine.startSubmission('bid-no-recheck')).toThrow(StaleCandidateError);
  });

  it('rejects startSubmission when the candidate was generated without bound state', () => {
    const policy = buildPolicy('BOUNDED_AUTO');
    const machine = new AuctionBotStateMachine(policy);
    machine.startMonitoring();
    machine.beginEvaluation();
    const state = buildDisplacedState();
    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });
    // No generating state passed: candidate has no basis and can never submit.
    machine.handleDecision(decision);
    const recheck = machine.recheckCandidate(state, { nowIso: baseTime });
    expect(recheck.valid).toBe(false);
    expect(() => machine.startSubmission('bid-unbound', { submittedAtIso: baseTime })).toThrow(StaleCandidateError);
  });

  it('invalidates the candidate when price/ranking changed → MONITORING / re-evaluate', () => {
    const { machine, state } = machineWithCandidate('BOUNDED_AUTO');
    const movedState: AuctionState = {
      ...state,
      rankedOffers: [
        { rank: 1, participantId: 'comp-1', isOurOffer: false, pricePyg: 990_000, timestamp: baseTime },
        { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_000_000, timestamp: baseTime },
      ],
      // ourRank/ourCurrentPricePyg unchanged, but competitor moved: engine would
      // compute a different candidate (989_990 vs 994_990) → must re-evaluate.
      observedAt: baseTime,
    };
    // Simulate the competitor move also shifting our observed rank is not needed:
    // change our own observed price slightly to trip the guard deterministically.
    const changedState: AuctionState = { ...movedState, ourCurrentPricePyg: 999_999 };
    const recheck = machine.recheckCandidate(changedState, { nowIso: baseTime });
    expect(recheck.valid).toBe(false);
    expect(machine.getState()).toBe('MONITORING');
    expect(() => machine.startSubmission('bid-changed', { submittedAtIso: baseTime })).toThrow();
  });

  it('invalidates the candidate on stale fresh observation → MONITORING', () => {
    const { machine, state } = machineWithCandidate('BOUNDED_AUTO');
    const recheck = machine.recheckCandidate(state, { nowIso: '2026-09-10T20:05:00.000Z' });
    expect(recheck.valid).toBe(false);
    expect(machine.getState()).toBe('MONITORING');
  });

  it('invalidates the candidate on auction/group mismatch → MONITORING', () => {
    const { machine, state } = machineWithCandidate('BOUNDED_AUTO');
    const otherState: AuctionState = { ...state, auctionId: 'auc-other' };
    const recheck = machine.recheckCandidate(otherState, { nowIso: baseTime });
    expect(recheck.valid).toBe(false);
    expect(machine.getState()).toBe('MONITORING');
  });

  it('HALTS the machine on invalid timestamp during recheck (fail-closed)', () => {
    const { machine, state } = machineWithCandidate('BOUNDED_AUTO');
    const badState: AuctionState = { ...state, observedAt: 'not-a-date' };
    const recheck = machine.recheckCandidate(badState, { nowIso: baseTime });
    expect(recheck.valid).toBe(false);
    expect(machine.getState()).toBe('HALTED');
  });

  it('a new decision resets any previous recheck', () => {
    const { machine, policy, state } = machineWithCandidate('BOUNDED_AUTO');
    expect(machine.recheckCandidate(state, { nowIso: baseTime }).valid).toBe(true);
    machine.beginEvaluation();
    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });
    machine.handleDecision(decision, state);
    // Previous recheck is void: must recheck the NEW candidate first.
    expect(() => machine.startSubmission('bid-reset', { submittedAtIso: baseTime })).toThrow(StaleCandidateError);
  });

  it('MIPYME candidates enforce the MIPYME execution mode, not the general one', () => {
    const generalAuto = freezePolicy({
      ...buildPolicy('BOUNDED_AUTO'),
      policyId: 'pol-mipyme-mode',
      auctionId: 'auc-mipyme-mode',
      groupId: 'grp-mipyme-mode',
      mipymePolicy: {
        enabled: true,
        executionMode: 'ASSISTED',
        defenseStepPyg: 10,
        economicLimitMode: 'USE_CURRENT_AUTO_LIMIT',
      },
    });
    const state: AuctionState = {
      auctionId: 'auc-mipyme-mode',
      groupId: 'grp-mipyme-mode',
      scope: 'ITEM',
      phase: 'POST_RANDOM',
      timingWindow: 'EXPIRED',
      closeRisk: false,
      status: 'ACTIVE',
      rankedOffers: [
        { rank: 1, participantId: 'comp-1', isOurOffer: false, pricePyg: 990_000, timestamp: baseTime },
        { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_005_000, timestamp: baseTime },
      ],
      ourRank: 2,
      ourCurrentPricePyg: 1_005_000,
      observedAt: baseTime,
      postRandom: { mipymeBenefitStatus: 'AVAILABLE', deadlineMs: 60_000, ourFinalRank: 2, bestPricePyg: 990_000 },
    };
    const machine = new AuctionBotStateMachine(generalAuto);
    machine.startMonitoring();
    machine.beginEvaluation();
    const decision = evaluateAuctionStep(state, generalAuto, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('BID_CANDIDATE');
    expect(decision.executionMode).toBe('ASSISTED');
    machine.handleDecision(decision, state);
    expect(machine.recheckCandidate(state, { nowIso: baseTime }).valid).toBe(true);
    // General mode is BOUNDED_AUTO, but the MIPYME candidate requires human auth.
    expect(() => machine.startSubmission('bid-mipyme-assisted')).toThrow(HumanAuthorizationRequiredError);
    machine.grantHumanAuthorization('supervisor@empresa.com.py');
    const submission = machine.startSubmission('bid-mipyme-assisted', { submittedAtIso: baseTime });
    expect(submission.isMipyme).toBe(true);
  });
});
