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
  status: string;
  providersInvitedCount: number;
  providerIds: string[];
}

export async function sendRfqDomainService(params: SendRfqParams): Promise<SendRfqResult> {
  const { db, empresaId, userId, rfqId, providerIds, notes } = params;

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

  // 2. Insertar proveedores a invitar en rfq_providers
  // Si ya existen proveedores previamente vinculados, aseguramos invitacion sin duplicar clave única
  const providerRows = providerIds.map((pid) => ({
    rfq_id: rfqId,
    provider_id: pid,
    status: "PENDIENTE",
  }));

  const { error: insErr } = await db
    .from("rfq_providers")
    .upsert(providerRows, { onConflict: "rfq_id, provider_id" });

  if (insErr) {
    throw new Error(`Error al registrar proveedores en la RFQ: ${insErr.message}`);
  }

  // 3. Transicionar estado a COTIZANDO si estaba en BORRADOR
  const updatePayload: Record<string, unknown> = {
    status: "COTIZANDO",
  };
  if (notes) {
    updatePayload.observations = notes;
  }

  const { error: updErr } = await db
    .from("rfqs")
    .update(updatePayload)
    .eq("id", rfqId)
    .eq("empresa_id", empresaId);

  if (updErr) {
    throw new Error(`Error al actualizar estado de la RFQ: ${updErr.message}`);
  }

  // 4. Log de auditoria del dominio
  try {
    await logAudit(db, {
      action: "rfq.sent",
      rfqId,
      detail: {
        provider_ids: providerIds,
        previous_status: rfq.status,
        new_status: "COTIZANDO",
        notes: notes ?? null,
      },
    });
  } catch {
    // best effort audit
  }

  return {
    rfqId: rfq.id,
    code: rfq.code,
    status: "COTIZANDO",
    providersInvitedCount: providerIds.length,
    providerIds,
  };
}
