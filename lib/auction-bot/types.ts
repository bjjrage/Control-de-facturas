/**
 * SBE AUCTION BOT - Core Domain Types (Sanitized V0 + MIPYME Last Chance)
 * 100% Deterministic runtime types.
 * Decoupled from DOM, Playwright, and external procurement modules.
 */

export type AuctionScope = 'ITEM' | 'LOT' | 'TOTAL';

export type AuctionPhase =
  | 'PRE_AUCTION'
  | 'NORMAL_BIDDING'     // Fase de lances
  | 'RANDOM_CLOSE'       // Fase aleatoria
  | 'POST_RANDOM'        // Etapa posterior a la fase aleatoria (posible beneficio MIPYME)
  | 'PAUSED'
  | 'CLOSED'
  | 'UNKNOWN';

export type TimingWindow =
  | 'SAFE_WINDOW'         // Random phase: cannot close yet
  | 'ENTRY_WINDOW'        // Prior to first possible close: repositioning
  | 'CLOSE_RISK_WINDOW'   // Close could happen at any instant (closeRisk = true)
  | 'EXPIRED'
  | 'NOT_APPLICABLE';

/**
 * Pure Position Goals (Independent from timing).
 * Defines strictly which rank position is targeted.
 */
export type PositionStrategyId =
  | 'TARGET_RANK_1'
  | 'TARGET_TOP_2'
  | 'TARGET_TOP_3'
  // Backward-compatible aliases
  | 'MAINTAIN_RANK_1'
  | 'MAINTAIN_TOP_2'
  | 'MAINTAIN_TOP_3';

export type NormalPhaseBehavior = 'WAIT' | 'ACTIVE';

export type SafeWindowBehavior = 'WAIT' | 'ACTIVE';

export type ExecutionMode = 'OBSERVE' | 'ASSISTED' | 'BOUNDED_AUTO';

export type MipymeEconomicLimitMode = 'USE_CURRENT_AUTO_LIMIT';

export interface MipymePolicyConfig {
  enabled: boolean;
  executionMode: ExecutionMode;
  defenseStepPyg: number; // Explicitly modeled positive integer PYG (> 0)
  economicLimitMode: MipymeEconomicLimitMode;
}

export interface AuctionPolicy {
  policyId: string;
  auctionId: string;
  groupId: string;
  scope: AuctionScope;
  
  // Position Strategy (Pure position goal)
  positionStrategy: PositionStrategyId;
  targetRank: number; // 1, 2, 3...
  defenseStepPyg: number; // Free positive integer PYG (> 0)
  
  // Timing Strategy (Pure temporal behavior)
  normalPhaseBehavior: NormalPhaseBehavior;
  safeWindowBehavior: SafeWindowBehavior;
  enterTargetPositionInEntryWindow: boolean;
  defendImmediatelyInCloseRisk: boolean;

  // Economic Policy (Integer arithmetic via Basis Points: 1% = 100 bps)
  targetPricePyg: number;
  autoDefenseToleranceBps: number; // e.g. 200 bps = 2.00%, 150 bps = 1.50%
  autoLimitPyg: number; // Derived integer floor: (targetPricePyg * (10000 - bps)) / 10000

  // MIPYME Last Chance Policy (Special stage configuration)
  mipymePolicy: MipymePolicyConfig;

  // Operational limits & Authorization
  executionMode: ExecutionMode;
  maxStalenessMs: number;
  authorizedBy: string; // User / Operator who authorized this policy
}

export interface FrozenAuctionPolicy extends AuctionPolicy {
  isFrozen: true;
  version: number;
  authorizedAt: string; // ISO string of authorization
  policyFingerprint: string; // Technical non-cryptographic snapshot fingerprint
}

export interface RankedOffer {
  rank: number;
  participantId: string;
  isOurOffer: boolean;
  pricePyg: number;
  timestamp: string; // ISO string
}

export type MipymeBenefitStatus =
  | 'NOT_APPLICABLE'
  | 'AVAILABLE'
  | 'UNAVAILABLE'
  | 'UNKNOWN';

export interface PostRandomState {
  mipymeBenefitStatus: MipymeBenefitStatus;
  deadlineMs?: number | null;
  ourFinalRank?: number | null;
  bestPricePyg?: number | null;
}

export interface AuctionState {
  auctionId: string;
  groupId: string;
  scope: AuctionScope;
  phase: AuctionPhase;
  timingWindow: TimingWindow;
  closeRisk: boolean;
  status: 'ACTIVE' | 'PAUSED' | 'CLOSED' | 'UNKNOWN';
  rankedOffers: RankedOffer[];
  ourRank: number | null;
  ourCurrentPricePyg: number | null;
  observedAt: string; // ISO string
  phaseElapsedTimeSeconds?: number;
  postRandom?: PostRandomState;
}

export interface SbeConstraints {
  minimumDecrementPyg: number;
  minimumOfferPyg?: number;
  maximumOfferPyg?: number;
  stepMultiplePyg?: number;
}

