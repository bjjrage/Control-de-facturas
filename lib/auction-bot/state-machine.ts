/**
 * SBE AUCTION BOT - Lifecycle State Machine & Submission Reconciliation
 * Decoupled from transport. Supports policy re-authorization, safe reconciliation,
 * and single-opportunity MIPYME Last Chance handling.
 */

import {
  ActionDecision,
  BotLifecycleState,
  BidSubmission,
  FrozenAuctionPolicy,
  AuctionState,
  MipymeAttemptStatus,
  ReconciliationContext,
  ReconciliationResult,
} from './types';

export interface StateMachineContext {
  lifecycleState: BotLifecycleState;
  policy: FrozenAuctionPolicy;
  lastDecision: ActionDecision | null;
  activeSubmission: BidSubmission | null;
  mipymeAttemptStatus: MipymeAttemptStatus;
  history: Array<{
    timestamp: string;
    from: BotLifecycleState;
    to: BotLifecycleState;
    trigger: string;
    detail?: string;
  }>;
}

export class AuctionBotStateMachine {
  private context: StateMachineContext;

  constructor(policy: FrozenAuctionPolicy) {
    this.context = {
      lifecycleState: 'IDLE',
      policy,
      lastDecision: null,
      activeSubmission: null,
      mipymeAttemptStatus: 'NOT_ATTEMPTED',
      history: [],
    };
  }

  getState(): BotLifecycleState {
    return this.context.lifecycleState;
  }

  getContext(): Readonly<StateMachineContext> {
    return this.context;
  }

  getMipymeAttemptStatus(): MipymeAttemptStatus {
    return this.context.mipymeAttemptStatus;
  }

  private transitionTo(newState: BotLifecycleState, trigger: string, detail?: string): void {
    const oldState = this.context.lifecycleState;
    this.context.lifecycleState = newState;
    this.context.history.push({
      timestamp: new Date().toISOString(),
      from: oldState,
      to: newState,
      trigger,
      detail,
    });
  }

  /**
   * Start monitoring the auction session
   */
  startMonitoring(): void {
    if (this.context.lifecycleState === 'IDLE' || this.context.lifecycleState === 'STOPPED') {
      this.transitionTo('MONITORING', 'START_MONITORING');
    }
  }

  /**
   * Transition to EVALUATING when a new state update arrives
   */
  beginEvaluation(): void {
    if (['MONITORING', 'CONFIRMED', 'IDLE', 'MIPYME_BID_CONFIRMED'].includes(this.context.lifecycleState)) {
      this.transitionTo('EVALUATING', 'STATE_RECEIVED');
    }
  }

  /**
   * Apply an engine decision (handling normal and MIPYME stages)
   */
  handleDecision(decision: ActionDecision): void {
    this.context.lastDecision = decision;

    // MIPYME Stage Decision Handling
    if (decision.isMipymeLastChance) {
      if (decision.action === 'BID_CANDIDATE') {
        // Enforce single-opportunity rule: do not recreate candidate if already confirmed or expired
        if (this.context.mipymeAttemptStatus === 'CONFIRMED' || this.context.mipymeAttemptStatus === 'EXPIRED') {
          return;
        }
        this.context.mipymeAttemptStatus = 'CANDIDATE_READY';
        this.transitionTo(
          'MIPYME_LAST_CHANCE',
          'MIPYME_CANDIDATE_READY',
          `Beneficio MIPYME disponible. Candidate: ₲${decision.candidatePricePyg?.toLocaleString()} (Modo: ${decision.executionMode})`
        );
        return;
      }

      if (decision.action === 'WAIT') {
        if (decision.reasonCode === 'MIPYME_BENEFIT_NOT_AVAILABLE') {
          this.context.mipymeAttemptStatus = 'EXPIRED';
        }
        this.transitionTo('MONITORING', 'MIPYME_WAIT', decision.reasonDescription);
        return;
      }

      if (decision.action === 'STOP') {
        this.transitionTo('STOPPED', 'MIPYME_STOP', decision.reasonDescription);
        return;
      }

      if (decision.action === 'HALT') {
        this.transitionTo('HALTED', 'MIPYME_HALT', decision.reasonDescription);
        return;
      }
    }

    // Standard Live Bidding Decision Handling
    switch (decision.action) {
      case 'BID_CANDIDATE':
        this.transitionTo('BID_READY', 'BID_CANDIDATE_GENERATED', `Candidate: ₲${decision.candidatePricePyg?.toLocaleString()}`);
        break;
      case 'WAIT':
        this.transitionTo('MONITORING', 'DECISION_WAIT', decision.reasonDescription);
        break;
      case 'STOP':
        this.transitionTo('STOPPED', 'DECISION_STOP', decision.reasonDescription);
        break;
      case 'HALT':
        this.transitionTo('HALTED', 'DECISION_HALT', decision.reasonDescription);
        break;
    }
  }

