import "server-only";
import { isReceiptPortalEvidenceSignature } from "@/lib/inventory/receipt-portal";
import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { DOCUMENT_UPLOAD_BUCKET, DOCUMENT_REFERENCE_PREFIX, MAX_DOCUMENT_BATCH_BYTES } from "./document-upload";
import { uploadPrincipal, verifyDocumentTicket } from "./document-upload-ticket";

export function internalUploadPrincipal(profile: { empresa_id: string; id: string }) {
  return uploadPrincipal("internal", `${profile.empresa_id}:${profile.id}`);
}
// The caller must reauthorize the principal immediately before materialization.
// Only the server-signed path is ever downloaded; callers cannot nominate buckets.
export async function materializeDocument(value: File | string, principal: string): Promise<File> {
  if (value instanceof File) return value; // Compatibility with existing small multipart clients.
  const ticket = verifyDocumentTicket(value, principal);
  const storage = createAdminClient().storage.from(DOCUMENT_UPLOAD_BUCKET);
  const info = await storage.info(ticket.path);
  if (info.error || info.data?.size !== ticket.size) throw new Error("El tamaño del archivo no coincide con la carga autorizada.");
  const downloaded = await storage.download(ticket.path);
  if (downloaded.error || !downloaded.data) throw new Error("No se pudo recuperar el archivo. Volvé a subirlo.");
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  if (bytes.length !== ticket.size || createHash("sha256").update(bytes).digest("hex") !== ticket.sha256) {
    await storage.remove([ticket.path]);
    throw new Error("El contenido del archivo no coincide con la carga autorizada.");
  }
  if (ticket.type !== "application/octet-stream" && !isReceiptPortalEvidenceSignature(bytes, ticket.type)) {
    await storage.remove([ticket.path]);
    throw new Error("El contenido del archivo no corresponde a su formato.");
  }
  const removed = await storage.remove([ticket.path]);
  if (removed.error) throw new Error("No se pudo finalizar la carga temporal. Reintentá.");
  return new File([bytes], ticket.name, { type: ticket.type });
}
export async function materializeDocumentForm(form: FormData, principal: string) {
  const entries = [...form.entries()];
  let total = 0;
  let count = 0;
  // Bound the whole request before downloading anything.
  for (const [, value] of entries) {
    if (value instanceof File || value.startsWith(DOCUMENT_REFERENCE_PREFIX)) {
      count++;
      total += value instanceof File ? value.size : verifyDocumentTicket(value, principal).size;
    }
  }
  if (count > 20 || total > MAX_DOCUMENT_BATCH_BYTES) throw new Error("Adjuntá hasta 20 archivos y 50 MiB en total.");
  const result = new FormData();
  for (const [name, value] of entries) {
    result.append(name, typeof value === "string" && value.startsWith(DOCUMENT_REFERENCE_PREFIX)
      ? await materializeDocument(value, principal) : value);
  }
  return result;
}
