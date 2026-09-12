/**
 * AUCTION SANDBOX — loadSandboxBundle fail-closed (F4/R4).
 * A read error is NEVER converted into an empty collection: any failing
 * query fails the whole load with a controlled error.
 */
import { describe, it, expect } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { botStoppedOnVersion, botTickSkipReason, computeNextRuntime, isVersionSuperseded, loadSandboxBundle, missingInitialEvents, missingStoppedEvents, policyVersionSuperseded, refuseIfRoomClosed, shouldEmitDecision, SandboxBundle } from '../server';
import { SandboxBid } from '../types';

const ROOM_ROW = {
  id: 'room-1',
  empresa_id: 'emp-1',
  created_by: null,
  title: 'TEST',
  scope: 'ITEM',
  group_id: 'item-1',
  status: 'ACTIVE_NORMAL',
  opening_price_pyg: 1_000_000,
  minimum_decrement_pyg: 1,
  normal_duration_seconds: 60,
  random_min_seconds: 30,
  random_max_seconds: 90,
  started_at: '2026-01-01T00:00:00.000Z',
  random_started_at: null,
  closed_at: null,
  next_sequence: 1,
  bot_paused: false,
  bot_runtime: {},
  winner_participant_id: null,
  created_at: '2026-01-01T00:00:00.000Z',
};

const boom = { code: 'XX500', message: 'boom' };

/** Minimal thenable stub: select → eq → (eq)* → (maybeSingle | order → limit?). */
function stubDb(failTable: string | null): SupabaseClient {
  const orderResult = (table: string) => {
    const failed = failTable === table;
    const payload = { data: failed ? null : [], error: failed ? boom : null };
    return Object.assign(Promise.resolve(payload), {
      limit: async (_n: number) => payload,
    });
  };
  const eqChain = (table: string): unknown => ({
    eq: (_c: string, _v: unknown) => eqChain(table),
    maybeSingle: async () =>
      failTable === table
        ? { data: null, error: boom }
        : { data: table === 'auction_sandbox_rooms' ? ROOM_ROW : null, error: null },
    order: (_c: string, _o?: unknown) => orderResult(table),
  });
  return {
    from: (table: string) => ({
      select: (_cols: string) => eqChain(table),
    }),
  } as unknown as SupabaseClient;
}

describe('computeNextRuntime — single coherent write (F-A2)', () => {  const decision = {
    action: 'BID_CANDIDATE',
    reasonCode: 'TARGET_POSITION_DEFENSE_REQUIRED',
    candidatePricePyg: 999_998,
    policyVersion: 1,
  };

  it('ASSISTED candidate: lastBotStatus AND pendingCandidate coexist', () => {
    const prev = { lastBotStatus: { action: 'WAIT', reasonCode: 'X', candidate: null, v: 1 }, other: 'kept' };
    const next = computeNextRuntime(prev, decision, {
      pricePyg: 999_998, basisObservedAt: '2026-01-01T00:00:01.000Z', policyVersion: 1, decidedAt: '2026-01-01T00:00:01.000Z',
    });
    expect(next.lastBotStatus).toEqual({ action: 'BID_CANDIDATE', reasonCode: 'TARGET_POSITION_DEFENSE_REQUIRED', candidate: 999_998, v: 1 });
    expect(next.pendingCandidate).toEqual({
      pricePyg: 999_998, basisObservedAt: '2026-01-01T00:00:01.000Z', policyVersion: 1, decidedAt: '2026-01-01T00:00:01.000Z',
    });
    expect(next.other).toBe('kept');
  });

  it('non-candidate decision refreshes status and clears pending', () => {
    const prev = {
      lastBotStatus: { action: 'BID_CANDIDATE', reasonCode: 'X', candidate: 999_998, v: 1 },
      pendingCandidate: { pricePyg: 999_998, basisObservedAt: 't', policyVersion: 1, decidedAt: 't' },
    };
    const next = computeNextRuntime(prev, { action: 'WAIT', reasonCode: 'Y', candidatePricePyg: null, policyVersion: 1 }, null);
    expect(next.lastBotStatus).toEqual({ action: 'WAIT', reasonCode: 'Y', candidate: null, v: 1 });
    expect(next.pendingCandidate).toBeNull();
  });
});