  /**
   * Authorizes and activates a new policy version (e.g. after stopping on autoLimit)
   */
  applyNewPolicyVersion(newPolicy: FrozenAuctionPolicy): void {
    if (newPolicy.version <= this.context.policy.version) {
      throw new Error(`New policy version (v${newPolicy.version}) must be greater than current active version (v${this.context.policy.version}).`);
    }
    const oldVersion = this.context.policy.version;
    this.context.policy = newPolicy;

    // If a new version is authorized during POST_RANDOM / MIPYME, invalidate previous candidate
    // and require fresh state evaluation
    if (this.context.mipymeAttemptStatus === 'CANDIDATE_READY') {
      this.context.mipymeAttemptStatus = 'NOT_ATTEMPTED';
    }
    this.context.lastDecision = null;

    this.transitionTo(
      'MONITORING',
      'POLICY_VERSION_UPDATED',
      `Policy upgraded from v${oldVersion} to v${newPolicy.version} (Authorized by ${newPolicy.authorizedBy})`
    );
  }

  /**
   * Begin submission of a candidate bid (assisted or bounded_auto)
   */
  startSubmission(bidId: string): BidSubmission {
    const isMipyme = this.context.lifecycleState === 'MIPYME_LAST_CHANCE';
    const validStates: BotLifecycleState[] = ['BID_READY', 'MIPYME_LAST_CHANCE'];

    if (!validStates.includes(this.context.lifecycleState)) {
      throw new Error(`Cannot start submission from state '${this.context.lifecycleState}'. Expected 'BID_READY' or 'MIPYME_LAST_CHANCE'.`);
    }
    if (!this.context.lastDecision?.candidatePricePyg) {
      throw new Error('No candidate price in last decision to submit.');
    }

    const submission: BidSubmission = {
      bidId,
      auctionId: this.context.policy.auctionId,
      groupId: this.context.policy.groupId,
      pricePyg: this.context.lastDecision.candidatePricePyg,
      submittedAt: new Date().toISOString(),
      policyVersion: this.context.policy.version,
      status: 'SUBMITTING',
      isMipyme,
    };

    if (isMipyme) {
      this.context.mipymeAttemptStatus = 'SUBMITTING';
    }

    this.context.activeSubmission = submission;
    this.transitionTo('SUBMITTING', 'SUBMIT_TRIGGERED', `Bid ${bidId} for ₲${submission.pricePyg.toLocaleString()}${isMipyme ? ' [MIPYME]' : ''}`);
    return submission;
  }

  /**
   * Confirms successful bid receipt by SBE portal
   * PROCESO A: Live Auction / MIPYME Last Chance
   * Transitions to MIPYME_BID_CONFIRMED for MIPYME, NOT PRICE_CONFIRMED.
   */
  confirmSubmission(): void {
    const isMipyme = this.context.activeSubmission?.isMipyme;

    if (this.context.activeSubmission) {
      this.context.activeSubmission.status = 'CONFIRMED';
    }

    if (isMipyme) {
      this.context.mipymeAttemptStatus = 'CONFIRMED';
      this.transitionTo('MIPYME_BID_CONFIRMED', 'MIPYME_SUBMISSION_CONFIRMED', 'Lance MIPYME confirmado por SBE.');
    } else {
      this.transitionTo('CONFIRMED', 'SUBMISSION_CONFIRMED');
      this.transitionTo('MONITORING', 'RESUME_MONITORING');
    }
  }

