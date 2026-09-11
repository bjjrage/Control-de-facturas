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

/** SBE constraints derived from room technical limits. */
export function roomSbeConstraints(minimumDecrementPyg: number): SbeConstraints {
  return { minimumDecrementPyg: Math.max(1, Math.floor(minimumDecrementPyg)) };
}
