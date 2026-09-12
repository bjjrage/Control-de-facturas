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
  'started_at, random_started_at, closed_at, next_sequence, bot_paused, ' +
  'bot_runtime, winner_participant_id, created_at';
// NOTE: random_close_at lives in auction_sandbox_room_private (no SELECT for
// app roles) and is NEVER selected here. Phase transitions run inside the
// advance_sandbox_room RPC; computeRoomAdvance() below is the REFERENCE
// implementation mirrored by that RPC (unit-tested; keep in sync).

/** Loads everything for a room. FAIL-CLOSED: any read error → { error }, never partial/empty data. */
export async function loadSandboxBundle(db: Db, roomId: string): Promise<{ bundle: SandboxBundle } | { error: string }> {
  const { data: room, error: roomError } = await db.from('auction_sandbox_rooms').select(ROOM_COLS).eq('id', roomId).maybeSingle();
  if (roomError) return { error: `No se pudo leer la sala (${roomError.code ?? 'read-error'}).` };
  if (!room) return { error: 'Sala inexistente.' };
  const typedRoom = room as unknown as SandboxRoom;
  const [participants, bids, policies, events] = await Promise.all([
    db.from('auction_sandbox_participants').select('*').eq('room_id', roomId).order('created_at'),
    // Latest 200 by sequence DESC (a rejection-spam flood can never push the
    // close/winner tail out of view), then back to ASC for the bundle contract.
    db.from('auction_sandbox_bids').select('*').eq('room_id', roomId).eq('accepted', true).order('server_sequence', { ascending: false }).limit(200),
    db.from('auction_sandbox_policy_versions').select('*').eq('room_id', roomId).order('version'),
    db.from('auction_sandbox_events').select('*').eq('room_id', roomId).order('server_sequence', { ascending: false }).limit(200),
  ]);
  const failed = [participants, bids, policies, events].find((q) => q.error);
  if (failed?.error) return { error: `No se pudo leer la sala (${failed.error.code ?? 'read-error'}).` };
  const asc = <T,>(rows: T[] | null): T[] => [...(rows ?? [])].reverse();
  return {
    bundle: {
      room: typedRoom,
      participants: (participants.data ?? []) as SandboxParticipant[],
      bids: asc(bids.data as SandboxBid[] | null),
      policies: (policies.data ?? []) as SandboxPolicyVersion[],
      events: asc(events.data as SandboxEvent[] | null),
    },
  };
}

export function bundleToSnapshot(bundle: SandboxBundle): SandboxSnapshot {
  return { room: bundle.room, participants: bundle.participants, bids: bundle.bids };
}

export function aliasOf(bundle: SandboxBundle, participantId: string): { kind: 'BOT' | 'HUMAN'; alias: string } {
  const p = bundle.participants.find((x) => x.id === participantId);
  return { kind: (p?.kind ?? 'HUMAN') as 'BOT' | 'HUMAN', alias: p?.display_alias ?? '?' };
}

export interface AssistedCandidate {
  pricePyg: number;
  basisObservedAt: string;
  policyVersion: number;
  decidedAt: string;
}

/**
 * Builds the next bot_runtime in ONE pure step (no I/O): the caller persists
 * the result exactly once per tick. lastBotStatus always refreshes from the
 * latest decision; pendingCandidate is set only for a live ASSISTED candidate
 * and cleared otherwise — the two can never clobber each other across writes
 * because there is a single write.
 */
export function computeNextRuntime(
  runtime: Record<string, unknown>,
  decision: { action: string; reasonCode: string; candidatePricePyg: number | null; policyVersion: number },
  assistedCandidate: AssistedCandidate | null
): Record<string, unknown> {
  return {
    ...runtime,
    lastBotStatus: {
      action: decision.action,
      reasonCode: decision.reasonCode,
      candidate: decision.candidatePricePyg ?? null,
      v: decision.policyVersion,
    },
    pendingCandidate: assistedCandidate,
  };
}

export function rankBundle(bundle: SandboxBundle): SandboxRankedEntry[] {
  return rankBids(bundle.bids, (pid) => aliasOf(bundle, pid));
}

export interface DecisionFingerprint {
  action: string;
  reasonCode: string;
  candidatePricePyg: number | null;
  policyVersion: number;
}

/**
 * True when no identical BOT_DECISION is already recorded in the loaded
 * bundle: prevents duplicate decision events when a previous tick committed
 * the event but failed to persist the runtime (or two tabs race). The check
 * is advisory (TOCTOU across tabs remains, narrowed to one RPC round trip),
 * never a correctness gate for bidding.
 */
