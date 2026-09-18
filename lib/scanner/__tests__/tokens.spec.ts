import { describe, expect, it } from 'vitest';
import {
  generateScanPin,
  generateScanToken,
  hashScanToken,
  isSessionExpired,
} from '../tokens';

describe('Scanner Tokens & Security', () => {
  it('genera tokens únicos de 64 caracteres hex con alta entropía', () => {
    const t1 = generateScanToken();
    const t2 = generateScanToken();
    expect(t1).toHaveLength(64);
    expect(t2).toHaveLength(64);
    expect(t1).not.toBe(t2);
  });

  it('computa hashes SHA-256 determinísticos y resistentes a colisión', () => {
    const token = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const hash1 = hashScanToken(token);
    const hash2 = hashScanToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
    expect(hash1).not.toBe(token);
  });

  it('genera códigos PIN de 6 dígitos numéricos', () => {
    const pin = generateScanPin();
    expect(pin).toMatch(/^\d{6}$/);
    const num = parseInt(pin, 10);
    expect(num).toBeGreaterThanOrEqual(100000);
    expect(num).toBeLessThanOrEqual(999999);
  });

  it('detecta correctamente si una sesión está expirada o vigente', () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const future = new Date(Date.now() + 60000).toISOString();

    expect(isSessionExpired(past)).toBe(true);
    expect(isSessionExpired(future)).toBe(false);
    expect(isSessionExpired('invalid-date')).toBe(true);
  });
});
