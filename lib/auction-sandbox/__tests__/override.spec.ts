/**
 * AUCTION SANDBOX — Human override (one-shot Ground-Floor authorization).
 * Canonical: opening 1.050.000, target 1.000.000, autoLimit 980.000, step 1,
 * BOUNDED_AUTO → 999.999 auto (no prompt); 979.999 → AWAITING proposal
 * 979.998; authorize → exactly 979.998; ceder → suppressed + monitoring.
 * The bot runs through the REAL Auction Bot Core (never modified).
 */
import { describe, it, expect } from 'vitest';
import { deriveLimitBreach, validateOverrideRequest } from '../override';
import { buildOverrideIdempotencyKey } from '../engine';
import { formatPctBelowGroundFloor } from '../format';
import { missingOverrideEvents } from '../server';
import { buildPolicyVersionRecord } from '../policies';
import { calculateAutoLimitPyg } from '../../auction-bot/policy';
import { AuctionPolicy } from '../../auction-bot/types';
import { SandboxBid, SandboxRoom } from '../types';

const T0 = '2026-01-01T00:00:00.000Z';
const T0ms = Date.parse(T0);

function draft(overrides: Partial<AuctionPolicy> = {}): AuctionPolicy {
  return {
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
    ...overrides,
  };
}

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
    random_started_at: new Date(T0ms - 40_000).toISOString(),
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

function humanBid(seq: number, price: number): SandboxBid {
  return {
    id: `h${seq}`, room_id: 'room-acc', participant_id: 'hum', price_pyg: price,
    server_sequence: seq, server_received_at: T0, idempotency_key: `hum:${seq}`,
    accepted: true, rejection_reason: null,
  };
}

function botBid(seq: number, price: number): SandboxBid {
  return { ...humanBid(seq, price), id: `b${seq}`, participant_id: 'bot', idempotency_key: `bot:${seq}` };
}

function bundle(r: SandboxRoom, bids: SandboxBid[], versions = [1], runtime: unknown = {}, drafts?: AuctionPolicy[]) {
  return {
    room: { ...r, bot_runtime: runtime as never },
    participants: [
      { id: 'bot', room_id: r.id, kind: 'BOT', display_alias: 'Nuestro Bot', created_at: T0 },
      { id: 'hum', room_id: r.id, kind: 'HUMAN', display_alias: 'Competidor', created_at: T0 },
    ],
    bids,
    policies: versions.map((version, i) => buildPolicyVersionRecord(
      'room-acc', drafts?.[i] ?? draft(), version, 'op', T0
    )),
    events: [],
  };
}

describe('deriveLimitBreach — canonical human-override flow', () => {
  it('999.999 → no prompt (bot auto-bids 999.998)', () => {
    const b = bundle(room(), [humanBid(1, 999_999), botBid(2, 999_998)]);
    expect(deriveLimitBreach(b as never, T0)).toEqual({ proposal: null, declined: null });
  });

  it('979.999 → AWAITING proposal for exactly 979.998', () => {
    const b = bundle(room(), [humanBid(1, 999_999), botBid(2, 999_998), humanBid(3, 979_999)]);
    const { proposal, declined } = deriveLimitBreach(b as never, T0);
    expect(declined).toBeNull();
    expect(proposal).toMatchObject({
      policyVersion: 1,
      groundFloorPyg: 980_000,
      competitorPricePyg: 979_999,
      candidatePricePyg: 979_998,
      defenseStepPyg: 1,
    });
    expect(proposal!.pctBelowGroundFloor).toBeCloseTo((1 / 980_000) * 100, 10);
  });

  it('deep breach 833.000 → proposal with ~15% below', () => {
    const b = bundle(room(), [humanBid(1, 833_000)]);
    const { proposal } = deriveLimitBreach(b as never, T0);
    expect(proposal?.candidatePricePyg).toBe(832_999);
    expect(proposal!.pctBelowGroundFloor).toBeCloseTo(15, 10);
  });

  it('defenseStep 10 → candidate = competitor − 10', () => {
    const d = draft({ defenseStepPyg: 10 });
    const b = bundle(room(), [humanBid(1, 979_999)], [1], {}, [d]);
    const { proposal } = deriveLimitBreach(b as never, T0);
    expect(proposal?.candidatePricePyg).toBe(979_989);
    expect(proposal?.defenseStepPyg).toBe(10);
  });

  it('inactive states → no prompt', () => {
    const bids = [humanBid(1, 979_999)];
    expect(deriveLimitBreach(bundle(room({ status: 'DRAFT', started_at: null }), bids) as never, T0).proposal).toBeNull();
    expect(deriveLimitBreach(bundle(room({ status: 'CLOSED' }), bids) as never, T0).proposal).toBeNull();
    expect(deriveLimitBreach(bundle(room({ bot_paused: true }), bids) as never, T0).proposal).toBeNull();
    expect(deriveLimitBreach(bundle(room(), bids, []) as never, T0).proposal).toBeNull();
  });

  it('non-BOUNDED_AUTO modes → no prompt', () => {
    const bids = [humanBid(1, 979_999)];
    const assisted = bundle(room(), bids, [1], {}, [draft({ executionMode: 'ASSISTED' })]);
    expect(deriveLimitBreach(assisted as never, T0).proposal).toBeNull();
    const observe = bundle(room(), bids, [1], {}, [draft({ executionMode: 'OBSERVE' })]);
    expect(deriveLimitBreach(observe as never, T0).proposal).toBeNull();
  });
});

