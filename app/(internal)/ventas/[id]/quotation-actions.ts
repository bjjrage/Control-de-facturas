"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import { canSendForAcceptance, quotationPortalPath } from "@/lib/quotation";
import {
  generateQuotationToken,
  hashQuotationToken,
  quotationTokenPrefix,
} from "@/lib/quotation-tokens";
import { SalesDocument, SalesQuotationToken, WorkOrderStatus } from "@/lib/types";

function appBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
}

export function portalUrlFor(rawToken: string) {
  const base = appBaseUrl();
  return base ? `${base}${quotationPortalPath(rawToken)}` : quotationPortalPath(rawToken);
}

function parseExpiry(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Genera un link seguro de aceptación para una PROFORMA.
 * - Solo PROFORMA en BORRADOR con total > 0 (ver canSendForAcceptance).
 * - El raw de 256-bit se genera en app y se devuelve UNA vez en memoria;
 *   en DB solo quedan token_hash + token_prefix (PUNTO 2: sin plaintext).
 * - Congela quotation_version vigente en el token.
 * - Revoca links activos anteriores (quedan en auditoría, no se borran).
 * - Pasa la cotización a PENDING_ACCEPTANCE.
 * - Si se indica email, se registra EMAIL_PREPARED (mailto: compuesto ≠
 *   email enviado: no hay provider SMTP, jamás se registra EMAIL_SENT).
 * El cliente acepta SOLO la cotización; la OT se genera vía RPC al aceptar.
 */
export async function createQuotationLink(docId: string, formData: FormData) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("sales_documents")
    .select("*")
    .eq("id", docId)
    .single<SalesDocument>();
  if (!doc) return { error: "Documento no encontrado." };
  if (!canSendForAcceptance(doc)) {
    return { error: "Solo se puede enviar a aceptación una proforma en borrador con total mayor a cero." };
  }

  const expiresAt = parseExpiry(formData.get("expires_at"));
  if (formData.get("expires_at") && !expiresAt) return { error: "Vencimiento inválido." };
  const emailRaw = formData.get("sent_to_email");
  const preparedForEmail =
    typeof emailRaw === "string" && emailRaw.trim() !== "" ? emailRaw.trim().slice(0, 320) : null;
  if (preparedForEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(preparedForEmail)) {
    return { error: "Email del cliente inválido." };
  }

  // Revocar links activos anteriores del mismo documento (histórico).
  const { data: actives } = await supabase
    .from("sales_quotation_tokens")
    .select("id")
    .eq("sales_document_id", docId)
    .is("revoked_at", null);
  if (actives && actives.length > 0) {
    await supabase
      .from("sales_quotation_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("sales_document_id", docId)
      .is("revoked_at", null);
    await supabase.from("sales_quotation_events").insert(
      (actives as { id: string }[]).map((t) => ({
        sales_document_id: docId,
        token_id: t.id,
        event_type: "VERSION_SUPERSEDED",
        actor_label: profile.full_name ?? profile.email,
        detail: { reason: "new_link_generated", quotation_version: doc.quotation_version },
      }))
    );
  }

  // El secreto vive solo acá (memoria) y en la URL devuelta una vez.
  const rawToken = generateQuotationToken();
  const { data: token, error } = await supabase
    .from("sales_quotation_tokens")
    .insert({
      sales_document_id: docId,
      quotation_version: doc.quotation_version ?? 1,
      token_hash: hashQuotationToken(rawToken),
      token_prefix: quotationTokenPrefix(rawToken),
      expires_at: expiresAt,
      created_by: profile.id,
      prepared_for_email: preparedForEmail,
      prepared_at: preparedForEmail ? new Date().toISOString() : null,
    })
    .select("*")
    .single<SalesQuotationToken>();
  if (error || !token) return { error: error?.message ?? "No se pudo generar el link." };

  const { error: docError } = await supabase
    .from("sales_documents")
    .update({
      acceptance_status: "PENDING_ACCEPTANCE",
      acceptance_expires_at: expiresAt,
    })
    .eq("id", docId);
  if (docError) return { error: docError.message };

  await supabase.from("sales_quotation_events").insert({
    sales_document_id: docId,
    token_id: token.id,
    event_type: preparedForEmail ? "EMAIL_PREPARED" : "CREATED",
    actor_label: profile.full_name ?? profile.email,
    detail: {
      quotation_version: token.quotation_version,
      expires_at: expiresAt,
      prepared_for_email: preparedForEmail,
    },
  });

  let mailto: string | null = null;
  if (preparedForEmail) {
    const subject = encodeURIComponent("Cotización para tu aceptación");
    const body = encodeURIComponent(
      `Hola,\n\nTe compartimos la cotización para tu revisión y aceptación electrónica:\n${portalUrlFor(rawToken)}\n\nSi el enlace vence o necesitás cambios, avisanos y te enviamos una versión actualizada.\n`
    );
    mailto = `mailto:${encodeURIComponent(preparedForEmail)}?subject=${subject}&body=${body}`;
  }

  revalidatePath(`/ventas/${docId}`);
  revalidatePath("/proformas");
  return { error: null as string | null, rawToken, url: portalUrlFor(rawToken), mailto };
}

/**
 * Registra que el link se copió al portapapeles (PUNTO 8).
 * Copiar ≠ entregar al cliente: no registra envío, destinatario ni aceptación.
 */
export async function logQuotationLinkCopied(docId: string, tokenId: string) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: token } = await supabase
    .from("sales_quotation_tokens")
    .select("id")
    .eq("id", tokenId)
    .eq("sales_document_id", docId)
    .single<{ id: string }>();
  if (!token) return { error: "Link no encontrado." };

  const { error } = await supabase.from("sales_quotation_events").insert({
    sales_document_id: docId,
    token_id: tokenId,
    event_type: "LINK_COPIED",
    actor_label: profile.full_name ?? profile.email,
  });
  if (error) return { error: error.message };
  return { error: null as string | null };
}

