/**
 * AUCTION SANDBOX — Policy versioning (pure record builder).
 *
 * The Auction Lab PERSISTS every authorized policy: validate → freeze →
 * immutable snapshot + fingerprint + version metadata. The server action
 * inserts the returned record (unique(room_id, version)); v1 is never mutated.
 * Reuses the Core's validate/freeze/fingerprint — no parallel logic.
 */
import { freezePolicy, generateTechnicalFingerprint, validateAuctionPolicy } from '../auction-bot/policy';
import { AuctionPolicy, FrozenAuctionPolicy } from '../auction-bot/types';

/**
 * Canonical economic content of a policy: everything EXCEPT version/audit
 * metadata (policyId, version, authorizedBy/At, fingerprint). Two drafts with
 * equal content authorize the same economics — used for retry idempotency
 * (same content twice must not inflate the version).
 */
const CONTENT_FIELDS = [
  'auctionId', 'groupId', 'scope', 'positionStrategy', 'targetRank',
  'defenseStepPyg', 'normalPhaseBehavior', 'safeWindowBehavior',
  'enterTargetPositionInEntryWindow', 'defendImmediatelyInCloseRisk',
  'targetPricePyg', 'autoDefenseToleranceBps', 'autoLimitPyg',
  'mipymePolicy', 'executionMode', 'maxStalenessMs',
] as const;

export function samePolicyContent(a: AuctionPolicy, b: AuctionPolicy): boolean {
  return CONTENT_FIELDS.every(
    (f) => JSON.stringify(a[f]) === JSON.stringify((b as AuctionPolicy)[f])
  );
}

export interface SandboxPolicyRecord {
  room_id: string;
  version: number;
  policy_id: string;
  snapshot: FrozenAuctionPolicy;
  fingerprint: string;
  authorized_by: string;
  authorized_at: string;
}

export function buildPolicyVersionRecord(
  roomId: string,
  draft: AuctionPolicy,
  version: number,
  authorizedBy: string,
  authorizedAtIso: string
): SandboxPolicyRecord {
  const errors = validateAuctionPolicy(draft);
  if (errors.length > 0) {
    throw new Error(`Política inválida: ${errors.join('; ')}`);
  }
  const frozen = freezePolicy(draft, version, authorizedAtIso);
  return {
    room_id: roomId,
    version,
    policy_id: frozen.policyId,
    snapshot: JSON.parse(JSON.stringify(frozen)) as FrozenAuctionPolicy,
    fingerprint: generateTechnicalFingerprint(draft, version),
    authorized_by: authorizedBy,
    authorized_at: authorizedAtIso,
  };
}

/** Restores a frozen policy from its persisted snapshot (with integrity check). */export function policyFromSnapshot(record: { snapshot: unknown; version: number; fingerprint: string; policy_id: string }): FrozenAuctionPolicy {
  const policy = record.snapshot as FrozenAuctionPolicy | null | undefined;
  if (!policy || policy.isFrozen !== true) {
    throw new Error('Snapshot de política corrupto: no está congelado.');
  }
  // Metadata cross-checks: the snapshot must agree with its version row.
  if (policy.version !== record.version) {
    throw new Error(`Snapshot de política corrupto: version ${policy.version} ≠ fila ${record.version}.`);
  }
  if (policy.policyId !== record.policy_id) {
    throw new Error('Snapshot de política corrupto: policyId no coincide con la fila.');
  }
  if (policy.policyFingerprint !== record.fingerprint) {
    throw new Error('Snapshot de política corrupto: fingerprint no coincide con la fila.');
  }
  if (generateTechnicalFingerprint(policy, record.version) !== record.fingerprint) {
    throw new Error('Snapshot de política corrupto: fingerprint recalculado no coincide.');
  }
  return policy;
}

export interface PolicyContinuityInput {
  roomId: string;
  roomGroupId: string;
  roomScope: 'ITEM' | 'LOT' | 'TOTAL';
  /** Previous persisted version row (null when authorizing v1). */
  prev: { version: number; policy_id: string } | null;
  /** Draft ALREADY room-bound server-side (never trust browser identity). */
  draft: AuctionPolicy;
  version: number;
  /** Non-empty operator identity; must equal draft.authorizedBy. */
  authorizedBy: string;
}

/**
 * Server-side canonical binding + version continuity. Returns error list
 * (empty = ok). The caller must overwrite draft identity fields with the
 * room truth BEFORE calling: auctionId = room.id, groupId = room.group_id,
 * scope = room.scope, authorizedBy = operator, policyId = server-assigned.
 */
export function checkPolicyContinuity(input: PolicyContinuityInput): string[] {
  const errors: string[] = [];
  if (input.draft.auctionId !== input.roomId) errors.push('La policy debe pertenecer a esta sala (auctionId).');
  if (input.draft.groupId !== input.roomGroupId) errors.push('La policy debe usar el group_id de la sala.');
  if (input.draft.scope !== input.roomScope) errors.push('La policy debe usar el scope de la sala.');
  if (!input.authorizedBy || input.authorizedBy.trim() === '') errors.push('Indicá quién autoriza.');
  if (input.draft.authorizedBy !== input.authorizedBy) errors.push('authorizedBy del snapshot no coincide con el operador.');
  if (input.prev === null) {
    if (input.version !== 1) errors.push('La primera versión debe ser v1.');
    if (!input.draft.policyId || input.draft.policyId.trim() === '') errors.push('Falta policyId generado por el servidor.');
  } else {
    if (input.draft.policyId !== input.prev.policy_id) {
      errors.push('v2+ debe conservar el policyId de la versión anterior (no es una policy nueva).');
    }
    if (input.version !== input.prev.version + 1) errors.push('La versión debe ser exactamente anterior + 1.');
  }
  return errors;
}
