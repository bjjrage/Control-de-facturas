import { createHash, createHmac, randomBytes, randomInt } from 'crypto';

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
/** Domain separation keeps the low-entropy PIN protected even after a DB-only leak. */
export function hashScanPin(pin: string): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('No se pudo preparar el PIN de escaneo.');
  return 'hmac-v1:' + createHmac('sha256', key).update('scanner-pin-v1:' + pin.trim()).digest('hex');
}

export function generateScanPin(): string {
  // 6 dígitos aleatorios entre 100000 y 999999
  const val = randomInt(100000, 1000000);
  return val.toString();
}

/**
 * Verifica si una fecha de expiración ISO ya pasó.
 */
export function isSessionExpired(expiresAt: string): boolean {
  const expiryTime = new Date(expiresAt).getTime();
  return Number.isNaN(expiryTime) || expiryTime <= Date.now();
}
