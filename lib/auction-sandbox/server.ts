/**
 * AUCTION SANDBOX — Server-only data layer (no UI, no Core changes).
 *
 * Maps Supabase rows ↔ engine snapshots, advances phases by server time, and
 * builds redacted views per role. NEVER includes random_close_at or token
 * hashes in any returned view — secrecy is enforced here, at the view layer.
 *
 * DB access goes through a passed-in client:
 *  - operator actions: user client (RLS) — empresa scoped;
 *  - token actions: service-role client gated by token hash (portal pattern).
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { computePhase, rankBids, rollRandomCloseAt, winnerOfRanking } from './engine';
import {
  SandboxBid,
  SandboxEvent,
  SandboxParticipant,
  SandboxPolicyVersion,
  SandboxRankedEntry,
  SandboxRoom,
  SandboxSnapshot,
} from './types';

export interface SandboxBundle {
  room: SandboxRoom;
  participants: SandboxParticipant[];
  bids: SandboxBid[];
  policies: SandboxPolicyVersion[];
  events: SandboxEvent[];
}

type Db = SupabaseClient;

const ROOM_COLS =
  'id, empresa_id, created_by, title, scope, group_id, status, opening_price_pyg, ' +
  'minimum_decrement_pyg, normal_duration_seconds, random_min_seconds, random_max_seconds, ' +
  'started_at, random_started_at, random_close_at, closed_at, next_sequence, bot_paused, ' +
  'bot_runtime, winner_participant_id, created_at';

/** Loads everything for a room. Returns null when the room does not exist. */
export async function loadSandboxBundle(db: Db, roomId: string): Promise<SandboxBundle | null> {
  const { data: room } = await db.from('auction_sandbox_rooms').select(ROOM_COLS).eq('id', roomId).maybeSingle();
  if (!room) return null;
  const typedRoom = room as unknown as SandboxRoom;
  const [participants, bids, policies, events] = await Promise.all([
    db.from('auction_sandbox_participants').select('*').eq('room_id', roomId).order('created_at'),
    db.from('auction_sandbox_bids').select('*').eq('room_id', roomId).eq('accepted', true).order('server_sequence'),
    db.from('auction_sandbox_policy_versions').select('*').eq('room_id', roomId).order('version'),
    db.from('auction_sandbox_events').select('*').eq('room_id', roomId).order('server_sequence').limit(200),
  ]);
  return {
    room: typedRoom,
    participants: (participants.data ?? []) as SandboxParticipant[],
    bids: (bids.data ?? []) as SandboxBid[],
    policies: (policies.data ?? []) as SandboxPolicyVersion[],
    events: (events.data ?? []) as SandboxEvent[],
  };
}

export function bundleToSnapshot(bundle: SandboxBundle): SandboxSnapshot {
  return { room: bundle.room, participants: bundle.participants, bids: bundle.bids };
}

export function aliasOf(bundle: SandboxBundle, participantId: string): { kind: 'BOT' | 'HUMAN'; alias: string } {
  const p = bundle.participants.find((x) => x.id === participantId);
  return { kind: (p?.kind ?? 'HUMAN') as 'BOT' | 'HUMAN', alias: p?.display_alias ?? '?' };
}

export function rankBundle(bundle: SandboxBundle): SandboxRankedEntry[] {
  return rankBids(bundle.bids, (pid) => aliasOf(bundle, pid));
}

export interface RoomAdvance {
  patch: Partial<SandboxRoom>;
  events: Array<{ type: SandboxEvent['type']; payload: Record<string, unknown>; server_sequence: number }>;
}

/**
 * Computes the phase transition for a room at server time. Pure given inputs
 * (persists nothing). Returns null when nothing changes. The caller persists
 * patch + events, emitting transition events only when the status CHANGED.
 */
