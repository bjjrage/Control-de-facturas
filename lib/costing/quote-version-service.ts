import type { SupabaseClient } from "@supabase/supabase-js";
import { sanitizeFileName } from "@/lib/storage";
import { createHash, randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Guardado de una versión de cotización multi-ítem. Lo usan el portal del
// proveedor (/cotizar/[token]) y la carga manual interna ("cargar precios del
// adjunto"). Siempre con el admin client, DESPUÉS de que el llamador validó
// el token o la empresa — mismo modelo que el resto del circuito de
// cotizaciones (sin políticas de escritura en quotes/quote_versions).
// ---------------------------------------------------------------------------

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

export function isAllowedQuoteAttachment(file: File): boolean {
  return ["application/pdf", "image/png", "image/jpeg", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv"].includes(file.type);
}

export async function uploadQuoteAttachment(
  admin: SupabaseClient,
  args: { empresaId: string; rfqId: string; rfqProviderId: string; file: File }
): Promise<{ attachmentId: string | null; error: string | null }> {
  const { file } = args;
  if (!isAllowedQuoteAttachment(file)) return { attachmentId: null, error: "El adjunto debe ser PDF, PNG, JPEG, Excel o CSV." };
  if (file.size > MAX_ATTACHMENT_BYTES) return { attachmentId: null, error: "El adjunto no puede superar los 20MB." };

  const path = `${args.rfqId}/${args.rfqProviderId}/${randomUUID()}-${sanitizeFileName(file.name)}`;
  const checksum = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
  const { error: uploadError } = await admin.storage.from("quote-pdfs").upload(path, file, { contentType: file.type });
  if (uploadError) return { attachmentId: null, error: "No se pudo subir el archivo: " + uploadError.message };

  const { data: attachment, error: attachmentError } = await admin
    .from("attachments")
    .insert({
      empresa_id: args.empresaId,
      bucket: "quote-pdfs",
      path,
      file_name: file.name,
      mime_type: file.type,
      size_bytes: file.size,
      rfq_provider_id: args.rfqProviderId,
      original_sha256: checksum,
    })
    .select("id")
    .single();
  if (attachmentError || !attachment) {
    await admin.storage.from("quote-pdfs").remove([path]);
    return { attachmentId: null, error: "No se pudo registrar el adjunto." };
  }
  return { attachmentId: attachment.id as string, error: null };
}