export function shouldEmitDecision(bundle: SandboxBundle, decision: DecisionFingerprint): boolean {
  return !bundle.events.some(
    (e) =>
      e.type === 'BOT_DECISION' &&
      (e.payload as Record<string, unknown>).action === decision.action &&
      (e.payload as Record<string, unknown>).reasonCode === decision.reasonCode &&
      ((e.payload as Record<string, unknown>).candidatePricePyg ?? null) === (decision.candidatePricePyg ?? null) &&
      (e.payload as Record<string, unknown>).policyVersion === decision.policyVersion
  );
}

/**
 * Initial-event backfill proof (fail-closed): returns which of ROOM_CREATED /
 * AUCTION_STARTED are provably missing. Provable only when the loaded history
 * is complete — i.e. max server_sequence < 200 (nothing could have aged out
 * of the 200-event window) — otherwise absence proves nothing and no
 * backfill is attempted (avoids duplicates).
 */
export function missingInitialEvents(bundle: SandboxBundle): Array<'ROOM_CREATED' | 'AUCTION_STARTED'> {  const seqs = bundle.events.map((e) => e.server_sequence);
  const complete = seqs.length === 0 || Math.max(...seqs) < 200;
  if (!complete) return [];
  const types = new Set(bundle.events.map((e) => e.type));
  const missing: Array<'ROOM_CREATED' | 'AUCTION_STARTED'> = [];
  if (!types.has('ROOM_CREATED')) missing.push('ROOM_CREATED');
  if (bundle.room.status !== 'DRAFT' && bundle.room.started_at && !types.has('AUCTION_STARTED')) {
    missing.push('AUCTION_STARTED');
  }
  return missing;
}

/**
 * Policy-event backfill proof: versions persisted without their
 * POLICY_AUTHORIZED event, provable only under the same completeness rule
 * as missingInitialEvents. Returns the version numbers to backfill.
 */
export function missingPolicyEvents(bundle: SandboxBundle): number[] {
  const seqs = bundle.events.map((e) => e.server_sequence);
  const complete = seqs.length === 0 || Math.max(...seqs) < 200;
  if (!complete || bundle.policies.length === 0) return [];
  const announced = new Set(
    bundle.events
      .filter((e) => e.type === 'POLICY_AUTHORIZED')
      .map((e) => (e.payload as Record<string, unknown>).version)
      .filter((v): v is number => typeof v === 'number')
  );
  return bundle.policies.map((p) => p.version).filter((v) => !announced.has(v));
}

// NOTE: phase transitions run EXCLUSIVELY inside the advance_sandbox_room /
// force_close_sandbox_room RPCs (row lock + monotonic sequence, single
// roll of random_close_at). There is deliberately NO TypeScript transition
// builder anymore: a second implementation would drift from the SQL source
// of truth. computePhase()/rollRandomCloseAt() in engine.ts remain as the
// tested pure primitives.

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

export interface WatchRecentBid {
  participant_id: string;
  display_alias: string;
  kind: 'BOT' | 'HUMAN';
  price_pyg: number;
  server_sequence: number;
  server_received_at: string;
}

export interface WatchView {
  room: PublicRoomInfo;
  ranking: SandboxRankedEntry[];
  /** Real bid history (sequence DESC, latest 10). NOT collapsed per participant. */
  recentBids: WatchRecentBid[];
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
    recentBids: [...bundle.bids]
      .sort((a, b) => b.server_sequence - a.server_sequence)
      .slice(0, 10)
      .map((b) => {
        const meta = aliasOf(bundle, b.participant_id);
        return {
          participant_id: b.participant_id,
          display_alias: meta.alias,
          kind: meta.kind,
          price_pyg: b.price_pyg,
          server_sequence: b.server_sequence,
          server_received_at: b.server_received_at,
        };
      }),
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
    // Canonical: persisted lastBotStatus is ALWAYS the object shape (see
    // SandboxBotRuntime); only .action (a string) leaves the server.
    botStatus: bundle.room.bot_runtime?.lastBotStatus?.action ?? null,
    // A stored candidate is only exposed when bound to the ACTIVE version.
    pendingCandidate:
      bundle.room.bot_runtime?.pendingCandidate?.policyVersion === latestPolicy?.version
        ? (bundle.room.bot_runtime?.pendingCandidate ?? null)
        : null,
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
