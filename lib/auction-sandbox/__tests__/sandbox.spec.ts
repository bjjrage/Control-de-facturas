/**
 * AUCTION SANDBOX — Adapter + bot-runner + policy persistence tests.
 * The bot runs through the REAL Auction Bot Core (no parallel logic).
 * Includes the critical acceptance scenario end-to-end (in-memory):
 * opening 1.050.000 → human 999.999 → bot 999.998 → human 979.999 → STOP.
 */
import { describe, it, expect } from 'vitest';
import { snapshotToAuctionState } from '../auction-state-adapter';
import { planAssistedSubmit, roomSbeConstraints, runBotTick } from '../bot-runner';
import { rankBids, validateSandboxBid, computePhase } from '../engine';
import { buildPolicyVersionRecord, policyFromSnapshot } from '../policies';
import { calculateAutoLimitPyg, freezePolicy } from '../../auction-bot/policy';
import { AuctionPolicy, FrozenAuctionPolicy } from '../../auction-bot/types';
import { SandboxBid, SandboxRoom, SandboxSnapshot } from '../types';

const T0 = '2026-01-01T00:00:00.000Z';
const T0ms = Date.parse(T0);

function room(overrides: Partial<SandboxRoom> = {}): SandboxRoom {
  return {
    id: 'room-acc',
    empresa_id: 'emp-1',
    created_by: 'user-1',
    title: 'TEST-001',
    scope: 'ITEM',
    group_id: 'item-1',
    status: 'ACTIVE_RANDOM',
    opening_price_pyg: 1_050_000,
    minimum_decrement_pyg: 1,
    normal_duration_seconds: 60,
    random_min_seconds: 30,
    random_max_seconds: 90,
    started_at: new Date(T0ms - 120_000).toISOString(),
    random_started_at: new Date(T0ms - 40_000).toISOString(), // closeRisk already true
    random_close_at: new Date(T0ms + 50_000).toISOString(),
    closed_at: null,
    next_sequence: 1,
    bot_paused: false,
    bot_runtime: {},
    winner_participant_id: null,
    created_at: T0,
    ...overrides,
  };
}

function acceptancePolicy(): FrozenAuctionPolicy {
  return freezePolicy(
    {
      policyId: 'pol-acc',
      auctionId: 'room-acc',
      groupId: 'item-1',
      scope: 'ITEM',
      positionStrategy: 'TARGET_RANK_1',
      targetRank: 1,
      defenseStepPyg: 1,
      normalPhaseBehavior: 'WAIT',
      safeWindowBehavior: 'WAIT',
      enterTargetPositionInEntryWindow: true,
      defendImmediatelyInCloseRisk: true,
      targetPricePyg: 1_000_000,
      autoDefenseToleranceBps: 200,
      autoLimitPyg: calculateAutoLimitPyg(1_000_000, 200),
      mipymePolicy: { enabled: false, executionMode: 'OBSERVE', defenseStepPyg: 1, economicLimitMode: 'USE_CURRENT_AUTO_LIMIT' },
      executionMode: 'BOUNDED_AUTO',
      maxStalenessMs: 5000,
      authorizedBy: 'Test Operator',
    },
    1,
    T0
  );
}

function snap(r: SandboxRoom, bids: SandboxBid[] = []): SandboxSnapshot {
  return {
    room: r,
    participants: [
      { id: 'bot', room_id: r.id, kind: 'BOT', display_alias: 'Nuestro Bot', created_at: T0 },
      { id: 'hum', room_id: r.id, kind: 'HUMAN', display_alias: 'Competidor', created_at: T0 },
    ],
    bids,
  };
}

function humanBid(seq: number, price: number, atIso: string): SandboxBid {
  return {
    id: `h${seq}`, room_id: 'room-acc', participant_id: 'hum', price_pyg: price,
    server_sequence: seq, server_received_at: atIso, idempotency_key: `hum:${seq}`,
    accepted: true, rejection_reason: null,
  };
}

