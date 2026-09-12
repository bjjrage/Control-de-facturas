/**
 * AUCTION SANDBOX — Human override (one-shot Ground-Floor authorization).
 *
 * When the bot's required next bid crosses below the authorized Ground Floor
 * (autoLimit), the Core deterministically returns STOP/ECONOMIC_LIMIT_BREACHED
 * *with the candidate attached*. That candidate is NOT executed — instead it
 * becomes a proposal the operator explicitly DEFENDS (one exact bid) or CEDES
 * (recorded decline, prompt suppressed for that exact state).
 *
 * Invariants (enforced here + in the server actions, never in the Core):
 *  - the bot NEVER invents the price: candidate = competitor − defenseStep,
 *    re-derived from authority on every read and re-validated before submit;
 *  - an override NEVER mutates target / autoLimit / defenseStep / rank /
 *    mode / policy: it names exactly one (version, price) one-shot;
 *  - a stale candidate (market moved, version bumped, room closed) NEVER
 *    submits — validation fails closed with "state changed, refresh";
 *  - every authorization AND every decline is an audited event;
 *  - competitor/observer/comercial can never invoke (server MANAGE gate).
 */
import { runBotTick, roomSbeConstraints } from './bot-runner';
import { policyFromSnapshot } from './policies';
import {
  SandboxBid,
  SandboxParticipant,
  SandboxPolicyVersion,
  SandboxRoom,
} from './types';

/** Minimal structural bundle: SandboxBundle is assignable (no import cycle). */
export interface LimitBreachBundle {
  room: SandboxRoom;
  participants: SandboxParticipant[];
  bids: SandboxBid[];
  policies: SandboxPolicyVersion[];
}

export interface LimitBreachProposal {
  policyVersion: number;
  groundFloorPyg: number;
  competitorPricePyg: number;
  candidatePricePyg: number;
  defenseStepPyg: number;
  /** Raw ((floor − competitor) / floor) * 100; formatted client-side. */
  pctBelowGroundFloor: number;
}

export interface DeclinedLimitBreach {
  candidatePricePyg: number;
  policyVersion: number;
}

export interface LimitBreachState {
  /** Live authorization request, or null (no breach / suppressed / inactive). */
  proposal: LimitBreachProposal | null;
  /** Set only when a live proposal is suppressed by a recorded CEDER. */
  declined: DeclinedLimitBreach | null;
}

/**
 * Derives the live limit-breach state PURELY from (bundle, time): the same
 * deterministic Core evaluation the tick runs, so views stay live even while
 * the STOPPED tick gate holds ticks (monitoring continues; only auto-execution
 * is frozen). Null proposal = nothing to authorize right now.
 */
export function deriveLimitBreach(bundle: LimitBreachBundle, atIso: string): LimitBreachState {
  const none: LimitBreachState = { proposal: null, declined: null };
  if (bundle.room.status !== 'ACTIVE_NORMAL' && bundle.room.status !== 'ACTIVE_RANDOM') return none;
  if (bundle.room.bot_paused) return none;
  if (bundle.policies.length === 0) return none;
  const latest = bundle.policies[bundle.policies.length - 1];
  let policy;
  try {
    policy = policyFromSnapshot(latest);
  } catch {
    return none;
  }
  // Override is the BOUNDED_AUTO pattern: ASSISTED has its own
  // pending-candidate authorization flow; OBSERVE never bids.
  if (policy.executionMode !== 'BOUNDED_AUTO') return none;

  const { decision } = runBotTick({
    snapshot: { room: bundle.room, participants: bundle.participants, bids: bundle.bids },
    policy,
    constraints: roomSbeConstraints(bundle.room.minimum_decrement_pyg),
    nowIso: atIso,
  });
  if (
    decision.action !== 'STOP' ||
    decision.reasonCode !== 'ECONOMIC_LIMIT_BREACHED' ||
    typeof decision.candidatePricePyg !== 'number'
  ) {
    return none;
  }
  const groundFloor = policy.autoLimitPyg;
  const candidate = decision.candidatePricePyg;
  if (!(candidate < groundFloor)) return none;
  const humanPrices = bundle.bids
    .filter((b) => bundle.participants.find((p) => p.id === b.participant_id)?.kind === 'HUMAN')
    .map((b) => b.price_pyg);
  if (humanPrices.length === 0) return none;
  const competitor = Math.min(...humanPrices);
  // Defense-rule integrity: the candidate MUST be exactly competitor −
  // defenseStep. Anything else means an unexpected Core shape — no prompt.
  const step = policy.defenseStepPyg;
  if (!(Number.isInteger(step) && step > 0) || candidate !== competitor - step) return none;

  const declinedList = bundle.room.bot_runtime?.declinedLimitBreaches ?? null;
  const declinedMatch =
    declinedList?.find((d) => d.v === latest.version && d.candidate === candidate) ?? null;
  if (declinedMatch) {
    return { proposal: null, declined: { candidatePricePyg: candidate, policyVersion: latest.version } };
  }
  return {
    proposal: {
      policyVersion: latest.version,
      groundFloorPyg: groundFloor,
      competitorPricePyg: competitor,
      candidatePricePyg: candidate,
      defenseStepPyg: step,
      pctBelowGroundFloor: ((groundFloor - competitor) / groundFloor) * 100,
    },
    declined: null,
  };
}

export interface OverrideRequest {
  candidatePricePyg: number;
  policyVersion: number;
}

/**
 * Validates a DEFENDER click against a FRESHLY derived state. Any mismatch
 * (moved market, bumped version, vanished proposal, recorded decline) fails
 * closed — the operator refreshes and decides on the new proposal. Pure and
 * unit-tested; the server action derives fresh and calls this.
 */
export function validateOverrideRequest(
  fresh: LimitBreachState,
  req: OverrideRequest,
  latestVersion: number | null
): string | null {
  if (latestVersion === null) return 'Sin policy autorizada.';
  if (!Number.isInteger(req.candidatePricePyg) || req.candidatePricePyg <= 0) return 'Candidate inválido.';
  if (req.policyVersion !== latestVersion) {
    return 'La policy cambió durante la autorización. Revisá la versión actual y reintentá.';
  }
  if (fresh.declined && fresh.declined.policyVersion === req.policyVersion && fresh.declined.candidatePricePyg === req.candidatePricePyg) {
    return 'Ya registraste CEDER para este lance. Si el estado cambió, aparecerá una nueva propuesta.';
  }
  const p = fresh.proposal;
  if (!p) return 'La propuesta cambió. Recargá la sala y revisá la nueva decisión.';
  if (p.policyVersion !== req.policyVersion || p.candidatePricePyg !== req.candidatePricePyg) {
    return 'El estado cambió. Recargá la sala y revisá la nueva decisión.';
  }
  return null;
}
