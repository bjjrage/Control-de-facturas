/**
 * AUCTION SANDBOX — Pure deterministic engine (no I/O, no DB, no clock).
 *
 * All functions take explicit `nowMs` / randomness so unit tests are fully
 * deterministic. The server-action layer maps these snapshots to Supabase
 * rows (see supabase/migrations/0068_auction_sandbox.sql + RPC).
 *
 * Server authority rules enforced here:
 *  - phases derive ONLY from server timestamps;
 *  - random_close_at is rolled ONCE (caller persists it);
 *  - ranking is price ASC, server_sequence ASC (first to the server wins);
 *  - bids must strictly improve (own last + minimum decrement vs best).
 */
import {
  BidRejectionCode,
  SandboxBid,
  SandboxEventType,
  SandboxRankedEntry,
  SandboxRoom,
  SandboxRoomStatus,
  SandboxSnapshot,
} from './types';

export interface PhaseView {
  status: SandboxRoomStatus;
  closeRisk: boolean;
}

/**
 * Computes the effective phase from server timestamps. Pure: never mutates.
 * - DRAFT stays DRAFT (bot sees PRE_AUCTION via the adapter).
 * - ACTIVE_NORMAL → ACTIVE_RANDOM once started_at + normal_duration passes.
 * - ACTIVE_RANDOM → CLOSED once random_close_at passes (only if already rolled).
 * - closeRisk is false until random_started_at + random_min_seconds.
 */
export function computePhase(room: SandboxRoom, nowMs: number): PhaseView {
  if (room.status === 'DRAFT' || room.status === 'CLOSED') {
    return { status: room.status, closeRisk: false };
  }
  if (room.status === 'ACTIVE_NORMAL') {
    if (!room.started_at) return { status: 'ACTIVE_NORMAL', closeRisk: false };
    const elapsed = nowMs - Date.parse(room.started_at);
    if (elapsed >= room.normal_duration_seconds * 1000) {
      return { status: 'ACTIVE_RANDOM', closeRisk: false };
    }
    return { status: 'ACTIVE_NORMAL', closeRisk: false };
  }
  // ACTIVE_RANDOM
  if (room.random_close_at && nowMs >= Date.parse(room.random_close_at)) {
    return { status: 'CLOSED', closeRisk: false };
  }
  let closeRisk = false;
  if (room.random_started_at) {
    closeRisk = nowMs - Date.parse(room.random_started_at) >= room.random_min_seconds * 1000;
  }
  return { status: 'ACTIVE_RANDOM', closeRisk };
}

/**
 * Rolls random_close_at = random_started_at + uniform(min, max).
 * `rand01` in [0, 1) — injectable for deterministic tests; server passes
 * Math.random(). MUST be called at most once per room (caller persists).
 */
export function rollRandomCloseAt(randomStartedAtMs: number, minSeconds: number, maxSeconds: number, rand01: number): string {
  const span = Math.max(0, maxSeconds - minSeconds);
  const offsetSeconds = minSeconds + rand01 * span;
  return new Date(randomStartedAtMs + Math.round(offsetSeconds * 1000)).toISOString();
}

/**
 * Server-side ranking: ONE position per participant.
 * Each participant competes with their CURRENT best accepted bid only
 * (lowest price; ties within a participant broken by lowest server_sequence).
 * Participants are then ordered by (price ASC, server_sequence ASC) —
 * first to the server wins ties. A participant NEVER occupies two ranks.
 */
export function rankBids(bids: SandboxBid[], aliasOf: (participantId: string) => { kind: 'BOT' | 'HUMAN'; alias: string }): SandboxRankedEntry[] {
  const bestByParticipant = new Map<string, SandboxBid>();
  for (const b of bids) {
    const cur = bestByParticipant.get(b.participant_id);
    if (!cur || b.price_pyg < cur.price_pyg || (b.price_pyg === cur.price_pyg && b.server_sequence < cur.server_sequence)) {
      bestByParticipant.set(b.participant_id, b);
    }
  }
  const ordered = [...bestByParticipant.values()].sort((a, b) =>
    a.price_pyg !== b.price_pyg ? a.price_pyg - b.price_pyg : a.server_sequence - b.server_sequence
  );
  return ordered.map((b, i) => {
    const meta = aliasOf(b.participant_id);
    return {
      rank: i + 1,
      participant_id: b.participant_id,
      kind: meta.kind,
      display_alias: meta.alias,
      price_pyg: b.price_pyg,
      server_sequence: b.server_sequence,
      server_received_at: b.server_received_at,
    };
  });
}

export interface BidCheck {
  ok: boolean;
  code?: BidRejectionCode;
  message?: string;
}

