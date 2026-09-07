"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Recalcula monto_anterior / monto_presente de la cabecera sumando las líneas.
 * monto_acumulado es GENERATED, no se toca. Se llama después de cualquier
 * escritura de líneas — todas pasan por las server actions de este archivo.
 */
async function recomputeCertificateTotals(supabase: SupabaseClient, certificateId: string) {
  const { data: items } = await supabase
    .from("project_certificate_items")
    .select("monto_anterior, monto_presente")
    .eq("certificate_id", certificateId);

  const montoAnterior = (items ?? []).reduce((s, i) => s + Number(i.monto_anterior ?? 0), 0);
  const montoPresente = (items ?? []).reduce((s, i) => s + Number(i.monto_presente ?? 0), 0);

  await supabase
    .from("project_certificates")
    .update({ monto_anterior: montoAnterior, monto_presente: montoPresente })
    .eq("id", certificateId);
}

async function loadOwnedProject(supabase: SupabaseClient, projectId: string, empresaId: string) {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  return data;
}

/** Devuelve el certificado si pertenece a la empresa del que llama, con su estado. */
async function loadOwnedCertificate(supabase: SupabaseClient, certificateId: string, empresaId: string) {
  const { data } = await supabase
    .from("project_certificates")
    .select("id, project_id, numero, status, projects!inner(empresa_id)")
    .eq("id", certificateId)
    .single();
  if (!data) return null;
  const proj = data.projects as unknown as { empresa_id: string };
  if (proj.empresa_id !== empresaId) return null;
  return data as { id: string; project_id: string; numero: number; status: string };
}

/**
 * Crea un certificado y arma sus líneas automáticamente:
 *   - qty_anterior  ← suma de qty_presente de los certificados CERRADOS previos
 *   - qty_presente  ← suma de execution_entries dentro del período
 * Ambas quedan editables mientras el certificado esté en BORRADOR.
 */