  /**
   * Marks submission as unknown (e.g. timeout / network break) -> Enters RECONCILING
   * Exactly-once semantics: timeout != bid failed. NEVER blindly retry!
   */
  markSubmissionUnknown(reason: string): void {
    if (this.context.activeSubmission) {
      this.context.activeSubmission.status = 'UNKNOWN';
    }
    if (this.context.activeSubmission?.isMipyme) {
      this.context.mipymeAttemptStatus = 'UNKNOWN';
    }
    this.transitionTo('RECONCILING', 'NETWORK_TIMEOUT_OR_UNKNOWN', reason);
  }

  /**
   * Reconciles an unknown submission against a newly observed auction state.
   *
   * Three-way outcome (Fail-Closed):
   *   ACCEPTED     → Authoritative evidence bid was registered. Transitions to BID_CONFIRMED or MIPYME_BID_CONFIRMED.
   *   NOT_ACCEPTED → Authoritative evidence bid was rejected or not registered. Resumes MONITORING.
   *   AMBIGUOUS    → Insufficient evidence to determine outcome. HALTS. Requires human intervention.
   *
   * Principle: "No visible in observation" ≠ "was not sent".
   * Only resolve as NOT_ACCEPTED when the caller explicitly provides authoritative evidence.
   * Stale or non-authoritative observations must resolve as AMBIGUOUS → HALT.
   */
  reconcileWithState(state: AuctionState, context: ReconciliationContext): ReconciliationResult {
    if (this.context.lifecycleState !== 'RECONCILING' || !this.context.activeSubmission) {
      return {
        outcome: 'AMBIGUOUS',
        reason: 'reconcileWithState called outside RECONCILING state or with no active submission. Halting for safety.',
      };
    }

    const isMipyme = this.context.activeSubmission.isMipyme;
    const targetPrice = this.context.activeSubmission.pricePyg;
    const bidId = this.context.activeSubmission.bidId;

    const foundOurOffer = state.rankedOffers.find(
      (offer) => offer.isOurOffer && offer.pricePyg === targetPrice
    );

    // ── OUTCOME: ACCEPTED ────────────────────────────────────────────────────
    // Authoritative positive evidence: our offer appears in the ranked list.
    if (foundOurOffer) {
      this.context.activeSubmission.status = 'CONFIRMED';
      const detail = `Oferta ${bidId} registrada en SBE en puesto #${foundOurOffer.rank}.`;
      if (isMipyme) {
        this.context.mipymeAttemptStatus = 'CONFIRMED';
        this.transitionTo('MIPYME_BID_CONFIRMED', 'MIPYME_RECONCILIATION_ACCEPTED', detail);
      } else {
        this.transitionTo('CONFIRMED', 'RECONCILIATION_ACCEPTED', detail);
        this.transitionTo('MONITORING', 'RESUME_MONITORING');
      }
      return { outcome: 'ACCEPTED', reason: detail, foundRank: foundOurOffer.rank };
    }

    // ── OUTCOME: NOT_ACCEPTED ─────────────────────────────────────────────────
    // Our offer is NOT present AND the caller confirms the observation is authoritative
    // (complete, current snapshot) OR the adapter has received an explicit rejection.
    if (context.observationIsAuthoritative || context.explicitRejectionFromAdapter) {
      this.context.activeSubmission.status = 'REJECTED';
      const detail = context.explicitRejectionFromAdapter
        ? `Oferta ${bidId} rechazada explícitamente por SBE adapter.`
        : `Oferta ${bidId} no encontrada en snapshot autoritativo de SBE. Se descarta.`;
      if (isMipyme) {
        this.context.mipymeAttemptStatus = 'EXPIRED';
        this.transitionTo('STOPPED', 'MIPYME_RECONCILIATION_NOT_ACCEPTED', detail);
      } else {
        this.transitionTo('MONITORING', 'RECONCILIATION_NOT_ACCEPTED', detail);
      }
      return { outcome: 'NOT_ACCEPTED', reason: detail };
    }

    // ── OUTCOME: AMBIGUOUS ────────────────────────────────────────────────────
    // Our offer is NOT visible AND we lack authoritative evidence to conclude it was rejected.
    // "No aparece todavía" ≠ "no fue enviado".
    // Fail-Closed: HALT and require human intervention. Never auto-retry.
    const ambiguousDetail = `Oferta ${bidId} no visible en observación pero sin evidencia autoritativa de rechazo. Se detiene para intervención humana.`;
    if (isMipyme) {
      this.context.mipymeAttemptStatus = 'UNKNOWN';
    }
    this.transitionTo('HALTED', 'RECONCILIATION_AMBIGUOUS_HALT', ambiguousDetail);
    return { outcome: 'AMBIGUOUS', reason: ambiguousDetail };
  }

