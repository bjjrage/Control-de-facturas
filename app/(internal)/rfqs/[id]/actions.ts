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

  let authorizedOrderId: string | null = null;
  const { data: rpcOrderId, error: rpcError } = await supabase.rpc("select_and_authorize_offer_atomically", {
    p_empresa_id: profile.empresa_id,
    p_actor_id: profile.id,
    p_rfq_id: params.rfqId,
    p_rfq_provider_id: params.rfqProviderId,
    p_quote_version_id: params.quoteVersionId,
    p_selection_reason: params.selectionReason,
    p_selection_reason_detail: params.selectionReasonDetail,
  });

  if (!rpcError && rpcOrderId) {
    authorizedOrderId = rpcOrderId;
  } else if (
    rpcError &&
    !rpcError.message.includes("Could not find the function") &&
    !rpcError.message.includes("schema cache")
  ) {
    return { error: rpcError.message };
  } else {
    // Fallback directo con control estricto multi-tenant si la RPC no está en el schema cache
    const { data: rfq, error: rfqError } = await supabase
      .from("rfqs")
      .select("*")
      .eq("id", params.rfqId)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle();
    if (rfqError || !rfq) return { error: "Solicitud no encontrada." };

    if (rfq.status === "AUTORIZADO") {
      const { data: existingOrder } = await supabase
        .from("authorized_orders")
        .select("id")
        .eq("rfq_id", params.rfqId)
        .eq("empresa_id", profile.empresa_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existingOrder) {
        return { error: null, authorizedOrderId: existingOrder.id };
      }
      return { error: "Esta solicitud ya tiene una oferta autorizada." };
    }

    if (rfq.status === "CANCELADO") {
      return { error: "No se puede autorizar una solicitud cancelada." };
    }

    const { data: rfqProvider } = await supabase
      .from("rfq_providers")
      .select("*, providers(name)")
      .eq("id", params.rfqProviderId)
      .eq("rfq_id", params.rfqId)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle();
    if (!rfqProvider) return { error: "Proveedor no encontrado en esta solicitud." };

    const { data: quoteVersion } = await supabase
      .from("quote_versions")
      .select("*")
      .eq("id", params.quoteVersionId)
      .eq("empresa_id", profile.empresa_id)
      .maybeSingle();
    if (!quoteVersion) return { error: "Cotización no encontrada." };

    const isCheapest = params.selectionReason === null;

    const { data: order, error: orderError } = await supabase
      .from("authorized_orders")
      .insert({
        empresa_id: profile.empresa_id,
        rfq_id: rfq.id,
        provider_id: rfqProvider.provider_id,
        quote_version_id: quoteVersion.id,
        created_from: "rfq",
        provider_name: (rfqProvider as unknown as { providers: { name: string } }).providers?.name ?? "Proveedor",
        client_name: rfq.client_name ?? "Cliente",
        product: rfq.product,
        quantity: rfq.quantity,
        unit: rfq.unit,
        unit_price: quoteVersion.unit_price,
        total_price: quoteVersion.total_price,
        currency: quoteVersion.currency,
        vat_included: quoteVersion.vat_included ?? true,
        authorized_by: profile.id,
        is_cheapest: isCheapest,
        selection_reason: isCheapest ? null : params.selectionReason,
        selection_reason_detail: params.selectionReasonDetail,
        project_id: rfq.project_id ?? null,
      })
      .select("id")
      .single();

    if (orderError || !order) return { error: orderError?.message ?? "No se pudo autorizar la orden." };
    authorizedOrderId = order.id;

    // Crear ítems de la orden autorizada
    await supabase.from("authorized_order_items").insert({
      empresa_id: profile.empresa_id,
      order_id: authorizedOrderId,
      product: rfq.product,
      quantity: rfq.quantity,
      unit: rfq.unit,
      unit_price: quoteVersion.unit_price,
      total_price: quoteVersion.total_price,
      sort_order: 0,
    });

    await supabase
      .from("rfqs")
      .update({
        status: "AUTORIZADO",
        selected_rfq_provider_id: params.rfqProviderId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", rfq.id)
      .eq("empresa_id", profile.empresa_id);
  }

  const { data: rfqRow } = await supabase
    .from("rfqs")
    .select("project_id")
    .eq("id", params.rfqId)
    .eq("empresa_id", profile.empresa_id)
    .maybeSingle();

  await logAudit(supabase, {
    action: "rfq.offer_authorized",
    rfqId: params.rfqId,
    rfqProviderId: params.rfqProviderId,
    authorizedOrderId: authorizedOrderId ?? undefined,
    detail: { rpc: !rpcError },
  });

  revalidatePath(`/rfqs/${params.rfqId}`);
  revalidatePath("/orders");
  if (rfqRow?.project_id) revalidatePath(`/projects/${rfqRow.project_id}`);
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
