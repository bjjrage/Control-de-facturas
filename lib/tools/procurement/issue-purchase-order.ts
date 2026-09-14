// lib/tools/procurement/issue-purchase-order.ts
// ACTION tool LEVEL 3 (BUSINESS_COMMITMENT) — Emite oficialmente una Orden de Compra desde un borrador.
// Requiere aprobación humana (risk 3). DeepSeek no puede ejecutarlo directamente.
// Preserva relaciones con project, RFQ, proveedor y partidas presupuestarias.
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { issuePurchaseOrderDomainService, type IssuePurchaseOrderResult } from "@/lib/procurement/issue-po-service";

export const IssuePurchaseOrderInputSchema = z.object({
  po_draft_id: z.string().uuid({ message: "po_draft_id debe ser UUID valido" }),
  confirm_issuance: z.boolean().refine((v) => v === true, {
    message: "confirm_issuance debe ser true para emitir la Orden de Compra",
  }),
});

export type IssuePurchaseOrderInput = z.infer<typeof IssuePurchaseOrderInputSchema>;

export type IssuePurchaseOrderOutput = IssuePurchaseOrderResult;

async function handler(
  ctx: AgentToolContext,
  input: IssuePurchaseOrderInput,
  deps: { db: SupabaseClient }
): Promise<IssuePurchaseOrderOutput> {
  const { db } = deps;

  return await issuePurchaseOrderDomainService({
    db,
    empresaId: ctx.empresaId,
    userId: ctx.userId ?? "system-agent",
    poDraftId: input.po_draft_id,
    confirmIssuance: input.confirm_issuance,
  });
}

// Auto-registro: Risk 3 = BUSINESS_COMMITMENT (compromiso contractual/financiero, aprobación obligatoria)
registerTool<IssuePurchaseOrderInput, IssuePurchaseOrderOutput>({
  name: "issue_purchase_order",
  description:
    "Emite y formaliza una Orden de Compra (OC) oficial en authorized_orders a partir de un borrador existente (purchase_order_drafts). Requiere aprobación humana (Risk 3: compromiso financiero). Usar cuando el usuario diga 'Emití la orden' o 'Aprobá y enviá la orden de compra'.",
  inputSchema: IssuePurchaseOrderInputSchema,
  riskLevel: 3,
  requiredRoles: ["comercial", "admin"],
  handler,
});

export const issuePurchaseOrderTool = { handler, inputSchema: IssuePurchaseOrderInputSchema };
