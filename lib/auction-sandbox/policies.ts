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

/** Restores a frozen policy from its persisted snapshot (with integrity check). */
export function policyFromSnapshot(record: { snapshot: unknown; version: number; fingerprint: string }): FrozenAuctionPolicy {
  const policy = record.snapshot as FrozenAuctionPolicy | null | undefined;
  if (!policy || policy.isFrozen !== true) {
    throw new Error('Snapshot de política corrupto: no está congelado.');
  }
  if (generateTechnicalFingerprint(policy, record.version) !== record.fingerprint) {
    throw new Error('Snapshot de política corrupto: fingerprint no coincide.');
  }
  return policy;
}