describe('deriveLimitBreach — CEDER suppression + re-prompt', () => {
  const declinedRuntime = {
    lastBotStatus: { action: 'STOP', reasonCode: 'ECONOMIC_LIMIT_BREACHED', candidate: 979_998, v: 1 },
    declinedLimitBreaches: [{ v: 1, candidate: 979_998, competitor: 979_999, at: T0 }],
  };

  it('recorded decline suppresses the identical state (no every-second reprompt)', () => {
    const b = bundle(
      room(), [humanBid(1, 999_999), botBid(2, 999_998), humanBid(3, 979_999)], [1], declinedRuntime
    );
    expect(deriveLimitBreach(b as never, T0)).toEqual({
      proposal: null,
      declined: { candidatePricePyg: 979_998, policyVersion: 1 },
    });
  });

  it('materially new candidate re-prompts (step 4 of canonical)', () => {
    const b = bundle(
      room(),
      [humanBid(1, 999_999), botBid(2, 999_998), humanBid(3, 979_999), humanBid(4, 979_990)],
      [1],
      declinedRuntime
    );
    const { proposal, declined } = deriveLimitBreach(b as never, T0);
    expect(declined).toBeNull();
    expect(proposal?.candidatePricePyg).toBe(979_989);
  });

  it('new policy version revives the prompt (old decline is inert)', () => {
    const b = bundle(
      room(), [humanBid(1, 999_999), botBid(2, 999_998), humanBid(3, 979_999)], [1, 2], declinedRuntime
    );
    const { proposal } = deriveLimitBreach(b as never, T0);
    expect(proposal?.policyVersion).toBe(2);
  });
});

describe('validateOverrideRequest — stale clicks fail closed', () => {
  const liveBids = [humanBid(1, 999_999), botBid(2, 999_998), humanBid(3, 979_999)];
  const fresh = () => deriveLimitBreach(bundle(room(), liveBids) as never, T0);

  it('exact clicked proposal → ok', () => {
    expect(validateOverrideRequest(fresh(), { candidatePricePyg: 979_998, policyVersion: 1 }, 1)).toBeNull();
  });

  it('candidate moved (competitor rebid) → state changed, no submit', () => {
    const moved = deriveLimitBreach(
      bundle(room(), [...liveBids, humanBid(4, 979_990)]) as never, T0
    );
    expect(validateOverrideRequest(moved, { candidatePricePyg: 979_998, policyVersion: 1 }, 1)).toMatch(/cambió/);
  });

  it('policy bumped mid-flight → policy changed, no submit', () => {
    expect(validateOverrideRequest(fresh(), { candidatePricePyg: 979_998, policyVersion: 1 }, 2)).toMatch(/policy cambió/);
  });

  it('requesting a recorded decline → refused with CEDER guidance', () => {
    const declined = deriveLimitBreach(
      bundle(room(), liveBids, [1], {
        declinedLimitBreaches: [{ v: 1, candidate: 979_998, competitor: 979_999, at: T0 }],
      }) as never,
      T0
    );
    expect(validateOverrideRequest(declined, { candidatePricePyg: 979_998, policyVersion: 1 }, 1)).toMatch(/CEDER/);
  });

  it('garbage input → refused', () => {
    expect(validateOverrideRequest(fresh(), { candidatePricePyg: 0, policyVersion: 1 }, 1)).toMatch(/inválido/);
    expect(validateOverrideRequest(fresh(), { candidatePricePyg: 979_998, policyVersion: 1 }, null)).toMatch(/Sin policy/);
  });
});

