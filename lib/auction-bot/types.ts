export type AuctionScopeType = 'ITEM' | 'LOT' | 'TOTAL';

export type AuctionPhase =
  | 'WAITING'
  | 'LANCES'
  | 'RANDOM'
  | 'POST_RANDOM'
  | 'CLOSED'
  | 'UNKNOWN';

export type AuctionStatus = 'OPEN' | 'PAUSED' | 'CLOSED' | 'UNKNOWN';

export type ExecutionMode = 'OBSERVE' | 'ASSISTED' | 'BOUNDED_AUTO';

export type PositionGoal =
  | { type: 'TARGET_RANK'; rank: 1 | 2 | 3 }
  | { type: 'ALWAYS_LOWEST' };

export type TimingAction = 'WAIT' | 'DEFEND_GOAL';

export interface AuctionTimingPolicy {
  /**
   * Strategy is deliberately configurable. The engine does not assume that
   * reacting immediately during the normal phase is desirable.
   */
  lancesAction: TimingAction;
  randomSafeAction: TimingAction;
  randomEntryAction: TimingAction;
  randomRiskAction: TimingAction;

  /**
   * How long before the earliest possible random close the bot is allowed to
   * enter its configured position. This is a client policy value, not an SBE
   * constant.
   */
  entryLeadMs: number;
}

export interface AuctionPolicyDraft {
  auctionId: string;
  groupId: string;
  scopeType: AuctionScopeType;
  executionMode: ExecutionMode;
  positionGoal: PositionGoal;
  timing: AuctionTimingPolicy;

  /** Price at which the client would ideally stop conceding margin. */
  targetPricePyg: number;

  /**
   * Extra economic room explicitly authorized by the client, expressed as a
   * positive percentage below targetPricePyg. Example: 2 means -2%.
   */
  autoDefenseTolerancePct: number;

  /**
   * Client-selected movement used to recover the desired position.
   * Never hardcode this in the engine.
   */
  defenseStepPyg: number;
}

export interface FrozenAuctionPolicy extends AuctionPolicyDraft {
  policyId: string;
  version: number;
  status: 'FROZEN';
  autoLimitPyg: number;
  authorizedBy: string;
  authorizedAt: string;
}

export interface RankedOffer {
  /** Position as observed in SBE. Equal prices are already ordered by SBE. */
  rank: number;
  pricePyg: number;
  isUs: boolean;
}

export interface AuctionState {
  auctionId: string;
  groupId: string;
  scopeType: AuctionScopeType;
  status: AuctionStatus;
  phase: AuctionPhase;
  phaseElapsedMs: number | null;
  observedAtMs: number;
  sourceTimestampMs?: number | null;
  rankedOffers: RankedOffer[];
}

/**
 * Technical/runtime facts learned from the concrete SBE procedure/session.
 * These are intentionally separate from client strategy.
 */
export interface AuctionRuntimeConstraints {
  maxStateAgeMs: number;
  randomMinCloseMs?: number | null;
  randomMaxCloseMs?: number | null;
  minimumValidDefenseStepPyg?: number | null;
}

export type TemporalBand =
  | 'LANCES'
  | 'RANDOM_SAFE'
  | 'RANDOM_ENTRY'
  | 'RANDOM_RISK'
  | 'OTHER';

export type ExecutionDirective =
  | 'OBSERVE_ONLY'
  | 'HUMAN_CONFIRMATION'
  | 'AUTO_SUBMIT';

export type AuctionDecision =
  | {
      kind: 'WAIT';
      reason:
        | 'TIMING_POLICY_WAIT'
        | 'POSITION_ALREADY_SATISFIED'
        | 'AUCTION_PAUSED'
        | 'NO_MARKET_REFERENCE'
        | 'PHASE_NOT_ACTIONABLE';
      temporalBand: TemporalBand;
      ourRank: number | null;
    }
  | {
      kind: 'BID_CANDIDATE';
      amountPyg: number;
      referencePricePyg: number;
      defenseStepPyg: number;
      targetRank: 1 | 2 | 3;
      ourRank: number | null;
      temporalBand: TemporalBand;
      executionDirective: ExecutionDirective;
      insideDefenseZone: boolean;
    }
  | {
      kind: 'STOP';
      reason: 'AUTO_LIMIT_REACHED' | 'AUCTION_CLOSED';
      temporalBand: TemporalBand;
      ourRank: number | null;
      candidateAmountPyg?: number;
      autoLimitPyg?: number;
    }
  | {
      kind: 'HALT';
      reason:
        | 'STATE_STALE'
        | 'STATE_UNKNOWN'
        | 'POLICY_STATE_MISMATCH'
        | 'INVALID_POLICY'
        | 'INVALID_STATE'
        | 'MISSING_RANDOM_CLOSE_CONSTRAINTS'
        | 'DEFENSE_STEP_REJECTED_BY_RUNTIME_CONSTRAINT';
      temporalBand: TemporalBand;
      details?: string;
    };
