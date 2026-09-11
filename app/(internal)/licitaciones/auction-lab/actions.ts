'use server';

import { requireEmpresaId, requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';
import { AuctionBotStateMachine } from '@/lib/auction-bot/state-machine';
import { evaluateAuctionStep } from '@/lib/auction-bot/engine';
import { runBotTick, roomSbeConstraints } from '@/lib/auction-sandbox/bot-runner';
import { snapshotToAuctionState } from '@/lib/auction-sandbox/auction-state-adapter';
import { buildBotIdempotencyKey, rankBids, winnerOfRanking } from '@/lib/auction-sandbox/engine';
import { buildPolicyVersionRecord, policyFromSnapshot } from '@/lib/auction-sandbox/policies';
import {
  bundleToSnapshot,
  buildWatchView,
  computeRoomAdvance,
  loadSandboxBundle,
  publicRoomInfo,
  rankBundle,
  SandboxBundle,
  WatchView,
} from '@/lib/auction-sandbox/server';
import { generateSandboxToken, hashSandboxToken } from '@/lib/auction-sandbox/tokens';
import { AuctionPolicy, FrozenAuctionPolicy } from '@/lib/auction-bot/types';

type Db = SupabaseClient;

const OPERATOR_ROLES = ['comercial', 'administracion', 'admin'] as const;
const MANAGE_ROLES = ['administracion', 'admin'] as const;

const nowIso = () => new Date().toISOString();

async function operatorBundle(roomId: string): Promise<{ db: Db; bundle: SandboxBundle; empresaId: string } | { error: string }> {
  const empresaId = await requireEmpresaId([...OPERATOR_ROLES]);
  const db = await createClient();
  const bundle = await loadSandboxBundle(db, roomId);
  if (!bundle || bundle.room.empresa_id !== empresaId) return { error: 'Sala inexistente.' };
  return { db, bundle, empresaId };
}

/** Persists a computed phase transition (optimistic: skips events on lost race). */
async function persistAdvance(db: Db, bundle: SandboxBundle, atIso: string, rand01: number): Promise<SandboxBundle> {
  const advance = computeRoomAdvance(bundle, atIso, rand01);
  if (!advance) return bundle;
  const seqBase = bundle.room.next_sequence;
  const { data: updated } = await db
    .from('auction_sandbox_rooms')
    .update({ ...advance.patch, next_sequence: seqBase + advance.events.length })
    .eq('id', bundle.room.id)
    .eq('status', bundle.room.status)
    .select('id');
  if (!updated || updated.length === 0) {
    return (await loadSandboxBundle(db, bundle.room.id)) ?? bundle;
  }
  if (advance.events.length > 0) {
    await db.from('auction_sandbox_events').insert(
      advance.events.map((e, i) => ({ room_id: bundle.room.id, type: e.type, payload: e.payload, server_sequence: seqBase + i }))
    );
  }
  return (await loadSandboxBundle(db, bundle.room.id)) ?? bundle;
}

async function appendEvent(db: Db, bundle: SandboxBundle, type: string, payload: Record<string, unknown>): Promise<SandboxBundle> {
  const seq = bundle.room.next_sequence;
  await db.from('auction_sandbox_events').insert({ room_id: bundle.room.id, type, payload, server_sequence: seq });
  await db.from('auction_sandbox_rooms').update({ next_sequence: seq + 1 }).eq('id', bundle.room.id);
  return { ...bundle, room: { ...bundle.room, next_sequence: seq + 1 } };
}

type RpcResult = { accepted: boolean; duplicate?: boolean; bid_id?: string; sequence?: number; rejection_code?: string; rejection_message?: string };

async function rpcSubmit(
  db: Db,
  roomId: string,
  participantId: string,
  pricePyg: number,
  atIso: string,
  idempotencyKey: string | null
): Promise<RpcResult> {
  const { data, error } = await db.rpc('submit_sandbox_bid', {
    p_room_id: roomId,
    p_participant_id: participantId,
    p_price_pyg: pricePyg,
    p_now_iso: atIso,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(`submit_sandbox_bid: ${error.message}`);
  return data as RpcResult;
}

// ---------------------------------------------------------------------------
// Bot tick (BOUNDED_AUTO auto-submit; other modes only observe/record).
// ---------------------------------------------------------------------------

async function botTick(db: Db, bundle: SandboxBundle, atIso: string): Promise<SandboxBundle> {
  if (bundle.room.bot_paused) return bundle;
  if (bundle.policies.length === 0) return bundle;
  if (bundle.room.status !== 'ACTIVE_NORMAL' && bundle.room.status !== 'ACTIVE_RANDOM') return bundle;

  const latest = bundle.policies[bundle.policies.length - 1];
  let policy;
  try {
    policy = policyFromSnapshot(latest);
  } catch {
    return bundle;
  }
  const constraints = roomSbeConstraints(bundle.room.minimum_decrement_pyg);
  const { decision, machineState } = runBotTick({ snapshot: bundleToSnapshot(bundle), policy, constraints, nowIso: atIso });

  const runtime = (bundle.room.bot_runtime ?? {}) as Record<string, unknown>;
  const last = (runtime.lastBotStatus ?? {}) as { action?: string; reasonCode?: string; candidate?: number | null; v?: number };
  const changed =
    last.action !== decision.action ||
    last.reasonCode !== decision.reasonCode ||
    (last.candidate ?? null) !== (decision.candidatePricePyg ?? null) ||
    last.v !== decision.policyVersion;

  let next = bundle;
  if (changed) {
    next = await appendEvent(db, next, 'BOT_DECISION', {
      action: decision.action,
      reasonCode: decision.reasonCode,
      reasonDescription: decision.reasonDescription,
      candidatePricePyg: decision.candidatePricePyg,
      targetRank: decision.targetRank,
      policyVersion: decision.policyVersion,
      executionMode: decision.executionMode,
      machineState,
    });
    await db.from('auction_sandbox_rooms').update({
      bot_runtime: {
        ...runtime,
        lastBotStatus: { action: decision.action, reasonCode: decision.reasonCode, candidate: decision.candidatePricePyg, v: decision.policyVersion },
      },
    }).eq('id', bundle.room.id);
    if (decision.action === 'STOP') {
      next = await appendEvent(db, next, 'BOT_STOPPED', { reasonCode: decision.reasonCode, policyVersion: decision.policyVersion });
    }
  }

  const pending = runtime.pendingCandidate as { pricePyg: number; basisObservedAt: string; policyVersion: number; decidedAt: string } | undefined;

  if (policy.executionMode === 'ASSISTED' && decision.action === 'BID_CANDIDATE' && decision.candidatePricePyg !== null) {
    if (!pending || pending.pricePyg !== decision.candidatePricePyg || pending.policyVersion !== decision.policyVersion) {
      await db.from('auction_sandbox_rooms').update({
        bot_runtime: {
          ...(next.room.bot_runtime as Record<string, unknown>),
          pendingCandidate: { pricePyg: decision.candidatePricePyg, basisObservedAt: decision.evaluatedAt, policyVersion: decision.policyVersion, decidedAt: atIso },
        },
      }).eq('id', bundle.room.id);
    }
    return (await loadSandboxBundle(db, bundle.room.id)) ?? next;
  }

  if (pending) {
    await db.from('auction_sandbox_rooms').update({
      bot_runtime: { ...(next.room.bot_runtime as Record<string, unknown>), pendingCandidate: null },
    }).eq('id', bundle.room.id);
  }

  if (policy.executionMode === 'BOUNDED_AUTO' && decision.action === 'BID_CANDIDATE' && decision.candidatePricePyg !== null) {
    await botAutoSubmit(db, next, policy, decision.candidatePricePyg, decision.evaluatedAt, atIso);
    return (await loadSandboxBundle(db, bundle.room.id)) ?? next;
  }

  return (await loadSandboxBundle(db, bundle.room.id)) ?? next;
}

/** Full guarded submit for one BOUNDED_AUTO candidate (fresh machine, recheck, RPC, confirm). */
async function botAutoSubmit(
  db: Db,
  bundle: SandboxBundle,
  policy: ReturnType<typeof policyFromSnapshot>,
  candidatePricePyg: number,
  basisObservedAt: string,
  atIso: string
): Promise<void> {
  const bot = bundle.participants.find((p) => p.kind === 'BOT');
  if (!bot) return;
  const constraints = roomSbeConstraints(bundle.room.minimum_decrement_pyg);
  const bidId = buildBotIdempotencyKey(bundle.room.id, policy.version, basisObservedAt, candidatePricePyg);

  const machine = new AuctionBotStateMachine(policy);
  machine.startMonitoring();
  machine.beginEvaluation();
  // Re-evaluate synchronously (same server instant) to bind the basis.
  const state0 = snapshotToAuctionState(bundleToSnapshot(bundle), atIso);
  const decision = evaluateAuctionStep(state0, policy, constraints, { currentTimestampIso: atIso });
  if (decision.action !== 'BID_CANDIDATE' || decision.candidatePricePyg !== candidatePricePyg) return;
  machine.handleDecision(decision, state0);

  // Fresh snapshot for the pre-submit recheck (strictly newer observation).
  const freshAt = new Date(Date.parse(atIso) + 1).toISOString();
  const recheck = machine.recheckCandidate({ ...state0, observedAt: freshAt }, { nowIso: freshAt });
  if (!recheck.valid) return;

  let submission;
  try {
    submission = machine.startSubmission(bidId, { submittedAtIso: freshAt });
  } catch {
    return;
  }
  try {
    const res = await rpcSubmit(db, bundle.room.id, bot.id, submission.pricePyg, freshAt, bidId);
    if (res.accepted) {
      machine.confirmSubmission();
    }
    // A business rejection (lost race) needs no confirm: next tick re-evaluates.
  } catch {
    try {
      machine.markSubmissionUnknown('RPC submit failed');
      const snap2 = await loadSandboxBundle(db, bundle.room.id);
      if (snap2) {
        const s2 = snapshotToAuctionState(bundleToSnapshot(snap2), new Date().toISOString());
        machine.reconcileWithState(s2, { observationIsAuthoritative: true }, { nowIso: s2.observedAt });
      }
    } catch {
      // Fail-safe: the bid may or may not exist; the next tick re-evaluates
      // from the authoritative snapshot. Never auto-retry blindly.
    }
  }
}

// ---------------------------------------------------------------------------
// Public operator API
// ---------------------------------------------------------------------------

export interface OperatorView {
  room: ReturnType<typeof publicRoomInfo>;
  ranking: ReturnType<typeof rankBids>;
  botPaused: boolean;
  bot: {
    status: string | null;
    mode: string | null;
    policyVersion: number | null;
    targetPricePyg: number | null;
    autoLimitPyg: number | null;
    lastDecision: Record<string, unknown> | null;
    pendingCandidate: { pricePyg: number; basisObservedAt: string; policyVersion: number; decidedAt: string } | null;
  };
  /** Full active policy snapshot (internal operator only — never exposed to token views). */
  activePolicy: FrozenAuctionPolicy | null;
  watch: WatchView;
}

function toOperatorView(bundle: SandboxBundle, atIso: string): OperatorView {
  const latest = bundle.policies.length > 0 ? bundle.policies[bundle.policies.length - 1] : null;
  let activePolicy: FrozenAuctionPolicy | null = null;
  try {
    activePolicy = latest ? policyFromSnapshot(latest) : null;
  } catch {
    activePolicy = null;
  }
  const snap = (latest?.snapshot ?? {}) as { targetPricePyg?: number; autoLimitPyg?: number; executionMode?: string };
  const runtime = (bundle.room.bot_runtime ?? {}) as Record<string, unknown>;
  const lastDecisionEvent = [...bundle.events].reverse().find((e) => e.type === 'BOT_DECISION');
  return {
    room: publicRoomInfo(bundle, atIso),
    ranking: rankBundle(bundle),
    botPaused: bundle.room.bot_paused,
    bot: {
      status: (runtime.lastBotStatus as { action?: string } | undefined)?.action ?? null,
      mode: snap.executionMode ?? null,
      policyVersion: latest?.version ?? null,
      targetPricePyg: snap.targetPricePyg ?? null,
      autoLimitPyg: snap.autoLimitPyg ?? null,
      lastDecision: (lastDecisionEvent?.payload ?? null) as Record<string, unknown> | null,
      pendingCandidate: (runtime.pendingCandidate as OperatorView['bot']['pendingCandidate']) ?? null,
    },
    activePolicy,
    watch: buildWatchView(bundle, atIso),
  };
}

/** Heartbeat: advance phases + run one bot tick + return the operator view. */
export async function pollOperatorRoom(roomId: string): Promise<{ view?: OperatorView; error?: string }> {
  const res = await operatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  const atIso = nowIso();
  let bundle = await persistAdvance(res.db, res.bundle, atIso, Math.random());
  bundle = await botTick(res.db, bundle, nowIso());
  return { view: toOperatorView(bundle, nowIso()) };
}

export async function createSandboxRoom(input: {
  title: string;
  scope: 'ITEM' | 'LOT' | 'TOTAL';
  group_id: string;
  opening_price_pyg: number;
  normal_duration_seconds: number;
  random_min_seconds: number;
  random_max_seconds: number;
  minimum_decrement_pyg: number;
}): Promise<{ roomId?: string; competitorToken?: string; observerToken?: string; error?: string }> {
  const empresaId = await requireEmpresaId([...MANAGE_ROLES]);
  const profile = await requireProfile([...MANAGE_ROLES]);
  const title = input.title.trim();
  const groupId = input.group_id.trim();
  if (!title || !groupId) return { error: 'Completá nombre y Group ID.' };
  if (!['ITEM', 'LOT', 'TOTAL'].includes(input.scope)) return { error: 'Scope inválido.' };
  const ints: Array<[string, number, number, number]> = [
    ['Precio inicial', input.opening_price_pyg, 1, Number.MAX_SAFE_INTEGER],
    ['Duración normal', input.normal_duration_seconds, 5, 3600],
    ['Random mínimo', input.random_min_seconds, 0, 3600],
    ['Random máximo', input.random_max_seconds, 0, 3600],
    ['Decremento mínimo', input.minimum_decrement_pyg, 1, Number.MAX_SAFE_INTEGER],
  ];
  for (const [label, v, min, max] of ints) {
    if (!Number.isInteger(v) || v < min || v > max) return { error: `${label} inválido.` };
  }
  if (input.random_max_seconds < input.random_min_seconds) return { error: 'Random máximo menor que el mínimo.' };

  const competitorToken = generateSandboxToken();
  const observerToken = generateSandboxToken();
  const db = await createClient();
  const { data: room, error } = await db
    .from('auction_sandbox_rooms')
    .insert({
      empresa_id: empresaId,
      created_by: profile.id,
      title,
      scope: input.scope,
      group_id: groupId,
      status: 'DRAFT',
      opening_price_pyg: input.opening_price_pyg,
      minimum_decrement_pyg: input.minimum_decrement_pyg,
      normal_duration_seconds: input.normal_duration_seconds,
      random_min_seconds: input.random_min_seconds,
      random_max_seconds: input.random_max_seconds,
      competitor_token_hash: hashSandboxToken(competitorToken),
      observer_token_hash: hashSandboxToken(observerToken),
    })
    .select('id')
    .single();
  if (error || !room) return { error: 'No se pudo crear la sala.' };
  const roomId = (room as { id: string }).id;
  await db.from('auction_sandbox_participants').insert([
    { room_id: roomId, kind: 'BOT', display_alias: 'Nuestro Bot' },
    { room_id: roomId, kind: 'HUMAN', display_alias: 'Competidor' },
  ]);
  await db.from('auction_sandbox_events').insert({
    room_id: roomId,
    type: 'ROOM_CREATED',
    payload: { title },
    server_sequence: 0,
  });
  return { roomId, competitorToken, observerToken };
}

export async function startSandboxRoom(roomId: string): Promise<{ error?: string }> {
  const res = await operatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  if (res.bundle.room.status !== 'DRAFT') return { error: 'La sala ya fue iniciada.' };
  if (res.bundle.policies.length === 0) return { error: 'Autorizá una policy (v1) antes de arrancar.' };
  const atIso = nowIso();
  const { error } = await res.db
    .from('auction_sandbox_rooms')
    .update({ status: 'ACTIVE_NORMAL', started_at: atIso })
    .eq('id', roomId)
    .eq('status', 'DRAFT');
  if (error) return { error: 'No se pudo iniciar la sala.' };
  let bundle = (await loadSandboxBundle(res.db, roomId)) ?? res.bundle;
  await appendEvent(res.db, bundle, 'AUCTION_STARTED', { at: atIso });
  return {};
}

export async function authorizeSandboxPolicy(
  roomId: string,
  draft: AuctionPolicy,
  authorizedBy: string
): Promise<{ version?: number; error?: string }> {
  const res = await operatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  const versions = res.bundle.policies.map((p) => p.version);
  const nextVersion = versions.length > 0 ? Math.max(...versions) + 1 : 1;
  let record;
  try {
    record = buildPolicyVersionRecord(roomId, draft, nextVersion, authorizedBy.trim(), nowIso());
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Política inválida.' };
  }
  if (!authorizedBy.trim()) return { error: 'Indicá quién autoriza.' };
  const { error } = await res.db.from('auction_sandbox_policy_versions').insert(record);
  if (error) {
    if (error.code === '23505') return { error: 'Versión duplicada: reintentá.' };
    return { error: 'No se pudo persistir la policy.' };
  }
  const bundle = (await loadSandboxBundle(res.db, roomId)) ?? res.bundle;
  await appendEvent(res.db, bundle, 'POLICY_AUTHORIZED', {
    version: nextVersion,
    policy_id: record.policy_id,
    fingerprint: record.fingerprint,
    authorized_by: record.authorized_by,
  });
  // A new version invalidates any ASSISTED pending candidate.
  await res.db.from('auction_sandbox_rooms').update({
    bot_runtime: { ...((bundle.room.bot_runtime ?? {}) as Record<string, unknown>), pendingCandidate: null },
  }).eq('id', roomId);
  return { version: nextVersion };
}

/** ASSISTED: grant → fresh snapshot → recheck → submit, all in one server action. */
export async function authorizeAssistedBid(roomId: string): Promise<{ price?: number; error?: string }> {
  const res = await operatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  const profile = await requireProfile([...MANAGE_ROLES]);
  const atIso = nowIso();
  let bundle = await persistAdvance(res.db, res.bundle, atIso, Math.random());
  if (bundle.policies.length === 0) return { error: 'Sin policy autorizada.' };
  const latest = bundle.policies[bundle.policies.length - 1];
  let policy;
  try {
    policy = policyFromSnapshot(latest);
  } catch {
    return { error: 'Snapshot de policy corrupto.' };
  }
  if (policy.executionMode !== 'ASSISTED') return { error: 'El bot no está en modo ASSISTED.' };
  const bot = bundle.participants.find((p) => p.kind === 'BOT');
  if (!bot) return { error: 'Sin participante BOT.' };

  const constraints = roomSbeConstraints(bundle.room.minimum_decrement_pyg);
  const state = snapshotToAuctionState(bundleToSnapshot(bundle), atIso);
  const decision = evaluateAuctionStep(state, policy, constraints, { currentTimestampIso: atIso });
  if (decision.action !== 'BID_CANDIDATE' || decision.candidatePricePyg === null) {
    return { error: `Sin candidate para autorizar (${decision.action}/${decision.reasonCode}).` };
  }
  const machine = new AuctionBotStateMachine(policy);
  machine.startMonitoring();
  machine.beginEvaluation();
  machine.handleDecision(decision, state);
  try {
    machine.grantHumanAuthorization(profile.full_name || profile.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'No se pudo autorizar.' };
  }
  const freshAt = new Date(Date.parse(atIso) + 1).toISOString();
  const freshBundle = (await loadSandboxBundle(res.db, roomId)) ?? bundle;
  const freshState = snapshotToAuctionState(bundleToSnapshot(freshBundle), freshAt);
  const recheck = machine.recheckCandidate(freshState, { nowIso: freshAt });
  if (!recheck.valid) return { error: `Recheck falló: ${recheck.reason}` };
  let submission;
  try {
    submission = machine.startSubmission(`assist:${roomId}:v${policy.version}:${freshAt}`, { submittedAtIso: freshAt });
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Submit bloqueado.' };
  }
  try {
    const bidKey = buildBotIdempotencyKey(roomId, policy.version, state.observedAt, submission.pricePyg);
    const rpcRes = await rpcSubmit(res.db, roomId, bot.id, submission.pricePyg, freshAt, bidKey);
    if (!rpcRes.accepted) return { error: `Rechazada: ${rpcRes.rejection_message ?? rpcRes.rejection_code}` };
    machine.confirmSubmission();
    await res.db.from('auction_sandbox_rooms').update({
      bot_runtime: { ...((bundle.room.bot_runtime ?? {}) as Record<string, unknown>), pendingCandidate: null },
    }).eq('id', roomId);
    return { price: submission.pricePyg };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falló el envío.' };
  }
}

export async function setSandboxBotPaused(roomId: string, paused: boolean): Promise<{ error?: string }> {
  const res = await operatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  const { error } = await res.db.from('auction_sandbox_rooms').update({ bot_paused: paused }).eq('id', roomId);
  if (error) return { error: 'No se pudo actualizar.' };
  return {};
}

export async function finalizeSandboxRoom(roomId: string): Promise<{ error?: string }> {
  const res = await operatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  if (res.bundle.room.status === 'CLOSED') return {};
  const atIso = nowIso();
  const ranking = rankBundle(res.bundle);
  const winner = winnerOfRanking(ranking);
  await res.db.from('auction_sandbox_rooms').update({
    status: 'CLOSED',
    closed_at: atIso,
    winner_participant_id: winner?.participant_id ?? null,
  }).eq('id', roomId);
  let bundle = (await loadSandboxBundle(res.db, roomId)) ?? res.bundle;
  bundle = await appendEvent(res.db, bundle, 'AUCTION_CLOSED', { at: atIso, manual: true, total_bids: bundle.bids.length });
  await appendEvent(res.db, bundle, 'WINNER_DECLARED', winner
    ? { participant_id: winner.participant_id, alias: winner.display_alias, price_pyg: winner.price_pyg }
    : { participant_id: null });
  return {};
}

export async function regenerateSandboxLinks(roomId: string): Promise<{ competitorToken?: string; observerToken?: string; error?: string }> {
  const res = await operatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  const competitorToken = generateSandboxToken();
  const observerToken = generateSandboxToken();
  const { error } = await res.db.from('auction_sandbox_rooms').update({
    competitor_token_hash: hashSandboxToken(competitorToken),
    observer_token_hash: hashSandboxToken(observerToken),
  }).eq('id', roomId);
  if (error) return { error: 'No se pudieron regenerar los links.' };
  return { competitorToken, observerToken };
}
