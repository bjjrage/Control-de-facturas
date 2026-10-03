import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { registerTool } from "@/lib/agent/registry";
import { loadRfqWorkspace } from "@/lib/rfq/service";
import { eligibleLine, proposeAllocations } from "@/lib/rfq/domain";
export const CompareQuotationsInputSchema = z.object({
  rfq_id: z.string().uuid(),
});
export type CompareQuotationsInput = z.infer<
  typeof CompareQuotationsInputSchema
>;
async function handler(
  ctx: AgentToolContext,
  input: CompareQuotationsInput,
  deps: { db: SupabaseClient },
) {
  const w = await loadRfqWorkspace(deps.db, ctx.empresaId, input.rfq_id);
  return {
    rfq_id: input.rfq_id,
    purpose: w.rfq.purpose,
    items_comparison: w.items.map((item) => ({
      item,
      offers: w.offers.filter((o) => o.rfq_item_id === item.id),
    })),
    overall_summary: {
      total_items: w.items.length,
      suppliers_quoted: new Set(w.offers.map((o) => o.provider_id)).size,
      items_with_price: new Set(
        w.offers
          .filter((o) => o.precio_unitario !== null && o.precio_unitario > 0)
          .map((o) => o.rfq_item_id),
      ).size,
      has_unknowns:
        w.items.some((i) => !w.offers.some((o) => o.rfq_item_id === i.id)) ||
        w.offers.some((o) => !eligibleLine(o, Date.now(), false)),
    },
    proposals:
      w.rfq.purpose === "PROCUREMENT"
        ? proposeAllocations(w.items, w.offers)
        : [],
    system_adjudicates: false,
    fx_applied: false,
  };
}
export type CompareQuotationsOutput = Awaited<ReturnType<typeof handler>>;
registerTool({
  name: "compare_quotations",
  description:
    "Compara precio/moneda/impuesto/flete/plazo/disponibilidad/pago/vigencia/evidencia. Solo propone escenarios; nunca adjudica ni genera OCs.",
  inputSchema: CompareQuotationsInputSchema,
  riskLevel: 0,
  requiredRoles: null,
  handler,
});
export const compareQuotationsTool = {
  handler,
  inputSchema: CompareQuotationsInputSchema,
};
