import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { authorizeDocumentUpload } from "@/lib/document-upload-authorization";
import { DOCUMENT_UPLOAD_BUCKET, MAX_DOCUMENT_BYTES, validDocumentMetadata, type DocumentUploadContext } from "@/lib/document-upload";
import { issueDocumentTicket, verifyDocumentTicket } from "@/lib/document-upload-ticket";

export const runtime = "nodejs";
async function readInput(request: NextRequest) {
  if (request.headers.get("origin") !== new URL(request.url).origin || !request.headers.get("content-type")?.startsWith("application/json")) throw new Error("Origen o formato inválido.");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Falta la solicitud.");
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > 8192) { await reader.cancel(); throw new Error("La solicitud es demasiado grande."); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as { context: DocumentUploadContext; file?: unknown; reference?: string };
  } finally { reader.releaseLock(); }
}
export async function POST(request: NextRequest) {
  try {
    const input = await readInput(request);
    if (!validDocumentMetadata(input.file)) return NextResponse.json({ error: "Archivo inválido: máximo 20 MiB." }, { status: 400 });
    const principal = await authorizeDocumentUpload(input.context, request);
    const admin = createAdminClient();
    const bucket = await admin.storage.getBucket(DOCUMENT_UPLOAD_BUCKET);
    if (bucket.error || !bucket.data || bucket.data.public || Number(bucket.data.file_size_limit) !== MAX_DOCUMENT_BYTES) {
      return NextResponse.json({ error: "Storage no está preparado para cargas de 20 MiB." }, { status: 503 });
    }
    const storage = admin.storage.from(DOCUMENT_UPLOAD_BUCKET);
    const pending = await storage.list(principal, { limit: 25, sortBy: { column: "created_at", order: "asc" } });
    if (pending.error) return NextResponse.json({ error: "No se pudieron revisar las cargas pendientes." }, { status: 503 });
    // A signed upload URL lasts two hours. Three hours after object creation AND
    // its last update, neither it nor the 15-minute application ticket is active.
    // Only this authenticated principal's temporary UUID objects are eligible.
    const cutoff = Date.now() - 3 * 60 * 60 * 1000;
    const expired = (pending.data ?? []).filter(object => object.id && /^[a-f0-9-]{36}$/.test(object.name)
      && typeof object.created_at === "string" && typeof object.updated_at === "string"
      && Date.parse(object.created_at) < cutoff && Date.parse(object.updated_at) < cutoff);
    if (expired.length) {
      const removed = await storage.remove(expired.map(object => principal + "/" + object.name));
      if (removed.error) return NextResponse.json({ error: "No se pudieron limpiar las cargas vencidas. Reintentá." }, { status: 503 });
    }
    if ((pending.data?.length ?? 0) - expired.length >= 24) return NextResponse.json({ error: "Hay demasiadas cargas pendientes. Reintentá más tarde." }, { status: 429 });
    const { ticket, reference } = issueDocumentTicket(principal, input.file);
    const signed = await admin.storage.from(DOCUMENT_UPLOAD_BUCKET).createSignedUploadUrl(ticket.path, { upsert: false });
    if (signed.error || !signed.data) return NextResponse.json({ error: "No se pudo preparar la carga." }, { status: 502 });
    return NextResponse.json({ path: ticket.path, token: signed.data.token, reference }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "No se pudo autorizar la carga. Revisá el archivo, la sesión o el enlace." }, { status: 400 });
  }
}
export async function DELETE(request: NextRequest) {
  try {
    const input = await readInput(request);
    const principal = await authorizeDocumentUpload(input.context, request);
    if (typeof input.reference !== "string") throw new Error("Falta la referencia.");
    const ticket = verifyDocumentTicket(input.reference, principal);
    const result = await createAdminClient().storage.from(DOCUMENT_UPLOAD_BUCKET).remove([ticket.path]);
    if (result.error) throw new Error("No se pudo limpiar la carga.");
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "No se pudo cancelar la carga." }, { status: 400 }); }
}
