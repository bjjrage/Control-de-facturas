/**
 * AUCTION SANDBOX — Adapter + bot-runner + policy persistence tests.
 * The bot runs through the REAL Auction Bot Core (no parallel logic).
 * Includes the critical acceptance scenario end-to-end (in-memory):
 * opening 1.050.000 → human 999.999 → bot 999.998 → human 979.999 → STOP.
 */
import { describe, it, expect } from 'vitest';
import { snapshotToAuctionState } from '../auction-state-adapter';
import { planAssistedSubmit, recheckAndSubmit, roomSbeConstraints, runBotTick } from '../bot-runner';
import { rankBids, validateSandboxBid, computePhase } from '../engine';
import { buildPolicyVersionRecord, checkPolicyContinuity, policyFromSnapshot, samePolicyContent } from '../policies';
import { buildJoinView, buildWatchView, missingPolicyEvents, publicRoomInfo } from '../server';
import { calculateAutoLimitPyg, freezePolicy } from '../../auction-bot/policy';
import { evaluateAuctionStep } from '../../auction-bot/engine';
import { AuctionBotStateMachine } from '../../auction-bot/state-machine';
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
  it('exposes one row per participant (current best only)', () => {
    const bids = [humanBid(2, 979_999, T0), humanBid(1, 999_999, T0)];
    const ranking = rankBids(bids, (pid) => (pid === 'bot' ? { kind: 'BOT', alias: 'Nuestro Bot' } : { kind: 'HUMAN', alias: 'Competidor' }));
    expect(ranking).toHaveLength(1);
    expect(ranking[0].price_pyg).toBe(979_999);
    expect(ranking[0].rank).toBe(1);
  });
});