describe('buildOverrideIdempotencyKey — one-shot stable keys', () => {
  it('same (room, version, price) always dedupes; anything else differs', () => {
    const k1 = buildOverrideIdempotencyKey('room-1', 1, 979_998);
    expect(buildOverrideIdempotencyKey('room-1', 1, 979_998)).toBe(k1);
    expect(k1.startsWith('override:')).toBe(true);
    expect(k1).not.toContain('2026');
    expect(buildOverrideIdempotencyKey('room-1', 1, 979_997)).not.toBe(k1);
    expect(buildOverrideIdempotencyKey('room-1', 2, 979_998)).not.toBe(k1);
    expect(buildOverrideIdempotencyKey('room-2', 1, 979_998)).not.toBe(k1);
  });
});

describe('formatPctBelowGroundFloor — information only', () => {
  it('canonical 979.999 vs 980.000 → ~0,0001%', () => {
    expect(formatPctBelowGroundFloor(980_000, 979_999)).toBe('~0,0001%');
  });

  it('833.000 vs 980.000 → ~15%', () => {
    expect(formatPctBelowGroundFloor(980_000, 833_000)).toBe('~15%');
  });

  it('degenerate inputs → safe fallbacks', () => {
    expect(formatPctBelowGroundFloor(0, 979_999)).toBe('—');
    expect(formatPctBelowGroundFloor(980_000, 980_000)).toBe('0%');
  });
});

describe('missingOverrideEvents — audit backfill proof', () => {
  const auditRuntime = {
    lastBotStatus: { action: 'OVERRIDE_SUBMITTED', reasonCode: 'ECONOMIC_LIMIT_OVERRIDE', candidate: 979_998, v: 1 },
    overrideAudit: {
      v: 1, candidate: 979_998, groundFloor: 980_000, competitor: 979_999,
      step: 1, by: 'op', at: T0,
    },
  };

  it('executed override without audit marker → backfill v1', () => {
    const b = bundle(room(), [], [1], auditRuntime);
    expect(missingOverrideEvents(b as never)).toEqual([1]);
  });

  it('marker present → nothing to backfill', () => {
    const b = bundle(room(), [], [1], auditRuntime) as unknown as {
      events: Array<{ type: string; payload: Record<string, unknown> }>;
    };
    b.events = [{
      id: 'e', room_id: 'room-acc', type: 'HUMAN_OVERRIDE_AUTHORIZED',
      payload: { policyVersion: 1, candidatePricePyg: 979_998 },
      server_sequence: 5, created_at: T0,
    }] as never;
    expect(missingOverrideEvents(b as never)).toEqual([]);
  });

  it('no audit mirror or truncated history → nothing', () => {
    expect(missingOverrideEvents(bundle(room(), [], [1], {}) as never)).toEqual([]);
    const b = bundle(room(), [], [1], auditRuntime);
    (b as { events: unknown }).events = [
      { id: 'e', room_id: 'room-acc', type: 'ROOM_CREATED', payload: {}, server_sequence: 250, created_at: T0 },
    ];
    expect(missingOverrideEvents(b as never)).toEqual([]);
  });
});
