"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectCertificateStatus } from "@/lib/types";

const FROZEN_STATES: ProjectCertificateStatus[] = ["ELABORADO", "VERIFICADO", "APROBADO", "FACTURADO"];
const round0 = (n: number) => Math.round(n);

/**
 * Recalcula monto_anterior / monto_presente de la cabecera sumando las líneas.
 * monto_acumulado y monto_liquido son GENERATED, no se tocan. Se llama después
 * de cualquier escritura de líneas — todas pasan por este archivo.
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

  return { montoAnterior, montoPresente };
}

async function loadOwnedProject(supabase: SupabaseClient, projectId: string, empresaId: string) {
  const { data } = await supabase
    .from("projects")
    .select("id, devolucion_anticipo_pct, retencion_pct, contract_amount, orden_inicio_date, start_date")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  return data as
    | {
        id: string;
        devolucion_anticipo_pct: number;
        retencion_pct: number;
        contract_amount: number;
        orden_inicio_date: string | null;
        start_date: string | null;
      }
    | null;
}

type OwnedCert = {
  id: string;
  project_id: string;
  numero: number;
  status: ProjectCertificateStatus;
  period_start: string;
  period_end: string;
  monto_presente: number;
};

async function loadOwnedCertificate(
  supabase: SupabaseClient,
  certificateId: string,
  empresaId: string
): Promise<OwnedCert | null> {
  const { data } = await supabase
    .from("project_certificates")
    .select("id, project_id, numero, status, period_start, period_end, monto_presente, projects!inner(empresa_id)")
    .eq("id", certificateId)
    .single();
  if (!data) return null;
  const proj = data.projects as unknown as { empresa_id: string };
  if (proj.empresa_id !== empresaId) return null;
  return {
    id: data.id as string,
    project_id: data.project_id as string,
    numero: data.numero as number,
    status: data.status as ProjectCertificateStatus,
    period_start: data.period_start as string,
    period_end: data.period_end as string,
    monto_presente: Number(data.monto_presente ?? 0),
  };
}

/** anterior + presente por budget_item, leyendo certificados ya congelados y el avance del período. */
async function buildQuantityMaps(
  supabase: SupabaseClient,
  projectId: string,
  periodStart: string,
  periodEnd: string
) {
  const { data: prevItems } = await supabase
    .from("project_certificate_items")
    .select("budget_item_id, qty_presente, project_certificates!inner(project_id, status)")
    .eq("project_certificates.project_id", projectId)
    .in("project_certificates.status", FROZEN_STATES);
  const anterior = new Map<string, number>();
  for (const r of prevItems ?? []) {
    if (!r.budget_item_id) continue;
    anterior.set(r.budget_item_id, (anterior.get(r.budget_item_id) ?? 0) + Number(r.qty_presente ?? 0));
  }

  const { data: execEntries } = await supabase
    .from("execution_entries")
    .select("budget_item_id, quantity_executed")
    .eq("project_id", projectId)
    .gte("entry_date", periodStart)
    .lte("entry_date", periodEnd);
  const presente = new Map<string, number>();
  for (const e of execEntries ?? []) {
    presente.set(e.budget_item_id, (presente.get(e.budget_item_id) ?? 0) + Number(e.quantity_executed ?? 0));
  }

  return { anterior, presente };
}

