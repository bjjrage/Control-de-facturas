import { describe, it, expect } from 'vitest';
import { evaluateAuctionStep } from '../engine';
import { calculateAutoLimitPyg, freezePolicy } from '../policy';
import { AuctionBotStateMachine } from '../state-machine';
import { AuctionState, FrozenAuctionPolicy } from '../types';

/**
 * Policy lifecycle: upgrade guards (P2) + identity continuity (P3).
 * A new VERSION belongs to the same policy/session; anything else requires
 * a new AuctionBotStateMachine. Upgrades are rejected while a submission is
 * in flight (exactly-once first).
 */
describe('Policy Lifecycle — Upgrade Guards & Identity Continuity', () => {
  const baseTime = '2026-09-10T20:00:00.000Z';
  const freshTime = '2026-09-10T20:00:01.000Z';
  const submitTime = '2026-09-10T20:00:02.000Z';

  function buildPolicy(version: number = 1): FrozenAuctionPolicy {
    return freezePolicy(
      {
        policyId: 'pol-lifecycle',
        auctionId: 'auc-lifecycle',
        groupId: 'grp-lifecycle',
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
      },
      version,
      baseTime
    );
  }

  function buildDisplacedState(): AuctionState {
    return {
      auctionId: 'auc-lifecycle',
      groupId: 'grp-lifecycle',
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

  function upgradeTo(policy: FrozenAuctionPolicy, overrides: Partial<FrozenAuctionPolicy>, version: number): FrozenAuctionPolicy {
    return freezePolicy({ ...policy, ...overrides } as FrozenAuctionPolicy, version, submitTime);
  }

  /** Machine with an in-flight (SUBMITTING) submission. */
  function submittingMachine(): AuctionBotStateMachine {
    const policy = buildPolicy(1);
    const state = buildDisplacedState();
    const machine = new AuctionBotStateMachine(policy);
    machine.startMonitoring();
    machine.beginEvaluation();
    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });
    expect(decision.action).toBe('BID_CANDIDATE');
    machine.handleDecision(decision, state);
    expect(machine.recheckCandidate({ ...state, observedAt: freshTime }, { nowIso: freshTime }).valid).toBe(true);
    machine.startSubmission('bid-lifecycle', { submittedAtIso: submitTime });
    expect(machine.getState()).toBe('SUBMITTING');
    return machine;
  }

  it('P2: rejects policy upgrade while SUBMITTING', () => {
    const machine = submittingMachine();
    const v2 = upgradeTo(machine.getContext().policy, { autoDefenseToleranceBps: 300, autoLimitPyg: 970_000 }, 2);
    expect(() => machine.applyNewPolicyVersion(v2)).toThrow();
    expect(machine.getContext().policy.version).toBe(1);
  });

  it('P2: rejects policy upgrade while RECONCILING (submission UNKNOWN)', () => {
    const machine = submittingMachine();
    machine.markSubmissionUnknown('Socket timeout');
    expect(machine.getState()).toBe('RECONCILING');
    const v2 = upgradeTo(machine.getContext().policy, { autoDefenseToleranceBps: 300, autoLimitPyg: 970_000 }, 2);
    expect(() => machine.applyNewPolicyVersion(v2)).toThrow();
    expect(machine.getContext().policy.version).toBe(1);
  });

  it('P2: allows upgrade after the submission CONFIRMED (exactly-once resolved)', () => {
    const machine = submittingMachine();
    machine.confirmSubmission();
    expect(machine.getState()).toBe('MONITORING');
    const v2 = upgradeTo(machine.getContext().policy, { autoDefenseToleranceBps: 300, autoLimitPyg: 970_000 }, 2);
    machine.applyNewPolicyVersion(v2);
    expect(machine.getContext().policy.version).toBe(2);
  });

  it('P3: rejects upgrade with changed auctionId', () => {
    const machine = new AuctionBotStateMachine(buildPolicy(1));
    machine.startMonitoring();
    const v2 = upgradeTo(machine.getContext().policy, { auctionId: 'auc-other' }, 2);
    expect(() => machine.applyNewPolicyVersion(v2)).toThrow(/auctionId/);
  });

  it('P3: rejects upgrade with changed groupId', () => {
    const machine = new AuctionBotStateMachine(buildPolicy(1));
    machine.startMonitoring();
    const v2 = upgradeTo(machine.getContext().policy, { groupId: 'grp-other' }, 2);
    expect(() => machine.applyNewPolicyVersion(v2)).toThrow(/groupId/);
  });

  it('P3: rejects upgrade with changed scope', () => {
    const machine = new AuctionBotStateMachine(buildPolicy(1));
    machine.startMonitoring();
    const v2 = upgradeTo(machine.getContext().policy, { scope: 'LOT' as const }, 2);
    expect(() => machine.applyNewPolicyVersion(v2)).toThrow(/scope/);
  });

  it('P3: rejects upgrade with changed policyId', () => {
    const machine = new AuctionBotStateMachine(buildPolicy(1));
    machine.startMonitoring();
    const v2 = upgradeTo(machine.getContext().policy, { policyId: 'pol-other' }, 2);
    expect(() => machine.applyNewPolicyVersion(v2)).toThrow(/policyId/);
  });

  it('P3: rejects non-increasing version even with identical identity', () => {
    const machine = new AuctionBotStateMachine(buildPolicy(2));
    machine.startMonitoring();
    const same = upgradeTo(machine.getContext().policy, {}, 2);
    expect(() => machine.applyNewPolicyVersion(same)).toThrow();
    const older = upgradeTo(machine.getContext().policy, {}, 1);
    expect(() => machine.applyNewPolicyVersion(older)).toThrow();
  });

  it('P3: accepts a valid v2 with the same identity', () => {
    const machine = new AuctionBotStateMachine(buildPolicy(1));
    machine.startMonitoring();
    const v2 = upgradeTo(
      machine.getContext().policy,
      { autoDefenseToleranceBps: 300, autoLimitPyg: 970_000, authorizedBy: 'director@empresa.com.py' },
      2
    );
    machine.applyNewPolicyVersion(v2);
    expect(machine.getContext().policy.version).toBe(2);
    expect(machine.getContext().policy.autoLimitPyg).toBe(970_000);
    expect(machine.getState()).toBe('MONITORING');
  });
});
