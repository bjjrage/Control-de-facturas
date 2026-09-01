import { SupabaseClient } from "@supabase/supabase-js";

type LogAuditParams = {
  action: string;
  rfqId?: string;
  rfqProviderId?: string;
  invoiceId?: string;
  authorizedOrderId?: string;
  detail?: Record<string, unknown>;
  actorType?: "internal" | "provider" | "system";
  actorLabel?: string;
};

export async function logAudit(supabase: SupabaseClient, params: LogAuditParams) {
  await supabase.rpc("log_audit_event", {
    p_action: params.action,
    p_rfq_id: params.rfqId ?? null,
    p_rfq_provider_id: params.rfqProviderId ?? null,
    p_invoice_id: params.invoiceId ?? null,
    p_authorized_order_id: params.authorizedOrderId ?? null,
    p_detail: params.detail ?? null,
    p_actor_type: params.actorType ?? "internal",
    p_actor_label: params.actorLabel ?? null,
  });
}
