import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ExtractedInvoiceFields } from "./invoice-extraction";
import { normalizeTaxId } from "./provider-lookup";

type Proof = { version: 1; empresaId: string; actorId: string; sha256: string; expires: number; fields: ExtractedInvoiceFields };
function key() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("No se pudo verificar la lectura del documento.");
  return value;
}
const signature = (payload: string, secret: string) => createHmac("sha256", secret).update("invoice-extraction:v1:" + payload).digest();
export const invoiceFileHash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
/** Keep one authenticated extraction; never re-run the model silently during save. */
export function issueInvoiceExtractionProof(input: { empresaId: string; actorId: string; bytes: Buffer; fields: ExtractedInvoiceFields }, secret = key(), now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ version: 1, empresaId: input.empresaId, actorId: input.actorId,
    sha256: invoiceFileHash(input.bytes), expires: now + 2 * 60 * 60 * 1000, fields: input.fields } satisfies Proof)).toString("base64url");
  return payload + "." + signature(payload, secret).toString("base64url");
}
export function verifyInvoiceExtractionProof(token: string | null, input: { empresaId: string; actorId: string; bytes: Buffer }, secret = key(), now = Date.now()): Proof | null {
  if (!token || token.length > 500000) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const expected = signature(parts[0], secret);
  const received = Buffer.from(parts[1], "base64url");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  try {
    const proof = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as Proof;
    if (proof.version !== 1 || proof.empresaId !== input.empresaId || proof.actorId !== input.actorId ||
      !Number.isFinite(proof.expires) || proof.expires <= now || proof.sha256 !== invoiceFileHash(input.bytes) ||
      !proof.fields || typeof proof.fields !== "object") return null;
    return proof;
  } catch { return null; }
}
export function invoiceIssuerMatches(documentTaxId: string | null, providerTaxId: string | null): boolean {
  return Boolean(documentTaxId && providerTaxId && normalizeTaxId(documentTaxId) &&
    normalizeTaxId(documentTaxId) === normalizeTaxId(providerTaxId));
}