export type ActionType = 'WAIT' | 'BID_CANDIDATE' | 'STOP' | 'HALT';

export type ActionReasonCode =
  | 'ALREADY_AT_TARGET_POSITION'
  | 'TACTICAL_WAIT_NORMAL_PHASE'
  | 'TACTICAL_WAIT_SAFE_WINDOW'
  | 'TARGET_POSITION_DEFENSE_REQUIRED'
  | 'ENTRY_POSITION_REQUIRED'
  | 'ECONOMIC_LIMIT_BREACHED'
  | 'STALE_STATE'
  | 'AUCTION_NOT_ACTIVE'
  | 'AUCTION_CLOSED'
  | 'AUCTION_PAUSED'
  | 'POLICY_MISMATCH'
  | 'POLICY_NOT_FROZEN'
  | 'SBE_CONSTRAINTS_VIOLATED'
  | 'POLICY_CONSTRAINT_VIOLATION'
  | 'INVALID_COMPETITIVE_STATE'
  | 'UNKNOWN_STATE'
  // MIPYME Specific Action Codes
  | 'MIPYME_LAST_CHANCE_BID_REQUIRED'
  | 'MIPYME_BENEFIT_DISABLED_BY_POLICY'
  | 'MIPYME_BENEFIT_NOT_AVAILABLE'
  | 'MIPYME_BENEFIT_STATUS_UNKNOWN'
  | 'MIPYME_ALREADY_SUBMITTED';

export interface ActionDecision {
  action: ActionType;
  reasonCode: ActionReasonCode;
  reasonDescription: string;
  candidatePricePyg: number | null;
  targetRank: number | null;
  currentRank: number | null;
  defenseStepAppliedPyg: number | null;
  autoLimitPyg: number;
  targetPricePyg: number;
  evaluatedAt: string;
  executionMode: ExecutionMode;
  policyVersion: number;
  isMipymeLastChance?: boolean;
}

/**
 * Bot Lifecycle States
 * Process A (Live Auction & MIPYME Last Chance) is strictly separated from
 * Process B (Post-Auction Price Adjustment / Acta).
 */
export type BotLifecycleState =
  | 'IDLE'
  | 'MONITORING'
  | 'EVALUATING'
  | 'BID_READY'
  | 'SUBMITTING'
  | 'CONFIRMED'
  | 'RECONCILING'
  | 'MIPYME_LAST_CHANCE'
  | 'MIPYME_BID_CANDIDATE'
  | 'MIPYME_BID_CONFIRMED'
  | 'HALTED'
  | 'STOPPED'
  // Post-Auction Workflow (Separated: Occurs only after GROUP_CLOSED / ACTA_AVAILABLE)
  | 'AUCTION_SESSION_CLOSED'
  | 'ACTA_AVAILABLE'
  | 'PRICE_ADJUSTMENT_PENDING'
  | 'PRICE_CONFIRMED';

export type MipymeAttemptStatus =
  | 'NOT_ATTEMPTED'
  | 'CANDIDATE_READY'
  | 'SUBMITTING'
  | 'CONFIRMED'
  | 'UNKNOWN'
  | 'RECONCILING'
  | 'EXPIRED';

export interface BidSubmission {
  bidId: string;
  auctionId: string;
  groupId: string;
  pricePyg: number;
  submittedAt: string;
  policyVersion: number;
  status: 'SUBMITTING' | 'CONFIRMED' | 'UNKNOWN' | 'REJECTED';
  isMipyme?: boolean;
}

/**
 * Three-way reconciliation outcome. Absence of evidence is NOT evidence of absence.
 *
 * ACCEPTED     — Authoritative evidence the SBE received and registered the bid.
 * NOT_ACCEPTED — Authoritative evidence the SBE rejected or did not register the bid.
 * AMBIGUOUS    — Insufficient evidence to determine ACCEPTED or NOT_ACCEPTED.
 *                → Must HALT and require human intervention.
 *                Never automatically retry from AMBIGUOUS.
 */
export type ReconciliationOutcome = 'ACCEPTED' | 'NOT_ACCEPTED' | 'AMBIGUOUS';

/**
 * Context provided by the caller (future SBE Adapter) when reconciling an unknown submission.
 *
 * observationIsAuthoritative — true only when the caller has high confidence the snapshot
 *   is complete and current (e.g. a full ranked-list returned by a synchronous SBE API call
 *   immediately after the submission window). Never set to true for a stale or partial observation.
 *
 * explicitRejectionFromAdapter — (optional) set to true when the SBE adapter has received
 *   an explicit rejection code from the portal for the specific bidId being reconciled.
 */
export interface ReconciliationContext {
  observationIsAuthoritative: boolean;
  explicitRejectionFromAdapter?: boolean;
}

export interface ReconciliationResult {
  outcome: ReconciliationOutcome;
  reason: string;
  foundRank?: number;
}