  /**
   * Emergency manual stop / halt
   */
  emergencyStop(reason: string = 'Manual operator stop'): void {
    this.transitionTo('STOPPED', 'EMERGENCY_STOP', reason);
  }

  // =========================================================================
  // PROCESO B — POST-AUCTION PRICE ADJUSTMENT
  // Occurs strictly AFTER auction session is closed and Acta is available.
  // Not connected automatically from MIPYME_BID_CONFIRMED.
  // =========================================================================

  /**
   * Signals that the auction group session has officially closed on SBE
   */
  notifyGroupClosed(): void {
    const allowedStates: BotLifecycleState[] = ['MIPYME_BID_CONFIRMED', 'MONITORING', 'STOPPED'];
    if (!allowedStates.includes(this.context.lifecycleState)) {
      throw new Error(`Cannot transition to AUCTION_SESSION_CLOSED from state '${this.context.lifecycleState}'.`);
    }
    this.transitionTo('AUCTION_SESSION_CLOSED', 'GROUP_CLOSED_BY_PORTAL', 'Subasta cerrada por portal.');
  }

  /**
   * Signals that the Acta de Sesión Pública Virtual has been generated and is available
   */
  notifyActaAvailable(): void {
    if (this.context.lifecycleState !== 'AUCTION_SESSION_CLOSED') {
      throw new Error(`Cannot notify Acta available from state '${this.context.lifecycleState}'. Expected 'AUCTION_SESSION_CLOSED'.`);
    }
    this.transitionTo('ACTA_AVAILABLE', 'ACTA_PUBLISHED', 'Acta de Sesión Pública Virtual disponible.');
  }

  /**
   * Initiates post-auction price adjustment workflow (manual/external trigger only)
   * This workflow adjusts the offer price to reflect the final price confirmed in SICP.
   */
  startPostAuctionPriceAdjustment(): void {
    if (this.context.lifecycleState !== 'ACTA_AVAILABLE') {
      throw new Error(`Cannot start price adjustment from state '${this.context.lifecycleState}'. Expected 'ACTA_AVAILABLE'.`);
    }
    this.transitionTo('PRICE_ADJUSTMENT_PENDING', 'PRICE_ADJUSTMENT_INITIATED', 'Ajuste de precios de la oferta post-acta iniciado. Pendiente de confirmación del precio final ajustado en SICP.');
  }

  /**
   * Confirms successful post-auction price adjustment in SICP
   */
  confirmPriceAdjustment(): void {
    if (this.context.lifecycleState !== 'PRICE_ADJUSTMENT_PENDING') {
      throw new Error(`Cannot confirm price adjustment from state '${this.context.lifecycleState}'. Expected 'PRICE_ADJUSTMENT_PENDING'.`);
    }
    this.transitionTo('PRICE_CONFIRMED', 'PRICE_ADJUSTMENT_CONFIRMED', 'Confirmación del precio final ajustado en SICP completada.');
  }
}
