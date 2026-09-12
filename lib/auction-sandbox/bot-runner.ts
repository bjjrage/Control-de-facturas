/**
 * AUCTION SANDBOX — Bot controller (uses the REAL Auction Bot Core).
 *
 * Design note: a FRESH Core state machine is built per evaluation — no
 * cross-request machine memory is needed because:
 *  - STOP/HALT/WAIT are deterministic given (state, frozen policy);
 *  - our own bid acceptance is synchronous (server RPC), so submissions are
 *    confirmed in the same tick — no RECONCILING across requests;
 *  - ASSISTED grants + pre-submit rechecks happen synchronously inside the
 *    authorize/submit server action (grant → fresh snapshot → recheck → submit).
 * The Core (lib/auction-bot) is imported, never modified, never simplified.
 */
import { evaluateAuctionStep } from '../auction-bot/engine';
import { AuctionBotStateMachine } from '../auction-bot/state-machine';
import {
  ActionDecision,
  AuctionState,
  BotLifecycleState,
  FrozenAuctionPolicy,
  SbeConstraints,
} from '../auction-bot/types';
import { snapshotToAuctionState } from './auction-state-adapter';
import { SandboxSnapshot } from './types';

export interface BotTickInput {
  snapshot: SandboxSnapshot;
  policy: FrozenAuctionPolicy;
  /** Room technical limits surfaced as SBE constraints (minimum decrement…). */
  constraints: SbeConstraints;
  /** Server instant of the snapshot read. */
  nowIso: string;
}

export interface BotTickResult {
  state: AuctionState;
  decision: ActionDecision;
  machineState: BotLifecycleState;
}

/** One deterministic evaluation round: snapshot → state → Core → decision. */
export function runBotTick(input: BotTickInput): BotTickResult {
  const state = snapshotToAuctionState(input.snapshot, input.nowIso);
  const machine = new AuctionBotStateMachine(input.policy);
  machine.startMonitoring();
  machine.beginEvaluation();
  const decision = evaluateAuctionStep(state, input.policy, input.constraints, {
    currentTimestampIso: input.nowIso,
  });
  machine.handleDecision(decision, state);
  return { state, decision, machineState: machine.getState() };
}

export interface AssistedSubmitInput extends BotTickInput {
  operatorId: string;
}

export interface AssistedSubmitPlan {
  state: AuctionState;
  decision: ActionDecision;
  machine: AuctionBotStateMachine;
}

/**
 * Rebuilds the exact pre-submit situation for an ASSISTED authorization:
 * fresh machine → evaluate → decide (must be BID_CANDIDATE). The server
 * action then calls grantHumanAuthorization → recheckCandidate(fresh) →
 * startSubmission on the returned machine. Throws when there is no candidate.
 */
export function planAssistedSubmit(input: AssistedSubmitInput): AssistedSubmitPlan {
  void input.operatorId;
  const state = snapshotToAuctionState(input.snapshot, input.nowIso);
  const machine = new AuctionBotStateMachine(input.policy);
  // The pre-submit recheck must run against the SAME constraints as the
  // original decision (Core contract) — never an implicit null.
  machine.setSbeConstraints(input.constraints);
  machine.startMonitoring();
  machine.beginEvaluation();
  const decision = evaluateAuctionStep(state, input.policy, input.constraints, {
    currentTimestampIso: input.nowIso,
  });
  if (decision.action !== 'BID_CANDIDATE' || decision.candidatePricePyg === null) {
    throw new Error(`No hay candidate para autorizar (decisión actual: ${decision.action}/${decision.reasonCode}).`);
  }
  machine.handleDecision(decision, state);
  return { state, decision, machine };
}

export interface RecheckSubmitInput {
  /**
   * Core machine with the candidate already decided AND basis bound
   * (handleDecision applied on the INITIAL authoritative snapshot).
   */
  machine: AuctionBotStateMachine;
  decision: ActionDecision;
  /** REAL fresh snapshot, read from the server AFTER the initial decision. */
  freshState: AuctionState;
  /** Server time of that fresh read (must be strictly newer in effect). */
  freshNowIso: string;
  /**
   * Transport submit, injected (Supabase RPC in production, fake in tests).
   * Called at most once, only after a valid recheck.
   */
  submit: (args: { pricePyg: number; bidId: string; submittedAtIso: string }) => Promise<{ accepted: boolean; reason?: string }>;
}

export interface RecheckSubmitResult {
  submitted: boolean;
  pricePyg?: number;
  bidId?: string;
  reason: string;
}

/**
 * Pre-submit barrier with a REAL fresh observation (F2):
 * machine.recheckCandidate(freshState) must pass — same candidate re-derived
 * from the fresh snapshot (a competitor move invalidates). Only then
 * startSubmission + a single injected submit. Never submits from a stale
 * snapshot; never invents observation times.
 */
export async function recheckAndSubmit(input: RecheckSubmitInput): Promise<RecheckSubmitResult> {
  const recheck = input.machine.recheckCandidate(input.freshState, { nowIso: input.freshNowIso });
  if (!recheck.valid) {
    return { submitted: false, reason: `Recheck inválido: ${recheck.reason}` };
  }
  let submission;
  try {
    submission = input.machine.startSubmission(
      `sandbox:${input.decision.policyVersion}:${input.freshState.auctionId}:${input.decision.candidatePricePyg}`,
      { submittedAtIso: input.freshNowIso }
    );
  } catch (e) {
    return { submitted: false, reason: e instanceof Error ? e.message : 'Submit bloqueado por el Core.' };
  }
  try {
    const res = await input.submit({
      pricePyg: submission.pricePyg,
      bidId: submission.bidId,
      submittedAtIso: submission.submittedAt,
    });
    if (!res.accepted) {
      return { submitted: false, reason: res.reason ?? 'Rechazada por el servidor.' };
    }
    return { submitted: true, pricePyg: submission.pricePyg, bidId: submission.bidId, reason: 'ok' };
  } catch (e) {
    return { submitted: false, reason: e instanceof Error ? e.message : 'Falló el envío.' };
  }
}

/** SBE constraints derived from room technical limits. */
export function roomSbeConstraints(minimumDecrementPyg: number): SbeConstraints {
  return { minimumDecrementPyg: Math.max(1, Math.floor(minimumDecrementPyg)) };
}
