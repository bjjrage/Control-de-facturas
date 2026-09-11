/**
 * SBE AUCTION BOT - Deterministic Strategy Engine (Sanitized V0)
 * 100% Pure, deterministic evaluation of auction state + frozen policy.
 * Fail-Closed on ambiguity, staleness, or rule violations.
 */

import {
  ActionDecision,
  AuctionState,
  FrozenAuctionPolicy,
  SbeConstraints,
} from './types';
import { verifyPolicyFingerprint } from './policy';
import { evaluatePositionGoal } from './position-evaluator';
import { validateOfferAgainstSbeConstraints } from './constraints';

export interface EvaluateStepOptions {
  currentTimestampIso?: string; // Injectable for deterministic replay/simulation
}

/**
 * Evaluates the current auction state against the frozen policy according to the 8-step central rule.
 */
export function evaluateAuctionStep(
  state: AuctionState,
  policy: FrozenAuctionPolicy,
  constraints?: SbeConstraints,
  options?: EvaluateStepOptions
): ActionDecision {
  const nowIso = options?.currentTimestampIso ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const observedMs = Date.parse(state.observedAt);

  const baseDecision: Pick<
    ActionDecision,
    'evaluatedAt' | 'executionMode' | 'policyVersion' | 'autoLimitPyg' | 'targetPricePyg' | 'currentRank'
  > = {
    evaluatedAt: nowIso,
    executionMode: policy.executionMode,
    policyVersion: policy.version,
    autoLimitPyg: policy.autoLimitPyg,
    targetPricePyg: policy.targetPricePyg,
    currentRank: state.ourRank,
  };

  // Invalid timestamps fail closed: NaN arithmetic would silently skip the
  // freshness validation below (any comparison with NaN is false).
  // A future-dated observation (observedAt > now) is equally untrustworthy —
  // there is no clock-skew policy yet, so fail closed.
  if (!Number.isFinite(nowMs) || !Number.isFinite(observedMs) || observedMs > nowMs) {
    return {
      ...baseDecision,
      action: 'HALT',
      reasonCode: 'INVALID_TIMESTAMP',
      reasonDescription: 'Timestamp inválido (now u observedAt no parseable, u observedAt futuro sin política de clock-skew). Detención preventiva: no se puede validar freshness sin tiempo confiable.',
      candidatePricePyg: null,
      targetRank: null,
      defenseStepAppliedPyg: null,
    };
  }

  // STEP 1: Observe & Validate State & Policy Integrity (Fail-Closed)
  if (!policy.isFrozen || !verifyPolicyFingerprint(policy)) {
    return {
      ...baseDecision,
      action: 'HALT',
      reasonCode: 'POLICY_NOT_FROZEN',
      reasonDescription: 'La política no está congelada o su fingerprint de integridad no coincide.',
      candidatePricePyg: null,
      targetRank: null,
      defenseStepAppliedPyg: null,
    };
  }

  // Policy scope / ID mismatch (fail-closed: never bid another scope's auction)
  if (
    policy.auctionId !== state.auctionId ||
    policy.groupId !== state.groupId ||
    policy.scope !== state.scope
  ) {
    const scopeNote = policy.scope !== state.scope
      ? ` Alcance incompatible (Policy: ${policy.scope} vs Estado: ${state.scope}).`
      : '';
    return {
      ...baseDecision,
      action: 'HALT',
      reasonCode: policy.scope !== state.scope ? 'SCOPE_MISMATCH' : 'POLICY_MISMATCH',
      reasonDescription: `Discrepancia de subasta/grupo (Policy: ${policy.auctionId}/${policy.groupId} vs Estado: ${state.auctionId}/${state.groupId}).${scopeNote}`,
      candidatePricePyg: null,
      targetRank: null,
      defenseStepAppliedPyg: null,
    };
  }

  // Freshness check
  const ageMs = Math.max(0, nowMs - observedMs);
  if (ageMs > policy.maxStalenessMs) {
    return {
      ...baseDecision,
      action: 'HALT',
      reasonCode: 'STALE_STATE',
      reasonDescription: `El estado de subasta está desactualizado (${ageMs}ms > máximo tolerado ${policy.maxStalenessMs}ms).`,
      candidatePricePyg: null,
      targetRank: null,
      defenseStepAppliedPyg: null,
    };
  }

  // Auction status & phase check
  if (state.status === 'CLOSED' || state.phase === 'CLOSED') {
    return {
      ...baseDecision,
      action: 'STOP',
      reasonCode: 'AUCTION_CLOSED',
      reasonDescription: 'La subasta ha finalizado (cerrada).',
      candidatePricePyg: null,
      targetRank: null,
      defenseStepAppliedPyg: null,
    };
  }

  if (state.status === 'PAUSED' || state.phase === 'PAUSED') {
    return {
      ...baseDecision,
      action: 'WAIT',
      reasonCode: 'AUCTION_PAUSED',
      reasonDescription: 'La subasta se encuentra pausada por el convocante. Esperando reactivación.',
      candidatePricePyg: null,
      targetRank: null,
      defenseStepAppliedPyg: null,
    };
  }

  if (state.status === 'UNKNOWN' || state.phase === 'UNKNOWN') {
    return {
      ...baseDecision,
      action: 'HALT',
      reasonCode: 'UNKNOWN_STATE',
      reasonDescription: 'El estado o fase de la subasta es desconocido. Detención preventiva por Fail-Closed.',
      candidatePricePyg: null,
      targetRank: null,
      defenseStepAppliedPyg: null,
    };
  }

  if (state.status !== 'ACTIVE') {
    return {
      ...baseDecision,
      action: 'HALT',
      reasonCode: 'AUCTION_NOT_ACTIVE',
      reasonDescription: `La subasta no está activa (estado actual: ${state.status}).`,
      candidatePricePyg: null,
      targetRank: null,
      defenseStepAppliedPyg: null,
    };
  }

  // STEP 2: Determine Temporal Phase & Timing Strategy (Independent of Position Goal)
  // PRE_AUCTION: the auction has not started — always WAIT, never BID_CANDIDATE.
  if (state.phase === 'PRE_AUCTION') {
    return {
      ...baseDecision,
      action: 'WAIT',
      reasonCode: 'AUCTION_PRE_AUCTION',
      reasonDescription: 'La subasta aún no inició (PRE_AUCTION). Espera al inicio; nunca se genera lance antes de la apertura.',
      candidatePricePyg: null,
      targetRank: null,
      defenseStepAppliedPyg: null,
    };
  }

  if (state.phase === 'NORMAL_BIDDING') {
    if (policy.normalPhaseBehavior === 'WAIT') {
      return {
        ...baseDecision,
        action: 'WAIT',
        reasonCode: 'TACTICAL_WAIT_NORMAL_PHASE',
        reasonDescription: 'Fase normal de lances: espera táctica configurada por el cliente para no revelar estrategia.',
        candidatePricePyg: null,
        targetRank: null,
        defenseStepAppliedPyg: null,
      };
    }
  } else if (state.phase === 'RANDOM_CLOSE') {
    if (state.timingWindow === 'SAFE_WINDOW' && policy.safeWindowBehavior === 'WAIT') {
      return {
        ...baseDecision,
        action: 'WAIT',
        reasonCode: 'TACTICAL_WAIT_SAFE_WINDOW',
        reasonDescription: 'Fase aleatoria (Safe Window): aún no hay riesgo de cierre, espera táctica en ejecución.',
        candidatePricePyg: null,
        targetRank: null,
        defenseStepAppliedPyg: null,
      };
    }
    // ENTRY_WINDOW is only actionable when the policy explicitly allows
    // acquiring the target position in that window.
    if (state.timingWindow === 'ENTRY_WINDOW' && policy.enterTargetPositionInEntryWindow === false) {
      return {
        ...baseDecision,
        action: 'WAIT',
        reasonCode: 'ENTRY_WINDOW_DISABLED_BY_POLICY',
        reasonDescription: 'Ventana de entrada (Entry Window): la política tiene deshabilitada la adquisición de posición en esta ventana. Espera.',
        candidatePricePyg: null,
        targetRank: null,
        defenseStepAppliedPyg: null,
      };
    }
    // Close-risk defense only fires when the policy explicitly enables it.
    const isCloseRiskNow = state.closeRisk || state.timingWindow === 'CLOSE_RISK_WINDOW';
    if (isCloseRiskNow && policy.defendImmediatelyInCloseRisk === false) {
      return {
        ...baseDecision,
        action: 'WAIT',
        reasonCode: 'CLOSE_RISK_DEFENSE_DISABLED_BY_POLICY',
        reasonDescription: 'Ventana de riesgo de cierre (Close-Risk): la política tiene deshabilitada la defensa inmediata. Espera.',
        candidatePricePyg: null,
        targetRank: null,
        defenseStepAppliedPyg: null,
      };
    }
  } else if (state.phase === 'POST_RANDOM') {
    const postRandom = state.postRandom;
    const mipymeStatus = postRandom?.mipymeBenefitStatus;

    if (!mipymeStatus || mipymeStatus === 'UNKNOWN') {
      return {
        ...baseDecision,
        action: 'HALT',
        reasonCode: 'MIPYME_BENEFIT_STATUS_UNKNOWN',
        reasonDescription: 'El estado del beneficio MIPYME es UNKNOWN o no fue provisto en POST_RANDOM. Detención preventiva por Fail-Closed.',
        candidatePricePyg: null,
        targetRank: null,
        defenseStepAppliedPyg: null,
        isMipymeLastChance: true,
      };
    }

    if (mipymeStatus === 'NOT_APPLICABLE' || mipymeStatus === 'UNAVAILABLE') {
      return {
        ...baseDecision,
        action: 'WAIT',
        reasonCode: 'MIPYME_BENEFIT_NOT_AVAILABLE',
        reasonDescription: `Fase aleatoria finalizada. El beneficio MIPYME no está disponible (${mipymeStatus}).`,
        candidatePricePyg: null,
        targetRank: null,
        defenseStepAppliedPyg: null,
        isMipymeLastChance: true,
      };
    }

    // Benefit is AVAILABLE
    if (!policy.mipymePolicy?.enabled) {
      return {
        ...baseDecision,
        action: 'WAIT',
        reasonCode: 'MIPYME_BENEFIT_DISABLED_BY_POLICY',
        reasonDescription: 'Beneficio MIPYME disponible en SBE pero deshabilitado en la política del cliente.',
        candidatePricePyg: null,
        targetRank: null,
        defenseStepAppliedPyg: null,
        isMipymeLastChance: true,
      };
    }

    // Identify best price to beat
    const competitorOffers = state.rankedOffers
      .filter((o) => !o.isOurOffer)
      .sort((a, b) => a.pricePyg - b.pricePyg);
    
    const bestPricePyg = postRandom.bestPricePyg ?? competitorOffers[0]?.pricePyg;

    if (bestPricePyg === undefined || bestPricePyg === null || bestPricePyg <= 0) {
      return {
        ...baseDecision,
        action: 'HALT',
        reasonCode: 'INVALID_COMPETITIVE_STATE',
        reasonDescription: 'No se identificó el mejor precio final de la subasta para aplicar el beneficio MIPYME.',
        candidatePricePyg: null,
        targetRank: null,
        defenseStepAppliedPyg: null,
        isMipymeLastChance: true,
      };
    }

    const defenseStep = policy.mipymePolicy.defenseStepPyg;
    const candidatePricePyg = bestPricePyg - defenseStep;

    // Check SBE constraints
    if (constraints) {
      const sbeValidation = validateOfferAgainstSbeConstraints(
        candidatePricePyg,
        constraints,
        bestPricePyg
      );
      if (!sbeValidation.isValid) {
        return {
          ...baseDecision,
          action: 'HALT',
          reasonCode: 'POLICY_CONSTRAINT_VIOLATION',
          reasonDescription: `Incompatibilidad entre la política del cliente (defenseStep ₲${defenseStep.toLocaleString()}) y restricciones técnicas SBE: ${sbeValidation.errors.join('; ')}. No se modificó silenciosamente el monto. Se requiere ajuste de política.`,
          candidatePricePyg,
          targetRank: 1,
          defenseStepAppliedPyg: defenseStep,
          isMipymeLastChance: true,
        };
      }
    }

    // Check Auto Limit
    if (candidatePricePyg < policy.autoLimitPyg) {
      return {
        ...baseDecision,
        action: 'STOP',
        reasonCode: 'ECONOMIC_LIMIT_BREACHED',
        reasonDescription: `El lance del beneficio MIPYME (₲${candidatePricePyg.toLocaleString()}) perfora el límite de defensa automática (₲${policy.autoLimitPyg.toLocaleString()}). Se detiene la oferta automática.`,
        candidatePricePyg,
        targetRank: 1,
        defenseStepAppliedPyg: defenseStep,
        isMipymeLastChance: true,
      };
    }

    return {
      ...baseDecision,
      action: 'BID_CANDIDATE',
      reasonCode: 'MIPYME_LAST_CHANCE_BID_REQUIRED',
      reasonDescription: `Oportunidad única MIPYME: lance propuesto ₲${candidatePricePyg.toLocaleString()} para superar el mejor precio ₲${bestPricePyg.toLocaleString()} por ₲${defenseStep.toLocaleString()}.`,
      candidatePricePyg,
      targetRank: 1,
      defenseStepAppliedPyg: defenseStep,
      executionMode: policy.mipymePolicy.executionMode,
      isMipymeLastChance: true,
    };
  }

  // STEP 3 & 4: Position Goal Evaluation
  const positionResult = evaluatePositionGoal(state, policy.targetRank, policy.defenseStepPyg);

  // No reference price exists for the requested target rank: never invent one.
  if (positionResult.insufficientEvidence) {
    return {
      ...baseDecision,
      action: 'WAIT',
      reasonCode: 'INSUFFICIENT_EVIDENCE_FOR_TARGET_RANK',
      reasonDescription: positionResult.reason,
      candidatePricePyg: null,
      targetRank: positionResult.targetRank,
      defenseStepAppliedPyg: null,
    };
  }

  if (positionResult.isSatisfied || positionResult.candidatePricePyg === null) {
    return {
      ...baseDecision,
      action: 'WAIT',
      reasonCode: 'ALREADY_AT_TARGET_POSITION',
      reasonDescription: positionResult.reason,
      candidatePricePyg: null,
      targetRank: positionResult.targetRank,
      defenseStepAppliedPyg: null,
    };
  }

  // STEP 5 & 6: Candidate Price & Defense Step
  const candidatePricePyg = positionResult.candidatePricePyg;
  const targetRank = positionResult.targetRank;
  const defenseStepApplied = policy.defenseStepPyg;

  // STEP 7: SBE Constraints Check
  if (constraints) {
    const sbeValidation = validateOfferAgainstSbeConstraints(
      candidatePricePyg,
      constraints,
      positionResult.referenceCompetitorPricePyg ?? undefined
    );
    if (!sbeValidation.isValid) {
      return {
        ...baseDecision,
        action: 'HALT',
        reasonCode: 'POLICY_CONSTRAINT_VIOLATION',
        reasonDescription: `Incompatibilidad entre la política del cliente (defenseStep ₲${defenseStepApplied.toLocaleString()}) y restricciones técnicas SBE: ${sbeValidation.errors.join('; ')}. No se modificó silenciosamente el monto. Se requiere ajuste de política.`,
        candidatePricePyg,
        targetRank,
        defenseStepAppliedPyg: defenseStepApplied,
      };
    }
  }

  // STEP 7 (cont): Economic Authorization Check (Auto Limit)
  // Semantics: autoLimitPyg is the limit authorized by the current policy.
  // Below autoLimitPyg -> STOP (requires operator override / new policy version).
  if (candidatePricePyg < policy.autoLimitPyg) {
    return {
      ...baseDecision,
      action: 'STOP',
      reasonCode: 'ECONOMIC_LIMIT_BREACHED',
      reasonDescription: `Límite de defensa automática alcanzado. El lance necesario ₲${candidatePricePyg.toLocaleString()} es inferior al límite autorizado ₲${policy.autoLimitPyg.toLocaleString()} (Target: ₲${policy.targetPricePyg.toLocaleString()} -${policy.autoDefenseToleranceBps / 100}%). Se detienen ofertas automáticas; requiere nueva versión de política autorizada para continuar.`,
      candidatePricePyg,
      targetRank,
      defenseStepAppliedPyg: defenseStepApplied,
    };
  }

  // STEP 8: Return Deterministic Action
  const isCloseRisk = state.closeRisk || state.timingWindow === 'CLOSE_RISK_WINDOW';
  const reasonCode = isCloseRisk
    ? 'TARGET_POSITION_DEFENSE_REQUIRED'
    : state.timingWindow === 'ENTRY_WINDOW'
    ? 'ENTRY_POSITION_REQUIRED'
    : 'TARGET_POSITION_DEFENSE_REQUIRED';

  return {
    ...baseDecision,
    action: 'BID_CANDIDATE',
    reasonCode,
    reasonDescription: positionResult.reason,
    candidatePricePyg,
    targetRank,
    defenseStepAppliedPyg: defenseStepApplied,
    isMipymeLastChance: false,
  };
}
