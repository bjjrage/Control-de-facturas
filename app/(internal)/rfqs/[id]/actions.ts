"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile, requireEmpresaId } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { SelectionReason } from "@/lib/types";
import { isRfqOpen, canReopenRfq, DEFAULT_RFQ_WINDOW_HOURS } from "@/lib/rfq-status";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function inviteProviders(rfqId: string, providerIds: string[]) {
  await requireProfile(["comercial", "admin"]);
  if (providerIds.length === 0) return { error: "ElegÃ­ al menos un proveedor." };
  const supabase = await createClient();

  const { data: rfq } = await supabase.from("rfqs").select("status, expires_at").eq("id", rfqId).single();
  if (!rfq || !isRfqOpen(rfq)) {
    return { error: "Esta solicitud estÃ¡ cerrada. Reabrila para poder invitar mÃ¡s proveedores." };
  }

  const { error } = await supabase
    .from("rfq_providers")
    .insert(providerIds.map((provider_id) => ({ rfq_id: rfqId, provider_id })));

  if (error) return { error: error.message };

  await supabase
    .from("rfqs")
    .update({ status: "COTIZANDO" })
    .eq("id", rfqId)
    .eq("status", "BORRADOR");

  await logAudit(supabase, {
    action: "rfq.providers_invited",
    rfqId,
    detail: { provider_ids: providerIds },
  });

  revalidatePath(`/rfqs/${rfqId}`);
  return { error: null };
}

export async function getSignedAttachmentUrl(bucket: string, path: string) {
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 120);
  if (error || !data) return { url: null, error: error?.message ?? "No se pudo generar el enlace." };
  return { url: data.signedUrl, error: null };
}

export async function selectAndAuthorizeOffer(params: {
  rfqId: string;
  rfqProviderId: string;
  quoteVersionId: string;
  selectionReason: SelectionReason | null;
  selectionReasonDetail: string | null;
}) {
  const profile = await requireProfile(["comercial", "admin"]);
  const supabase = await createClient();
  const { data: authorizedOrderId, error } = await supabase.rpc("select_and_authorize_offer_atomically", {
    p_empresa_id: profile.empresa_id,
    p_actor_id: profile.id,
    p_rfq_id: params.rfqId,
    p_rfq_provider_id: params.rfqProviderId,
    p_quote_version_id: params.quoteVersionId,
    p_selection_reason: params.selectionReason,
    p_selection_reason_detail: params.selectionReasonDetail,
  });
  if (error) return { error: error.message };
  if (!authorizedOrderId) return { error: "No se recibió confirmación de la orden autorizada." };

  const [{ data: rfq }, { data: authorizedOrder }] = await Promise.all([
    supabase
      .from("rfqs")
      .select("project_id, status, selected_rfq_provider_id")
      .eq("id", params.rfqId)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle(),
    supabase
      .from("authorized_orders")
      .select("id, rfq_id, quote_version_id")
      .eq("id", authorizedOrderId)
      .eq("rfq_id", params.rfqId)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle(),
  ]);
  if (!rfq || rfq.status !== "AUTORIZADO" || rfq.selected_rfq_provider_id !== params.rfqProviderId
      || !authorizedOrder || authorizedOrder.quote_version_id !== params.quoteVersionId) {
    return { error: "La autorización se guardó, pero no se pudo confirmar su lectura. Reintentá para verificar el resultado." };
  }
  await logAudit(supabase, {
    action: "rfq.offer_authorized",
    rfqId: params.rfqId,
    rfqProviderId: params.rfqProviderId,
    authorizedOrderId,
    detail: { atomic_rpc: true },
  });
  revalidatePath(`/rfqs/${params.rfqId}`);
  revalidatePath("/orders");
  if (rfq?.project_id) revalidatePath(`/projects/${rfq.project_id}`);
  return { error: null, authorizedOrderId };
}

export async function cancelRfq(rfqId: string) {
  await requireProfile(["comercial", "admin"]);
  const supabase = await createClient();
  await supabase
    .from("rfqs")
    .update({ status: "CANCELADO" })
    .eq("id", rfqId)
    .in("status", ["BORRADOR", "COTIZANDO", "OFERTAS_RECIBIDAS"]);
  await logAudit(supabase, { action: "rfq.cancelled", rfqId });
  revalidatePath(`/rfqs/${rfqId}`);
}

/**
 * Manually reopens a closed RFQ (expired without a decision, or cancelled)
 * for another DEFAULT_RFQ_WINDOW_HOURS. Never available once a winner was
 * authorized â that's a done deal, not something to reopen.
 */
export async function reopenRfq(rfqId: string) {
  await requireProfile(["comercial", "admin"]);
  const supabase = await createClient();

  const { data: rfq } = await supabase.from("rfqs").select("status, expires_at").eq("id", rfqId).single();
  if (!rfq || !canReopenRfq(rfq)) {
    return { error: "Esta solicitud no se puede reabrir (ya tiene una oferta autorizada, o sigue abierta)." };
  }

  const newExpiresAt = new Date(Date.now() + DEFAULT_RFQ_WINDOW_HOURS * 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("rfqs")
    .update({
      status: rfq.status === "CANCELADO" ? "COTIZANDO" : rfq.status,
      expires_at: newExpiresAt,
    })
    .eq("id", rfqId);
  if (error) return { error: error.message };

  await logAudit(supabase, { action: "rfq.reopened", rfqId, detail: { expires_at: newExpiresAt } });
  revalidatePath(`/rfqs/${rfqId}`);
  revalidatePath("/rfqs");
  return { error: null };
}

/**
 * Hard-delete: solo admin, solo cuando está CANCELADO o BORRADOR (nunca si ya
 * tiene OC autorizada).
 *
 * Usa el admin client a propósito: rfqs no tiene policy de DELETE en RLS
 * (igual que authorized_orders/invoices — ver 0004_rls.sql), así que un
 * delete con el cliente normal no falla, simplemente no borra nada (0 filas
 * afectadas, sin error). rfq_providers/quotes/quote_versions/attachments
 * cascadean solos al borrar la fila; audit_logs.rfq_id NO tiene cascade
 * (toda RFQ tiene al menos el log de creación), así que se limpia a mano
 * antes — igual que deleteInvoice.
 */
export async function deleteRfq(rfqId: string) {
  const empresaId = await requireEmpresaId(["admin"]);
  const supabase = await createClient(); // solo para el audit log — necesita auth.uid()
  const admin = createAdminClient();

  const { data: rfq } = await admin
    .from("rfqs")
    .select("status")
    .eq("id", rfqId)
    .eq("empresa_id", empresaId)
    .maybeSingle();

  if (!rfq) return { error: "No encontrada." };
  if (!["CANCELADO", "BORRADOR"].includes(rfq.status)) {
    return { error: "Solo se pueden eliminar cotizaciones canceladas o en borrador." };
  }

  await admin.from("audit_logs").delete().eq("rfq_id", rfqId).eq("empresa_id", empresaId);

  const { error, count } = await admin
    .from("rfqs")
    .delete({ count: "exact" })
    .eq("id", rfqId)
    .eq("empresa_id", empresaId);
  if (error) return { error: error.message };
  if (!count) return { error: "No se pudo eliminar la solicitud." };

  await logAudit(supabase, { action: "rfq.deleted", detail: { rfq_id: rfqId } });
  revalidatePath("/rfqs");
  redirect("/rfqs");
}
