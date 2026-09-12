'use server';

import { requireEmpresaId, requireProfile } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { SupabaseClient } from '@supabase/supabase-js';
import { AuctionBotStateMachine } from '@/lib/auction-bot/state-machine';
import { evaluateAuctionStep } from '@/lib/auction-bot/engine';
import { recheckAndSubmit, runBotTick, roomSbeConstraints } from '@/lib/auction-sandbox/bot-runner';
import { snapshotToAuctionState } from '@/lib/auction-sandbox/auction-state-adapter';
import { buildAssistedIdempotencyKey, buildBotIdempotencyKey, rankBids } from '@/lib/auction-sandbox/engine';
import { buildPolicyVersionRecord, checkPolicyContinuity, policyFromSnapshot, samePolicyContent } from '@/lib/auction-sandbox/policies';
import {
  bundleToSnapshot,
  buildWatchView,
  botTickSkipReason,
  computeNextRuntime,
  isVersionSuperseded,
  loadSandboxBundle,
  missingInitialEvents,
  missingPolicyEvents,
  missingStoppedEvents,
  policyVersionSuperseded,
  publicRoomInfo,
  rankBundle,
  refuseIfRoomClosed,
  shouldEmitDecision,
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

/**
 * Self-healing for birth + policy events (ROOM_CREATED / AUCTION_STARTED /
 * POLICY_AUTHORIZED): when the loaded history provably starts at birth (see
 * missingInitialEvents / missingPolicyEvents) yet an event is absent — i.e.
 * its write failed while the state transition committed — the next heartbeat
 * backfills it. Never duplicates: absence is only acted upon with proof.
 */
async function ensureInitialEvents(admin: Db, bundle: SandboxBundle): Promise<void> {
  const missing = missingInitialEvents(bundle);
  for (const type of missing) {
    await appendEvent(admin, bundle.room.id, type, {
      at: type === 'ROOM_CREATED' ? bundle.room.created_at : (bundle.room.started_at ?? new Date().toISOString()),
      backfilled: true,
    });
  }
  const byVersion = new Map(bundle.policies.map((p) => [p.version, p]));
  for (const version of missingPolicyEvents(bundle)) {
    const rec = byVersion.get(version);
    if (!rec) continue;
    await appendEvent(admin, bundle.room.id, 'POLICY_AUTHORIZED', {
      version,
      policy_id: rec.policy_id,
      fingerprint: rec.fingerprint,
      authorized_by: rec.authorized_by,
      backfilled: true,
    });
  }
  // Terminal-marker backfill: a STOP decision committed while its BOT_STOPPED
  // write failed would otherwise leave the timeline permanently headless (the
  // dedupe gate never re-enters the emission branch). Convergent: absence is
  // proved under the completeness rule, and a concurrent duplicate is
  // timeline spam at worst (never economic: the STOP gate already holds).
  for (const version of missingStoppedEvents(bundle)) {
    await appendEvent(admin, bundle.room.id, 'BOT_STOPPED', {
      reasonCode: bundle.room.bot_runtime?.lastBotStatus?.reasonCode ?? 'UNKNOWN',
      policyVersion: version,
      backfilled: true,
    });
  }
}

type RpcResult = { accepted: boolean; duplicate?: boolean; bid_id?: string; sequence?: number; rejection_code?: string; rejection_message?: string };

/**
 * Lightweight pre-submit policy re-read: latest version ONLY (one indexed
 * row, no full bundle). Used inside submit closures as the last-millimetre
 * continuity check — a version authorized between the fresh reload and the
 * submit still aborts. Residual single-read→RPC TOCTOU is documented and
 * accepted (the submit RPC itself is the final atomic step).
 */
async function latestPolicyVersion(db: Db, roomId: string): Promise<number | null> {
  const { data, error } = await db
    .from('auction_sandbox_policy_versions')
    .select('version')
    .eq('room_id', roomId)
    .order('version', { ascending: false })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const v = (data[0] as { version?: unknown }).version;
  return typeof v === 'number' ? v : null;
}

/** Bid submit ALWAYS through the service_role RPC (server clock, no client time). */
async function rpcSubmit(
  admin: Db,
  roomId: string,
  participantId: string,
  pricePyg: number,
  idempotencyKey: string | null,
  expectedPolicyVersion?: number | null
): Promise<RpcResult> {
  const { data, error } = await admin.rpc('submit_sandbox_bid', {
    p_room_id: roomId,
    p_participant_id: participantId,
    p_price_pyg: pricePyg,
    p_idempotency_key: idempotencyKey,
    // Policy binding (0070): bot/assisted submits carry the authorizing
    // version; the RPC rejects when a newer version exists. Human submits
    // pass nothing (not policy-bound). Requires migration 0070 applied.
    ...(expectedPolicyVersion !== undefined && expectedPolicyVersion !== null
      ? { p_expected_policy_version: expectedPolicyVersion }
      : {}),
  });
  if (error) throw new Error(`submit_sandbox_bid: ${error.message}`);
  return data as RpcResult;
}

// ---------------------------------------------------------------------------
// Bot tick (BOUNDED_AUTO auto-submit; other modes only observe/record).
// ---------------------------------------------------------------------------

async function botTick(admin: Db, db: Db, bundle: SandboxBundle, atIso: string): Promise<SandboxBundle> {
  // Every skip (paused / no policy / inactive / STOP-terminal per version)
  // lives in one pure, tested helper — the tick never evaluates when skipped.
  if (botTickSkipReason(bundle) !== null) return bundle;

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

  // Emit only when the freshly loaded bundle has no identical decision yet:
  // covers the event-committed/runtime-lost split without duplicating.
  // If the event write fails, skip the runtime update as well: the next tick
  // recomputes from the authoritative bundle and retries both together.
  if (changed && shouldEmitDecision(bundle, decision)) {
    const decisionSeq = await appendEvent(admin, bundle.room.id, 'BOT_DECISION', {
      action: decision.action,
      reasonCode: decision.reasonCode,
      reasonDescription: decision.reasonDescription,
      candidatePricePyg: decision.candidatePricePyg,
      targetRank: decision.targetRank,
      policyVersion: decision.policyVersion,
      executionMode: decision.executionMode,
      machineState,
    });
    if (decisionSeq === null) return bundle;
    if (decision.action === 'STOP') {
      const stoppedSeq = await appendEvent(admin, bundle.room.id, 'BOT_STOPPED', { reasonCode: decision.reasonCode, policyVersion: decision.policyVersion });
      if (stoppedSeq === null) return bundle;
    }
  }

  // Single coherent bot_runtime write per tick (F-A2): status + pending
  // candidate are assembled pure-first, then persisted exactly once — and
  // only when something actually changed (narrows cross-tab LWW + DB load).
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
  let next = bundle;
  if (JSON.stringify(nextRuntime) !== JSON.stringify(runtime)) {
    const { error: runtimeError } = await db
      .from('auction_sandbox_rooms')
      .update({ bot_runtime: nextRuntime })
      .eq('id', bundle.room.id);
    // A failed runtime write is non-fatal: the next tick recomputes from the
    // authoritative bundle (and shouldEmitDecision prevents event dupes).
    if (!runtimeError) {
      next = { ...bundle, room: { ...bundle.room, bot_runtime: nextRuntime } };
    }
  }

  if (assistedCandidate) {
    const assistedReload = await loadSandboxBundle(db, bundle.room.id);
    return 'error' in assistedReload ? next : assistedReload.bundle;
  }

  if (policy.executionMode === 'BOUNDED_AUTO' && decision.action === 'BID_CANDIDATE' && decision.candidatePricePyg !== null) {
    await botAutoSubmit(admin, db, next, policy, decision.candidatePricePyg, atIso);
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
  atIso: string
): Promise<void> {
  const bot = bundle.participants.find((p) => p.kind === 'BOT');
  if (!bot) return;
  const constraints = roomSbeConstraints(bundle.room.minimum_decrement_pyg);

  // Initial authoritative evaluation → candidate (binds the basis).
  const machine = new AuctionBotStateMachine(policy);
  // Rechecks must run against the SAME constraints (Core contract).
  machine.setSbeConstraints(constraints);
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
  // Policy continuity: a version authorized mid-flight (e.g. a tighter
  // autoLimit) invalidates this candidate — fail closed, the next tick
  // re-evaluates under the current version. Never submit off a superseded
  // policy (the RPC does not enforce autoLimit).
  if (policyVersionSuperseded(freshBundle, policy.version)) return;
  const freshState = snapshotToAuctionState(bundleToSnapshot(freshBundle), freshAt);
  const bidKey = buildBotIdempotencyKey(bundle.room.id, policy.version, candidatePricePyg);
  // A pause landing mid-flight stops the submit: pausing must take effect
  // ASAP, and the next tick re-evaluates (PAUSED skip) anyway.
  if (freshBundle.room.bot_paused) return;

  const result = await recheckAndSubmit({
    machine,
    decision,
    freshState,
    freshNowIso: freshAt,
    submit: async ({ pricePyg }) => {
      // Last-millimetre continuity: re-read the latest version right before
      // the irreversible submit (see latestPolicyVersion).
      if (isVersionSuperseded(await latestPolicyVersion(db, bundle.room.id), policy.version)) {
        return { accepted: false, reason: 'La policy cambió durante el envío.' };
      }
      try {
        const res = await rpcSubmit(admin, bundle.room.id, bot.id, pricePyg, bidKey, policy.version);
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
  // A stored candidate is only shown when bound to the ACTIVE version: a
  // version upgrade (or a stale write) must never offer authorizing old economics.
  const storedPending = (runtime.pendingCandidate as OperatorView['bot']['pendingCandidate']) ?? null;
  const pendingCandidate =
    storedPending && latest && storedPending.policyVersion === latest.version ? storedPending : null;
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
      pendingCandidate,
    },
    activePolicy,
    watch: buildWatchView(bundle, atIso),
  };
}

/** Heartbeat: atomic advance + one bot tick + operator view. Fail-closed on reads. */
export async function pollOperatorRoom(roomId: string): Promise<{ view?: OperatorView; error?: string }> {
  const res = await manageOperatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  // Terminal rooms degrade to a read-only refresh: CLOSED is monotonic, so
  // there is nothing left to advance or tick — but backfills still heal and
  // the result board still converges. (Token consoles stop entirely; the
  // operator keeps a cheap read so post-mortem review stays live.)
  if (res.bundle.room.status === 'CLOSED') {
    await ensureInitialEvents(res.admin, res.bundle);
    // Re-read so backfilled markers (and any coincident tail) are visible
    // immediately instead of lagging one heartbeat; fall back to the
    // pre-backfill bundle when the reload itself fails (fail-closed read).
    const fresh = await loadSandboxBundle(res.db, roomId);
    return { view: toOperatorView('bundle' in fresh ? fresh.bundle : res.bundle, nowIso()) };
  }
  const advanced = await advanceRoom(res.admin, res.db, roomId);
  if ('error' in advanced) return { error: advanced.error };
  await ensureInitialEvents(res.admin, advanced.bundle);
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
  // Participants must both exist or the room is bricked: compensate by
  // deleting the room (cascade) instead of returning half-built state.
  const { error: participantsError } = await db.from('auction_sandbox_participants').insert([
    { room_id: roomId, kind: 'BOT', display_alias: 'Nuestro Bot' },
    { room_id: roomId, kind: 'HUMAN', display_alias: 'Competidor' },
  ]);
  if (participantsError) {
    // Compensation must bypass RLS: the user client has no rooms DELETE
    // grant, so deleting through it silently persists a half-built room.
    await createAdminClient().from('auction_sandbox_rooms').delete().eq('id', roomId);
    return { error: 'No se pudo crear la sala (participantes).' };
  }
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
  // Conditional write + rowcount check: two concurrent starts cannot both
  // win, so AUCTION_STARTED is emitted exactly once (checked below).
  const { data: started, error } = await res.db
    .from('auction_sandbox_rooms')
    .update({ status: 'ACTIVE_NORMAL', started_at: atIso })
    .eq('id', roomId)
    .eq('status', 'DRAFT')
    .select('id');
  if (error) return { error: 'No se pudo iniciar la sala.' };
  if (!started || started.length !== 1) {
    return { error: 'La sala ya fue iniciada o cambió de estado.' };
  }
  // The transition committed; a failed event write must surface (the
  // heartbeat backfills a provably-missing AUCTION_STARTED via
  // ensureInitialEvents, so this never silently diverges forever).
  const startedSeq = await appendEvent(res.admin, roomId, 'AUCTION_STARTED', { at: nowIso() });
  if (startedSeq === null) return { error: 'Sala iniciada, pero falló el registro del evento. Recargá la sala.' };
  return {};
}

export async function authorizeSandboxPolicy(
  roomId: string,
  draft: AuctionPolicy,
  _authorizedBy: string
): Promise<{ version?: number; error?: string }> {
  const res = await manageOperatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  const room = res.bundle.room;
  // A closed auction takes no new policy versions: authorizing one would
  // inflate the version chain and timeline with zero economic effect.
  const closedPolicyRefusal = refuseIfRoomClosed(room.status);
  if (closedPolicyRefusal) return { error: closedPolicyRefusal };
  const prev = res.bundle.policies.length > 0 ? res.bundle.policies[res.bundle.policies.length - 1] : null;
  const nextVersion = prev ? prev.version + 1 : 1;
  // Audit identity comes from the logged-in operator, NEVER from the browser:
  // a client-supplied authorizedBy is spoofable and is therefore ignored.
  const profile = await requireProfile([...MANAGE_ROLES]);
  const who = profile.full_name?.trim() || profile.id;
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
  // Retry idempotency: identical content to the latest version returns it
  // instead of inflating a duplicate vN+1 (e.g. double-click / retry after
  // a partial failure that already committed the row).
  if (prev) {
    try {
      const prevPolicy = policyFromSnapshot(prev);
      if (samePolicyContent(prevPolicy, boundDraft)) {
        return { version: prev.version };
      }
    } catch {
      // Corrupt snapshot: fall through and version up normally.
    }
  }
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
  // Both follow-ups are checked: a persisted policy without its event or
  // without the candidate invalidation would silently diverge.
  const policySeq = await appendEvent(res.admin, roomId, 'POLICY_AUTHORIZED', {
    version: nextVersion,
    policy_id: record.policy_id,
    fingerprint: record.fingerprint,
    authorized_by: record.authorized_by,
  });
  const { error: clearError } = await res.db.from('auction_sandbox_rooms').update({
    // A new version invalidates any ASSISTED pending candidate.
    bot_runtime: { ...((room.bot_runtime ?? {}) as Record<string, unknown>), pendingCandidate: null },
  }).eq('id', roomId);
  if (policySeq === null || clearError) {
    return { error: `Policy v${nextVersion} guardada, pero falló la registración (evento/limpieza). Revisá el timeline antes de operar.` };
  }
  return { version: nextVersion };
}

/** ASSISTED: grant → fresh snapshot → recheck → submit, all in one server action. */
export async function authorizeAssistedBid(roomId: string): Promise<{ price?: number; error?: string }> {
  const res = await manageOperatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  // Authorizing into a closed auction is incoherent (the Core would STOP on
  // the CLOSED state anyway): fail fast with a clear message instead of a
  // confusing "sin candidate" error after wasted RPCs.
  const closedBidRefusal = refuseIfRoomClosed(res.bundle.room.status);
  if (closedBidRefusal) return { error: closedBidRefusal };
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
  // Rechecks must run against the SAME constraints (Core contract).
  machine.setSbeConstraints(constraints);
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
  // Policy continuity across the grant→recheck window: a version authorized
  // mid-flight invalidates the granted candidate (it could breach the new
  // autoLimit). Fail closed — the operator retries under the current version.
  if (policyVersionSuperseded(freshBundle, policy.version)) {
    return { error: 'La policy cambió durante la autorización. Revisá la versión actual y reintentá.' };
  }
  const freshAt = new Date().toISOString();
  const freshState = snapshotToAuctionState(bundleToSnapshot(freshBundle), freshAt);
  // STABLE key per (room, version, price): concurrent authorizations of the
  // SAME candidate dedupe in the RPC instead of double-submitting. (Never
  // bind wall-clock here: time-varying keys defeat idempotency.)
  const bidKey = buildAssistedIdempotencyKey(roomId, policy.version, decision.candidatePricePyg);
  const result = await recheckAndSubmit({
    machine,
    decision,
    freshState,
    freshNowIso: freshAt,
    submit: async ({ pricePyg }) => {
      // Last-millimetre continuity (see botAutoSubmit): a version landing
      // between the refresh and this submit still aborts with an
      // operator-actionable message. (Neutral wording: a failed re-read
      // aborts the same way as a genuine change — fail closed either way.)
      if (isVersionSuperseded(await latestPolicyVersion(res.db, roomId), policy.version)) {
        return { accepted: false, reason: 'No se pudo confirmar la versión actual de la policy. Reintentá.' };
      }
      try {
        const rpcRes = await rpcSubmit(res.admin, roomId, bot.id, pricePyg, bidKey, policy.version);
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
  // Display-only cleanup (best-effort, checked): spread the FRESHEST runtime
  // (freshBundle, not the action-input bundle) so a tick write landing
  // mid-flight (e.g. a fresh STOP marker) is not clobbered for a heartbeat.
  // The submit path re-derived everything from the current policy, and the
  // next tick recomputes the proposal box from scratch — so a failed clear
  // converges on its own. Never fail an executed economic action over display.
  await res.db.from('auction_sandbox_rooms').update({
    bot_runtime: { ...((freshBundle.room.bot_runtime ?? {}) as Record<string, unknown>), pendingCandidate: null },
  }).eq('id', roomId);
  return { price: result.pricePyg };
}

export async function setSandboxBotPaused(roomId: string, paused: boolean): Promise<{ error?: string }> {
  const res = await manageOperatorBundle(roomId);
  if ('error' in res) return { error: res.error };
  // Terminal rooms take no state flips: an in-flight click landing after
  // CLOSE (or a direct call) must not silently pollute a CLOSED room with an
  // untraced bot_paused flip. Same pattern as the other manage mutations.
  const closedPauseRefusal = refuseIfRoomClosed(res.bundle.room.status);
  if (closedPauseRefusal) return { error: closedPauseRefusal };
  const { data, error } = await res.db.from('auction_sandbox_rooms').update({ bot_paused: paused }).eq('id', roomId).select('id');
  if (error || !data || data.length !== 1) return { error: 'No se pudo actualizar.' };
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
  // Post-mortem regeneration would silently invalidate the observer links
  // someone may be using to review the finished room.
  const closedLinksRefusal = refuseIfRoomClosed(res.bundle.room.status);
  if (closedLinksRefusal) return { error: closedLinksRefusal };
  const competitorToken = generateSandboxToken();
  const observerToken = generateSandboxToken();
  const { data, error } = await res.db.from('auction_sandbox_rooms').update({
    competitor_token_hash: hashSandboxToken(competitorToken),
    observer_token_hash: hashSandboxToken(observerToken),
  }).eq('id', roomId).select('id');
  if (error || !data || data.length !== 1) return { error: 'No se pudieron regenerar los links.' };
  return { competitorToken, observerToken };
}
