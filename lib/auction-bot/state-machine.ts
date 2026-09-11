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
  ExecutionMode,
  MipymeAttemptStatus,
  ReconciliationContext,
  ReconciliationResult,
  SbeConstraints,
} from './types';
import { evaluateAuctionStep } from './engine';
import {
  HumanAuthorizationRequiredError,
  ObserveModeSubmissionError,
  StaleCandidateError,
} from './errors';

export interface StateMachineContext {
  lifecycleState: BotLifecycleState;
  policy: FrozenAuctionPolicy;
  lastDecision: ActionDecision | null;
  activeSubmission: BidSubmission | null;
  mipymeAttemptStatus: MipymeAttemptStatus;
  /**
   * Binds a BID_CANDIDATE to the exact observed state that generated it.
   * The pre-submit recheck compares the fresh observation against this basis.
   * Null = no submittable candidate (stale, invalidated, or never observed).
   */
  candidateBasis: {
    observedAt: string;
    auctionId: string;
    groupId: string;
    ourRank: number | null;
    ourCurrentPricePyg: number | null;
    policyVersion: number;
  } | null;
  /** True only after a successful pre-submit recheck. Single-use: consumed by startSubmission. */
  candidateRechecked: boolean;
  /**
   * Observation timestamp that passed the pre-submit recheck. startSubmission
   * enforces submittedAt >= recheckedObservationAt and a TTL of maxStalenessMs.
   */
  recheckedObservationAt: string | null;
  /**
   * Explicit single-use human authorization for ASSISTED mode, BOUND to the
   * exact candidate it was issued for (policy version, price, observation,
   * auction, group). Any new decision, invalidation or policy upgrade clears it.
   * Granted via grantHumanAuthorization, consumed by startSubmission.
   */
  pendingHumanAuthorization: {
    operatorId: string;
    grantedAt: string;
    policyVersion: number;
    candidatePricePyg: number;
    observedAt: string;
    auctionId: string;
    groupId: string;
  } | null;
  /**
   * Technical SBE constraints used for evaluation AND pre-submit re-evaluation.
   * The recheck must run against the same constraints as the original decision.
   */
  sbeConstraints: SbeConstraints | null;
  history: Array<{
    timestamp: string;
    from: BotLifecycleState;
    to: BotLifecycleState;
    trigger: string;
    detail?: string;
  }>;
}

export interface RecheckOptions {
  /** Injectable current time for deterministic replay/simulation. */
  nowIso?: string;
}

export interface StartSubmissionOptions {
  /** Deterministic submittedAt for replay/tests. Defaults to current time. */
  submittedAtIso?: string;
  /**
   * Inline explicit human authorization (operator identity) for ASSISTED mode.
   * Equivalent to calling grantHumanAuthorization immediately before.
   */
  humanAuthorizationId?: string;
}

export interface ReconcileOptions {
  /** Injectable current time for deterministic replay/simulation. */
  nowIso?: string;
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
      candidateBasis: null,
      candidateRechecked: false,
      recheckedObservationAt: null,
      pendingHumanAuthorization: null,
      sbeConstraints: null,
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

