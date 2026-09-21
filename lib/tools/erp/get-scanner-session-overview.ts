// READ tool LEVEL 0 — estado/metadata segura de una sesión de scanner.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";

export const GetScannerSessionOverviewInputSchema = z.object({ session_id: z.string().uuid() });
export type GetScannerSessionOverviewInput = z.infer<typeof GetScannerSessionOverviewInputSchema>;

async function handler(ctx: AgentToolContext, input: GetScannerSessionOverviewInput, deps: { db: SupabaseClient }) {
  const { data, error } = await deps.db
    .from("scan_sessions")
    .select("id, empresa_id, context_type, context_id, target_field, status, expires_at, storage_bucket, storage_path, file_name, file_size_bytes, page_count, metadata, created_at, claimed_at, completed_at")
    .eq("id", input.session_id)
    .eq("empresa_id", ctx.empresaId)
    .maybeSingle();
  if (error) throw new Error(`Error leyendo sesión de scanner: ${error.message}`);
  if (!data) throw new Error("La sesión de scanner no existe o no pertenece a tu empresa.");
  return {
    session: data,
    completed_document: data.status === "completed" && Boolean(data.storage_path),
    reference: data.storage_path ? { bucket: data.storage_bucket, path: data.storage_path, file_name: data.file_name } : null,
    secrets_excluded: ["token_hash", "mobile_claim_token_hash", "pin_code", "claimed_device_info"],
  };
}

registerTool({
  name: "get_scanner_session_overview",
  description: "Lee estado y metadata segura de una sesión de scanner existente, incluyendo referencia al archivo completado cuando corresponde. Nunca devuelve PINes, tokens, hashes ni filesystem arbitrario.",
  inputSchema: GetScannerSessionOverviewInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});

export const getScannerSessionOverviewTool = { handler, inputSchema: GetScannerSessionOverviewInputSchema };