describe('botStoppedOnVersion — STOP terminal per policy version', () => {
  it('STOP on the current version → stopped', () => {
    expect(botStoppedOnVersion({ lastBotStatus: { action: 'STOP', reasonCode: 'X', candidate: null, v: 2 } }, 2)).toBe(true);
  });

  it('STOP on an older version → revived by the new policy', () => {
    expect(botStoppedOnVersion({ lastBotStatus: { action: 'STOP', reasonCode: 'X', candidate: null, v: 2 } }, 3)).toBe(false);
  });

  it('non-STOP status → not stopped', () => {
    expect(botStoppedOnVersion({ lastBotStatus: { action: 'WAIT', reasonCode: 'X', candidate: null, v: 2 } }, 2)).toBe(false);
  });

  it('empty/corrupt runtime → not stopped (fail-open toward evaluation)', () => {
    expect(botStoppedOnVersion({}, 1)).toBe(false);
    expect(botStoppedOnVersion(null, 1)).toBe(false);
    expect(botStoppedOnVersion(undefined, 1)).toBe(false);
    expect(botStoppedOnVersion({ lastBotStatus: { action: 'STOP' } }, 1)).toBe(false);
  });
});

describe('loadSandboxBundle fail-closed', () => {
  it('loads a full bundle when every query succeeds', async () => {
    const res = await loadSandboxBundle(stubDb(null), 'room-1');
    expect('bundle' in res).toBe(true);
    if ('bundle' in res) {
      expect(res.bundle.room.id).toBe('room-1');
      expect(res.bundle.bids).toEqual([]);
    }
  });

  it('room read error → controlled error (never a fake empty bundle)', async () => {
    const res = await loadSandboxBundle(stubDb('auction_sandbox_rooms'), 'room-1');
    expect('error' in res).toBe(true);
  });

  it.each([
    ['auction_sandbox_participants'],
    ['auction_sandbox_bids'],
    ['auction_sandbox_policy_versions'],
    ['auction_sandbox_events'],
  ])('%s read error → controlled error (never [] as data)', async (table) => {
    const res = await loadSandboxBundle(stubDb(table), 'room-1');
    expect('error' in res).toBe(true);
    expect(res).not.toHaveProperty('bundle');
  });
});

function bundleWithEvents(
  status: 'DRAFT' | 'ACTIVE_NORMAL' | 'ACTIVE_RANDOM' | 'CLOSED',
  startedAt: string | null,
  seqs: number[],
  types: string[]
): SandboxBundle {
  return {
    room: {
      id: 'room-1', empresa_id: 'emp-1', created_by: null, title: 'T', scope: 'ITEM',
      group_id: 'g', status, opening_price_pyg: 100, minimum_decrement_pyg: 1,
      normal_duration_seconds: 60, random_min_seconds: 30, random_max_seconds: 90,
      started_at: startedAt, random_started_at: null, closed_at: null,
      next_sequence: 1, bot_paused: false, bot_runtime: {},
      winner_participant_id: null, created_at: '2026-01-01T00:00:00.000Z',
    },
    participants: [],
    bids: [],
    policies: [],
    events: seqs.map((server_sequence, i) => ({
      id: `e${i}`, room_id: 'room-1', type: types[i] as never,
      payload: {}, server_sequence, created_at: '2026-01-01T00:00:00.000Z',
    })),
  };
}

describe('missingInitialEvents — provable-absence backfill proof', () => {
  it('empty history proves both missing', () => {
    expect(missingInitialEvents(bundleWithEvents('ACTIVE_NORMAL', '2026-01-01T00:00:00.000Z', [], []))).toEqual([
      'ROOM_CREATED',
      'AUCTION_STARTED',
    ]);
  });

  it('complete history without AUCTION_STARTED proves the gap', () => {
    const b = bundleWithEvents('ACTIVE_NORMAL', '2026-01-01T00:00:00.000Z', [0, 1], ['ROOM_CREATED', 'BOT_DECISION']);
    expect(missingInitialEvents(b)).toEqual(['AUCTION_STARTED']);
  });

  it('truncated history (max seq >= 200) never backfills', () => {
    const seqs = Array.from({ length: 200 }, (_, i) => i + 50);
    const b = bundleWithEvents('ACTIVE_NORMAL', '2026-01-01T00:00:00.000Z', seqs, seqs.map(() => 'BOT_DECISION'));
    expect(missingInitialEvents(b)).toEqual([]);
  });

  it('DRAFT never asks for AUCTION_STARTED', () => {
    const b = bundleWithEvents('DRAFT', null, [], []);
    expect(missingInitialEvents(b)).toEqual(['ROOM_CREATED']);
  });
});

