/**
 * AUCTION SANDBOX — loadSandboxBundle fail-closed (F4/R4).
 * A read error is NEVER converted into an empty collection: any failing
 * query fails the whole load with a controlled error.
 */
import { describe, it, expect } from 'vitest';
import { SupabaseClient } from '@supabase/supabase-js';
import { computeNextRuntime, loadSandboxBundle } from '../server';

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

describe('computeNextRuntime — single coherent write (F-A2)', () => {
  const decision = {
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
