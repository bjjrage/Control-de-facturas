import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DOCUMENT_REFERENCE_PREFIX, validDocumentMetadata, type DocumentMetadata } from "./document-upload";

type Ticket = DocumentMetadata & { version: 1; principal: string; path: string; expires: number };
const TTL = 15 * 60 * 1000;
function key() {
  const value = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!value) throw new Error("Falta la configuración de Storage.");
  return value;
}
export function uploadPrincipal(scope: string, identity: string) {
  return createHash("sha256").update(`document-upload:v1:${scope}:${identity}`).digest("hex");
}
function signature(encoded: string) {
  return createHmac("sha256", key()).update(`document-upload:v1:${encoded}`).digest("base64url");
}
export function issueDocumentTicket(principal: string, metadata: DocumentMetadata, now = Date.now()) {
  if (!/^[a-f0-9]{64}$/.test(principal) || !validDocumentMetadata(metadata)) throw new Error("Archivo inválido: máximo 20 MiB.");
  const ticket: Ticket = { ...metadata, version: 1, principal, path: `${principal}/${randomUUID()}`, expires: now + TTL };
  const encoded = Buffer.from(JSON.stringify(ticket)).toString("base64url");
  return { ticket, reference: DOCUMENT_REFERENCE_PREFIX + encoded + "." + signature(encoded) };
}
export function verifyDocumentTicket(reference: string, principal: string, now = Date.now()): Ticket {
  const invalid = () => { throw new Error("La referencia del archivo es inválida o venció. Volvé a subirlo."); };
  if (!reference.startsWith(DOCUMENT_REFERENCE_PREFIX) || reference.length > 3000) return invalid();
  const parts = reference.slice(DOCUMENT_REFERENCE_PREFIX.length).split(".");
  const [encoded, mac] = parts;
  if (parts.length !== 2 || !encoded || !mac) return invalid();
  const expected = Buffer.from(signature(encoded));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return invalid();
  let ticket: Ticket;
  try { ticket = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { return invalid(); }
  if (!validDocumentMetadata(ticket) || ticket.version !== 1 || ticket.principal !== principal
    || !Number.isSafeInteger(ticket.expires) || ticket.expires <= now || ticket.expires > now + TTL
    || !new RegExp(`^${principal}/[a-f0-9-]{36}$`).test(ticket.path)) return invalid();
  return ticket;
}