describe('shouldEmitDecision — no duplicate decision events', () => {  const decision = { action: 'WAIT', reasonCode: 'X', candidatePricePyg: null, policyVersion: 1 };

  it('emits when no identical decision is recorded', () => {
    const b = bundleWithEvents('ACTIVE_NORMAL', '2026-01-01T00:00:00.000Z', [0], ['ROOM_CREATED']);
    expect(shouldEmitDecision(b, decision)).toBe(true);
  });

  it('skips when the identical decision is already recorded', () => {
    const b = bundleWithEvents('ACTIVE_NORMAL', '2026-01-01T00:00:00.000Z', [0, 1], ['ROOM_CREATED', 'BOT_DECISION']);
    (b.events[1].payload as Record<string, unknown>) = {
      action: 'WAIT', reasonCode: 'X', candidatePricePyg: null, policyVersion: 1,
    };
    expect(shouldEmitDecision(b, decision)).toBe(false);
  });

  it('emits when only a different decision is recorded', () => {
    const b = bundleWithEvents('ACTIVE_NORMAL', '2026-01-01T00:00:00.000Z', [0, 1], ['ROOM_CREATED', 'BOT_DECISION']);
    (b.events[1].payload as Record<string, unknown>) = {
      action: 'BID_CANDIDATE', reasonCode: 'Y', candidatePricePyg: 5, policyVersion: 1,
    };
    expect(shouldEmitDecision(b, decision)).toBe(true);
  });
});

describe('loadSandboxBundle keeps the latest-200 window in ASC contract', () => {  function descStub(rows: Array<{ server_sequence: number; type: string }>): SupabaseClient {
    const orderChain = {
      eq: (_c: string, _v: unknown) => orderChain,
      maybeSingle: async () => ({ data: { ...ROOM_ROW }, error: null }),
      order: (_c: string, _o?: unknown) => {
        const sorted = [...rows].sort((a, b) => b.server_sequence - a.server_sequence).slice(0, 200);
        const payload = { data: sorted, error: null };
        return Object.assign(Promise.resolve(payload), { limit: async (_n: number) => payload });
      },
    };
    return { from: (_t: string) => ({ select: (_c: string) => orderChain }) } as unknown as SupabaseClient;
  }

  it('returns events ASC even though the DB read is latest-first', async () => {
    const rows = [
      { server_sequence: 5, type: 'BOT_DECISION' },
      { server_sequence: 3, type: 'BID_ACCEPTED' },
      { server_sequence: 9, type: 'BOT_DECISION' },
    ];
    const res = await loadSandboxBundle(descStub(rows), 'room-1');
    expect('bundle' in res).toBe(true);
    if ('bundle' in res) {
      expect(res.bundle.events.map((e) => e.server_sequence)).toEqual([3, 5, 9]);
    }
  });
});

function tickBundle(overrides: {
  status?: 'DRAFT' | 'ACTIVE_NORMAL' | 'ACTIVE_RANDOM' | 'CLOSED';
  bot_paused?: boolean;
  policies?: number[];
  runtime?: unknown;
}): SandboxBundle {
  const b = bundleWithEvents(overrides.status ?? 'ACTIVE_NORMAL', '2026-01-01T00:00:00.000Z', [0], ['ROOM_CREATED']);
  b.room.bot_paused = overrides.bot_paused ?? false;
  b.policies = (overrides.policies ?? [1]).map((version) => ({
    room_id: 'room-1', version, policy_id: 'p', snapshot: {}, fingerprint: 'f',
    authorized_by: 'op', authorized_at: '2026-01-01T00:00:00.000Z',
  }));
  b.room.bot_runtime = (overrides.runtime ?? {}) as never;
  return b;
}

