/**
 * SBE AUCTION BOT - Typed Domain Errors
 */

export class AuctionBotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuctionBotError';
  }
}

export class PolicyValidationError extends AuctionBotError {
  constructor(public readonly validationErrors: string[]) {
    super(`Auction policy validation failed: ${validationErrors.join(', ')}`);
    this.name = 'PolicyValidationError';
  }
}

export class PolicyFrozenError extends AuctionBotError {
  constructor(message: string = 'Policy must be frozen and authorized to execute in auction runtime.') {
    super(message);
    this.name = 'PolicyFrozenError';
  }
}

export class StaleStateError extends AuctionBotError {
  constructor(public readonly ageMs: number, public readonly maxStalenessMs: number) {
    super(`Auction state is stale (age: ${ageMs}ms > max: ${maxStalenessMs}ms).`);
    this.name = 'StaleStateError';
  }
}

export class EconomicLimitBreachedError extends AuctionBotError {
  constructor(
    public readonly candidatePricePyg: number,
    public readonly autoLimitPyg: number
  ) {
    super(`Candidate price ₲${candidatePricePyg.toLocaleString()} reaches current policy auto-limit ₲${autoLimitPyg.toLocaleString()}`);
    this.name = 'EconomicLimitBreachedError';
  }
}

export class SbeConstraintViolationError extends AuctionBotError {
  constructor(message: string) {
    super(`SBE platform technical constraint violated: ${message}`);
    this.name = 'SbeConstraintViolationError';
  }
}

export class ObserveModeSubmissionError extends AuctionBotError {
  constructor() {
    super('Submission blocked: execution mode is OBSERVE. OBSERVE policies audit only and can never submit bids.');
    this.name = 'ObserveModeSubmissionError';
  }
}

export class HumanAuthorizationRequiredError extends AuctionBotError {
  constructor() {
    super('Submission blocked: ASSISTED mode requires an explicit, single-use human authorization (grantHumanAuthorization) before startSubmission.');
    this.name = 'HumanAuthorizationRequiredError';
  }
}

export class StaleCandidateError extends AuctionBotError {
  constructor(detail?: string) {
    super(
      `Submission blocked: candidate was not re-validated against a fresh observation (pre-submit recheck).${detail ? ` ${detail}` : ''}`
    );
    this.name = 'StaleCandidateError';
  }
}
