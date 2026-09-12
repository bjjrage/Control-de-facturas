/**
 * AUCTION SANDBOX — Pure engine tests (no DB, no clock, no Core changes).
 * Covers: phases, random close roll, bid validation, ranking/ties,
 * closeRisk, close, post-close rejection, idempotency keys.
 */
import { describe, it, expect } from 'vitest';
import {
  buildAssistedIdempotencyKey,
  buildBotIdempotencyKey,
  computePhase,
  rankBids,
  rollRandomCloseAt,
  validateSandboxBid,
  winnerOfRanking,
} from '../engine';
import { SandboxBid, SandboxRoom, SandboxSnapshot } from '../types';

const T0 = Date.parse('2026-01-01T00:00:00.000Z');

function baseRoom(overrides: Partial<SandboxRoom> = {}): SandboxRoom {
  return {
    id: 'room-1',
    empresa_id: 'emp-1',
    created_by: 'user-1',
    title: 'TEST-001',
    scope: 'ITEM',
    group_id: 'item-1',
    status: 'DRAFT',
    opening_price_pyg: 1_050_000,
    minimum_decrement_pyg: 1,
    normal_duration_seconds: 60,
    random_min_seconds: 30,
    random_max_seconds: 90,
    started_at: null,
    random_started_at: null,
    random_close_at: null,
    closed_at: null,
    next_sequence: 1,
    bot_paused: false,
    bot_runtime: {},
    winner_participant_id: null,
    created_at: new Date(T0).toISOString(),
    ...overrides,
  };
}

function bid(id: string, participant: string, price: number, seq: number, atMs: number = T0): SandboxBid {
  return {
    id, room_id: 'room-1', participant_id: participant, price_pyg: price,
    server_sequence: seq, server_received_at: new Date(atMs).toISOString(),
    idempotency_key: null, accepted: true, rejection_reason: null,
  };
}

const ALIAS = (pid: string) => (pid === 'bot' ? { kind: 'BOT' as const, alias: 'Nuestro Bot' } : { kind: 'HUMAN' as const, alias: 'Competidor' });

function snapshot(room: SandboxRoom, bids: SandboxBid[] = []): SandboxSnapshot {
  return {
    room,
    participants: [
      { id: 'bot', room_id: room.id, kind: 'BOT', display_alias: 'Nuestro Bot', created_at: new Date(T0).toISOString() },
      { id: 'hum', room_id: room.id, kind: 'HUMAN', display_alias: 'Competidor', created_at: new Date(T0).toISOString() },
    ],
    bids,
  };
}

describe('Sandbox engine — phases', () => {
  it('DRAFT stays DRAFT and CLOSED stays CLOSED', () => {
    expect(computePhase(baseRoom(), T0 + 999_999).status).toBe('DRAFT');
    expect(computePhase(baseRoom({ status: 'CLOSED' }), T0).status).toBe('CLOSED');
  });

  it('NORMAL → RANDOM when normal duration elapses', () => {
    const room = baseRoom({ status: 'ACTIVE_NORMAL', started_at: new Date(T0).toISOString() });
    expect(computePhase(room, T0 + 59_000).status).toBe('ACTIVE_NORMAL');
    expect(computePhase(room, T0 + 60_000).status).toBe('ACTIVE_RANDOM');
  });

  it('closeRisk false until min seconds, true after', () => {
    const room = baseRoom({ status: 'ACTIVE_RANDOM', random_started_at: new Date(T0).toISOString() });
    expect(computePhase(room, T0 + 29_999).closeRisk).toBe(false);
    expect(computePhase(room, T0 + 30_000).closeRisk).toBe(true);
  });

  it('RANDOM → CLOSED once random_close_at passes', () => {
    const room = baseRoom({
      status: 'ACTIVE_RANDOM',
      random_started_at: new Date(T0).toISOString(),
      random_close_at: new Date(T0 + 45_000).toISOString(),
    });
    expect(computePhase(room, T0 + 44_999).status).toBe('ACTIVE_RANDOM');
    expect(computePhase(room, T0 + 45_000).status).toBe('CLOSED');
  });

  it('rolls random_close_at inside [min, max] (deterministic with injected rand)', () => {
    expect(rollRandomCloseAt(T0, 30, 90, 0)).toBe(new Date(T0 + 30_000).toISOString());
    expect(rollRandomCloseAt(T0, 30, 90, 0.5)).toBe(new Date(T0 + 60_000).toISOString());
    const highRoll = rollRandomCloseAt(T0, 30, 90, 0.99);
    expect(Date.parse(highRoll)).toBe(T0 + 89_400);
  });
});