export async function createCertificate(
  projectId: string,
  formData: FormData
): Promise<{ error: string | null; id: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  if (!(await loadOwnedProject(supabase, projectId, empresaId))) {
    return { error: "Proyecto no encontrado.", id: null };
  }

  const periodStart = (formData.get("period_start") as string | null) || null;
  const periodEnd = (formData.get("period_end") as string | null) || null;
  if (!periodStart || !periodEnd) return { error: "El período es obligatorio.", id: null };
  if (periodEnd < periodStart) return { error: "La fecha final no puede ser anterior a la inicial.", id: null };

  // Bloquear si hay un certificado abierto — el flujo es de a uno por vez.
  const { data: open } = await supabase
    .from("project_certificates")
    .select("numero")
    .eq("project_id", projectId)
    .eq("status", "BORRADOR")
    .limit(1);
  if (open && open.length > 0) {
    return { error: `Ya hay un certificado en borrador (N° ${open[0].numero}). Cerralo o eliminalo antes de crear otro.`, id: null };
  }

  const { data: maxRow } = await supabase
    .from("project_certificates")
    .select("numero")
    .eq("project_id", projectId)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();
  const numero = (maxRow?.numero ?? 0) + 1;

  // Rubros certificables: los que tienen cantidad y precio cargados.
  const { data: budgetItems } = await supabase
    .from("budget_items")
    .select("id, code, description, unit, quantity, unit_price, sort_order")
    .eq("project_id", projectId)
    .not("quantity", "is", null)
    .not("unit_price", "is", null)
    .order("sort_order");

  if (!budgetItems || budgetItems.length === 0) {
    return { error: "El proyecto no tiene rubros con cantidad y precio cargados en el presupuesto.", id: null };
  }

  // qty_anterior: suma de qty_presente en certificados CERRADOS.
  const { data: prevItems } = await supabase
    .from("project_certificate_items")
    .select("budget_item_id, qty_presente, project_certificates!inner(project_id, status)")
    .eq("project_certificates.project_id", projectId)
    .eq("project_certificates.status", "CERRADO");
  const anteriorByItem = new Map<string, number>();
  for (const r of prevItems ?? []) {
    if (!r.budget_item_id) continue;
    anteriorByItem.set(r.budget_item_id, (anteriorByItem.get(r.budget_item_id) ?? 0) + Number(r.qty_presente ?? 0));
  }

  // qty_presente: execution_entries dentro del período.
  const { data: execEntries } = await supabase
    .from("execution_entries")
    .select("budget_item_id, quantity_executed")
    .eq("project_id", projectId)
    .gte("entry_date", periodStart)
    .lte("entry_date", periodEnd);
  const presenteByItem = new Map<string, number>();
  for (const e of execEntries ?? []) {
    presenteByItem.set(
      e.budget_item_id,
      (presenteByItem.get(e.budget_item_id) ?? 0) + Number(e.quantity_executed ?? 0)
    );
  }

  const { data: cert, error: certError } = await supabase
    .from("project_certificates")
    .insert({
      project_id: projectId,
      numero,
      period_start: periodStart,
      period_end: periodEnd,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (certError || !cert) return { error: "No se pudo crear el certificado.", id: null };

  const lines = budgetItems.map((bi, idx) => ({
    certificate_id: cert.id,
    budget_item_id: bi.id,
    codigo: bi.code,
    descripcion: bi.description,
    unidad: bi.unit,
    qty_contractual: bi.quantity ?? 0,
    precio_unitario: bi.unit_price ?? 0,
    qty_anterior: anteriorByItem.get(bi.id) ?? 0,
    qty_presente: presenteByItem.get(bi.id) ?? 0,
    sort_order: bi.sort_order ?? idx,
  }));

  const { error: itemsError } = await supabase.from("project_certificate_items").insert(lines);
  if (itemsError) {
    await supabase.from("project_certificates").delete().eq("id", cert.id);
    return { error: "No se pudieron generar las líneas del certificado.", id: null };
  }

  await recomputeCertificateTotals(supabase, cert.id as string);
  await logAudit(supabase, {
    action: "project_certificate.created",
    detail: { project_id: projectId, certificate_id: cert.id, numero },
  });

  revalidatePath(`/projects/${projectId}`);
  return { error: null, id: cert.id as string };
}

/** Ajusta qty_anterior / qty_presente de una línea. Solo en BORRADOR. */
export async function updateCertificateItem(
  itemId: string,
  values: { qty_anterior?: number; qty_presente?: number }
): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: item } = await supabase
    .from("project_certificate_items")
    .select("id, certificate_id")
    .eq("id", itemId)
    .single();
  if (!item) return { error: "Línea no encontrada." };

  const cert = await loadOwnedCertificate(supabase, item.certificate_id, empresaId);
  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== "BORRADOR") return { error: "El certificado está cerrado y no se puede editar." };

  const patch: Record<string, number> = {};
  if (values.qty_anterior !== undefined) {
    if (!(values.qty_anterior >= 0)) return { error: "La cantidad anterior no puede ser negativa." };
    patch.qty_anterior = values.qty_anterior;
  }
  if (values.qty_presente !== undefined) {
    if (!(values.qty_presente >= 0)) return { error: "La cantidad del período no puede ser negativa." };
    patch.qty_presente = values.qty_presente;
  }
  if (Object.keys(patch).length === 0) return { error: null };

  const { error } = await supabase.from("project_certificate_items").update(patch).eq("id", itemId);
  if (error) return { error: "No se pudo actualizar la línea." };

  await recomputeCertificateTotals(supabase, cert.id);
  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}

/** Cierra el certificado: congela las líneas y lo hace referencia para el "anterior" del próximo. */
export async function closeCertificate(certificateId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== "BORRADOR") return { error: "El certificado ya está cerrado." };

  await recomputeCertificateTotals(supabase, cert.id);

  const { error } = await supabase
    .from("project_certificates")
    .update({ status: "CERRADO", closed_at: new Date().toISOString() })
    .eq("id", certificateId);
  if (error) return { error: "No se pudo cerrar el certificado." };

  await logAudit(supabase, {
    action: "project_certificate.closed",
    detail: { project_id: cert.project_id, certificate_id: cert.id, numero: cert.numero },
  });

  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}