export function computeRoomAdvance(
  bundle: SandboxBundle,
  nowIso: string,
  rand01: number
): RoomAdvance | null {
  const room = bundle.room;
  const nowMs = Date.parse(nowIso);
  if (room.status === 'DRAFT' || room.status === 'CLOSED') return null;

  if (room.status === 'ACTIVE_NORMAL') {
    if (!room.started_at) return null;
    if (nowMs - Date.parse(room.started_at) < room.normal_duration_seconds * 1000) return null;
    const randomStartedAt = nowIso;
    const randomCloseAt = room.random_close_at ?? rollRandomCloseAt(nowMs, room.random_min_seconds, room.random_max_seconds, rand01);
    return {
      patch: { status: 'ACTIVE_RANDOM', random_started_at: randomStartedAt, random_close_at: randomCloseAt },
      events: [{ type: 'RANDOM_PHASE_STARTED', payload: { at: randomStartedAt }, server_sequence: room.next_sequence }],
    };
  }

  // ACTIVE_RANDOM
  if (room.random_close_at && nowMs >= Date.parse(room.random_close_at)) {
    const ranking = rankBundle(bundle);
    const winner = winnerOfRanking(ranking);
    return {
      patch: { status: 'CLOSED', closed_at: nowIso, winner_participant_id: winner?.participant_id ?? null },
      events: [
        { type: 'AUCTION_CLOSED', payload: { at: nowIso, total_bids: bundle.bids.length }, server_sequence: room.next_sequence },
        {
          type: 'WINNER_DECLARED',
          payload: winner ? { participant_id: winner.participant_id, alias: winner.display_alias, price_pyg: winner.price_pyg } : { participant_id: null },
          server_sequence: room.next_sequence + 1,
        },
      ],
    };
  }
  // Random close not rolled yet (should not happen — rolled at transition — but backstop it).
  if (!room.random_close_at && room.random_started_at) {
    return {
      patch: { random_close_at: rollRandomCloseAt(Date.parse(room.random_started_at), room.random_min_seconds, room.random_max_seconds, rand01) },
      events: [],
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Views (secret fields NEVER leave the server)
// ---------------------------------------------------------------------------

export interface PublicRoomInfo {
  id: string;
  title: string;
  scope: string;
  group_id: string;
  status: SandboxRoom['status'];
  opening_price_pyg: number;
  minimum_decrement_pyg: number;
  closeRisk: boolean;
  bot_paused: boolean;
  winner_participant_id: string | null;
  total_bids: number;
}

export function publicRoomInfo(bundle: SandboxBundle, nowIso: string): PublicRoomInfo {
  const phase = computePhase(bundle.room, Date.parse(nowIso));
  return {
    id: bundle.room.id,
    title: bundle.room.title,
    scope: bundle.room.scope,
    group_id: bundle.room.group_id,
    status: phase.status,
    opening_price_pyg: bundle.room.opening_price_pyg,
    minimum_decrement_pyg: bundle.room.minimum_decrement_pyg,
    closeRisk: phase.closeRisk,
    bot_paused: bundle.room.bot_paused,
    winner_participant_id: bundle.room.winner_participant_id,
    total_bids: bundle.bids.length,
  };
}

export interface JoinBidView {
  rank: number;
  price_pyg: number;
  mine: boolean;
  server_received_at: string;
}

export interface JoinView {
  room: PublicRoomInfo;
  ranking: JoinBidView[];
  myRank: number | null;
  myPrice: number | null;
  bestPrice: number | null;
  myBids: Array<{ price_pyg: number; server_received_at: string; accepted: boolean }>;
}

/** Competitor view: prices and own position only. No policy, no bot internals. */
export function buildJoinView(bundle: SandboxBundle, participantId: string, nowIso: string): JoinView {
  const ranking = rankBundle(bundle);
  const mine = ranking.find((r) => r.participant_id === participantId) ?? null;
  return {
    room: publicRoomInfo(bundle, nowIso),
    ranking: ranking.map((r) => ({ rank: r.rank, price_pyg: r.price_pyg, mine: r.participant_id === participantId, server_received_at: r.server_received_at })),
    myRank: mine?.rank ?? null,
    myPrice: mine?.price_pyg ?? null,
    bestPrice: ranking.length > 0 ? ranking[0].price_pyg : null,
    myBids: bundle.bids
      .filter((b) => b.participant_id === participantId)
      .map((b) => ({ price_pyg: b.price_pyg, server_received_at: b.server_received_at, accepted: true }))
      .reverse(),
  };
}

export interface WatchKpis {
  botBids: number;
  humanBids: number;
  /** ms between each bot bid and the latest human bid before it (min), null when N/A. */
  reactionMs: number | null;
  /** Opening − best (null without bids). */
  concessionPyg: number | null;
  /** Best − autoLimit (null without policy/bids). Negative = breached (should never happen). */
  distanceToAutoLimitPyg: number | null;
}

export interface WatchView {
  room: PublicRoomInfo;
  ranking: SandboxRankedEntry[];
  recentBids: SandboxRankedEntry[];
  policy: { version: number; targetPricePyg: number; autoLimitPyg: number; targetRank: number; executionMode: string; authorizedBy: string } | null;
  lastDecision: Record<string, unknown> | null;
  botStatus: string | null;
  pendingCandidate: {
    pricePyg: number;
    basisObservedAt: string;
    policyVersion: number;
    decidedAt: string;
  } | null;
  timeline: Array<{ at: string; type: string; text: string }>;
  kpis: WatchKpis;
  result: { winner_alias: string | null; price_pyg: number | null; total_bids: number } | null;
}

/** War-room view: everything except random_close_at and token hashes. */
export function buildWatchView(bundle: SandboxBundle, nowIso: string): WatchView {
  const ranking = rankBundle(bundle);
  const latestPolicy = bundle.policies.length > 0 ? bundle.policies[bundle.policies.length - 1] : null;
  const botParticipant = bundle.participants.find((p) => p.kind === 'BOT');
  const botBids = botParticipant ? bundle.bids.filter((b) => b.participant_id === botParticipant.id) : [];
  const humanBids = botParticipant ? bundle.bids.filter((b) => b.participant_id !== botParticipant.id) : bundle.bids;

  let reactionMs: number | null = null;
  for (const bb of botBids) {
    const prev = humanBids.filter((h) => Date.parse(h.server_received_at) <= Date.parse(bb.server_received_at));
    if (prev.length === 0) continue;
    const latest = prev.reduce((a, b) => (Date.parse(a.server_received_at) >= Date.parse(b.server_received_at) ? a : b));
    const diff = Date.parse(bb.server_received_at) - Date.parse(latest.server_received_at);
    reactionMs = reactionMs === null ? diff : Math.min(reactionMs, diff);
  }

  const best = ranking.length > 0 ? ranking[0].price_pyg : null;
  const snap = (latestPolicy?.snapshot ?? {}) as { targetPricePyg?: number; autoLimitPyg?: number; targetRank?: number; executionMode?: string; authorizedBy?: string };
  const lastDecisionEvent = [...bundle.events].reverse().find((e) => e.type === 'BOT_DECISION');

  const timeline = bundle.events.map((e) => ({ at: e.created_at, type: e.type, text: eventText(e.type, e.payload) }));

  const winner = bundle.room.winner_participant_id
    ? ranking.find((r) => r.participant_id === bundle.room.winner_participant_id) ?? null
    : null;

  return {
    room: publicRoomInfo(bundle, nowIso),
    ranking,
    recentBids: [...ranking].reverse().slice(0, 10),
    policy: latestPolicy
      ? {
          version: latestPolicy.version,
          targetPricePyg: snap.targetPricePyg ?? 0,
          autoLimitPyg: snap.autoLimitPyg ?? 0,
          targetRank: snap.targetRank ?? 0,
          executionMode: snap.executionMode ?? '?',
          authorizedBy: latestPolicy.authorized_by,
        }
      : null,
    lastDecision: (lastDecisionEvent?.payload ?? null) as Record<string, unknown> | null,
    botStatus: (bundle.room.bot_runtime?.lastBotStatus as string | undefined) ?? null,
    pendingCandidate: bundle.room.bot_runtime?.pendingCandidate ?? null,
    timeline,
    kpis: {
      botBids: botBids.length,
      humanBids: humanBids.length,
      reactionMs,
      concessionPyg: best === null ? null : bundle.room.opening_price_pyg - best,
      distanceToAutoLimitPyg: best === null || snap.autoLimitPyg === undefined ? null : best - snap.autoLimitPyg,
    },
    result:
      bundle.room.status === 'CLOSED'
        ? { winner_alias: winner?.display_alias ?? null, price_pyg: winner?.price_pyg ?? null, total_bids: bundle.bids.length }
        : null,
  };
}

function eventText(type: string, payload: Record<string, unknown>): string {
  const pyg = (v: unknown) => (typeof v === 'number' ? `₲${v.toLocaleString('es-PY')}` : '');
  switch (type) {
    case 'ROOM_CREATED': return 'Sala creada';
    case 'AUCTION_STARTED': return 'Subasta iniciada (fase normal)';
    case 'RANDOM_PHASE_STARTED': return 'Fase aleatoria iniciada';
    case 'BID_ACCEPTED': return `Oferta aceptada ${pyg(payload.price_pyg)}`;
    case 'BID_REJECTED': return `Oferta rechazada (${String(payload.rejection_code ?? '')})`;
    case 'BOT_DECISION': return `Bot → ${String(payload.action ?? '?')}${payload.candidatePricePyg ? ` ${pyg(payload.candidatePricePyg)}` : ''}`;
    case 'POLICY_AUTHORIZED': return `Policy v${String(payload.version ?? '?')} autorizada`;
    case 'BOT_STOPPED': return 'Bot detenido';
    case 'AUCTION_CLOSED': return 'Subasta cerrada';
    case 'WINNER_DECLARED': return `Ganador: ${String(payload.alias ?? '—')} ${pyg(payload.price_pyg)}`;
    default: return type;
  }
}
