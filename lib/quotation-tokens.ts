/**
 * Tokens de aceptación de cotizaciones — generación y hash.
 *
 * Política (auditoría de cierre, PUNTO 2):
 * - URL: token aleatorio de 256-bit en base64url, generado en app con
 *   crypto.randomBytes. Alta entropía: 2^256 combinaciones, imposible de
 *   enumerar.
 * - DB: SOLO token_hash (SHA-256 hex) + token_prefix (8 primeros chars para
 *   correlación de soporte; 48 bits expuestos no alcanzan para adivinar).
 *   El raw jamás se persiste ni se loguea: al generarse se devuelve una vez
 *   en memoria para mostrar/copiar, y el portal lo hashea antes de consultar.
 * - Lookup: hash(token recibido) → WHERE token_hash. Comparación exacta por
 *   índice único (espacio de 256-bit: la enumeración es inviable; los hashes
 *   desconocidos responden genérico "Enlace inválido" sin oráculo de estado).
 *
 * Mismo patrón que lib/auction-sandbox/tokens.ts (solo hashes en DB).
 */
import { randomBytes, createHash } from "crypto";

export function generateQuotationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashQuotationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function quotationTokenPrefix(token: string): string {
  return token.slice(0, 8);
}

/** Raw de URL: base64url de 32..64 chars (cubre el formato nuevo; los hex de
 *  0090 también matchean y siguen válidos vía su hash retrocalculado). */
export function isValidRawQuotationToken(token: string) {
  return typeof token === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(token);
}

export function isValidQuotationTokenHash(hash: string) {
  return typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash);
}