/** Reabre un certificado cerrado. Solo admin — mueve el "anterior" de los siguientes. */
export async function reopenCertificate(certificateId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== "CERRADO") return { error: "El certificado no está cerrado." };

  // No permitir reabrir si hay un certificado posterior (rompería su "anterior").
  const { data: later } = await supabase
    .from("project_certificates")
    .select("numero")
    .eq("project_id", cert.project_id)
    .gt("numero", cert.numero)
    .limit(1);
  if (later && later.length > 0) {
    return { error: `No se puede reabrir: existe el certificado N° ${later[0].numero} que depende de este.` };
  }

  const { error } = await supabase
    .from("project_certificates")
    .update({ status: "BORRADOR", closed_at: null })
    .eq("id", certificateId);
  if (error) return { error: "No se pudo reabrir el certificado." };

  await logAudit(supabase, {
    action: "project_certificate.reopened",
    detail: { project_id: cert.project_id, certificate_id: cert.id, numero: cert.numero },
  });

  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}

/** Elimina un certificado en borrador (las líneas caen por cascade). */
export async function deleteCertificate(certificateId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== "BORRADOR") return { error: "Solo se puede eliminar un certificado en borrador." };

  const { error } = await supabase.from("project_certificates").delete().eq("id", certificateId);
  if (error) return { error: "No se pudo eliminar el certificado." };

  await logAudit(supabase, {
    action: "project_certificate.deleted",
    detail: { project_id: cert.project_id, certificate_id: cert.id, numero: cert.numero },
  });

  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}

/**
 * Regenera qty_presente de todas las líneas desde execution_entries del período
 * (y qty_anterior desde los certificados cerrados). Útil si se cargó avance en
 * campo después de haber creado el certificado. Solo en BORRADOR.
 */
export async function resyncCertificateFromExecution(certificateId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== "BORRADOR") return { error: "El certificado está cerrado y no se puede editar." };

  const { data: header } = await supabase
    .from("project_certificates")
    .select("period_start, period_end")
    .eq("id", certificateId)
    .single();
  if (!header) return { error: "Certificado no encontrado." };

  const { data: items } = await supabase
    .from("project_certificate_items")
    .select("id, budget_item_id")
    .eq("certificate_id", certificateId);
  if (!items || items.length === 0) return { error: null };

  const { data: prevItems } = await supabase
    .from("project_certificate_items")
    .select("budget_item_id, qty_presente, project_certificates!inner(project_id, status)")
    .eq("project_certificates.project_id", cert.project_id)
    .eq("project_certificates.status", "CERRADO");
  const anteriorByItem = new Map<string, number>();
  for (const r of prevItems ?? []) {
    if (!r.budget_item_id) continue;
    anteriorByItem.set(r.budget_item_id, (anteriorByItem.get(r.budget_item_id) ?? 0) + Number(r.qty_presente ?? 0));
  }

  const { data: execEntries } = await supabase
    .from("execution_entries")
    .select("budget_item_id, quantity_executed")
    .eq("project_id", cert.project_id)
    .gte("entry_date", header.period_start)
    .lte("entry_date", header.period_end);
  const presenteByItem = new Map<string, number>();
  for (const e of execEntries ?? []) {
    presenteByItem.set(
      e.budget_item_id,
      (presenteByItem.get(e.budget_item_id) ?? 0) + Number(e.quantity_executed ?? 0)
    );
  }

  for (const it of items) {
    if (!it.budget_item_id) continue;
    await supabase
      .from("project_certificate_items")
      .update({
        qty_anterior: anteriorByItem.get(it.budget_item_id) ?? 0,
        qty_presente: presenteByItem.get(it.budget_item_id) ?? 0,
      })
      .eq("id", it.id);
  }

  await recomputeCertificateTotals(supabase, certificateId);
  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}