export async function revokeQuotationLink(docId: string, tokenId: string) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: token } = await supabase
    .from("sales_quotation_tokens")
    .select("id, revoked_at")
    .eq("id", tokenId)
    .eq("sales_document_id", docId)
    .single<{ id: string; revoked_at: string | null }>();
  if (!token) return { error: "Link no encontrado." };
  if (token.revoked_at) return { error: null };

  const { error } = await supabase
    .from("sales_quotation_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", tokenId);
  if (error) return { error: error.message };

  await supabase.from("sales_quotation_events").insert({
    sales_document_id: docId,
    token_id: tokenId,
    event_type: "REVOKED",
  });

  revalidatePath(`/ventas/${docId}`);
  return { error: null as string | null };
}

export async function updateQuotationExpiry(docId: string, formData: FormData) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const expiresAt = parseExpiry(formData.get("expires_at"));
  if (formData.get("expires_at") && !expiresAt) return { error: "Vencimiento inválido." };

  const { data: doc } = await supabase
    .from("sales_documents")
    .select("id, doc_type, acceptance_status")
    .eq("id", docId)
    .single<Pick<SalesDocument, "id" | "doc_type" | "acceptance_status">>();
  if (!doc) return { error: "Documento no encontrado." };
  if (doc.doc_type !== "PROFORMA") return { error: "Solo las proformas usan aceptación electrónica." };
  if (doc.acceptance_status !== "PENDING_ACCEPTANCE" && expiresAt) {
    return { error: "Solo se puede fijar vencimiento en una cotización pendiente de aceptación." };
  }

  const { error } = await supabase
    .from("sales_documents")
    .update({ acceptance_expires_at: expiresAt })
    .eq("id", docId);
  if (error) return { error: error.message };

  // Propagar al link activo (el portal usa la más restrictiva, pero mantener
  // ambos sincronizados evita confusión en la UI interna).
  await supabase
    .from("sales_quotation_tokens")
    .update({ expires_at: expiresAt })
    .eq("sales_document_id", docId)
    .is("revoked_at", null);

  revalidatePath(`/ventas/${docId}`);
  return { error: null as string | null };
}