describe('Sandbox adapter', () => {
  it('maps ACTIVE_RANDOM + closeRisk to RANDOM_CLOSE / CLOSE_RISK_WINDOW with bot as ours', () => {
    const state = snapshotToAuctionState(snap(room(), [humanBid(1, 999_999, T0)]), T0);
    expect(state.auctionId).toBe('room-acc');
    expect(state.groupId).toBe('item-1');
    expect(state.scope).toBe('ITEM');
    expect(state.phase).toBe('RANDOM_CLOSE');
    expect(state.timingWindow).toBe('CLOSE_RISK_WINDOW');
    expect(state.closeRisk).toBe(true);
    expect(state.status).toBe('ACTIVE');
    expect(state.ourRank).toBeNull();
    expect(state.ourCurrentPricePyg).toBeNull();
    expect(state.rankedOffers).toHaveLength(1);
    expect(state.rankedOffers[0].isOurOffer).toBe(false);
    expect(state.observedAt).toBe(T0);
  });

  it('maps early RANDOM (no close risk) to ENTRY_WINDOW', () => {
    const r = room({ random_started_at: new Date(T0ms - 10_000).toISOString() });
    const state = snapshotToAuctionState(snap(r), T0);
    expect(state.phase).toBe('RANDOM_CLOSE');
    expect(state.timingWindow).toBe('ENTRY_WINDOW');
    expect(state.closeRisk).toBe(false);
  });

  it('maps DRAFT to PRE_AUCTION (Core waits, never bids pre-opening)', () => {
    const state = snapshotToAuctionState(snap(room({ status: 'DRAFT', started_at: null, random_started_at: null, random_close_at: null })), T0);
    expect(state.phase).toBe('PRE_AUCTION');
  });

  it('never leaks random_close_at into AuctionState', () => {
    const state = snapshotToAuctionState(snap(room()), T0);
    expect('random_close_at' in state).toBe(false);
    expect(JSON.stringify(state)).not.toContain('random_close_at');
  });
});

describe('Bot runner through the REAL Core — acceptance scenario', () => {
  const policy = acceptancePolicy();
  const constraints = roomSbeConstraints(1);

  it('bot defends 999.999 with 999.998 (BOUNDED_AUTO)', () => {
    const { decision, machineState } = runBotTick({
      snapshot: snap(room(), [humanBid(1, 999_999, T0)]),
      policy, constraints, nowIso: T0,
    });
    expect(decision.action).toBe('BID_CANDIDATE');
    expect(decision.candidatePricePyg).toBe(999_998);
    expect(machineState).toBe('BID_READY');
  });

  it('bot STOPS (no bid) when the defense would breach Auto Limit', () => {
    const bids = [humanBid(1, 999_999, T0), humanBid(2, 979_999, T0)];
    const check = validateSandboxBid(snap(room(), [bids[0]]), 'hum', 979_999, computePhase(room(), T0ms));
    expect(check.ok).toBe(true); // the human move itself is legal
    const { decision } = runBotTick({ snapshot: snap(room(), bids), policy, constraints, nowIso: T0 });
    expect(decision.action).toBe('STOP');
    expect(decision.reasonCode).toBe('ECONOMIC_LIMIT_BREACHED');
    expect(decision.candidatePricePyg).toBe(979_998); // theoretical, never submitted
  });

  it('OBSERVE mode never submits: candidate exists but machine blocks submission', () => {
    const observePolicy = freezePolicy({ ...(policy as unknown as Record<string, unknown>), executionMode: 'OBSERVE' } as AuctionPolicy, 1, T0);
    const { decision } = runBotTick({
      snapshot: snap(room(), [humanBid(1, 999_999, T0)]),
      policy: observePolicy, constraints, nowIso: T0,
    });
    expect(decision.action).toBe('BID_CANDIDATE'); // evaluation only (WOULD BID)
    expect(decision.executionMode).toBe('OBSERVE');
  });

  it('ASSISTED plan exposes the candidate for human authorization', () => {
    const assistedPolicy = freezePolicy({ ...(policy as unknown as Record<string, unknown>), executionMode: 'ASSISTED' } as AuctionPolicy, 1, T0);
    const plan = planAssistedSubmit({
      snapshot: snap(room(), [humanBid(1, 999_999, T0)]),
      policy: assistedPolicy, constraints, nowIso: T0, operatorId: 'op@x',
    });
    expect(plan.decision.candidatePricePyg).toBe(999_998);
    // The machine enforces the grant before any submission.
    expect(() => plan.machine.startSubmission('x', { submittedAtIso: T0 })).toThrow();
    plan.machine.grantHumanAuthorization('op@x');
    const recheck = plan.machine.recheckCandidate(
      { ...snapshotToAuctionState(snap(room(), [humanBid(1, 999_999, T0)]), T0), observedAt: new Date(T0ms + 1000).toISOString() },
      { nowIso: new Date(T0ms + 1000).toISOString() }
    );
    expect(recheck.valid).toBe(true);
  });
});

