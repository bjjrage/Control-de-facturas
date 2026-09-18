import { createHash, randomBytes } from 'crypto';

/**
 * Genera un token aleatorio criptográficamente seguro de 32 bytes en formato hex.
 */
export function generateScanToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Computa el hash SHA-256 del token para almacenar en base de datos.
 * El token original nunca se guarda en texto claro.
 */
export function hashScanToken(token: string): string {
  const trimmed = token.trim();
  return createHash('sha256').update(trimmed).digest('hex');
}

/**
 * Genera un código PIN corto de 6 dígitos numéricos para ingreso manual.
 */
export function generateScanPin(): string {
  // 6 dígitos aleatorios entre 100000 y 999999
  const val = Math.floor(100000 + Math.random() * 900000);
  return val.toString();
}

/**
 * Verifica si una fecha de expiración ISO ya pasó.
 */
export function isSessionExpired(expiresAt: string): boolean {
  const expiryTime = new Date(expiresAt).getTime();
  return Number.isNaN(expiryTime) || expiryTime <= Date.now();
}