/** Vuelve una cotización REJECTED/EXPIRED a DRAFT para un nuevo ciclo. */
export async function reopenQuotationToDraft(docId: string) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("sales_documents")
    .select("id, doc_type, acceptance_status")
    .eq("id", docId)
    .single<Pick<SalesDocument, "id" | "doc_type" | "acceptance_status">>();
  if (!doc) return { error: "Documento no encontrado." };
  if (doc.doc_type !== "PROFORMA") return { error: "Solo las proformas usan aceptación electrónica." };
  if (doc.acceptance_status !== "REJECTED" && doc.acceptance_status !== "EXPIRED") {
    return { error: "Solo se puede reabrir una cotización rechazada o vencida." };
  }

  const { error } = await supabase
    .from("sales_documents")
    .update({
      acceptance_status: "DRAFT",
      acceptance_expires_at: null,
      rejected_at: null,
      rejection_reason: null,
    })
    .eq("id", docId);
  if (error) return { error: error.message };

  revalidatePath(`/ventas/${docId}`);
  revalidatePath("/proformas");
  return { error: null as string | null };
}

/** Gestión interna de la OT (la OT nunca la toca el cliente). */
export async function updateWorkOrderStatus(workOrderId: string, status: WorkOrderStatus) {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const allowed: WorkOrderStatus[] = ["PENDIENTE", "EN_CURSO", "COMPLETADA", "CANCELADA"];
  if (!allowed.includes(status)) return { error: "Estado inválido." };

  const { data: wo } = await supabase
    .from("work_orders")
    .select("id, sales_document_id")
    .eq("id", workOrderId)
    .single<{ id: string; sales_document_id: string }>();
  if (!wo) return { error: "Orden no encontrada." };

  const { error } = await supabase.from("work_orders").update({ status }).eq("id", workOrderId);
  if (error) return { error: error.message };

  await supabase.from("sales_quotation_events").insert({
    sales_document_id: wo.sales_document_id,
    event_type: "OT_STATUS_CHANGED",
    detail: { work_order_id: workOrderId, status },
  });

  revalidatePath("/ordenes-trabajo");
  revalidatePath(`/ordenes-trabajo/${workOrderId}`);
  return { error: null as string | null };
}

/**
 * Aprobación interna de OT en PENDING_INTERNAL_APPROVAL (PUNTO 5).
 * Autoriza el rol responsable configurado en la política (o admin).
 * Nunca hardcodea personas: solo roles existentes (user_role).
 */
export async function approveWorkOrderInternal(workOrderId: string) {
  const profile = await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: wo } = await supabase
    .from("work_orders")
    .select("id, sales_document_id, workflow_status, responsible_role")
    .eq("id", workOrderId)
    .single<{ id: string; sales_document_id: string; workflow_status: string; responsible_role: string }>();
  if (!wo) return { error: "Orden no encontrada." };
  if (wo.workflow_status !== "PENDING_INTERNAL_APPROVAL") {
    return { error: "La orden no está pendiente de aprobación interna." };
  }
  if (profile.role !== wo.responsible_role && profile.role !== "admin") {
    return { error: `Requiere rol ${wo.responsible_role}.` };
  }

  const { error } = await supabase
    .from("work_orders")
    .update({
      workflow_status: "READY_FOR_PRODUCTION",
      approved_at: new Date().toISOString(),
      approved_by: profile.id,
    })
    .eq("id", workOrderId);
  if (error) return { error: error.message };

  await supabase.from("sales_quotation_events").insert({
    sales_document_id: wo.sales_document_id,
    event_type: "OT_STATUS_CHANGED",
    actor_label: profile.full_name ?? profile.email,
    detail: { work_order_id: workOrderId, workflow_status: "READY_FOR_PRODUCTION", approved_by_role: profile.role },
  });

  revalidatePath("/ordenes-trabajo");
  revalidatePath(`/ordenes-trabajo/${workOrderId}`);
  return { error: null as string | null };
}