/**
 * Crea un certificado y arma sus líneas automáticamente:
 *   - qty_anterior  ← suma de qty_presente de los certificados ya congelados
 *   - qty_presente  ← suma de execution_entries dentro del período
 * Ambas quedan editables mientras esté en BORRADOR.
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

  const { data: latest } = await supabase
    .from("project_certificates")
    .select("numero, status")
    .eq("project_id", projectId)
    .order("numero", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latest && !["APROBADO", "FACTURADO"].includes(latest.status)) {
    return {
      error: `El certificado N° ${latest.numero} está en ${String(latest.status).toLowerCase()}. Aprobalo antes de empezar el siguiente.`,
      id: null,
    };
  }
  const numero = (latest?.numero ?? 0) + 1;

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

  const { anterior, presente } = await buildQuantityMaps(supabase, projectId, periodStart, periodEnd);

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
    qty_anterior: anterior.get(bi.id) ?? 0,
    qty_presente: presente.get(bi.id) ?? 0,
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

  const { data: item } = await supabase
    .from("project_certificate_items")
    .select("id, certificate_id")
    .eq("id", itemId)
    .single();
  if (!item) return { error: "Línea no encontrada." };

  const cert = await loadOwnedCertificate(supabase, item.certificate_id, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== "BORRADOR") return { error: "El certificado ya está elaborado y no se puede editar." };

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

/**
 * Ajustes y penalidades — cargados por Fiscalización durante la revisión.
 * Editables mientras el certificado no esté aprobado.
 */
export async function updateCertificateDeductions(
  certificateId: string,
  values: { ajustes?: number; penalidad_avance?: number; penalidad_presentacion?: number }
): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };
  if (!["ELABORADO", "VERIFICADO"].includes(cert.status)) {
    return { error: "Los ajustes solo se cargan mientras el certificado está elaborado o en verificación." };
  }

  const patch: Record<string, number> = {};
  for (const k of ["ajustes", "penalidad_avance", "penalidad_presentacion"] as const) {
    const v = values[k];
    if (v === undefined) continue;
    if (!Number.isFinite(v)) return { error: "Valor inválido." };
    if (k !== "ajustes" && v < 0) return { error: "Las penalidades no pueden ser negativas." };
    patch[k] = v;
  }
  if (Object.keys(patch).length === 0) return { error: null };

  const { error } = await supabase.from("project_certificates").update(patch).eq("id", certificateId);
  if (error) return { error: "No se pudieron guardar los ajustes." };

  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}

/**
 * BORRADOR → ELABORADO. Congela las líneas, copia los % del contrato y calcula
 * la devolución del anticipo y la retención sobre el monto del período.
 */
export async function submitCertificate(certificateId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== "BORRADOR") return { error: "El certificado ya está elaborado." };

  const project = await loadOwnedProject(supabase, cert.project_id, profile.empresa_id);
  if (!project) return { error: "Proyecto no encontrado." };

  const { montoPresente } = await recomputeCertificateTotals(supabase, cert.id);
  const devolucion = round0((montoPresente * project.devolucion_anticipo_pct) / 100);
  const retencion = round0((montoPresente * project.retencion_pct) / 100);

  const { error } = await supabase
    .from("project_certificates")
    .update({
      status: "ELABORADO",
      elaborado_por: profile.id,
      elaborado_at: new Date().toISOString(),
      closed_at: new Date().toISOString(),
      devolucion_anticipo_pct_snap: project.devolucion_anticipo_pct,
      retencion_pct_snap: project.retencion_pct,
      devolucion_anticipo: devolucion,
      retencion,
    })
    .eq("id", certificateId);
  if (error) return { error: "No se pudo elaborar el certificado." };

  await logAudit(supabase, {
    action: "project_certificate.submitted",
    detail: { project_id: cert.project_id, certificate_id: cert.id, numero: cert.numero },
  });
  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}

async function transition(
  certificateId: string,
  from: ProjectCertificateStatus,
  to: ProjectCertificateStatus,
  buildPatch: (profileId: string) => Record<string, unknown>,
  auditAction: string
): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== from) return { error: `El certificado no está en estado ${from.toLowerCase()}.` };

  const { error } = await supabase
    .from("project_certificates")
    .update({ status: to, ...buildPatch(profile.id) })
    .eq("id", certificateId);
  if (error) return { error: "No se pudo cambiar el estado del certificado." };

  await logAudit(supabase, {
    action: auditAction,
    detail: { project_id: cert.project_id, certificate_id: cert.id, numero: cert.numero },
  });
  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}

/** ELABORADO → VERIFICADO (Fiscalización / SAT). */
export async function verifyCertificate(certificateId: string) {
  return transition(
    certificateId,
    "ELABORADO",
    "VERIFICADO",
    (id) => ({ verificado_por: id, verificado_at: new Date().toISOString() }),
    "project_certificate.verified"
  );
}

