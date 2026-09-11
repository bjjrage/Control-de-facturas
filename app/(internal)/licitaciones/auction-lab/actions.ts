'use server';

import { requireEmpresaId, requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseClient } from '@supabase/supabase-js';
import { AuctionBotStateMachine } from '@/lib/auction-bot/state-machine';
import { evaluateAuctionStep } from '@/lib/auction-bot/engine';
import { recheckAndSubmit, runBotTick, roomSbeConstraints } from '@/lib/auction-sandbox/bot-runner';
import { snapshotToAuctionState } from '@/lib/auction-sandbox/auction-state-adapter';
import { buildBotIdempotencyKey, rankBids } from '@/lib/auction-sandbox/engine';
import { buildPolicyVersionRecord, checkPolicyContinuity, policyFromSnapshot } from '@/lib/auction-sandbox/policies';
import {
  bundleToSnapshot,
  buildWatchView,
  computeNextRuntime,
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

/**
 * Write model: reads go through the RLS user client; every SEQUENCE-allocating
 * write goes through the service_role RPCs (submit/append/advance/close).
 * No app code reads or writes next_sequence (see migration-audit spec).
 *
 * AUTHORIZATION MODEL (V0): comercial = READ ONLY, administracion/admin = MANAGE.
 * - readOperatorBundle(): OPERATOR_ROLES, user/RLS client, NEVER admin.
 *   No mutation authority of any kind leaves this function.
 * - manageOperatorBundle(): MANAGE_ROLES only, user client + admin client.
 *   Every mutating action (create/start/policy/poll-with-bot/assisted/auto/
 *   pause/finalize/regenerate/advance) goes through here. The admin client is
 *   NEVER handed out after a comercial-level gate.
 */
async function readOperatorBundle(roomId: string): Promise<{ db: Db; bundle: SandboxBundle } | { error: string }> {
  const empresaId = await requireEmpresaId([...OPERATOR_ROLES]);
  const db = await createClient();
  const loaded = await loadSandboxBundle(db, roomId);
  if ('error' in loaded) return { error: loaded.error };
  if (loaded.bundle.room.empresa_id !== empresaId) return { error: 'Sala inexistente.' };
  return { db, bundle: loaded.bundle };
}

async function manageOperatorBundle(roomId: string): Promise<{ db: Db; admin: Db; bundle: SandboxBundle; empresaId: string } | { error: string }> {
  const empresaId = await requireEmpresaId([...MANAGE_ROLES]);
  const db = await createClient();
  const loaded = await loadSandboxBundle(db, roomId);
  if ('error' in loaded) return { error: loaded.error };
  if (loaded.bundle.room.empresa_id !== empresaId) return { error: 'Sala inexistente.' };
  return { db, admin: createAdminClient(), bundle: loaded.bundle, empresaId };
}



/** Phase heartbeat via the atomic advance RPC, then a fresh authoritative reload. */
async function advanceRoom(admin: Db, db: Db, roomId: string): Promise<{ bundle: SandboxBundle } | { error: string }> {
  const { error } = await admin.rpc('advance_sandbox_room', { p_room_id: roomId });
  if (error) return { error: `No se pudo avanzar la sala (${error.code ?? 'rpc-error'}).` };
  return loadSandboxBundle(db, roomId);
}

async function appendEvent(admin: Db, roomId: string, type: string, payload: Record<string, unknown>): Promise<number | null> {
  const { data, error } = await admin.rpc('append_sandbox_event', { p_room_id: roomId, p_type: type, p_payload: payload });
  if (error) return null;
  return (data as { ok: boolean; sequence?: number })?.sequence ?? null;
}

type RpcResult = { accepted: boolean; duplicate?: boolean; bid_id?: string; sequence?: number; rejection_code?: string; rejection_message?: string };

/** Bid submit ALWAYS through the service_role RPC (server clock, no client time). */
async function rpcSubmit(
  admin: Db,
  roomId: string,
  participantId: string,
  pricePyg: number,
  idempotencyKey: string | null
): Promise<RpcResult> {
  const { data, error } = await admin.rpc('submit_sandbox_bid', {
    p_room_id: roomId,
    p_participant_id: participantId,
    p_price_pyg: pricePyg,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw new Error(`submit_sandbox_bid: ${error.message}`);
  return data as RpcResult;
}

// ---------------------------------------------------------------------------
// Bot tick (BOUNDED_AUTO auto-submit; other modes only observe/record).
// ---------------------------------------------------------------------------

async function botTick(admin: Db, db: Db, bundle: SandboxBundle, atIso: string): Promise<SandboxBundle> {
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

  if (changed) {
    await appendEvent(admin, bundle.room.id, 'BOT_DECISION', {
      action: decision.action,
      reasonCode: decision.reasonCode,
      reasonDescription: decision.reasonDescription,
      candidatePricePyg: decision.candidatePricePyg,
      targetRank: decision.targetRank,
      policyVersion: decision.policyVersion,
      executionMode: decision.executionMode,
      machineState,
    });
    if (decision.action === 'STOP') {
      await appendEvent(admin, bundle.room.id, 'BOT_STOPPED', { reasonCode: decision.reasonCode, policyVersion: decision.policyVersion });
    }
  }

  // Single coherent bot_runtime write per tick (F-A2): status + pending
  // candidate are assembled pure-first, then persisted exactly once.
  const assistedCandidate =
    policy.executionMode === 'ASSISTED' && decision.action === 'BID_CANDIDATE' && decision.candidatePricePyg !== null
      ? {
          pricePyg: decision.candidatePricePyg,
          basisObservedAt: decision.evaluatedAt,
          policyVersion: decision.policyVersion,
          decidedAt: atIso,
        }
      : null;
  const nextRuntime = computeNextRuntime(runtime, decision, assistedCandidate);
  await db.from('auction_sandbox_rooms').update({ bot_runtime: nextRuntime }).eq('id', bundle.room.id);
  const next: SandboxBundle = { ...bundle, room: { ...bundle.room, bot_runtime: nextRuntime } };

  if (assistedCandidate) {
    const assistedReload = await loadSandboxBundle(db, bundle.room.id);
    return 'error' in assistedReload ? next : assistedReload.bundle;
  }

  if (policy.executionMode === 'BOUNDED_AUTO' && decision.action === 'BID_CANDIDATE' && decision.candidatePricePyg !== null) {
    await botAutoSubmit(admin, db, next, policy, decision.candidatePricePyg, decision.evaluatedAt, atIso);
  }
  // Return the freshest authoritative bundle; fall back to the tick input
  // (fully loaded seconds ago) only when the reload itself fails.
  const reloaded = await loadSandboxBundle(db, bundle.room.id);
  return 'error' in reloaded ? next : reloaded.bundle;
}

/** Guarded BOUNDED_AUTO submit: initial decision, then a REAL fresh reload before any submit. */
async function botAutoSubmit(
  admin: Db,
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

  // Initial authoritative evaluation → candidate (binds the basis).
  const machine = new AuctionBotStateMachine(policy);
  machine.startMonitoring();
  machine.beginEvaluation();
  const state0 = snapshotToAuctionState(bundleToSnapshot(bundle), atIso);
  const decision = evaluateAuctionStep(state0, policy, constraints, { currentTimestampIso: atIso });
  if (decision.action !== 'BID_CANDIDATE' || decision.candidatePricePyg !== candidatePricePyg) return;
  machine.handleDecision(decision, state0);

  // REAL fresh re-observation: confirm the phase through the authoritative
  // advance RPC FIRST (bonus) — never run the bot against an unconfirmed
  // phase — then re-read Supabase AFTER the decision, then recheck.
  // A competitor move invalidates — never submit off the old snapshot.
  const advanced = await advanceRoom(admin, db, bundle.room.id);
  if ('error' in advanced) return; // phase unconfirmed → NO SUBMIT
  const freshAt = new Date().toISOString();
  const freshBundle = advanced.bundle;
  const freshState = snapshotToAuctionState(bundleToSnapshot(freshBundle), freshAt);
  const bidKey = buildBotIdempotencyKey(bundle.room.id, policy.version, basisObservedAt, candidatePricePyg);

  const result = await recheckAndSubmit({
    machine,
    decision,
    freshState,
    freshNowIso: freshAt,
    submit: async ({ pricePyg }) => {
      try {
        const res = await rpcSubmit(admin, bundle.room.id, bot.id, pricePyg, bidKey);
        return res.accepted ? { accepted: true } : { accepted: false, reason: res.rejection_message ?? res.rejection_code };
      } catch (e) {
        return { accepted: false, reason: e instanceof Error ? e.message : 'RPC failed' };
      }
    },
  });
  if (result.submitted) {
    try {
      machine.confirmSubmission();
    } catch {
      // Already resolved; next tick re-evaluates from authority.
    }
  }
  // Business rejection / transport failure: no confirm, no blind retry.
  // The next tick re-evaluates from the authoritative snapshot.
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

/** Heartbeat: atomic advance + one bot tick + operator view. Fail-closed on reads. */
export async function pollOperatorRoom(roomId: string): Promise<{ view?: OperatorView; error?: string }> {
  const res = await manageOperatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  const advanced = await advanceRoom(res.admin, res.db, roomId);
  if ('error' in advanced) return { error: advanced.error };
  const bundle = await botTick(res.admin, res.db, advanced.bundle, nowIso());
  return { view: toOperatorView(bundle, nowIso()) };
}

/**
 * READ-ONLY view for comercial: loads state only — no advance, no bot tick,
 * no privileged RPC, no admin client. Phases may lag until a manager's
 * heartbeat (or any token poll) advances them.
 */
export async function getOperatorRoomState(roomId: string): Promise<{ view?: OperatorView; error?: string }> {
  const res = await readOperatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  return { view: toOperatorView(res.bundle, nowIso()) };
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
  // ROOM_CREATED goes through the authoritative event allocator (admin RPC):
  // direct inserts have no RLS grant and would fail silently.
  const admin = createAdminClient();
  const { error: eventError } = await admin.rpc('append_sandbox_event', {
    p_room_id: roomId,
    p_type: 'ROOM_CREATED',
    p_payload: { title },
  });
  if (eventError) return { error: 'Sala creada pero sin evento inicial.' };
  return { roomId, competitorToken, observerToken };
}

export async function startSandboxRoom(roomId: string): Promise<{ error?: string }> {
  const res = await manageOperatorBundle(roomId);
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
  await appendEvent(res.admin, roomId, 'AUCTION_STARTED', { at: nowIso() });
  return {};
}

export async function authorizeSandboxPolicy(
  roomId: string,
  draft: AuctionPolicy,
  authorizedBy: string
): Promise<{ version?: number; error?: string }> {
  const res = await manageOperatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  const room = res.bundle.room;
  const prev = res.bundle.policies.length > 0 ? res.bundle.policies[res.bundle.policies.length - 1] : null;
  const nextVersion = prev ? prev.version + 1 : 1;
  const who = authorizedBy.trim();
  if (!who) return { error: 'Indicá quién autoriza.' };

  // Canonical server-side binding: NEVER trust browser identity fields.
  // v1 policyId is server-assigned (stable per room); v2+ must keep it.
  const boundDraft: AuctionPolicy = {
    ...draft,
    auctionId: room.id,
    groupId: room.group_id,
    scope: room.scope,
    authorizedBy: who,
    policyId: prev ? prev.policy_id : `pol-sandbox-${room.id.slice(0, 8)}`,
  };
  const continuity = checkPolicyContinuity({
    roomId: room.id,
    roomGroupId: room.group_id,
    roomScope: room.scope,
    prev: prev ? { version: prev.version, policy_id: prev.policy_id } : null,
    draft: boundDraft,
    version: nextVersion,
    authorizedBy: who,
  });
  if (continuity.length > 0) return { error: continuity.join(' ') };

  let record;
  try {
    record = buildPolicyVersionRecord(roomId, boundDraft, nextVersion, who, nowIso());
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Política inválida.' };
  }
  const { error } = await res.db.from('auction_sandbox_policy_versions').insert(record);
  if (error) {
    if (error.code === '23505') return { error: 'Versión duplicada: reintentá.' };
    return { error: 'No se pudo persistir la policy.' };
  }
  await appendEvent(res.admin, roomId, 'POLICY_AUTHORIZED', {
    version: nextVersion,
    policy_id: record.policy_id,
    fingerprint: record.fingerprint,
    authorized_by: record.authorized_by,
  });
  // A new version invalidates any ASSISTED pending candidate.
  await res.db.from('auction_sandbox_rooms').update({
    bot_runtime: { ...((room.bot_runtime ?? {}) as Record<string, unknown>), pendingCandidate: null },
  }).eq('id', roomId);
  return { version: nextVersion };
}

/** ASSISTED: grant → fresh snapshot → recheck → submit, all in one server action. */
export async function authorizeAssistedBid(roomId: string): Promise<{ price?: number; error?: string }> {
  const res = await manageOperatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  const profile = await requireProfile([...MANAGE_ROLES]);
  const atIso = nowIso();
  const advanced = await advanceRoom(res.admin, res.db, roomId);
  if ('error' in advanced) return { error: advanced.error };
  let bundle = advanced.bundle;
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
  // REAL fresh re-observation: advance + re-read Supabase AFTER the decision.
  // The grant stays bound to the initial candidate; if the market moved, the
  // recheck invalidates and nothing is submitted. Advance failure → no submit.
  const refreshed = await advanceRoom(res.admin, res.db, roomId);
  if ('error' in refreshed) return { error: refreshed.error };
  const freshBundle = refreshed.bundle;
  const freshAt = new Date().toISOString();
  const freshState = snapshotToAuctionState(bundleToSnapshot(freshBundle), freshAt);
  const bidKey = buildBotIdempotencyKey(roomId, policy.version, state.observedAt, decision.candidatePricePyg);
  const result = await recheckAndSubmit({
    machine,
    decision,
    freshState,
    freshNowIso: freshAt,
    submit: async ({ pricePyg }) => {
      try {
        const rpcRes = await rpcSubmit(res.admin, roomId, bot.id, pricePyg, bidKey);
        return rpcRes.accepted ? { accepted: true } : { accepted: false, reason: rpcRes.rejection_message ?? rpcRes.rejection_code };
      } catch (e) {
        return { accepted: false, reason: e instanceof Error ? e.message : 'Falló el envío.' };
      }
    },
  });
  if (!result.submitted) return { error: result.reason };
  try {
    machine.confirmSubmission();
  } catch {
    return { error: 'No se pudo confirmar el envío.' };
  }
  await res.db.from('auction_sandbox_rooms').update({
    bot_runtime: { ...((bundle.room.bot_runtime ?? {}) as Record<string, unknown>), pendingCandidate: null },
  }).eq('id', roomId);
  return { price: result.pricePyg };
}

export async function setSandboxBotPaused(roomId: string, paused: boolean): Promise<{ error?: string }> {
  const res = await manageOperatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  const { error } = await res.db.from('auction_sandbox_rooms').update({ bot_paused: paused }).eq('id', roomId);
  if (error) return { error: 'No se pudo actualizar.' };
  return {};
}

export async function finalizeSandboxRoom(roomId: string): Promise<{ error?: string }> {
  const res = await manageOperatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  if (res.bundle.room.status === 'CLOSED') return {};
  // Atomic manual close (winner + AUCTION_CLOSED + WINNER_DECLARED coherent).
  const { error } = await res.admin.rpc('force_close_sandbox_room', { p_room_id: roomId });
  if (error) return { error: 'No se pudo finalizar la sala.' };
  return {};
}

export async function regenerateSandboxLinks(roomId: string): Promise<{ competitorToken?: string; observerToken?: string; error?: string }> {
  const res = await manageOperatorBundle(roomId);
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
