import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { prepareEmailDraft, type PrepareEmailInput, type PrepareEmailOutput } from "@/lib/email/domain-service";

export const PrepareEmailInputSchema = z.object({
  to: z.array(z.string().email()).max(20).optional(),
  cc: z.array(z.string().email()).max(20).optional(),
  bcc: z.array(z.string().email()).max(20).optional(),
  contact_query: z.string().max(200).optional(),
  subject: z.string().max(300).optional(),
  objective: z.string().min(1).max(100_000),
  tone: z.string().max(80).optional(),
  language: z.string().max(40).optional(),
  attachment_queries: z.array(z.string().min(1).max(200)).max(10).optional(),
  project_id: z.string().uuid().optional(),
  draft_id: z.string().uuid().optional(),
  idempotency_key: z.string().uuid().optional(),
  revision_instruction: z.string().max(2_000).optional(),
  force_resend: z.boolean().optional(),
});

export type PrepareEmailToolInput = z.infer<typeof PrepareEmailInputSchema>;

async function handler(
  ctx: AgentToolContext,
  input: PrepareEmailToolInput,
  deps: { db: SupabaseClient }
): Promise<PrepareEmailOutput> {
  return prepareEmailDraft(deps.db, ctx, input as PrepareEmailInput);
}

registerTool<PrepareEmailToolInput, PrepareEmailOutput>({
  name: "prepare_email",
  description:
    "Prepara un borrador interno de email sin enviarlo. Si el usuario proporciona una dirección de email explícita, usala directamente en to. Si proporciona solamente un nombre o empresa, intentá resolverlo desde los contactos del ERP. Nunca inventes una dirección y, si hay múltiples contactos posibles, preguntá cuál. Redacta un correo profesional y conciso, busca adjuntos autorizados cuando correspondan y devuelve el preview. Para editar un borrador existente usar draft_id y revision_instruction. Nunca envía ni salta la aprobación.",
  inputSchema: PrepareEmailInputSchema,
  riskLevel: 2,
  requiredRoles: ["comercial", "admin"],
  handler,
});

export const prepareEmailTool = { handler, inputSchema: PrepareEmailInputSchema };
