// lib/tools/documents/get-document-content.ts
// READ tool LEVEL 0 — Obtiene metadatos y contenido de un documento/attachment.
// No duplica lógica: consulta tabla attachments y documentos relacionados con scoping tenant.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetDocumentContentInputSchema = z.object({
  document_id: z.string().uuid({ message: "document_id debe ser UUID valido" }),
  include_content: z.boolean().optional().default(false),
});

export type GetDocumentContentInput = z.infer<typeof GetDocumentContentInputSchema>;

export interface GetDocumentContentOutput {
  document: {
    id: string;
    empresa_id: string;
    bucket: string;
    path: string;
    file_name: string;
    mime_type: string | null;
    size_bytes: number | null;
    uploaded_by: string | null;
    rfq_provider_id: string | null;
    rfq_id: string | null;
    quote_version_id: string | null;
    created_at: string;
  } | null;
  // Nota: el contenido real del archivo (bytes) no se retorna por el tool —
  // se espera que el frontend use la URL firmada o el storage bucket directamente.
  // El tool solo retorna metadatos para que el agente sepa qué documento existe.
  metadata: {
    has_rfq_link: boolean;
    has_rfq_provider_link: boolean;
    has_quote_version_link: boolean;
    storage_url?: string; // URL pública/firmada si aplica
  };
}

async function handler(
  ctx: AgentToolContext,
  input: GetDocumentContentInput,
  deps: { db: SupabaseClient }
): Promise<GetDocumentContentOutput> {
  const { db } = deps;
  const empresaId = ctx.empresaId;

  // Buscar attachment por ID con scoping tenant
  const { data: attachment, error: attErr } = await db
    .from("attachments")
    .select("*")
    .eq("id", input.document_id)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (attErr) throw new Error(`Error leyendo documento: ${attErr.message}`);

  if (!attachment) {
    return {
      document: null,
      metadata: {
        has_rfq_link: false,
        has_rfq_provider_link: false,
        has_quote_version_link: false,
      },
    };
  }

  // Verificar links a entidades relacionadas
  let hasRfqLink = false;
  let hasRfqProviderLink = false;
  let hasQuoteVersionLink = false;

  if (attachment.rfq_id) {
    const { data: rfq } = await db
      .from("rfqs")
      .select("id")
      .eq("id", attachment.rfq_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    hasRfqLink = !!rfq;
  }

  if (attachment.rfq_provider_id) {
    const { data: rfqProv } = await db
      .from("rfq_providers")
      .select("id")
      .eq("id", attachment.rfq_provider_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    hasRfqProviderLink = !!rfqProv;
  }

  if (attachment.quote_version_id) {
    const { data: qv } = await db
      .from("quote_versions")
      .select("id")
      .eq("id", attachment.quote_version_id)
      .eq("empresa_id", empresaId)
      .maybeSingle();
    hasQuoteVersionLink = !!qv;
  }

  // Generar URL de storage si aplica (URL pública o firmada)
  let storageUrl: string | undefined;
  if (attachment.path) {
    const { data: urlData } = await db.storage
      .from(attachment.bucket)
      .createSignedUrl(attachment.path, 60 * 60); // 1 hora
    storageUrl = urlData?.signedUrl;
  }

  return {
    document: attachment as GetDocumentContentOutput["document"],
    metadata: {
      has_rfq_link: hasRfqLink,
      has_rfq_provider_link: hasRfqProviderLink,
      has_quote_version_link: hasQuoteVersionLink,
      storage_url: storageUrl,
    },
  };
}

// Auto-registro (side-effect al importar). Risk 0 = READ.
registerTool<GetDocumentContentInput, GetDocumentContentOutput>({
  name: "get_document_content",
  description:
    "Obtiene metadatos de un documento/attachment por ID: nombre de archivo, tipo MIME, tamaño, links a RFQ/proveedor/cotización, y URL de storage firmada. No retorna el contenido binario — el frontend usa la URL firmada. Usar cuando el usuario pregunta 'qué documento está adjunto a esta RFQ' o 'muéreme el PDF de esta cotización'.",
  inputSchema: GetDocumentContentInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getDocumentContentTool = { handler, inputSchema: GetDocumentContentInputSchema };