/**
 * Validates a bid against the authoritative snapshot. Pure.
 * Rules (in order):
 *  1. room must be ACTIVE_* (never DRAFT/CLOSED);
 *  2. participant must belong to the room;
 *  3. price must be a positive integer (PYG);
 *  4. price must be strictly below the participant's own last accepted bid;
 *  5. first bid of the room must be strictly below the opening price;
 *  6. otherwise the improvement over the current best must cover minimum_decrement.
 */
export function validateSandboxBid(
  snapshot: SandboxSnapshot,
  participantId: string,
  pricePyg: number,
  phase: PhaseView
): BidCheck {
  if (phase.status !== 'ACTIVE_NORMAL' && phase.status !== 'ACTIVE_RANDOM') {
    return { ok: false, code: 'ROOM_NOT_ACTIVE', message: 'La subasta no está activa.' };
  }
  const participant = snapshot.participants.find((p) => p.id === participantId);
  if (!participant) {
    return { ok: false, code: 'UNKNOWN_PARTICIPANT', message: 'Participante desconocido en esta sala.' };
  }
  if (!Number.isInteger(pricePyg) || pricePyg <= 0) {
    return { ok: false, code: 'INVALID_PRICE', message: 'El precio debe ser un entero positivo en guaraníes.' };
  }
  const ownBids = snapshot.bids.filter((b) => b.participant_id === participantId);
  const ownLast = ownBids.length > 0 ? Math.min(...ownBids.map((b) => b.price_pyg)) : null;
  if (ownLast !== null && pricePyg >= ownLast) {
    return { ok: false, code: 'NOT_DECREASING', message: `Tu nueva oferta debe ser menor a tu última oferta (₲${ownLast.toLocaleString('es-PY')}).` };
  }
  const best = snapshot.bids.length > 0 ? Math.min(...snapshot.bids.map((b) => b.price_pyg)) : null;
  if (best === null) {
    if (pricePyg >= snapshot.room.opening_price_pyg) {
      return { ok: false, code: 'NOT_BELOW_OPENING', message: `La primera oferta debe ser menor al precio de apertura (₲${snapshot.room.opening_price_pyg.toLocaleString('es-PY')}).` };
    }
    return { ok: true };
  }
  if (best - pricePyg < snapshot.room.minimum_decrement_pyg) {
    return {
      ok: false,
      code: 'BELOW_MINIMUM_DECREMENT',
      message: `La mejora mínima es ₲${snapshot.room.minimum_decrement_pyg.toLocaleString('es-PY')} sobre el mejor precio (₲${best.toLocaleString('es-PY')}).`,
    };
  }
  return { ok: true };
}

/**
 * Stable key for BOUNDED_AUTO submits: bound to (room, version, price) ONLY —
 * deliberately wall-clock-free (same pattern as the assisted key) so two tabs
 * evaluating the same candidate dedupe in the RPC instead of double-submitting.
 * Safe: keys persist only on ACCEPT, and re-bidding an identical price is
 * economically invalid anyway (strictly decreasing prices).
 */
export function buildBotIdempotencyKey(roomId: string, policyVersion: number, pricePyg: number): string {
  return `bot:${roomId}:v${policyVersion}:${pricePyg}`;
}

/**
 * Stable key for ASSISTED authorizations: bound to (room, version, price)
 * ONLY — deliberately wall-clock-free so concurrent authorizations of the
 * same candidate dedupe in the RPC instead of double-submitting.
 */
export function buildAssistedIdempotencyKey(roomId: string, policyVersion: number, pricePyg: number): string {
  return `assist:${roomId}:v${policyVersion}:${pricePyg}`;
}

/**
 * Stable key for HUMAN OVERRIDE authorizations: bound to (room, version,
 * price) ONLY — deliberately wall-clock-free (same pattern as bot/assisted
 * keys) so a double-click or a post-timeout operator retry dedupes in the
 * RPC instead of double-submitting. One-shot by construction: the key names
 * the exact authorized candidate, never a spending authority.
 */
export function buildOverrideIdempotencyKey(roomId: string, policyVersion: number, pricePyg: number): string {
  return `override:${roomId}:v${policyVersion}:${pricePyg}`;
}

/** Winner = rank #1 accepted bid (null when no bids). */
export function winnerOfRanking(ranking: SandboxRankedEntry[]): SandboxRankedEntry | null {
  return ranking.length > 0 ? ranking[0] : null;
}

export const SANDBOX_EVENT_TYPES: SandboxEventType[] = [
  'ROOM_CREATED',
  'AUCTION_STARTED',
  'RANDOM_PHASE_STARTED',
  'BID_ACCEPTED',
  'BID_REJECTED',
  'BOT_DECISION',
  'POLICY_AUTHORIZED',
  'BOT_STOPPED',
  'HUMAN_OVERRIDE_AUTHORIZED',
  'HUMAN_OVERRIDE_DECLINED',
  'AUCTION_CLOSED',
  'WINNER_DECLARED',
];
