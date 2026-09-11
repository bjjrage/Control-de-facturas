/**
 * SBE AUCTION BOT - Policy Validation, Integer Arithmetic & Deep Freeze
 * Uses integer Basis Points (bps) for monetary calculations in PYG.
 */

import { AuctionPolicy, FrozenAuctionPolicy } from './types';
import { PolicyValidationError } from './errors';

/**
 * Converts percentage (e.g. 2, 1.5, 0.25) to integer Basis Points (1% = 100 bps).
 */
export function tolerancePctToBps(pct: number): number {
  return Math.round(pct * 100);
}

/**
 * Converts integer Basis Points to display percentage.
 */
export function bpsToTolerancePct(bps: number): number {
  return bps / 100;
}

/**
 * Calculates the exact auto-defense limit price authorized by the policy.
 * Uses pure integer BigInt arithmetic in PYG integers:
 * autoLimit = floor(targetPrice * (10000 - toleranceBps) / 10000)
 * 
 * Rounding Rule: Integer truncation / floor division (conservative integer floor).
 * Never uses floating point for the financial boundary.
 */
export function calculateAutoLimitPyg(targetPricePyg: number, autoDefenseToleranceBps: number): number {
  if (targetPricePyg <= 0) return 0;
  if (autoDefenseToleranceBps <= 0) return targetPricePyg;
  if (autoDefenseToleranceBps >= 10000) return 0;

  const targetBig = BigInt(Math.floor(targetPricePyg));
  const factorBig = BigInt(10000 - autoDefenseToleranceBps);
  const autoLimitBig = (targetBig * factorBig) / BigInt(10000);

  return Number(autoLimitBig);
}

/**
 * Recursively freezes an object and its nested properties.
 */
export function deepFreeze<T extends object>(obj: T): T {
  const propNames = Reflect.ownKeys(obj);
  for (const name of propNames) {
    const value = (obj as any)[name];
    if ((typeof value === 'object' || typeof value === 'function') && value !== null) {
      deepFreeze(value);
    }
  }
  return Object.freeze(obj);
}

/**
 * Validates an AuctionPolicy object and returns an array of validation errors (if any).
 */
export function validateAuctionPolicy(policy: Partial<AuctionPolicy>): string[] {
  const errors: string[] = [];

  if (!policy.policyId || typeof policy.policyId !== 'string' || policy.policyId.trim() === '') {
    errors.push('policyId is required and must be a non-empty string');
  }
  if (!policy.auctionId || typeof policy.auctionId !== 'string' || policy.auctionId.trim() === '') {
    errors.push('auctionId is required and must be a non-empty string');
  }
  if (!policy.groupId || typeof policy.groupId !== 'string' || policy.groupId.trim() === '') {
    errors.push('groupId is required and must be a non-empty string');
  }
  if (!policy.scope || !['ITEM', 'LOT', 'TOTAL'].includes(policy.scope)) {
    errors.push('scope must be ITEM, LOT, or TOTAL');
  }
  if (typeof policy.targetRank !== 'number' || policy.targetRank < 1 || !Number.isInteger(policy.targetRank)) {
    errors.push('targetRank must be an integer >= 1');
  }
  // defenseStep is a free positive integer (₲1, ₲7, ₲23, ₲100, ₲5.000, etc.)
  if (typeof policy.defenseStepPyg !== 'number' || policy.defenseStepPyg <= 0 || !Number.isInteger(policy.defenseStepPyg)) {
    errors.push('defenseStepPyg must be a free positive integer PYG (> 0)');
  }
  if (typeof policy.targetPricePyg !== 'number' || policy.targetPricePyg <= 0 || !Number.isInteger(policy.targetPricePyg)) {
    errors.push('targetPricePyg must be a positive integer in PYG');
  }
  if (
    typeof policy.autoDefenseToleranceBps !== 'number' ||
    policy.autoDefenseToleranceBps < 0 ||
    policy.autoDefenseToleranceBps > 10000 ||
    !Number.isInteger(policy.autoDefenseToleranceBps)
  ) {
    errors.push('autoDefenseToleranceBps must be an integer between 0 and 10000 (0% to 100%)');
  }
  if (typeof policy.autoLimitPyg !== 'number' || policy.autoLimitPyg <= 0) {
    errors.push('autoLimitPyg must be a positive number');
  } else if (policy.targetPricePyg && policy.autoDefenseToleranceBps !== undefined) {
    const expectedAutoLimit = calculateAutoLimitPyg(policy.targetPricePyg, policy.autoDefenseToleranceBps);
    if (policy.autoLimitPyg !== expectedAutoLimit) {
      errors.push(`autoLimitPyg (${policy.autoLimitPyg}) does not match calculated integer auto limit (${expectedAutoLimit})`);
    }
  }
  if (!policy.executionMode || !['OBSERVE', 'ASSISTED', 'BOUNDED_AUTO'].includes(policy.executionMode)) {
    errors.push('executionMode must be OBSERVE, ASSISTED, or BOUNDED_AUTO');
  }
  if (typeof policy.maxStalenessMs !== 'number' || policy.maxStalenessMs < 500) {
    errors.push('maxStalenessMs must be at least 500 ms');
  }
  if (!policy.authorizedBy || typeof policy.authorizedBy !== 'string' || policy.authorizedBy.trim() === '') {
    errors.push('authorizedBy is required (identifies the operator / system authorizing the policy)');
  }
  if (!policy.mipymePolicy || typeof policy.mipymePolicy !== 'object') {
    errors.push('mipymePolicy is required');
  } else {
    if (typeof policy.mipymePolicy.enabled !== 'boolean') {
      errors.push('mipymePolicy.enabled must be a boolean');
    }
    if (!['OBSERVE', 'ASSISTED', 'BOUNDED_AUTO'].includes(policy.mipymePolicy.executionMode)) {
      errors.push('mipymePolicy.executionMode must be OBSERVE, ASSISTED, or BOUNDED_AUTO');
    }
    if (
      typeof policy.mipymePolicy.defenseStepPyg !== 'number' ||
      policy.mipymePolicy.defenseStepPyg <= 0 ||
      !Number.isInteger(policy.mipymePolicy.defenseStepPyg)
    ) {
      errors.push('mipymePolicy.defenseStepPyg must be a positive integer PYG (> 0)');
    }
    if (policy.mipymePolicy.economicLimitMode !== 'USE_CURRENT_AUTO_LIMIT') {
      errors.push('mipymePolicy.economicLimitMode must be USE_CURRENT_AUTO_LIMIT');
    }
  }

  return errors;
}

