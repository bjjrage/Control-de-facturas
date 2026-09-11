/**
 * SBE AUCTION BOT - Technical Platform Constraints Validator
 * Decoupled from client strategy.
 */

import { SbeConstraints } from './types';

export interface SbeValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates the technical integrity of the SbeConstraints object itself.
 */
export function validateSbeConstraints(constraints: SbeConstraints): SbeValidationResult {
  const errors: string[] = [];
  if (typeof constraints.minimumDecrementPyg !== 'number' || constraints.minimumDecrementPyg <= 0) {
    errors.push('minimumDecrementPyg must be greater than 0');
  }
  if (constraints.minimumOfferPyg !== undefined && constraints.minimumOfferPyg <= 0) {
    errors.push('minimumOfferPyg must be greater than 0');
  }
  if (constraints.maximumOfferPyg !== undefined && constraints.maximumOfferPyg <= 0) {
    errors.push('maximumOfferPyg must be greater than 0');
  }
  if (
    constraints.minimumOfferPyg !== undefined &&
    constraints.maximumOfferPyg !== undefined &&
    constraints.minimumOfferPyg > constraints.maximumOfferPyg
  ) {
    errors.push('minimumOfferPyg cannot exceed maximumOfferPyg');
  }
  if (constraints.stepMultiplePyg !== undefined && constraints.stepMultiplePyg <= 0) {
    errors.push('stepMultiplePyg must be greater than 0');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Checks whether a candidate offer price satisfies platform rules.
 */
export function validateOfferAgainstSbeConstraints(
  candidatePricePyg: number,
  constraints: SbeConstraints,
  referenceTargetPricePyg?: number
): SbeValidationResult {
  const errors: string[] = [];

  if (candidatePricePyg <= 0) {
    errors.push('Candidate price must be greater than 0');
  }

  if (constraints.minimumOfferPyg !== undefined && candidatePricePyg < constraints.minimumOfferPyg) {
    errors.push(`Candidate price ₲${candidatePricePyg.toLocaleString()} is below platform minimum ₲${constraints.minimumOfferPyg.toLocaleString()}`);
  }

  if (constraints.maximumOfferPyg !== undefined && candidatePricePyg > constraints.maximumOfferPyg) {
    errors.push(`Candidate price ₲${candidatePricePyg.toLocaleString()} exceeds platform maximum ₲${constraints.maximumOfferPyg.toLocaleString()}`);
  }

  if (referenceTargetPricePyg !== undefined && referenceTargetPricePyg > 0) {
    const decrement = referenceTargetPricePyg - candidatePricePyg;
    if (decrement < constraints.minimumDecrementPyg) {
      errors.push(
        `Decrement ₲${decrement.toLocaleString()} is below platform minimum required decrement ₲${constraints.minimumDecrementPyg.toLocaleString()}`
      );
    }
  }

  if (constraints.stepMultiplePyg !== undefined && constraints.stepMultiplePyg > 1) {
    if (candidatePricePyg % constraints.stepMultiplePyg !== 0) {
      errors.push(`Candidate price ₲${candidatePricePyg.toLocaleString()} is not a multiple of ₲${constraints.stepMultiplePyg.toLocaleString()}`);
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
