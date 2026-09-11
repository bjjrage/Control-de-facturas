/**
 * AUCTION SANDBOX — Token generation & hashing.
 *
 * Tokens are cryptographically random (256 bit) and only their SHA-256 hex
 * digest is persisted. Lookup is always by hash; the raw token is shown to
 * the operator exactly once at room creation.
 */
import { randomBytes, createHash } from 'crypto';

export function generateSandboxToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSandboxToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isValidSandboxTokenFormat(token: string): boolean {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{32,64}$/.test(token);
}