describe('botTickSkipReason — every tick skip in one tested place', () => {
  it('evaluates a live room (null)', () => {
    expect(botTickSkipReason(tickBundle({}))).toBeNull();
  });

  it('skips paused / policyless / inactive rooms', () => {
    expect(botTickSkipReason(tickBundle({ bot_paused: true }))).toBe('PAUSED');
    expect(botTickSkipReason(tickBundle({ policies: [] }))).toBe('NO_POLICY');
    expect(botTickSkipReason(tickBundle({ status: 'DRAFT' }))).toBe('NOT_ACTIVE');
    expect(botTickSkipReason(tickBundle({ status: 'CLOSED' }))).toBe('NOT_ACTIVE');
  });

  it('skips STOP on the current version, revives on a new version', () => {
    const stopped = { lastBotStatus: { action: 'STOP', reasonCode: 'ECONOMIC_LIMIT_BREACHED', candidate: null, v: 1 } };
    expect(botTickSkipReason(tickBundle({ runtime: stopped }))).toBe('STOPPED');
    expect(botTickSkipReason(tickBundle({ policies: [1, 2], runtime: stopped }))).toBeNull();
  });
});

describe('refuseIfRoomClosed — one message, both authorize paths', () => {
  it('refuses CLOSED, allows the rest', () => {
    expect(refuseIfRoomClosed('CLOSED')).toBe('La sala está cerrada.');
    expect(refuseIfRoomClosed('DRAFT')).toBeNull();
    expect(refuseIfRoomClosed('ACTIVE_NORMAL')).toBeNull();
    expect(refuseIfRoomClosed('ACTIVE_RANDOM')).toBeNull();
  });
});

describe('policyVersionSuperseded — never submit off a stale policy', () => {  it('same latest version → not superseded', () => {
    expect(policyVersionSuperseded(tickBundle({ policies: [1, 2] }), 2)).toBe(false);
  });

  it('newer version authorized mid-flight → superseded', () => {
    expect(policyVersionSuperseded(tickBundle({ policies: [1, 2] }), 1)).toBe(true);
  });

  it('policies vanished → superseded (fail closed)', () => {
    expect(policyVersionSuperseded(tickBundle({ policies: [] }), 1)).toBe(true);
  });
});

describe('isVersionSuperseded — last-millimetre pre-submit check', () => {
  it('same version → submit allowed', () => {
    expect(isVersionSuperseded(2, 2)).toBe(false);
  });

  it('newer version landed → abort', () => {
    expect(isVersionSuperseded(3, 2)).toBe(true);
  });

  it('no version readable → abort (fail closed)', () => {
    expect(isVersionSuperseded(null, 2)).toBe(true);
  });

  it('decision newer than latest (torn read) → abort, never submit', () => {
    expect(isVersionSuperseded(2, 3)).toBe(true);
  });
});

describe('missingStoppedEvents — terminal-marker backfill proof', () => {
  it('STOP recorded without BOT_STOPPED marker → backfill the version', () => {
    const b = tickBundle({
      runtime: { lastBotStatus: { action: 'STOP', reasonCode: 'ECONOMIC_LIMIT_BREACHED', candidate: null, v: 1 } },
    });
    expect(missingStoppedEvents(b)).toEqual([1]);
  });

  it('marker present → nothing to backfill', () => {
    const b = tickBundle({
      runtime: { lastBotStatus: { action: 'STOP', reasonCode: 'X', candidate: null, v: 1 } },
    });
    b.events.push({
      id: 'e9', room_id: 'room-1', type: 'BOT_STOPPED',
      payload: { reasonCode: 'X', policyVersion: 1 }, server_sequence: 1,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(missingStoppedEvents(b)).toEqual([]);
  });

  it('non-STOP runtime or truncated history → nothing', () => {
    expect(missingStoppedEvents(tickBundle({}))).toEqual([]);
    const b = tickBundle({
      runtime: { lastBotStatus: { action: 'STOP', reasonCode: 'X', candidate: null, v: 1 } },
    });
    b.events = [{ id: 'e', room_id: 'room-1', type: 'ROOM_CREATED', payload: {}, server_sequence: 250, created_at: '2026-01-01T00:00:00.000Z' }];
    expect(missingStoppedEvents(b)).toEqual([]);
  });

  it('exactly-full window (max seq 200) → nothing (boundary)', () => {
    const b = tickBundle({
      runtime: { lastBotStatus: { action: 'STOP', reasonCode: 'X', candidate: null, v: 1 } },
    });
    b.events = [{ id: 'e', room_id: 'room-1', type: 'ROOM_CREATED', payload: {}, server_sequence: 200, created_at: '2026-01-01T00:00:00.000Z' }];
    expect(missingStoppedEvents(b)).toEqual([]);
  });
});