describe('Sandbox policy persistence records', () => {
  function draft(): AuctionPolicy {
    return {
      policyId: 'pol-lab-1',
      auctionId: 'room-acc',
      groupId: 'item-1',
      scope: 'ITEM',
      positionStrategy: 'TARGET_RANK_1',
      targetRank: 1,
      defenseStepPyg: 1,
      normalPhaseBehavior: 'WAIT',
      safeWindowBehavior: 'WAIT',
      enterTargetPositionInEntryWindow: true,
      defendImmediatelyInCloseRisk: true,
      targetPricePyg: 1_000_000,
      autoDefenseToleranceBps: 200,
      autoLimitPyg: 980_000,
      mipymePolicy: { enabled: false, executionMode: 'OBSERVE', defenseStepPyg: 1, economicLimitMode: 'USE_CURRENT_AUTO_LIMIT' },
      executionMode: 'BOUNDED_AUTO',
      maxStalenessMs: 5000,
      authorizedBy: 'Test Operator',
    };
  }

  it('persists v1 as an immutable snapshot with fingerprint', () => {
    const rec = buildPolicyVersionRecord('room-acc', draft(), 1, 'Test Operator', T0);
    expect(rec.version).toBe(1);
    expect(rec.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(rec.snapshot.autoLimitPyg).toBe(980_000);
    const restored = policyFromSnapshot(rec);
    expect(restored.isFrozen).toBe(true);
    expect(restored.targetPricePyg).toBe(1_000_000);
  });

  it('v2 coexists without mutating v1', () => {
    const v1 = buildPolicyVersionRecord('room-acc', draft(), 1, 'Test Operator', T0);
    const v2draft = { ...draft(), autoDefenseToleranceBps: 300, autoLimitPyg: 970_000 };
    const v2 = buildPolicyVersionRecord('room-acc', v2draft, 2, 'Jefa', T0);
    expect(v2.snapshot.autoLimitPyg).toBe(970_000);
    expect(v1.snapshot.autoLimitPyg).toBe(980_000);
    expect(v1.fingerprint).not.toBe(v2.fingerprint);
  });

  it('rejects tampered snapshots on restore', () => {
    const rec = buildPolicyVersionRecord('room-acc', draft(), 1, 'Test Operator', T0);
    const tampered = { ...rec, snapshot: { ...rec.snapshot, targetPricePyg: 1 } };
    expect(() => policyFromSnapshot(tampered)).toThrow();
  });

  it('rejects invalid drafts before persisting', () => {
    expect(() => buildPolicyVersionRecord('room-acc', { ...draft(), authorizedBy: '' }, 1, '', T0)).toThrow();
  });
});

describe('Sandbox ranking helper reuse', () => {
  it('exposes server ranking for views', () => {
    const bids = [humanBid(2, 979_999, T0), humanBid(1, 999_999, T0)];
    const ranking = rankBids(bids, (pid) => (pid === 'bot' ? { kind: 'BOT', alias: 'Nuestro Bot' } : { kind: 'HUMAN', alias: 'Competidor' }));
    expect(ranking[0].price_pyg).toBe(979_999);
    expect(ranking[0].rank).toBe(1);
  });
});
