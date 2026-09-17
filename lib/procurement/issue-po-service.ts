// lib/procurement/issue-po-service.ts
// Domain service decoupled from Next.js Server Actions.
// Emite una Orden de Compra oficial (authorized_orders) a partir de un borrador existente (purchase_order_drafts).
// Revalida tenant, estado DRAFT del borrador, no-reemisión, genera items y marca DRAFT como ISSUED.
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";

export interface IssuePurchaseOrderParams {
  db: SupabaseClient;
  empresaId: string;
  userId: string;
  poDraftId: string;
  confirmIssuance: boolean;
}

export interface IssuePurchaseOrderResult {
  orderId: string;
  orderCode?: string;
  poDraftId: string;
  rfqId: string;
  providerId: string;
  providerName: string;
  totalPrice: number;
  currency: string;
  itemsCount: number;
  status: "AUTORIZADO";
}

export async function issuePurchaseOrderDomainService(
  params: IssuePurchaseOrderParams
): Promise<IssuePurchaseOrderResult> {
  const { db, empresaId, userId, poDraftId, confirmIssuance } = params;

  if (!confirmIssuance) {
    throw new Error("confirm_issuance debe ser true para emitir la Orden de Compra.");
  }

  // Ejecución 100% atómica dentro de una sola transacción PostgreSQL vía RPC
  const { data: rpcResult, error: rpcErr } = await db.rpc("issue_purchase_order_atomic", {
    p_empresa_id: empresaId,
    p_user_id: userId,
    p_po_draft_id: poDraftId,
    p_confirm_issuance: confirmIssuance,
  });

  if (rpcErr) {
    throw new Error(`Error en emision atomica de Orden de Compra: ${rpcErr.message}`);
  }

  const result = rpcResult as IssuePurchaseOrderResult;

  // Log de auditoría del dominio (fuera de la transacción estricta como best-effort)
  try {
    await logAudit(db, {
      action: "order.issued",
      authorizedOrderId: result.orderId,
      rfqId: result.rfqId,
      detail: {
        po_draft_id: poDraftId,
        provider_id: result.providerId,
        total_price: result.totalPrice,
        currency: result.currency,
        items_count: result.itemsCount,
      },
    });
  } catch {
    // best-effort audit
  }

  return result;
}