/**
 * Generates a non-cryptographic technical fingerprint of the canonical parameters snapshot.
 * Note: This is an integrity / change-detection fingerprint, NOT a cryptographic authority token.
 */
export function generateTechnicalFingerprint(policy: AuctionPolicy, version: number): string {
  const canonical = JSON.stringify({
    policyId: policy.policyId,
    auctionId: policy.auctionId,
    groupId: policy.groupId,
    scope: policy.scope,
    positionStrategy: policy.positionStrategy,
    targetRank: policy.targetRank,
    defenseStepPyg: policy.defenseStepPyg,
    normalPhaseBehavior: policy.normalPhaseBehavior,
    safeWindowBehavior: policy.safeWindowBehavior,
    enterTargetPositionInEntryWindow: policy.enterTargetPositionInEntryWindow,
    defendImmediatelyInCloseRisk: policy.defendImmediatelyInCloseRisk,
    targetPricePyg: policy.targetPricePyg,
    autoDefenseToleranceBps: policy.autoDefenseToleranceBps,
    autoLimitPyg: policy.autoLimitPyg,
    mipymePolicy: policy.mipymePolicy ? {
      enabled: policy.mipymePolicy.enabled,
      executionMode: policy.mipymePolicy.executionMode,
      defenseStepPyg: policy.mipymePolicy.defenseStepPyg,
      economicLimitMode: policy.mipymePolicy.economicLimitMode,
    } : undefined,
    executionMode: policy.executionMode,
    maxStalenessMs: policy.maxStalenessMs,
    authorizedBy: policy.authorizedBy,
    version,
  });

  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Freezes an authorized policy version with deep immutability.
 */
export function freezePolicy(
  policy: AuctionPolicy,
  version: number = 1,
  authorizedAt: string = new Date().toISOString()
): FrozenAuctionPolicy {
  const errors = validateAuctionPolicy(policy);
  if (errors.length > 0) {
    throw new PolicyValidationError(errors);
  }

  const policyFingerprint = generateTechnicalFingerprint(policy, version);

  const frozenDraft: FrozenAuctionPolicy = {
    ...policy,
    isFrozen: true,
    version,
    authorizedAt,
    policyFingerprint,
  };

  return deepFreeze(frozenDraft);
}

/**
 * Checks if the frozen policy matches its technical fingerprint snapshot.
 */
export function verifyPolicyFingerprint(policy: FrozenAuctionPolicy): boolean {
  if (!policy.isFrozen) return false;
  const expected = generateTechnicalFingerprint(policy, policy.version);
  return policy.policyFingerprint === expected;
}
