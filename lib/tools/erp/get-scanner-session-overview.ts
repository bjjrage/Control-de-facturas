// READ tool LEVEL 0 - estado seguro de una sesion de scanner.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetScannerSessionOverviewInputSchema = z.object({ session_id: z.string().uuid() });
export type GetScannerSessionOverviewInput = z.infer<typeof GetScannerSessionOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetScannerSessionOverviewInput, deps: { db: SupabaseClient }) {
  const { data, error } = await deps.db
    .from("scan_sessions")
    .select("id, empresa_id, context_type, context_id, target_field, status, expires_at, storage_path, file_name, file_size_bytes, page_count, metadata, created_at, claimed_at, completed_at")
    .eq("id", input.session_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (error) throw new Error(`Error leyendo sesion de scanner: ${error.message}`);
  if (!data) throw new Error("La sesion de scanner no existe o no pertenece a tu empresa.");

  const row = data as Record<string, unknown>;
  const boundedFileName = typeof row.file_name === "string" ? row.file_name.slice(0, 200) : null;
  const metadataAvailable = Boolean(row.metadata && typeof row.metadata === "object" && Object.keys(row.metadata as object).length > 0);

  // Whitelist explicita: no se expone la fila DB, metadata arbitraria ni
  // referencias de Storage. Esos valores pueden contener tokens o prompt injection.
  const session = {
    id: String(row.id),
    context_type: typeof row.context_type === "string" ? row.context_type : null,
    context_id: typeof row.context_id === "string" ? row.context_id : null,
    target_field: typeof row.target_field === "string" ? row.target_field : null,
    status: typeof row.status === "string" ? row.status : null,
    expires_at: typeof row.expires_at === "string" ? row.expires_at : null,
    file_name: boundedFileName,
    file_size_bytes: typeof row.file_size_bytes === "number" ? row.file_size_bytes : null,
    page_count: typeof row.page_count === "number" ? row.page_count : null,
    created_at: typeof row.created_at === "string" ? row.created_at : null,
    claimed_at: typeof row.claimed_at === "string" ? row.claimed_at : null,
    completed_at: typeof row.completed_at === "string" ? row.completed_at : null,
    metadata_available: metadataAvailable,
  };

  return {
    session,
    completed_document: row.status === "completed" && Boolean(row.storage_path),
    reference: row.storage_path ? { available: true, file_name: boundedFileName } : null,
    secrets_excluded: ["token_hash", "mobile_claim_token_hash", "pin_code", "claimed_device_info"],
  };
}

registerTool({
  name: "get_scanner_session_overview",
  description: "Lee estado y metadata segura de una sesion de scanner existente. Nunca devuelve PINes, tokens, hashes ni filesystem arbitrario.",
  inputSchema: GetScannerSessionOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getScannerSessionOverviewTool = { handler, inputSchema: GetScannerSessionOverviewInputSchema };