describe('recheckAndSubmit — real fresh snapshot flow (F2)', () => {
  const T1 = '2026-01-01T00:00:01.000Z';
  const policy = acceptancePolicy();
  const constraints = roomSbeConstraints(1);

  function decide() {
    const state = snapshotToAuctionState(snap(room(), [humanBid(1, 999_999, T0)]), T0);
    const machine = new AuctionBotStateMachine(policy);
    machine.startMonitoring();
    machine.beginEvaluation();
    const decision = evaluateAuctionStep(state, policy, constraints, { currentTimestampIso: T0 });
    machine.handleDecision(decision, state);
    return { machine, decision };
  }

  it('submits when the fresh snapshot confirms the same candidate', async () => {
    const { machine, decision } = decide();
    expect(decision.action).toBe('BID_CANDIDATE');
    const freshState = snapshotToAuctionState(snap(room(), [humanBid(1, 999_999, T0)]), T1);
    const calls: Array<{ pricePyg: number; bidId: string; submittedAtIso: string }> = [];
    const result = await recheckAndSubmit({
      machine, decision, freshState, freshNowIso: T1,
      submit: async (args) => { calls.push(args); return { accepted: true }; },
    });
    expect(result.submitted).toBe(true);
    expect(result.pricePyg).toBe(999_998);
    expect(calls).toHaveLength(1);
    expect(calls[0].submittedAtIso).toBe(T1);
  });

  it('does NOT submit when the competitor moved before the fresh read', async () => {
    const { machine, decision } = decide();
    // Competitor drops to 990_000 AFTER the initial decision: the old
    // candidate 999_998 would no longer take #1.
    const movedState = snapshotToAuctionState(
      snap(room(), [humanBid(1, 990_000, T1)]), T1
    );
    const calls: unknown[] = [];
    const result = await recheckAndSubmit({
      machine, decision, freshState: movedState, freshNowIso: T1,
      submit: async (args) => { calls.push(args); return { accepted: true }; },
    });
    expect(result.submitted).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('does NOT submit from the same snapshot twice (no re-observation)', async () => {
    const { machine, decision } = decide();
    const sameState = snapshotToAuctionState(snap(room(), [humanBid(1, 999_999, T0)]), T0);
    const calls: unknown[] = [];
    const result = await recheckAndSubmit({
      machine, decision, freshState: sameState, freshNowIso: T0,
      submit: async (args) => { calls.push(args); return { accepted: true }; },
    });
    expect(result.submitted).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe('checkPolicyContinuity — server-side binding (F5)', () => {
  const ROOM = { roomId: 'room-acc', roomGroupId: 'item-1', roomScope: 'ITEM' as const };
  function boundDraft(overrides: Partial<AuctionPolicy> = {}): AuctionPolicy {
    return {
      policyId: 'pol-sandbox-room-acc',
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
      ...overrides,
    };
  }

  it('accepts a well-formed v1', () => {
    expect(checkPolicyContinuity({ ...ROOM, prev: null, draft: boundDraft(), version: 1, authorizedBy: 'Test Operator' })).toEqual([]);
  });

  it('rejects v1 from another room / group / scope', () => {
    const base = { ...ROOM, prev: null, draft: boundDraft(), version: 1, authorizedBy: 'Test Operator' };
    expect(checkPolicyContinuity({ ...base, draft: boundDraft({ auctionId: 'room-B' }) })).not.toEqual([]);
    expect(checkPolicyContinuity({ ...base, draft: boundDraft({ groupId: 'item-9' }) })).not.toEqual([]);
    expect(checkPolicyContinuity({ ...base, draft: boundDraft({ scope: 'LOT' }) })).not.toEqual([]);
  });

  it('rejects authorizedBy mismatch', () => {
    expect(checkPolicyContinuity({ ...ROOM, prev: null, draft: boundDraft(), version: 1, authorizedBy: 'Other' })).not.toEqual([]);
    expect(checkPolicyContinuity({ ...ROOM, prev: null, draft: boundDraft({ authorizedBy: '' }), version: 1, authorizedBy: '' })).not.toEqual([]);
  });

  it('v2 must keep policyId and bump exactly +1', () => {
    const prev = { version: 1, policy_id: 'pol-sandbox-room-acc' };
    const ok = { ...ROOM, prev, draft: boundDraft(), version: 2, authorizedBy: 'Test Operator' };
    expect(checkPolicyContinuity(ok)).toEqual([]);
    expect(checkPolicyContinuity({ ...ok, draft: boundDraft({ policyId: 'pol-other' }) })).not.toEqual([]);
    expect(checkPolicyContinuity({ ...ok, version: 3 })).not.toEqual([]);
    expect(checkPolicyContinuity({ ...ok, draft: boundDraft({ scope: 'LOT' }) })).not.toEqual([]);
  });
});

describe('policyFromSnapshot metadata cross-checks (F5)', () => {
  function record() {
    return buildPolicyVersionRecord('room-acc', {
      policyId: 'pol-sandbox-room-acc',
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
    }, 1, 'Test Operator', T0);
  }

  it('restores a consistent record', () => {
    expect(policyFromSnapshot(record()).policyId).toBe('pol-sandbox-room-acc');
  });

  it('rejects version / policyId / fingerprint metadata tamper', () => {
    const rec = record();
    expect(() => policyFromSnapshot({ ...rec, version: 2 })).toThrow();
    expect(() => policyFromSnapshot({ ...rec, policy_id: 'pol-other' })).toThrow();
    expect(() => policyFromSnapshot({ ...rec, fingerprint: 'deadbeef' })).toThrow();
  });
});

describe('view secrecy (F6)', () => {  function fullBundle() {
    const r = room();
    const ext = r as unknown as Record<string, unknown>;
    ext.random_close_at = new Date(Date.parse(T0) + 60_000).toISOString();
    ext.competitor_token_hash = 'hash-c';
    ext.observer_token_hash = 'hash-o';
    return { ...snap(r, [humanBid(1, 999_999, T0)]), policies: [], events: [] };
  }

  it('no view leaks random_close_at or token hashes', () => {
    const b = fullBundle();
    for (const view of [publicRoomInfo(b, T0), buildJoinView(b, 'hum', T0), buildWatchView(b, T0)]) {
      const json = JSON.stringify(view);
      expect(json).not.toContain('random_close_at');
      expect(json).not.toContain('token_hash');
      expect(json).not.toContain('hash-c');
    }
  });

  it('persisted lastBotStatus object surfaces as the action string (never an object)', () => {
    const b = fullBundle();
    const withStatus = {
      ...b,
      room: {
        ...b.room,
        bot_runtime: {
          lastBotStatus: { action: 'BID_CANDIDATE', reasonCode: 'TARGET_POSITION_DEFENSE_REQUIRED', candidate: 999_998, v: 1 },
        },
      },
    };
    const view = buildWatchView(withStatus, T0);
    expect(view.botStatus).toBe('BID_CANDIDATE');
    expect(typeof view.botStatus).toBe('string');
  });

  it('empty runtime yields null botStatus (never undefined/object)', () => {
    const view = buildWatchView(fullBundle(), T0);
    expect(view.botStatus).toBeNull();
  });
});

describe('recentBids is real history, ranking stays collapsed (F1/F3)', () => {
  function historyBundle() {
    const r = room();
    const bids = [
      humanBid(1, 999_999, T0),
      { ...humanBid(1, 999_999, T0), id: 'bot1', participant_id: 'bot', price_pyg: 999_998, server_sequence: 2 },
      { ...humanBid(1, 999_999, T0), id: 'h2', price_pyg: 999_990, server_sequence: 3 },
      { ...humanBid(1, 999_999, T0), id: 'bot2', participant_id: 'bot', price_pyg: 999_989, server_sequence: 4 },
    ];
    return { ...snap(r, bids), policies: [], events: [] };
  }

  it('ranking collapses to 2 rows, recentBids keeps all 4 in recency order', () => {
    const b = historyBundle();
    const view = buildWatchView(b, T0);
    expect(view.ranking).toHaveLength(2);
    expect(view.ranking[0].price_pyg).toBe(999_989);
    expect(view.recentBids).toHaveLength(4);
    expect(view.recentBids.map((x) => x.server_sequence)).toEqual([4, 3, 2, 1]);
    expect(view.recentBids[0]).toMatchObject({ participant_id: 'bot', price_pyg: 999_989, display_alias: 'Nuestro Bot', kind: 'BOT' });
  });
});

describe('samePolicyContent — retry idempotency without version inflation', () => {
  function draft(): AuctionPolicy {
    return {
      policyId: 'pol-sandbox-room-acc',
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
      authorizedBy: 'Anyone',
    };
  }

  it('ignores metadata, compares economics', () => {
    const a = draft();
    expect(samePolicyContent(a, { ...a, authorizedBy: 'Else' })).toBe(true);
    expect(samePolicyContent(a, { ...a, policyId: 'other' })).toBe(true);
    expect(samePolicyContent(a, { ...a, targetPricePyg: 2 })).toBe(false);
    expect(samePolicyContent(a, { ...a, autoDefenseToleranceBps: 300, autoLimitPyg: 970_000 })).toBe(false);
    expect(samePolicyContent(a, { ...a, executionMode: 'ASSISTED' })).toBe(false);
  });
});

describe('missingPolicyEvents + version-gated pending display', () => {
  it('flags only truly-missing versions under complete history', () => {
    const ev = (seq: number, version?: number) => ({
      id: `e${seq}`, room_id: 'room-acc',
      type: version === undefined ? 'ROOM_CREATED' : 'POLICY_AUTHORIZED',
      payload: version === undefined ? {} : { version },
      server_sequence: seq, created_at: T0,
    });
    const base = snap(room(), []);
    const mk = (policies: number[], events: ReturnType<typeof ev>[]) => ({
      ...base,
      policies: policies.map((version) => ({
        room_id: 'room-acc', version, policy_id: 'p', snapshot: {}, fingerprint: 'f',
        authorized_by: 'op', authorized_at: T0,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      events: events as any,
    });
    expect(missingPolicyEvents(mk([1, 2], [ev(0), ev(1, 1), ev(2, 2)]))).toEqual([]);
    expect(missingPolicyEvents(mk([1, 2], [ev(0), ev(1, 1)]))).toEqual([2]);
    // Truncated history (max >= 200): never backfill.
    expect(missingPolicyEvents(mk([1], [ev(250)]))).toEqual([]);
  });

  it('hides a pending candidate bound to a stale version', () => {
    const base = snap(room(), [humanBid(1, 999_999, T0)]);
    const withStalePending = {
      ...base,
      policies: [{
        room_id: 'room-acc', version: 2, policy_id: 'p', snapshot: {}, fingerprint: 'f',
        authorized_by: 'op', authorized_at: T0,
      }],
      events: [],
      room: {
        ...base.room,
        bot_runtime: { pendingCandidate: { pricePyg: 1, basisObservedAt: T0, policyVersion: 1, decidedAt: T0 } },
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = buildWatchView(withStalePending as any, T0);
    expect(view.pendingCandidate).toBeNull();
  });
});