  /**
   * Sets the technical SBE constraints used for evaluation and, critically,
   * for the pre-submit re-evaluation (B1): the recheck must run against the
   * SAME constraints as the original decision, otherwise a constraint change
   * could silently alter the outcome instead of invalidating the candidate.
   */
  setSbeConstraints(constraints: SbeConstraints | null): void {
    this.context.sbeConstraints = constraints;
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
   * Transition to EVALUATING when a new state update arrives.
   *
   * Allowed from any monitoring-like state — including BID_READY and
   * MIPYME_LAST_CHANCE: a fresh observation arriving while a candidate is
   * pending must be evaluable (the resulting decision replaces or confirms
   * the candidate via handleDecision). Terminal ACTION states (STOPPED,
   * HALTED) and in-flight states (SUBMITTING, RECONCILING) can NOT resume
   * evaluation on their own: STOPPED requires a new authorized policy version,
   * HALTED requires explicit operator recovery, and in-flight submissions must
   * resolve exactly-once first.
   */
  beginEvaluation(): void {
    if (['MONITORING', 'CONFIRMED', 'IDLE', 'MIPYME_BID_CONFIRMED', 'BID_READY', 'MIPYME_LAST_CHANCE'].includes(this.context.lifecycleState)) {
      this.transitionTo('EVALUATING', 'STATE_RECEIVED');
    }
  }

  /**
   * Apply an engine decision (handling normal and MIPYME stages).
   *
   * generatingState binds a BID_CANDIDATE to the exact observation that
   * produced it (pre-submit recheck basis). When omitted, any candidate is
   * recorded WITHOUT basis and can never be submitted until re-evaluated —
   * fail-closed against stale submissions.
   */
  handleDecision(decision: ActionDecision, generatingState?: AuctionState): void {
    // LIFECYCLE GUARD: engine decisions are only accepted from EVALUATING.
    // No exceptions: this prevents accidental resurrection or overwrite —
    // HALTED + WAIT → MONITORING, STOPPED + BID → BID_READY, IDLE + BID →
    // BID_READY, SUBMITTING/RECONCILING + any stray decision (including BID
    // overwrites of in-flight submissions). Throws WITHOUT mutating context.
    if (this.context.lifecycleState !== 'EVALUATING') {
      throw new Error(
        `Refusing decision '${decision.action}' from state '${this.context.lifecycleState}'. Decisions are only accepted from EVALUATING (call beginEvaluation() on a fresh observation first).`
      );
    }
    // NOTE: in-flight-submission overwrite and HALTED resurrection are subsumed
    // by the EVALUATING-only guard above (a machine in SUBMITTING /
    // RECONCILING / HALTED can never reach this point). They are intentionally
    // NOT re-checked here to avoid dead code.

    this.context.lastDecision = decision;
    // A new decision invalidates any previous recheck AND any pending human
    // grant (the grant is bound to the previous candidate — see B3).
    this.context.candidateRechecked = false;
    this.context.recheckedObservationAt = null;
    this.context.pendingHumanAuthorization = null;

    const bindBasis = () => {
      if (generatingState) {
        this.context.candidateBasis = {
          observedAt: generatingState.observedAt,
          auctionId: generatingState.auctionId,
          groupId: generatingState.groupId,
          ourRank: generatingState.ourRank,
          ourCurrentPricePyg: generatingState.ourCurrentPricePyg,
          policyVersion: decision.policyVersion,
        };
      } else {
        this.context.candidateBasis = null;
      }
    };

    // MIPYME Stage Decision Handling
    if (decision.isMipymeLastChance) {
      if (decision.action === 'BID_CANDIDATE') {
        // Enforce single-opportunity rule: do not recreate candidate if already confirmed or expired
        if (this.context.mipymeAttemptStatus === 'CONFIRMED' || this.context.mipymeAttemptStatus === 'EXPIRED') {
          this.context.candidateBasis = null;
          return;
        }
        this.context.mipymeAttemptStatus = 'CANDIDATE_READY';
        bindBasis();
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
        this.context.candidateBasis = null;
        this.transitionTo('MONITORING', 'MIPYME_WAIT', decision.reasonDescription);
        return;
      }

      if (decision.action === 'STOP') {
        this.context.candidateBasis = null;
        this.transitionTo('STOPPED', 'MIPYME_STOP', decision.reasonDescription);
        return;
      }

      if (decision.action === 'HALT') {
        this.context.candidateBasis = null;
        this.transitionTo('HALTED', 'MIPYME_HALT', decision.reasonDescription);
        return;
      }
    }

    // Standard Live Bidding Decision Handling
    switch (decision.action) {
      case 'BID_CANDIDATE':
        bindBasis();
        this.transitionTo('BID_READY', 'BID_CANDIDATE_GENERATED', `Candidate: ₲${decision.candidatePricePyg?.toLocaleString()}`);
        break;
      case 'WAIT':
        this.context.candidateBasis = null;
        this.transitionTo('MONITORING', 'DECISION_WAIT', decision.reasonDescription);
        break;
      case 'STOP':
        this.context.candidateBasis = null;
        this.transitionTo('STOPPED', 'DECISION_STOP', decision.reasonDescription);
        break;
      case 'HALT':
        this.context.candidateBasis = null;
        this.transitionTo('HALTED', 'DECISION_HALT', decision.reasonDescription);
        break;
    }
  }

  /**
   * Authorizes and activates a new policy version (e.g. after stopping on autoLimit)
   *
   * LIFECYCLE GUARD: never while a submission is in flight (SUBMITTING /
   * RECONCILING, or an active submission still SUBMITTING/UNKNOWN). The
   * in-flight submission must resolve exactly-once first.
   *
   * IDENTITY CONTINUITY: a new VERSION belongs to the same policy/session —
   * policyId, auctionId, groupId and scope must be identical (and version
   * strictly greater). Anything else is NOT a new version: it requires a new
   * AuctionBotStateMachine / new session.
   */
  applyNewPolicyVersion(newPolicy: FrozenAuctionPolicy): void {
    const inFlightState =
      this.context.lifecycleState === 'SUBMITTING' || this.context.lifecycleState === 'RECONCILING';
    const inFlightSubmission =
      this.context.activeSubmission?.status === 'SUBMITTING' ||
      this.context.activeSubmission?.status === 'UNKNOWN';
    if (inFlightState || inFlightSubmission) {
      throw new Error(
        `Refusing policy upgrade while a submission is in flight (state '${this.context.lifecycleState}', submission '${this.context.activeSubmission?.status ?? 'none'}'). Resolve exactly-once first.`
      );
    }
    const current = this.context.policy;
    const identityFields = ['policyId', 'auctionId', 'groupId', 'scope'] as const;
    for (const field of identityFields) {
      if (newPolicy[field] !== current[field]) {
        throw new Error(
          `Refusing policy upgrade: identity field '${field}' changed ('${current[field]}' → '${newPolicy[field]}'). That is not a new version — start a new AuctionBotStateMachine/session.`
        );
      }
    }
    if (newPolicy.version <= current.version) {
      throw new Error(`New policy version (v${newPolicy.version}) must be greater than current active version (v${current.version}).`);
    }
    const oldVersion = this.context.policy.version;
    this.context.policy = newPolicy;

    // If a new version is authorized during POST_RANDOM / MIPYME, invalidate previous candidate
    // and require fresh state evaluation
    if (this.context.mipymeAttemptStatus === 'CANDIDATE_READY') {
      this.context.mipymeAttemptStatus = 'NOT_ATTEMPTED';
    }
    this.context.lastDecision = null;
    this.context.candidateBasis = null;
    this.context.candidateRechecked = false;
    this.context.recheckedObservationAt = null;
    // A pending human grant was issued against the previous candidate/policy:
    // it must not survive a policy upgrade.
    this.context.pendingHumanAuthorization = null;

    this.transitionTo(
      'MONITORING',
      'POLICY_VERSION_UPDATED',
      `Policy upgraded from v${oldVersion} to v${newPolicy.version} (Authorized by ${newPolicy.authorizedBy})`
    );
  }

  /**
   * Records an explicit, single-use human authorization to submit the current
   * candidate (ASSISTED mode gate), BOUND to that exact candidate: policy
   * version, candidate price, generating observation, auction and group.
   *
   * Can only operate while a BID_CANDIDATE is actually pending. Any new
   * decision, candidate invalidation or policy upgrade clears the grant, and
   * startSubmission verifies the grant still matches the current candidate.
   * Auditable via history.
   */
  grantHumanAuthorization(operatorId: string): void {
    if (!operatorId || operatorId.trim() === '') {
      throw new Error('grantHumanAuthorization requires a non-empty operator identity.');
    }
    const lastDecision = this.context.lastDecision;
    const basis = this.context.candidateBasis;
    const hasPendingCandidate =
      (this.context.lifecycleState === 'BID_READY' || this.context.lifecycleState === 'MIPYME_LAST_CHANCE') &&
      lastDecision?.action === 'BID_CANDIDATE' &&
      lastDecision.candidatePricePyg !== null &&
      basis !== null;
    if (!hasPendingCandidate) {
      throw new Error('grantHumanAuthorization requires a current pending BID_CANDIDATE. There is nothing to authorize.');
    }
    this.context.pendingHumanAuthorization = {
      operatorId: operatorId.trim(),
      grantedAt: new Date().toISOString(),
      policyVersion: this.context.policy.version,
      candidatePricePyg: lastDecision.candidatePricePyg as number,
      observedAt: basis.observedAt,
      auctionId: basis.auctionId,
      groupId: basis.groupId,
    };
    this.context.history.push({
      timestamp: new Date().toISOString(),
      from: this.context.lifecycleState,
      to: this.context.lifecycleState,
      trigger: 'HUMAN_AUTHORIZATION_GRANTED',
      detail: `Operator ${operatorId.trim()} authorized candidate ₲${(lastDecision.candidatePricePyg as number).toLocaleString()} (policy v${this.context.policy.version}, obs ${basis.observedAt}) — single-use, bound to this exact candidate.`,
    });
  }

  /**
   * PRE-SUBMIT RECHECK — explicit barrier between BID_CANDIDATE and SUBMITTING.
   *
   * A candidate is bound to the observed state that generated it. Before any
   * submission, the caller must present a FRESH observation and this method:
   *   1. requires a strictly NEWER observation (same snapshot ≠ re-observation);
   *   2. rejects unparseable or future-dated timestamps (fail-closed, HALT);
   *   3. requires freshness within maxStalenessMs (else invalidate → MONITORING);
   *   4. RE-EVALUATES the fresh state with evaluateAuctionStep() against the
   *      current policy and the same SBE constraints, and requires the fresh
   *      decision to still be BID_CANDIDATE with EXACTLY the same
   *      candidatePricePyg, targetRank, policyVersion, executionMode and
   *      isMipymeLastChance. Anything else → INVALIDATE → MONITORING.
   *
   * This catches the case a rank/price comparison alone misses: our own
   * position unchanged, but a competitor moved — the old candidate no longer
   * achieves the target rank and must never be submitted.
   */
  recheckCandidate(
    freshState: AuctionState,
    options?: RecheckOptions
  ): { valid: boolean; reason: string } {
    const basis = this.context.candidateBasis;
    const lastDecision = this.context.lastDecision;

    if (
      this.context.lifecycleState !== 'BID_READY' &&
      this.context.lifecycleState !== 'MIPYME_LAST_CHANCE'
    ) {
      return { valid: false, reason: 'No hay candidate pendiente (estado actual no es BID_READY ni MIPYME_LAST_CHANCE).' };
    }
    if (!lastDecision || lastDecision.action !== 'BID_CANDIDATE' || !basis) {
      this.context.candidateRechecked = false;
      return { valid: false, reason: 'Candidate sin base observada ligada: requiere re-evaluación con estado fresco antes de enviar.' };
    }

    if (
      freshState.auctionId !== basis.auctionId ||
      freshState.groupId !== basis.groupId ||
      freshState.auctionId !== this.context.policy.auctionId ||
      freshState.groupId !== this.context.policy.groupId
    ) {
      this.invalidateCandidate(
        `La observación fresca pertenece a otra subasta/grupo (${freshState.auctionId}/${freshState.groupId}) que el candidate (${basis.auctionId}/${basis.groupId}).`
      );
      return { valid: false, reason: 'Discrepancia de subasta/grupo entre candidate y observación fresca: candidate invalidado.' };
    }

    const nowMs = Date.parse(options?.nowIso ?? new Date().toISOString());
    const freshObservedMs = Date.parse(freshState.observedAt);
    const basisObservedMs = Date.parse(basis.observedAt);
    if (!Number.isFinite(nowMs) || !Number.isFinite(freshObservedMs) || !Number.isFinite(basisObservedMs)) {
      this.context.candidateRechecked = false;
      this.transitionTo('HALTED', 'RECHECK_INVALID_TIMESTAMP', 'Timestamp inválido en recheck pre-submit (now, fresh observedAt o basis observedAt no parseable). Detención preventiva.');
      return { valid: false, reason: 'Timestamp inválido en recheck: HALT preventivo.' };
    }
    // No clock-skew policy yet: future-dated observations fail closed.
    if (freshObservedMs > nowMs) {
      this.context.candidateRechecked = false;
      this.transitionTo('HALTED', 'RECHECK_FUTURE_OBSERVATION', 'La observación fresca está fechada en el futuro (observedAt > now). Sin política de clock-skew: HALT preventivo.');
      return { valid: false, reason: 'Observación fresca con timestamp futuro: HALT preventivo.' };
    }

    // Strict re-observation: the same snapshot does NOT count as a recheck.
    if (freshObservedMs <= basisObservedMs) {
      this.invalidateCandidate(
        `La observación presentada (obs ${freshState.observedAt}) no es posterior a la que generó el candidate (obs ${basis.observedAt}). El mismo snapshot no cuenta como re-observación.`
      );
      return { valid: false, reason: 'Sin re-observación real: el snapshot debe ser estrictamente posterior al que generó el candidate.' };
    }

    const ageMs = Math.max(0, nowMs - freshObservedMs);
    if (ageMs > this.context.policy.maxStalenessMs) {
      this.invalidateCandidate(
        `La observación fresca está desactualizada (${ageMs}ms > máximo ${this.context.policy.maxStalenessMs}ms).`
      );
      return { valid: false, reason: 'Observación fresca desactualizada: candidate invalidado, a re-evaluar.' };
    }

    if (this.context.policy.version !== basis.policyVersion) {
      this.invalidateCandidate(
        `La política cambió desde que se generó el candidate (v${basis.policyVersion} → v${this.context.policy.version}).`
      );
      return { valid: false, reason: 'La política cambió desde la generación del candidate: candidate invalidado.' };
    }

    // Full re-evaluation against the real fresh state.
    const nowIso = options?.nowIso ?? new Date().toISOString();
    const freshDecision = evaluateAuctionStep(
      freshState,
      this.context.policy,
      this.context.sbeConstraints ?? undefined,
      { currentTimestampIso: nowIso }
    );
    const sameCandidate =
      freshDecision.action === 'BID_CANDIDATE' &&
      freshDecision.candidatePricePyg === lastDecision.candidatePricePyg &&
      freshDecision.targetRank === lastDecision.targetRank &&
      freshDecision.policyVersion === lastDecision.policyVersion &&
      freshDecision.executionMode === lastDecision.executionMode &&
      (freshDecision.isMipymeLastChance ?? false) === (lastDecision.isMipymeLastChance ?? false);
    if (!sameCandidate) {
      this.invalidateCandidate(
        `La re-evaluación del estado fresco difiere del candidate (fresco: ${freshDecision.action}/${freshDecision.reasonCode} candidate ₲${freshDecision.candidatePricePyg?.toLocaleString() ?? '—'} vs candidate ₲${lastDecision.candidatePricePyg?.toLocaleString()}).`
      );
      return { valid: false, reason: 'La re-evaluación difiere del candidate original: candidate invalidado, a re-evaluar.' };
    }

    this.context.candidateRechecked = true;
    this.context.recheckedObservationAt = freshState.observedAt;
    return { valid: true, reason: 'Candidate re-validado: re-observación posterior y fresca, y la re-evaluación produce exactamente el mismo candidate (precio, rank, policyVersion, modo).' };
  }

  private invalidateCandidate(detail: string): void {
    this.context.candidateBasis = null;
    this.context.candidateRechecked = false;
    this.context.recheckedObservationAt = null;
    this.context.pendingHumanAuthorization = null;
    this.context.lastDecision = null;
    if (this.context.mipymeAttemptStatus === 'CANDIDATE_READY') {
      this.context.mipymeAttemptStatus = 'NOT_ATTEMPTED';
    }
    this.transitionTo('MONITORING', 'CANDIDATE_INVALIDATED', detail);
  }

  /**
   * Begin submission of a candidate bid.
   *
   * Hard gates enforced HERE (never trust the UI for these guarantees), in order:
   *  1. Valid states only: BID_READY / MIPYME_LAST_CHANCE, with a candidate price.
   *  2. OBSERVE mode can NEVER submit (audit only).
   *  3. The candidate must have passed the pre-submit recheck, AND the submit
   *     must happen promptly after the rechecked observation:
   *     recheckedObservationAt <= submittedAt <= recheckedObservationAt + maxStalenessMs.
   *     Expired → invalidate + StaleCandidateError. Time-travel/corrupt clock → HALT.
   *  4. ASSISTED mode requires an explicit single-use human authorization BOUND
   *     to this exact candidate (consumed only after the candidate gates pass).
   */
  startSubmission(bidId: string, options?: StartSubmissionOptions): BidSubmission {
    const isMipyme = this.context.lifecycleState === 'MIPYME_LAST_CHANCE';
    const validStates: BotLifecycleState[] = ['BID_READY', 'MIPYME_LAST_CHANCE'];

    if (!validStates.includes(this.context.lifecycleState)) {
      throw new Error(`Cannot start submission from state '${this.context.lifecycleState}'. Expected 'BID_READY' or 'MIPYME_LAST_CHANCE'.`);
    }
    const lastDecision = this.context.lastDecision;
    const candidatePricePyg = lastDecision?.candidatePricePyg;
    if (!candidatePricePyg) {
      throw new Error('No candidate price in last decision to submit.');
    }

    const effectiveMode: ExecutionMode = isMipyme
      ? this.context.policy.mipymePolicy.executionMode
      : this.context.policy.executionMode;

    if (effectiveMode === 'OBSERVE') {
      throw new ObserveModeSubmissionError();
    }

    if (!this.context.candidateRechecked || !this.context.recheckedObservationAt) {
      throw new StaleCandidateError('Call recheckCandidate with a fresh observation first.');
    }

    const submittedAt = options?.submittedAtIso ?? new Date().toISOString();
    const submittedAtMs = Date.parse(submittedAt);
    const recheckedAtMs = Date.parse(this.context.recheckedObservationAt);
    if (!Number.isFinite(submittedAtMs) || !Number.isFinite(recheckedAtMs)) {
      this.context.candidateRechecked = false;
      this.transitionTo('HALTED', 'SUBMIT_INVALID_TIMESTAMP', 'Timestamp inválido en submit (submittedAt o recheckedObservationAt no parseable). Detención preventiva.');
      throw new StaleCandidateError('Corrupt submit/recheck timestamp: HALT preventivo.');
    }
    if (submittedAtMs < recheckedAtMs) {
      this.context.candidateRechecked = false;
      this.transitionTo('HALTED', 'SUBMIT_TIME_TRAVEL', 'submittedAt anterior a la observación revalidada: reloj corrupto. HALT preventivo.');
      throw new StaleCandidateError('submittedAt predates the rechecked observation: HALT preventivo.');
    }
    if (submittedAtMs - recheckedAtMs > this.context.policy.maxStalenessMs) {
      this.invalidateCandidate(
        `El recheck expiró antes del envío (submit ${submittedAt} > obs revalidada ${this.context.recheckedObservationAt} + ${this.context.policy.maxStalenessMs}ms).`
      );
      throw new StaleCandidateError('Pre-submit recheck TTL expired: candidate invalidated, re-observe and re-evaluate.');
    }

    if (effectiveMode === 'ASSISTED') {
      const inlineAuth = options?.humanAuthorizationId?.trim() || null;
      const grantedAuth = this.context.pendingHumanAuthorization;
      const basis = this.context.candidateBasis;
      const grantMatchesCurrentCandidate =
        grantedAuth !== null &&
        basis !== null &&
        grantedAuth.policyVersion === this.context.policy.version &&
        grantedAuth.candidatePricePyg === candidatePricePyg &&
        grantedAuth.observedAt === basis.observedAt &&
        grantedAuth.auctionId === basis.auctionId &&
        grantedAuth.groupId === basis.groupId;
      if (!inlineAuth && !grantMatchesCurrentCandidate) {
        throw new HumanAuthorizationRequiredError();
      }
      const authorizingOperator = inlineAuth ?? grantedAuth!.operatorId;
      // Single-use: consume any prior grant.
      this.context.pendingHumanAuthorization = null;
      this.context.history.push({
        timestamp: new Date().toISOString(),
        from: this.context.lifecycleState,
        to: this.context.lifecycleState,
        trigger: 'HUMAN_AUTHORIZATION_CONSUMED',
        detail: `Operator ${authorizingOperator} authorized bid ${bidId} at ₲${candidatePricePyg.toLocaleString()} (ASSISTED, single-use, bound to candidate obs ${basis?.observedAt}).`,
      });
    }

    // All gates passed: single-use recheck is consumed ONLY by a submission
    // that actually proceeds (a rejected attempt preserves it for retry —
    // the TTL gate re-runs on every attempt).
    this.context.candidateRechecked = false;

    const submission: BidSubmission = {
      bidId,
      auctionId: this.context.policy.auctionId,
      groupId: this.context.policy.groupId,
      pricePyg: candidatePricePyg,
      submittedAt,
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
   *
   * LIFECYCLE GUARD: only valid from SUBMITTING with an active submission.
   * Out-of-order confirmations (e.g. double-confirm) throw instead of
   * silently corrupting the lifecycle.
   */
  confirmSubmission(): void {
    if (this.context.lifecycleState !== 'SUBMITTING' || !this.context.activeSubmission) {
      throw new Error(
        `Cannot confirm submission from state '${this.context.lifecycleState}'. Expected 'SUBMITTING' with an active submission.`
      );
    }
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
   *
   * LIFECYCLE GUARD: only valid from SUBMITTING with an active submission.
   */
  markSubmissionUnknown(reason: string): void {
    if (this.context.lifecycleState !== 'SUBMITTING' || !this.context.activeSubmission) {
      throw new Error(
        `Cannot mark submission unknown from state '${this.context.lifecycleState}'. Expected 'SUBMITTING' with an active submission.`
      );
    }
    this.context.activeSubmission.status = 'UNKNOWN';
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
   *
   * Hardening gates (all fail closed to AMBIGUOUS → HALTED):
   *   - auctionId/groupId/scope of the observation must match the submission/policy;
   *   - observedAt/submittedAt/now must be parseable, and observedAt must not be
   *     future-dated (no clock-skew policy yet);
   *   - the observation must be fresh (stale snapshots prove nothing);
   *   - snapshot-based conclusions require observedAt >= submittedAt: a snapshot
   *     older than the submit proves NOTHING (neither ACCEPTED nor NOT_ACCEPTED);
   *   - ACCEPTED requires observationIsAuthoritative === true OR an explicit
   *     acceptance from the adapter — never a bare price match;
   *   - a price match only ACCEPTs when a matched OUR offer provably postdates
   *     the submission (timestamp >= submittedAt), searching ALL our offers at
   *     that price (an identical older offer may be a PREVIOUS bid of ours).
   *     When identity cannot be proven: AMBIGUOUS → HALT.
   */
  reconcileWithState(
    state: AuctionState,
    context: ReconciliationContext,
    options?: ReconcileOptions
  ): ReconciliationResult {
    if (this.context.lifecycleState !== 'RECONCILING' || !this.context.activeSubmission) {
      return {
        outcome: 'AMBIGUOUS',
        reason: 'reconcileWithState called outside RECONCILING state or with no active submission. Halting for safety.',
      };
    }

    const isMipyme = this.context.activeSubmission.isMipyme;
    const targetPrice = this.context.activeSubmission.pricePyg;
    const bidId = this.context.activeSubmission.bidId;
    const submittedAtMs = Date.parse(this.context.activeSubmission.submittedAt);

    const haltAmbiguous = (trigger: string, reason: string): ReconciliationResult => {
      if (isMipyme) {
        this.context.mipymeAttemptStatus = 'UNKNOWN';
      }
      this.transitionTo('HALTED', trigger, reason);
      return { outcome: 'AMBIGUOUS', reason };
    };

    // ── GATE 1: auction / group / scope identity ─────────────────────────────
    if (
      state.auctionId !== this.context.activeSubmission.auctionId ||
      state.groupId !== this.context.activeSubmission.groupId
    ) {
      return haltAmbiguous(
        'RECONCILIATION_SCOPE_MISMATCH_HALT',
        `La observación pertenece a otra subasta/grupo (${state.auctionId}/${state.groupId}) que la oferta enviada (${this.context.activeSubmission.auctionId}/${this.context.activeSubmission.groupId}). No se puede reconciliar: HALT para intervención humana.`
      );
    }
    if (state.scope !== this.context.policy.scope) {
      return haltAmbiguous(
        'RECONCILIATION_SCOPE_MISMATCH_HALT',
        `Alcance incompatible en reconciliación (observación: ${state.scope} vs política: ${this.context.policy.scope}). No se puede reconciliar: HALT para intervención humana.`
      );
    }

    // ── GATE 2: parseable timestamps (invalid timestamps fail closed) ────────
    const nowMs = Date.parse(options?.nowIso ?? new Date().toISOString());
    const observedMs = Date.parse(state.observedAt);
    if (!Number.isFinite(nowMs) || !Number.isFinite(observedMs) || !Number.isFinite(submittedAtMs)) {
      return haltAmbiguous(
        'RECONCILIATION_INVALID_TIMESTAMP_HALT',
        'Timestamp inválido en reconciliación (observedAt, submittedAt o now no parseable). Sin tiempo confiable no se puede validar freshness ni identidad: HALT preventivo.'
      );
    }
    // No clock-skew policy yet: future-dated observations fail closed.
    if (observedMs > nowMs) {
      return haltAmbiguous(
        'RECONCILIATION_FUTURE_OBSERVATION_HALT',
        'La observación para reconciliar está fechada en el futuro (observedAt > now). Sin política de clock-skew: HALT preventivo.'
      );
    }

    // ── GATE 3: observation freshness ────────────────────────────────────────
    const ageMs = Math.max(0, nowMs - observedMs);
    if (ageMs > this.context.policy.maxStalenessMs) {
      return haltAmbiguous(
        'RECONCILIATION_STALE_OBSERVATION_HALT',
        `La observación para reconciliar está desactualizada (${ageMs}ms > máximo ${this.context.policy.maxStalenessMs}ms). Un snapshot viejo no prueba nada: HALT para intervención humana.`
      );
    }

    // ── GATE 4: temporal causality ───────────────────────────────────────────
    // A snapshot OLDER than the submit proves NOTHING — neither that the bid
    // was registered nor that it was rejected. Only snapshots taken at or
    // after the submit can support a conclusion.
    if (observedMs < submittedAtMs) {
      return haltAmbiguous(
        'RECONCILIATION_PRE_SUBMIT_SNAPSHOT_HALT',
        'El snapshot es anterior al envío de la oferta: no puede demostrar ni aceptación ni rechazo. AMBIGUO → HALT, sin reintento automático.'
      );
    }

    // All OUR offers at the submitted price (there may be several, e.g. a
    // previous identical bid). Never settle for the first .find().
    const ourOffersAtPrice = state.rankedOffers.filter(
      (offer) => offer.isOurOffer && offer.pricePyg === targetPrice
    );
    const provenOffer = ourOffersAtPrice
      .map((offer) => ({ offer, offerMs: Date.parse(offer.timestamp) }))
      .filter((entry) => Number.isFinite(entry.offerMs) && entry.offerMs >= submittedAtMs)
      .sort((a, b) => a.offer.rank - b.offer.rank)[0];

    // ── OUTCOME: ACCEPTED ────────────────────────────────────────────────────
    // Requires AUTHORITATIVE evidence: an authoritative snapshot (or an
    // explicit acceptance from the adapter) PLUS a matched offer that provably
    // postdates the submission. A bare price match in a non-authoritative
    // snapshot never ACCEPTs.
    const hasAuthoritativeAcceptance =
      context.observationIsAuthoritative || context.explicitAcceptanceFromAdapter === true;
    if (provenOffer && hasAuthoritativeAcceptance) {
      this.context.activeSubmission.status = 'CONFIRMED';
      const viaAdapter = !context.observationIsAuthoritative && context.explicitAcceptanceFromAdapter === true;
      const detail = `Oferta ${bidId} registrada en SBE en puesto #${provenOffer.offer.rank}${viaAdapter ? ' (aceptación explícita del adapter)' : ''}.`;
      if (isMipyme) {
        this.context.mipymeAttemptStatus = 'CONFIRMED';
        this.transitionTo('MIPYME_BID_CONFIRMED', 'MIPYME_RECONCILIATION_ACCEPTED', detail);
      } else {
        this.transitionTo('CONFIRMED', 'RECONCILIATION_ACCEPTED', detail);
        this.transitionTo('MONITORING', 'RESUME_MONITORING');
      }
      return { outcome: 'ACCEPTED', reason: detail, foundRank: provenOffer.offer.rank };
    }
    if (provenOffer && !hasAuthoritativeAcceptance) {
      return haltAmbiguous(
        'RECONCILIATION_NON_AUTHORITATIVE_MATCH_HALT',
        `Oferta propia a ₲${targetPrice.toLocaleString()} visible pero el snapshot NO es autoritativo y no hay aceptación explícita del adapter. Un precio coincidente no basta: AMBIGUO → HALT, sin reintento automático.`
      );
    }
    if (ourOffersAtPrice.length > 0) {
      return haltAmbiguous(
        'RECONCILIATION_IDENTITY_UNPROVEN_HALT',
        `Oferta propia a ₲${targetPrice.toLocaleString()} visible pero sin timestamp autoritativo que la ligue a este envío (podría ser una oferta previa idéntica). No se puede demostrar identidad: AMBIGUO → HALT, sin reintento automático.`
      );
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
