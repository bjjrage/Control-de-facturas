// lib/tools/procurement/send-rfq.ts
// ACTION tool LEVEL 2 (EXTERNAL_ACTION) — Envía formalmente una RFQ a los proveedores invitados.
// Requiere aprobación humana (risk 2). DeepSeek no puede ejecutarlo directamente.
// Tras aprobación humana y validación criptográfica del payload, ejecuta sendRfqDomainService.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { sendRfqDomainService, type SendRfqResult } from "@/lib/procurement/send-rfq-service";

export const SendRfqInputSchema = z.object({
  rfq_id: z.string().uuid({ message: "rfq_id debe ser UUID valido" }),
  supplier_ids: z.array(z.string().uuid()).min(1, "al menos un supplier_id"),
  notes: z.string().optional(),
});

export type SendRfqInput = z.infer<typeof SendRfqInputSchema>;

export type SendRfqOutput = SendRfqResult;

async function handler(
  ctx: AgentToolContext,
  input: SendRfqInput,
  deps: { db: SupabaseClient }
): Promise<SendRfqOutput> {
  const { db } = deps;

  return await sendRfqDomainService({
    db,
    empresaId: ctx.empresaId,
    userId: ctx.userId ?? "system-agent",
    rfqId: input.rfq_id,
    providerIds: input.supplier_ids,
    notes: input.notes,
  });
}

// Auto-registro: Risk 2 = EXTERNAL_ACTION (requiere approval humano obligatorio)
registerTool<SendRfqInput, SendRfqOutput>({
  name: "send_rfq",
  description:
    "Formaliza y publica una Solicitud de Cotización (RFQ) hacia proveedores: transiciona el estado de BORRADOR a COTIZANDO y genera invitaciones con tokens únicos en rfq_providers para el portal de cotizaciones (/cotizar/[token]). Requiere aprobación humana (Risk 2: acción externa/publicación a proveedores). Nota: genera los accesos e invitaciones en el sistema sin disparar emails o mensajes de WhatsApp automáticos.",
  inputSchema: SendRfqInputSchema,
  riskLevel: 2,
  requiredRoles: ["comercial", "admin"],
  handler,
});

export const sendRfqTool = { handler, inputSchema: SendRfqInputSchema };
