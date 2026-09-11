import { describe, it, expect } from 'vitest';
import { evaluateAuctionStep } from '../engine';
import { calculateAutoLimitPyg, freezePolicy } from '../policy';
import { AuctionBotStateMachine } from '../state-machine';
import { AuctionState, ExecutionMode, FrozenAuctionPolicy } from '../types';

describe('MIPYME Last Chance Specification', () => {
  const baseTime = '2026-09-10T20:00:00.000Z';
  // Strict temporal protocol: T0 generates the candidate, T1 re-observes,
  // T2 submits and reconciles. Same snapshot never counts as re-observation.
  const freshTime = '2026-09-10T20:00:01.000Z';
  const submitTime = '2026-09-10T20:00:02.000Z';

  function freshState(state: AuctionState): AuctionState {
    return { ...state, observedAt: freshTime };
  }

  // NOTE: reconcile fixtures below use observedAt === submitTime and offer
  // timestamps >= submittedAt: GATE 4 requires snapshots at/after the submit,
  // and ACCEPT requires a provably-post-submit offer timestamp.

  function createPolicy(
    mipymeEnabled: boolean = true,
    mipymeMode: ExecutionMode = 'BOUNDED_AUTO',
    mipymeStep: number = 10,
    toleranceBps: number = 200 // 2% -> Auto Limit = 980.000
  ): FrozenAuctionPolicy {
    const targetPrice = 1_000_000;
    // Always mirror the canonical CEIL implementation — never a local formula.
    const autoLimit = calculateAutoLimitPyg(targetPrice, toleranceBps);

    return freezePolicy({
      policyId: 'pol-mipyme',
      auctionId: 'auc-dncp-99',
      groupId: 'item-1',
      scope: 'ITEM',
      positionStrategy: 'TARGET_RANK_1',
      targetRank: 1,
      defenseStepPyg: 10,
      normalPhaseBehavior: 'WAIT',
      safeWindowBehavior: 'WAIT',
      enterTargetPositionInEntryWindow: true,
      defendImmediatelyInCloseRisk: true,
      targetPricePyg: targetPrice,
      autoDefenseToleranceBps: toleranceBps,
      autoLimitPyg: autoLimit,
      mipymePolicy: {
        enabled: mipymeEnabled,
        executionMode: mipymeMode,
        defenseStepPyg: mipymeStep,
        economicLimitMode: 'USE_CURRENT_AUTO_LIMIT',
      },
      executionMode: 'BOUNDED_AUTO',
      maxStalenessMs: 5000,
      authorizedBy: 'gerencia.mipyme@empresa.com.py',
    });
  }

  function createPostRandomState(
    status: 'AVAILABLE' | 'UNAVAILABLE' | 'NOT_APPLICABLE' | 'UNKNOWN',
    bestPricePyg: number = 990_000
  ): AuctionState {
    return {
      auctionId: 'auc-dncp-99',
      groupId: 'item-1',
      scope: 'ITEM',
      phase: 'POST_RANDOM',
      timingWindow: 'EXPIRED',
      closeRisk: false,
      status: 'ACTIVE',
      rankedOffers: [
        { rank: 1, participantId: 'comp-alpha', isOurOffer: false, pricePyg: bestPricePyg, timestamp: baseTime },
        { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_005_000, timestamp: baseTime },
      ],
      ourRank: 2,
      ourCurrentPricePyg: 1_005_000,
      observedAt: baseTime,
      postRandom: {
        mipymeBenefitStatus: status,
        deadlineMs: 60_000,
        ourFinalRank: 2,
        bestPricePyg,
      },
    };
  }

  // CASO 1: MIPYME benefit unavailable -> RANDOM -> POST_RANDOM -> GROUP_CLOSED
  it('Caso 1: returns WAIT when MIPYME benefit is UNAVAILABLE or NOT_APPLICABLE', () => {
    const policy = createPolicy(true);
    const stateUnavailable = createPostRandomState('UNAVAILABLE', 990_000);
    const decision = evaluateAuctionStep(stateUnavailable, policy, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('WAIT');
    expect(decision.reasonCode).toBe('MIPYME_BENEFIT_NOT_AVAILABLE');
    expect(decision.candidatePricePyg).toBeNull();
  });

  // CASO 2: Benefit available + candidate dentro de Auto Limit -> BID_CANDIDATE
  it('Caso 2: generates BID_CANDIDATE when benefit is AVAILABLE and candidate is within Auto Limit', () => {
    const policy = createPolicy(true, 'BOUNDED_AUTO', 10); // Auto Limit = 980.000
    const state = createPostRandomState('AVAILABLE', 990_000); // Best price = 990.000
    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('BID_CANDIDATE');
    expect(decision.reasonCode).toBe('MIPYME_LAST_CHANCE_BID_REQUIRED');
    expect(decision.candidatePricePyg).toBe(989_990); // 990.000 - 10
    expect(decision.candidatePricePyg! >= decision.autoLimitPyg).toBe(true);
    expect(decision.isMipymeLastChance).toBe(true);
  });

  // CASO 3: Benefit available + candidate debajo de Auto Limit -> STOP
  it('Caso 3: stops with ECONOMIC_LIMIT_BREACHED when candidate breaches Auto Limit', () => {
    const policy = createPolicy(true, 'BOUNDED_AUTO', 10); // Auto Limit = 980.000
    const state = createPostRandomState('AVAILABLE', 980_005); // candidate would be 979.995 < 980.000
    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('STOP');
    expect(decision.reasonCode).toBe('ECONOMIC_LIMIT_BREACHED');
    expect(decision.candidatePricePyg).toBe(979_995);
    expect(decision.isMipymeLastChance).toBe(true);
  });

  // CASO 4: Benefit status UNKNOWN -> HALT (Fail Closed)
  it('Caso 4: HALTS immediately when benefit status is UNKNOWN (Fail-Closed)', () => {
    const policy = createPolicy(true);
    const stateUnknown = createPostRandomState('UNKNOWN', 990_000);
    const decision = evaluateAuctionStep(stateUnknown, policy, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('HALT');
    expect(decision.reasonCode).toBe('MIPYME_BENEFIT_STATUS_UNKNOWN');
    expect(decision.candidatePricePyg).toBeNull();
  });

  // CASO 5: Policy tiene MIPYME disabled -> WAIT / NO ACTION
  it('Caso 5: returns WAIT when client policy has MIPYME disabled', () => {
    const policyDisabled = createPolicy(false); // enabled: false
    const state = createPostRandomState('AVAILABLE', 990_000);
    const decision = evaluateAuctionStep(state, policyDisabled, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('WAIT');
    expect(decision.reasonCode).toBe('MIPYME_BENEFIT_DISABLED_BY_POLICY');
    expect(decision.candidatePricePyg).toBeNull();
  });

  // CASO 6: OBSERVE mode -> muestra candidate pero executionMode es OBSERVE
  it('Caso 6: generates candidate with OBSERVE executionMode for audit only', () => {
    const policyObserve = createPolicy(true, 'OBSERVE', 10);
    const state = createPostRandomState('AVAILABLE', 990_000);
    const decision = evaluateAuctionStep(state, policyObserve, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('BID_CANDIDATE');
    expect(decision.executionMode).toBe('OBSERVE');
    expect(decision.candidatePricePyg).toBe(989_990);
  });

  // CASO 7: ASSISTED mode -> candidate con executionMode ASSISTED
  it('Caso 7: generates candidate with ASSISTED executionMode requiring human confirmation', () => {
    const policyAssisted = createPolicy(true, 'ASSISTED', 10);
    const state = createPostRandomState('AVAILABLE', 990_000);
    const decision = evaluateAuctionStep(state, policyAssisted, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('BID_CANDIDATE');
    expect(decision.executionMode).toBe('ASSISTED');
    expect(decision.candidatePricePyg).toBe(989_990);
  });

  // CASO 8: BOUNDED_AUTO -> candidate con executionMode BOUNDED_AUTO
  it('Caso 8: generates candidate with BOUNDED_AUTO executionMode', () => {
    const policyAuto = createPolicy(true, 'BOUNDED_AUTO', 10);
    const state = createPostRandomState('AVAILABLE', 990_000);
    const decision = evaluateAuctionStep(state, policyAuto, undefined, { currentTimestampIso: baseTime });

    expect(decision.action).toBe('BID_CANDIDATE');
    expect(decision.executionMode).toBe('BOUNDED_AUTO');
    expect(decision.candidatePricePyg).toBe(989_990);
  });

  // CASO 9: Timeout futuro / resultado ambiguo -> UNKNOWN -> RECONCILING (nunca retry ciego)
  // Reconciliación ACCEPTED termina en MIPYME_BID_CONFIRMED usando nuevo ReconciliationContext
  it('Caso 9: timeout + authoritative observation showing bid accepted → MIPYME_BID_CONFIRMED', () => {
    const policy = createPolicy(true, 'BOUNDED_AUTO', 10);
    const machine = new AuctionBotStateMachine(policy);
    machine.startMonitoring();

    const state = createPostRandomState('AVAILABLE', 990_000);
    machine.beginEvaluation();
    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });

    machine.handleDecision(decision, state);
    expect(machine.getState()).toBe('MIPYME_LAST_CHANCE');
    expect(machine.getMipymeAttemptStatus()).toBe('CANDIDATE_READY');

    // Pre-submit recheck against a fresh observation is mandatory.
    const recheck = machine.recheckCandidate(freshState(state), { nowIso: freshTime });
    expect(recheck.valid).toBe(true);

    // Submit bid (deterministic submittedAt for replay)
    const submission = machine.startSubmission('mipyme-bid-001', { submittedAtIso: submitTime });
    expect(submission.isMipyme).toBe(true);
    expect(machine.getState()).toBe('SUBMITTING');
    expect(machine.getMipymeAttemptStatus()).toBe('SUBMITTING');

    // Network timeout occurs -> UNKNOWN and RECONCILING, NEVER blind retry
    machine.markSubmissionUnknown('Socket timeout on SBE ACK');
    expect(machine.getState()).toBe('RECONCILING');
    expect(machine.getMipymeAttemptStatus()).toBe('UNKNOWN');
    // Ensure timeout does NOT pass to PRICE_ADJUSTMENT_PENDING
    expect(machine.getState()).not.toBe('PRICE_ADJUSTMENT_PENDING');

    // Portal state arrives showing our MIPYME offer in rank 1 (authoritative snapshot)
    const postReconciliationState: AuctionState = {
      ...state,
      observedAt: submitTime,
      rankedOffers: [
        { rank: 1, participantId: 'our-firm', isOurOffer: true, pricePyg: 989_990, timestamp: submitTime },
        { rank: 2, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 990_000, timestamp: baseTime },
      ],
      ourRank: 1,
      ourCurrentPricePyg: 989_990,
    };

    const recon = machine.reconcileWithState(postReconciliationState, { observationIsAuthoritative: true }, { nowIso: submitTime });
    // Three-way outcome
    expect(recon.outcome).toBe('ACCEPTED');
    expect(recon.foundRank).toBe(1);
    // P0.1 Requirement 1: MIPYME BID confirmado termina en MIPYME_BID_CONFIRMED, NO PRICE_CONFIRMED
    expect(machine.getState()).toBe('MIPYME_BID_CONFIRMED');
    expect(machine.getState()).not.toBe('PRICE_CONFIRMED');
    expect(machine.getState()).not.toBe('PRICE_ADJUSTMENT_PENDING');
    expect(machine.getMipymeAttemptStatus()).toBe('CONFIRMED');

    // Single-opportunity check: cannot generate another MIPYME candidate once confirmed
    machine.beginEvaluation();
    const secondDecision = evaluateAuctionStep(postReconciliationState, policy, undefined, { currentTimestampIso: submitTime });
    machine.handleDecision(secondDecision);
    // State remains in EVALUATING/MIPYME_BID_CONFIRMED, not reverting to MIPYME_LAST_CHANCE
    expect(machine.getState()).toBe('EVALUATING');
  });

  // CASO 10: Nueva Policy Version autorizada durante POST_RANDOM invalida candidate anterior
  it('Caso 10: authorizes a new Policy Version during POST_RANDOM and invalidates previous candidate', () => {
    const policyV1 = createPolicy(true, 'BOUNDED_AUTO', 10, 100); // 1% tolerance -> Auto Limit = 990.000
    const machine = new AuctionBotStateMachine(policyV1);
    machine.startMonitoring();

    // State where competitor is at 990.000 -> candidate 989.990 breaches Auto Limit (990.000)
    const state = createPostRandomState('AVAILABLE', 990_000);
    machine.beginEvaluation();
    const decisionV1 = evaluateAuctionStep(state, policyV1, undefined, { currentTimestampIso: baseTime });

    expect(decisionV1.action).toBe('STOP');
    machine.handleDecision(decisionV1);
    expect(machine.getState()).toBe('STOPPED');

    // Client authorizes Policy V2 with higher tolerance (300 bps / 3% -> Auto Limit = 970.000)
    const policyV2 = freezePolicy(
      {
        ...policyV1,
        autoDefenseToleranceBps: 300,
        autoLimitPyg: 970_000,
        authorizedBy: 'director.general@empresa.com.py',
      },
      2,
      '2026-09-10T20:05:00.000Z'
    );

    machine.applyNewPolicyVersion(policyV2);
    expect(machine.getState()).toBe('MONITORING');
    expect(machine.getContext().policy.version).toBe(2);
    expect(machine.getContext().lastDecision).toBeNull();
    expect(machine.getMipymeAttemptStatus()).toBe('NOT_ATTEMPTED');

    // Re-evaluate with fresh state under Policy V2
    machine.beginEvaluation();
    const decisionV2 = evaluateAuctionStep(state, policyV2, undefined, { currentTimestampIso: baseTime });

    expect(decisionV2.action).toBe('BID_CANDIDATE');
    expect(decisionV2.candidatePricePyg).toBe(989_990);
    expect(decisionV2.policyVersion).toBe(2);

    machine.handleDecision(decisionV2);
    expect(machine.getState()).toBe('MIPYME_LAST_CHANCE');
    expect(machine.getMipymeAttemptStatus()).toBe('CANDIDATE_READY');
  });

  // CASO 11: Direct submission confirmation transitions to MIPYME_BID_CONFIRMED (not PRICE_CONFIRMED)
  it('Caso 11: direct submission confirmation transitions to MIPYME_BID_CONFIRMED', () => {
    const policy = createPolicy(true, 'BOUNDED_AUTO', 10);
    const machine = new AuctionBotStateMachine(policy);
    machine.startMonitoring();

    const state = createPostRandomState('AVAILABLE', 990_000);
    machine.beginEvaluation();
    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });
    machine.handleDecision(decision, state);

    const recheck = machine.recheckCandidate(freshState(state), { nowIso: freshTime });
    expect(recheck.valid).toBe(true);

    machine.startSubmission('mipyme-bid-direct', { submittedAtIso: submitTime });
    expect(machine.getState()).toBe('SUBMITTING');

    machine.confirmSubmission();
    expect(machine.getState()).toBe('MIPYME_BID_CONFIRMED');
    expect(machine.getState()).not.toBe('PRICE_CONFIRMED');
    expect(machine.getMipymeAttemptStatus()).toBe('CONFIRMED');
  });

  // CASO 12: Separation of PROCESO A (MIPYME) and PROCESO B (Post-Auction Price Adjustment)
  it('Caso 12: PRICE_ADJUSTMENT_PENDING only appears in post-auction workflow after GROUP_CLOSED and ACTA_AVAILABLE', () => {
    const policy = createPolicy(true, 'BOUNDED_AUTO', 10);
    const machine = new AuctionBotStateMachine(policy);
    machine.startMonitoring();

    const state = createPostRandomState('AVAILABLE', 990_000);
    machine.beginEvaluation();
    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });
    machine.handleDecision(decision, state);
    const recheck = machine.recheckCandidate(freshState(state), { nowIso: freshTime });
    expect(recheck.valid).toBe(true);
    machine.startSubmission('mipyme-bid-proc', { submittedAtIso: submitTime });
    machine.confirmSubmission();

    expect(machine.getState()).toBe('MIPYME_BID_CONFIRMED');

    // Cannot jump straight to PRICE_ADJUSTMENT_PENDING
    expect(() => machine.startPostAuctionPriceAdjustment()).toThrow();

    // Portal closes auction session
    machine.notifyGroupClosed();
    expect(machine.getState()).toBe('AUCTION_SESSION_CLOSED');

    // Still cannot jump to PRICE_ADJUSTMENT_PENDING until Acta is published
    expect(() => machine.startPostAuctionPriceAdjustment()).toThrow();

    // Acta published
    machine.notifyActaAvailable();
    expect(machine.getState()).toBe('ACTA_AVAILABLE');

    // Now start post-auction price adjustment
    machine.startPostAuctionPriceAdjustment();
    expect(machine.getState()).toBe('PRICE_ADJUSTMENT_PENDING');

    // Confirm post-auction adjustment in SICP
    machine.confirmPriceAdjustment();
    expect(machine.getState()).toBe('PRICE_CONFIRMED');
  });

  // CASO 13: defenseStep = 7 incompatible with constraints produces POLICY_CONSTRAINT_VIOLATION without silent rounding
  it('Caso 13: defenseStep = 7 incompatible with constraints produces POLICY_CONSTRAINT_VIOLATION without auto-rounding', () => {
    // Client policy: defenseStep = 7
    const policy7 = createPolicy(true, 'BOUNDED_AUTO', 7);
    const state = createPostRandomState('AVAILABLE', 1_000_000);

    // SBE constraint: requires decrement multiple of 10 (or minimum decrement 10)
    // 7 is incompatible!
    const incompatibleConstraints = {
      minimumDecrementPyg: 10,
      stepMultiplePyg: 10,
    };

    const decision = evaluateAuctionStep(state, policy7, incompatibleConstraints, { currentTimestampIso: baseTime });

    // Must FAIL-CLOSED with POLICY_CONSTRAINT_VIOLATION
    expect(decision.action).toBe('HALT');
    expect(decision.reasonCode).toBe('POLICY_CONSTRAINT_VIOLATION');
    // Crucial: The candidate price MUST reflect exactly the client's choice (1.000.000 - 7 = 999.993)
    // and NEVER be silently rounded to 999.990!
    expect(decision.candidatePricePyg).toBe(999_993);
    expect(decision.defenseStepAppliedPyg).toBe(7);
    expect(decision.reasonDescription).toContain('No se modificó silenciosamente el monto');
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // CASOS 14-17: Three-way Reconciliation (Fail-Closed)
  // ─────────────────────────────────────────────────────────────────────────────

  function setupReconciliationMachine(bidId: string): AuctionBotStateMachine {
    const policy = createPolicy(true, 'BOUNDED_AUTO', 10);
    const machine = new AuctionBotStateMachine(policy);
    machine.startMonitoring();

    const state = createPostRandomState('AVAILABLE', 990_000);
    machine.beginEvaluation();
    const decision = evaluateAuctionStep(state, policy, undefined, { currentTimestampIso: baseTime });
    machine.handleDecision(decision, state);
    const recheck = machine.recheckCandidate(freshState(state), { nowIso: freshTime });
    expect(recheck.valid).toBe(true);
    machine.startSubmission(bidId, { submittedAtIso: submitTime });
    machine.markSubmissionUnknown('Socket timeout');
    return machine;
  }

  // CASO 14: Timeout + bid visible en snapshot autoritativo → ACCEPTED → MIPYME_BID_CONFIRMED
  it('Caso 14: timeout + bid found in authoritative observation → ACCEPTED → MIPYME_BID_CONFIRMED', () => {
    const machine = setupReconciliationMachine('bid-case-14');

    const stateWithBid: AuctionState = {
      auctionId: 'auc-dncp-99',
      groupId: 'item-1',
      scope: 'ITEM',
      phase: 'POST_RANDOM',
      timingWindow: 'EXPIRED',
      closeRisk: false,
      status: 'ACTIVE',
      rankedOffers: [
        { rank: 1, participantId: 'our-firm', isOurOffer: true, pricePyg: 989_990, timestamp: submitTime },
        { rank: 2, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 990_000, timestamp: baseTime },
      ],
      ourRank: 1,
      ourCurrentPricePyg: 989_990,
      observedAt: submitTime,
    };

    const result = machine.reconcileWithState(stateWithBid, { observationIsAuthoritative: true }, { nowIso: submitTime });

    expect(result.outcome).toBe('ACCEPTED');
    expect(result.foundRank).toBe(1);
    expect(machine.getState()).toBe('MIPYME_BID_CONFIRMED');
    expect(machine.getMipymeAttemptStatus()).toBe('CONFIRMED');
  });

  // CASO 15: Timeout + bid NOT found + snapshot autoritativo → NOT_ACCEPTED → STOPPED (MIPYME)
  it('Caso 15: timeout + bid not found in authoritative observation → NOT_ACCEPTED → STOPPED', () => {
    const machine = setupReconciliationMachine('bid-case-15');

    const stateWithoutBid: AuctionState = {
      auctionId: 'auc-dncp-99',
      groupId: 'item-1',
      scope: 'ITEM',
      phase: 'POST_RANDOM',
      timingWindow: 'EXPIRED',
      closeRisk: false,
      status: 'ACTIVE',
      rankedOffers: [
        { rank: 1, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 990_000, timestamp: baseTime },
        { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_005_000, timestamp: baseTime },
      ],
      ourRank: 2,
      ourCurrentPricePyg: 1_005_000,
      observedAt: submitTime,
    };

    const result = machine.reconcileWithState(stateWithoutBid, { observationIsAuthoritative: true }, { nowIso: submitTime });

    expect(result.outcome).toBe('NOT_ACCEPTED');
    expect(machine.getState()).toBe('STOPPED');
    expect(machine.getMipymeAttemptStatus()).toBe('EXPIRED');
  });

  // CASO 16: Timeout + bid NOT found + snapshot NO autoritativo → AMBIGUOUS → HALTED
  it('Caso 16: timeout + bid not found in NON-authoritative observation → AMBIGUOUS → HALTED', () => {
    const machine = setupReconciliationMachine('bid-case-16');

    const nonAuthoritativeState: AuctionState = {
      auctionId: 'auc-dncp-99',
      groupId: 'item-1',
      scope: 'ITEM',
      phase: 'POST_RANDOM',
      timingWindow: 'EXPIRED',
      closeRisk: false,
      status: 'ACTIVE',
      rankedOffers: [
        // Our bid at 989.990 NOT visible yet — but observation is NOT authoritative
        { rank: 1, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 990_000, timestamp: baseTime },
        { rank: 2, participantId: 'our-firm', isOurOffer: true, pricePyg: 1_005_000, timestamp: baseTime },
      ],
      ourRank: 2,
      ourCurrentPricePyg: 1_005_000,
      observedAt: submitTime,
    };

    // Caller cannot guarantee the snapshot is complete
    const result = machine.reconcileWithState(nonAuthoritativeState, { observationIsAuthoritative: false }, { nowIso: submitTime });

    expect(result.outcome).toBe('AMBIGUOUS');
    expect(machine.getState()).toBe('HALTED');
    expect(machine.getMipymeAttemptStatus()).toBe('UNKNOWN');
    // Verify the reason explains why it halted
    expect(result.reason).toContain('intervención humana');
  });

  // CASO 17: Timeout + explicit adapter rejection → NOT_ACCEPTED (regardless of observation)
  it('Caso 17: timeout + explicit adapter rejection → NOT_ACCEPTED → STOPPED even without authoritative snapshot', () => {
    const machine = setupReconciliationMachine('bid-case-17');

    const anyState: AuctionState = {
      auctionId: 'auc-dncp-99',
      groupId: 'item-1',
      scope: 'ITEM',
      phase: 'POST_RANDOM',
      timingWindow: 'EXPIRED',
      closeRisk: false,
      status: 'ACTIVE',
      rankedOffers: [
        { rank: 1, participantId: 'comp-alpha', isOurOffer: false, pricePyg: 990_000, timestamp: baseTime },
      ],
      ourRank: null,
      ourCurrentPricePyg: null,
      observedAt: submitTime,
    };

    // SBE adapter received an explicit rejection code for this bidId
    const result = machine.reconcileWithState(anyState, {
      observationIsAuthoritative: false,
      explicitRejectionFromAdapter: true,
    }, { nowIso: submitTime });

    expect(result.outcome).toBe('NOT_ACCEPTED');
    expect(result.reason).toContain('rechazada explícitamente');
    expect(machine.getState()).toBe('STOPPED');
    expect(machine.getMipymeAttemptStatus()).toBe('EXPIRED');
  });
});
