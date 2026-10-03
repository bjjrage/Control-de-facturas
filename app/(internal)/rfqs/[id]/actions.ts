"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireProfile, requireEmpresaId } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { SelectionReason } from "@/lib/types";
import {
  isRfqOpen,
  canReopenRfq,
  DEFAULT_RFQ_WINDOW_HOURS,
} from "@/lib/rfq-status";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export async function inviteProviders(rfqId: string, providerIds: string[]) {
  await requireProfile(["comercial", "administracion", "admin"]);
  if (!providerIds.length) return { error: "Elegí proveedores" };
  const db = await createClient();
  const { error } = await db.rpc("rfq_invite", {
    p_rfq_id: rfqId,
    p_provider_ids: [...new Set(providerIds)],
  });
  revalidatePath("/rfqs/" + rfqId);
  return { error: error?.message ?? null };
}

export async function getSignedAttachmentUrl(bucket: string, path: string) {
  await requireProfile(["comercial", "administracion", "admin"]);
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(path, 120);
  if (error || !data)
    return {
      url: null,
      error: error?.message ?? "No se pudo generar el enlace.",
    };
  return { url: data.signedUrl, error: null };
}

export async function selectAndAuthorizeOffer(params: {
  rfqId: string;
  rfqProviderId: string;
  quoteVersionId: string;
  selectionReason: SelectionReason | null;
  selectionReasonDetail: string | null;
}) {
  await requireProfile(["comercial", "admin"]);
  return {
    error:
      "Usá asignación humana, autorización, preview y confirmación de RFQ 2.0",
    authorizedOrderId: null,
  };
}

export async function cancelRfq(rfqId: string) {
  const profile = await requireProfile([
    "comercial",
    "administracion",
    "admin",
  ]);
  if (!profile.active) return { error: "Cuenta inactiva" };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rfqs")
    .update({ status: "CANCELADO" })
    .eq("id", rfqId)
    .eq("empresa_id", profile.empresa_id)
    .in("status", ["BORRADOR", "COTIZANDO", "OFERTAS_RECIBIDAS"])
    .select("id")
    .maybeSingle();
  if (error || !data)
    return { error: error?.message ?? "Solicitud no cancelable" };
  await logAudit(supabase, { action: "rfq.cancelled", rfqId });
  revalidatePath(`/rfqs/${rfqId}`);
  return { error: null };
}

/**
 * Manually reopens a closed RFQ (expired without a decision, or cancelled)
 * for another DEFAULT_RFQ_WINDOW_HOURS. Never available once a winner was
 * authorized â that's a done deal, not something to reopen.
 */
export async function reopenRfq(rfqId: string) {
  const profile = await requireProfile([
    "comercial",
    "administracion",
    "admin",
  ]);
  if (!profile.active) return { error: "Cuenta inactiva" };
  const supabase = await createClient();

  const { data: rfq } = await supabase
    .from("rfqs")
    .select("status, expires_at,closed_at")
    .eq("id", rfqId)
    .eq("empresa_id", profile.empresa_id)
    .single();
  if (!rfq || rfq.closed_at || !canReopenRfq(rfq)) {
    return {
      error:
        "Esta solicitud no se puede reabrir (ya tiene una oferta autorizada, o sigue abierta).",
    };
  }

  const newExpiresAt = new Date(
    Date.now() + DEFAULT_RFQ_WINDOW_HOURS * 60 * 60 * 1000,
  ).toISOString();
  const { error } = await supabase
    .from("rfqs")
    .update({
      status: rfq.status === "CANCELADO" ? "COTIZANDO" : rfq.status,
      expires_at: newExpiresAt,
    })
    .eq("id", rfqId);
  if (error) return { error: error.message };

  await logAudit(supabase, {
    action: "rfq.reopened",
    rfqId,
    detail: { expires_at: newExpiresAt },
  });
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
    return {
      error: "Solo se pueden eliminar cotizaciones canceladas o en borrador.",
    };
  }

  const invitations = await admin
    .from("rfq_providers")
    .select("id")
    .eq("rfq_id", rfqId)
    .eq("empresa_id", empresaId);
  if (invitations.error) return { error: invitations.error.message };
  if (invitations.data?.length) {
    const quotes = await admin
      .from("quotes")
      .select("id", { count: "exact", head: true })
      .eq("empresa_id", empresaId)
      .in(
        "rfq_provider_id",
        invitations.data.map((p) => p.id),
      );
    if (quotes.error) return { error: quotes.error.message };
    if (quotes.count)
      return {
        error:
          "Una RFQ con ofertas conserva su historial; usá cancelar o cerrar",
      };
  }
  await admin
    .from("audit_logs")
    .delete()
    .eq("rfq_id", rfqId)
    .eq("empresa_id", empresaId);

  const { error, count } = await admin
    .from("rfqs")
    .delete({ count: "exact" })
    .eq("id", rfqId)
    .eq("empresa_id", empresaId);
  if (error) return { error: error.message };
  if (!count) return { error: "No se pudo eliminar la solicitud." };

  await logAudit(supabase, {
    action: "rfq.deleted",
    detail: { rfq_id: rfqId },
  });
  revalidatePath("/rfqs");
  redirect("/rfqs");
}

/**
 * Carga manual de precios por ítem desde la foto/PDF que mandó un proveedor
 * (no hay parseo automático: una persona lee el adjunto y tipea). Crea una
 * versión nueva de la cotización con cargado_por=INTERNO y queda auditado.
 */
export async function enterQuotePricesManually(
  rfqProviderId: string,
  formData: FormData,
) {
  const { submitInternalQuoteAction } = await import("./workflow-actions");
  return submitInternalQuoteAction(rfqProviderId, formData);
}
