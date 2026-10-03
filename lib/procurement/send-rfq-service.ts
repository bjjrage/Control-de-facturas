// lib/procurement/send-rfq-service.ts
// Domain service decoupled from Next.js Server Actions.
// Envia/formaliza invitaciones de una RFQ hacia proveedores en estado BORRADOR.
// Revalida tenant, estado de la RFQ, invierte a COTIZANDO y genera tokens criptograficos.
import type { SupabaseClient } from "@supabase/supabase-js";
import { logAudit } from "@/lib/audit";

export interface SendRfqParams {
  db: SupabaseClient;
  empresaId: string;
  userId: string;
  rfqId: string;
  providerIds: string[];
  notes?: string;
}

export interface SendRfqResult {
  rfqId: string;
  code: string;
  status: "COTIZANDO" | "OFERTAS_RECIBIDAS";
  providersInvitedCount: number;
  providerIds: string[];
  externalDispatchPerformed: false;
  message: string;
}

export async function sendRfqDomainService(params: SendRfqParams): Promise<SendRfqResult> {
  const { db, empresaId, rfqId, notes } = params;
  const providerIds = [...new Set(params.providerIds)];

  if (!providerIds || providerIds.length === 0) {
    throw new Error("Debe seleccionar al menos un proveedor para enviar la cotización.");
  }

  // 1. Validar RFQ: existencia, tenant y estado
  const { data: rfq, error: rfqErr } = await db
    .from("rfqs")
    .select("id, code, status, empresa_id, product, quantity, unit, expires_at")
    .eq("id", rfqId)
    .eq("empresa_id", empresaId)
    .single();

  if (rfqErr || !rfq) {
    throw new Error(`RFQ no encontrada o no pertenece a tu empresa (id=${rfqId})`);
  }

  // State revalidation: no se puede enviar una RFQ cancelada o que ya tiene OC autorizada
  if (rfq.status === "CANCELADO") {
    throw new Error(`No se puede enviar una RFQ en estado CANCELADO (id=${rfqId})`);
  }
  if (rfq.status === "AUTORIZADO") {
    throw new Error(`No se puede enviar una RFQ que ya cuenta con orden de compra autorizada (id=${rfqId})`);
  }

  const {error:inviteError}=await db.rpc("rfq_invite",{p_rfq_id:rfqId,p_provider_ids:[...new Set(providerIds)]});
  if(inviteError)throw new Error(inviteError.message);
  // 4. Log de auditoria del dominio
  try {
    await logAudit(db, {
      action: "rfq.sent",
      rfqId,
      detail: {
        provider_ids: providerIds,
        previous_status: rfq.status,
        new_status: rfq.status === "OFERTAS_RECIBIDAS" ? "OFERTAS_RECIBIDAS" : "COTIZANDO",
        notes: notes ?? null,
      },
    });
  } catch {
    // best effort audit
  }

  return {
    rfqId: rfq.id,
    code: rfq.code,
    status: rfq.status === "OFERTAS_RECIBIDAS" ? "OFERTAS_RECIBIDAS" : "COTIZANDO",
    providersInvitedCount: providerIds.length,
    providerIds,
    externalDispatchPerformed: false,
    message: `RFQ ${rfq.code} transicionada a COTIZANDO e invitaciones creadas para ${providerIds.length} proveedor(es). No se realiza envío automático de email/WhatsApp (despacho manual por link o portal /cotizar/[token]).`,
  };
}