describe('Sandbox engine — bid validation', () => {
  const activeRoom = () => baseRoom({ status: 'ACTIVE_RANDOM', started_at: new Date(T0 - 120_000).toISOString(), random_started_at: new Date(T0 - 10_000).toISOString() });
  const phaseOf = (room: SandboxRoom) => computePhase(room, T0);

  it('accepts a valid human first bid below opening', () => {
    const room = activeRoom();
    const r = validateSandboxBid(snapshot(room), 'hum', 999_999, phaseOf(room));
    expect(r.ok).toBe(true);
  });

  it('rejects bids in DRAFT and CLOSED rooms', () => {
    expect(validateSandboxBid(snapshot(baseRoom()), 'hum', 999_999, computePhase(baseRoom(), T0)).code).toBe('ROOM_NOT_ACTIVE');
    const closed = baseRoom({ status: 'CLOSED' });
    expect(validateSandboxBid(snapshot(closed), 'hum', 999_999, computePhase(closed, T0)).code).toBe('ROOM_NOT_ACTIVE');
  });

  it('rejects unknown participant, zero/negative/fractional prices', () => {
    const room = activeRoom();
    const snap = snapshot(room);
    const ph = phaseOf(room);
    expect(validateSandboxBid(snap, 'ghost', 999_999, ph).code).toBe('UNKNOWN_PARTICIPANT');
    expect(validateSandboxBid(snap, 'hum', 0, ph).code).toBe('INVALID_PRICE');
    expect(validateSandboxBid(snap, 'hum', -5, ph).code).toBe('INVALID_PRICE');
    expect(validateSandboxBid(snap, 'hum', 999_999.5, ph).code).toBe('INVALID_PRICE');
  });

  it('requires own bids to strictly decrease', () => {
    const room = activeRoom();
    const snap = snapshot(room, [bid('b1', 'hum', 999_999, 1)]);
    const ph = phaseOf(room);
    expect(validateSandboxBid(snap, 'hum', 999_999, ph).code).toBe('NOT_DECREASING');
    expect(validateSandboxBid(snap, 'hum', 1_000_000, ph).code).toBe('NOT_DECREASING');
    expect(validateSandboxBid(snap, 'hum', 999_998, ph).ok).toBe(true);
  });

  it('enforces minimum decrement over the current best', () => {
    const room = activeRoom();
    room.minimum_decrement_pyg = 100;
    const snap = snapshot(room, [bid('b1', 'hum', 999_999, 1)]);
    const ph = phaseOf(room);
    // own decrease ok (999_950 < 999_999) but improvement over best is 49 < 100
    expect(validateSandboxBid(snap, 'hum', 999_950, ph).code).toBe('BELOW_MINIMUM_DECREMENT');
    expect(validateSandboxBid(snap, 'hum', 999_899, ph).ok).toBe(true);
  });

  it('first bid must be below opening price', () => {
    const room = activeRoom();
    const snap = snapshot(room);
    const ph = phaseOf(room);
    expect(validateSandboxBid(snap, 'hum', 1_050_000, ph).code).toBe('NOT_BELOW_OPENING');
    expect(validateSandboxBid(snap, 'hum', 1_060_000, ph).code).toBe('NOT_BELOW_OPENING');
  });
});

describe('Sandbox engine — ranking, winner, idempotency', () => {
  it('one position per participant: history never duplicates ranks', () => {
    // human: 999999 then 979999; bot: 999998 → only current bests rank.
    const bids = [bid('b1', 'hum', 999_999, 1), bid('b2', 'bot', 999_998, 2), bid('b3', 'hum', 979_999, 3)];
    const ranking = rankBids(bids, ALIAS);
    expect(ranking).toHaveLength(2);
    expect(ranking[0].participant_id).toBe('hum');
    expect(ranking[0].price_pyg).toBe(979_999);
    expect(ranking[0].rank).toBe(1);
    expect(ranking[1].participant_id).toBe('bot');
    expect(ranking[1].price_pyg).toBe(999_998);
    expect(ranking[1].rank).toBe(2);
    expect(winnerOfRanking(ranking)?.participant_id).toBe('hum');
  });

  it('breaks cross-participant ties by server_sequence (first to server wins)', () => {
    const bids = [bid('b2', 'hum', 999_998, 2), bid('b1', 'bot', 999_998, 1)];
    const ranking = rankBids(bids, ALIAS);
    expect(ranking.map((r) => r.participant_id)).toEqual(['bot', 'hum']);
    expect(winnerOfRanking(ranking)?.participant_id).toBe('bot');
  });

  it('no winner without bids', () => {
    expect(winnerOfRanking([])).toBeNull();
  });

  it('builds wall-clock-free bot keys (same candidate always dedupes)', () => {
    const k1 = buildBotIdempotencyKey('room-1', 1, 999_998);
    const k2 = buildBotIdempotencyKey('room-1', 1, 999_998);
    expect(k1).toBe(k2);
    expect(k1).toContain('room-1');
    expect(k1).toContain('999998');
    expect(k1).not.toContain('2026');
    expect(buildBotIdempotencyKey('room-1', 1, 999_997)).not.toBe(k1);
    expect(buildBotIdempotencyKey('room-1', 2, 999_998)).not.toBe(k1);
  });

  it('builds wall-clock-free assisted keys (same candidate always dedupes)', () => {
    const k1 = buildAssistedIdempotencyKey('room-1', 2, 999_998);
    const k2 = buildAssistedIdempotencyKey('room-1', 2, 999_998);
    expect(k1).toBe(k2);
    expect(k1).toContain('999998');
    expect(k1).not.toContain('2026');
    expect(buildAssistedIdempotencyKey('room-1', 2, 999_997)).not.toBe(k1);
  });
});