/** VERIFICADO → APROBADO (Supervisión / comitente). Recién acá cuenta para el "anterior" del próximo. */
export async function approveCertificate(certificateId: string) {
  return transition(
    certificateId,
    "VERIFICADO",
    "APROBADO",
    (id) => ({ aprobado_por: id, aprobado_at: new Date().toISOString() }),
    "project_certificate.approved"
  );
}

/** APROBADO → FACTURADO. */
export async function markCertificateInvoiced(
  certificateId: string,
  facturaNumero: string
): Promise<{ error: string | null }> {
  const num = facturaNumero.trim();
  if (!num) return { error: "Ingresá el número de factura." };
  return transition(
    certificateId,
    "APROBADO",
    "FACTURADO",
    () => ({ factura_numero: num, facturado_at: new Date().toISOString() }),
    "project_certificate.invoiced"
  );
}

/** Retrocede un paso en el circuito. Solo admin, y no si hay un certificado posterior. */
export async function revertCertificate(certificateId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };

  const backTo: Record<ProjectCertificateStatus, ProjectCertificateStatus | null> = {
    BORRADOR: null,
    ELABORADO: "BORRADOR",
    VERIFICADO: "ELABORADO",
    APROBADO: "VERIFICADO",
    FACTURADO: "APROBADO",
  };
  const target = backTo[cert.status];
  if (!target) return { error: "El certificado está en borrador, no se puede retroceder." };

  if (["APROBADO", "FACTURADO"].includes(cert.status)) {
    const { data: later } = await supabase
      .from("project_certificates")
      .select("numero")
      .eq("project_id", cert.project_id)
      .gt("numero", cert.numero)
      .limit(1);
    if (later && later.length > 0) {
      return { error: `No se puede: existe el certificado N° ${later[0].numero} que depende de este.` };
    }
  }

  // Al volver a un estado, se limpia la firma del paso que se abandona.
  const clear: Record<string, null> = {};
  if (cert.status === "ELABORADO") {
    clear.elaborado_por = null;
    clear.elaborado_at = null;
    clear.closed_at = null;
    clear.devolucion_anticipo_pct_snap = null;
    clear.retencion_pct_snap = null;
  }
  if (cert.status === "VERIFICADO") {
    clear.verificado_por = null;
    clear.verificado_at = null;
  }
  if (cert.status === "APROBADO") {
    clear.aprobado_por = null;
    clear.aprobado_at = null;
  }
  if (cert.status === "FACTURADO") {
    clear.facturado_at = null;
    clear.factura_numero = null;
  }

  const { error } = await supabase
    .from("project_certificates")
    .update({ status: target, ...clear })
    .eq("id", certificateId);
  if (error) return { error: "No se pudo retroceder el certificado." };

  await logAudit(supabase, {
    action: "project_certificate.reverted",
    detail: { project_id: cert.project_id, certificate_id: cert.id, numero: cert.numero, to: target },
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
 * Regenera qty_anterior / qty_presente de todas las líneas desde los
 * certificados congelados y el avance del período. Solo en BORRADOR.
 */
export async function resyncCertificateFromExecution(certificateId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== "BORRADOR") return { error: "El certificado ya está elaborado y no se puede editar." };

  const { data: items } = await supabase
    .from("project_certificate_items")
    .select("id, budget_item_id")
    .eq("certificate_id", certificateId);
  if (!items || items.length === 0) return { error: null };

  const { anterior, presente } = await buildQuantityMaps(
    supabase,
    cert.project_id,
    cert.period_start,
    cert.period_end
  );

  for (const it of items) {
    if (!it.budget_item_id) continue;
    await supabase
      .from("project_certificate_items")
      .update({
        qty_anterior: anterior.get(it.budget_item_id) ?? 0,
        qty_presente: presente.get(it.budget_item_id) ?? 0,
      })
      .eq("id", it.id);
  }

  await recomputeCertificateTotals(supabase, certificateId);
  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}
