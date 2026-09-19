import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { sendEmailDraft } from "@/lib/email/domain-service";
import type { EmailDraftSnapshot, EmailSendResult } from "@/lib/email/types";

const EmailAttachmentSnapshotSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  fileName: z.string().max(300),
  mimeType: z.string().max(200),
  sizeBytes: z.number().int().nonnegative(),
  storageBucket: z.string().max(100),
  storagePath: z.string().max(1_000),
  contentSha256: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
});

const EmailDraftSnapshotSchema = z.object({
  draftId: z.string().uuid(),
  to: z.array(z.string().email()).max(20),
  cc: z.array(z.string().email()).max(20),
  bcc: z.array(z.string().email()).max(20),
  subject: z.string().max(300),
  bodyText: z.string().max(100_000),
  bodyHtml: z.string().max(200_000).nullable().optional(),
  attachments: z.array(EmailAttachmentSnapshotSchema).max(10),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const SendEmailInputSchema = z.object({
  draft_id: z.string().uuid(),
  idempotency_key: z.string().uuid(),
  draft_hash: z.string().regex(/^[a-f0-9]{64}$/u),
  draft_snapshot: EmailDraftSnapshotSchema,
});

export type SendEmailToolInput = z.infer<typeof SendEmailInputSchema>;

async function handler(
  ctx: AgentToolContext,
  input: SendEmailToolInput,
  deps: { db: SupabaseClient }
): Promise<EmailSendResult> {
  return sendEmailDraft({
    db: deps.db,
    actor: ctx,
    draftId: input.draft_id,
    idempotencyKey: input.idempotency_key,
    draftHash: input.draft_hash,
    draftSnapshot: input.draft_snapshot as EmailDraftSnapshot,
  });
}

registerTool<SendEmailToolInput, EmailSendResult>({
  name: "send_email",
  description:
    "Envía únicamente un email_draft ya preparado y congelado. Es una acción externa Risk 2 y siempre requiere aprobación humana explícita. El input obligatorio es draft_id, idempotency_key, draft_hash y draft_snapshot completo devuelto por prepare_email; nunca acepta to/body libres. Si el draft cambió desde la aprobación, falla y exige una nueva aprobación.",
  inputSchema: SendEmailInputSchema,
  riskLevel: 2,
  requiredRoles: ["comercial", "admin"],
  handler,
});

export const sendEmailTool = { handler, inputSchema: SendEmailInputSchema };
