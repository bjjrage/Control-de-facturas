"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProjectCertificateStatus } from "@/lib/types";
import type { ProjectUnit } from "@/lib/types";
import { buildCertificateImportLines, certificateWorkbookFingerprint, extractCertificateWorkbookData, type CertificateBudgetItem, type CertificateImportLine, type CertificateWorkbookData } from "@/lib/certificates/workbook-import";
import { parseWorkbook } from "@/lib/workbook-interpretation/parser";

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

/** Imports a reviewed XLSX into an existing project's canonical certificate tables. */
export async function importCertificateWorkbook(
  projectId: string,
  formData: FormData,
): Promise<{ error: string | null; id: string | null; alreadyImported: boolean }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();
  if (!(await loadOwnedProject(supabase, projectId, profile.empresa_id))) {
    return { error: "Obra no encontrada para la empresa activa.", id: null, alreadyImported: false };
  }

  const uploaded = formData.get("file");
  if (!(uploaded instanceof File) || !/\.xlsx$/i.test(uploaded.name)) {
    return { error: "Seleccioná un archivo .xlsx válido.", id: null, alreadyImported: false };
  }
  if (uploaded.size > 10 * 1024 * 1024) return { error: "El archivo supera el límite de 10 MB.", id: null, alreadyImported: false };

  let workbookData: CertificateWorkbookData;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await uploaded.arrayBuffer());
    const workbook = parseWorkbook(bytes, uploaded.name);
    const rawPlan = JSON.parse(String(formData.get("plan_json") ?? "null")) as unknown;
    workbookData = extractCertificateWorkbookData(workbook, rawPlan);
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "No se pudo verificar el certificado XLSX.", id: null, alreadyImported: false };
  }

  const fingerprint = certificateWorkbookFingerprint(bytes);
  const { data: existingImport, error: existingImportError } = await supabase
    .from("project_certificates")
    .select("id")
    .eq("project_id", projectId)
    .eq("import_fingerprint", fingerprint)
    .maybeSingle();
  if (existingImportError) return { error: "No se pudo verificar si este archivo ya fue importado.", id: null, alreadyImported: false };
  if (existingImport) {
    revalidatePath(`/projects/${projectId}`);
    return { error: null, id: existingImport.id, alreadyImported: true };
  }

  let mappings: Array<{ sourceRow: number; budgetItemId: string }>;
  try {
    const parsed = JSON.parse(String(formData.get("mappings_json") ?? "[]")) as unknown;
    if (!Array.isArray(parsed) || parsed.some((entry) => !entry || !Number.isInteger(entry.sourceRow) || typeof entry.budgetItemId !== "string")) {
      throw new Error("El mapeo de partidas no es válido.");
    }
    mappings = parsed as Array<{ sourceRow: number; budgetItemId: string }>;
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "El mapeo de partidas no es válido.", id: null, alreadyImported: false };
  }

  const { data: budgetRows, error: budgetError } = await supabase
    .from("budget_items")
    .select("id, project_id, code, description, unit, quantity, unit_price, sort_order")
    .eq("project_id", projectId)
    .order("sort_order");
  if (budgetError || !budgetRows) return { error: "No se pudo verificar el presupuesto de esta obra.", id: null, alreadyImported: false };

  let lines: CertificateImportLine[];
  try {
    lines = buildCertificateImportLines(workbookData.rows, mappings, budgetRows as CertificateBudgetItem[], projectId);
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "Revisá el vínculo de las partidas.", id: null, alreadyImported: false };
  }

  const byId = new Map((budgetRows as CertificateBudgetItem[]).map((item) => [item.id, item]));
  const hasDiscrepancies = workbookData.planNeedsReview || lines.some((line) => {
    const budget = byId.get(line.budgetItemId)!;
    const contractualDiffers = budget.quantity !== null && Number(budget.quantity) !== line.quantityContractual;
    const priceDiffers = budget.unit_price !== null && Number(budget.unit_price) !== line.unitPrice;
    const sourceAmountDiffers = line.amountCurrent !== null && Math.round(line.quantityCurrent * line.unitPrice) !== line.amountCurrent;
    const cumulativeDiffers = line.quantityCumulative !== line.quantityPrevious + line.quantityCurrent;
    return contractualDiffers || priceDiffers || sourceAmountDiffers || cumulativeDiffers;
  });
  if (hasDiscrepancies && formData.get("confirm_discrepancies") !== "on") {
    return { error: "El preview contiene diferencias visibles. Revisalas y confirmá expresamente cómo recalcular los importes antes de importar.", id: null, alreadyImported: false };
  }

  const rpcItems = lines.map((line) => ({
    budget_item_id: line.budgetItemId,
    codigo: line.code,
    descripcion: line.description,
    unidad: line.unit,
    qty_contractual: line.quantityContractual,
    precio_unitario: line.unitPrice,
    qty_anterior: line.quantityPrevious,
    qty_presente: line.quantityCurrent,
    sort_order: line.sortOrder,
  }));
  const { data, error: importError } = await supabase.rpc("import_project_certificate_atomically", {
    p_project_id: projectId,
    p_expected_number: workbookData.number,
    p_period_start: workbookData.periodStart,
    p_period_end: workbookData.periodEnd,
    p_import_fingerprint: fingerprint,
    p_items: rpcItems,
  });
  if (importError) return { error: importError.message, id: null, alreadyImported: false };
  const imported = (Array.isArray(data) ? data[0] : data) as { certificate_id?: string; numero?: number; already_imported?: boolean } | null;
  if (!imported?.certificate_id) return { error: "La importación no devolvió un certificado creado.", id: null, alreadyImported: false };

  if (!imported.already_imported) {
    await logAudit(supabase, {
      action: "project_certificate.workbook_imported",
      detail: {
        project_id: projectId,
        certificate_id: imported.certificate_id,
        numero: imported.numero,
        file_fingerprint: fingerprint,
        item_count: lines.length,
      },
    });
  }
  revalidatePath(`/projects/${projectId}`);
  return { error: null, id: imported.certificate_id, alreadyImported: Boolean(imported.already_imported) };
}

/**
 * Carga masiva de la columna "presente" — pegando el avance del mes desde el
 * Excel de medición. `values` viene ya alineado línea-por-línea desde el
 * cliente (cada entrada trae el id de la línea y la cantidad). Solo en BORRADOR.
 */
export async function bulkSetCertificatePresente(
  certificateId: string,
  values: { itemId: string; qty_presente: number }[]
): Promise<{ error: string | null; updated: number }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado.", updated: 0 };
  if (cert.status !== "BORRADOR") {
    return { error: "El certificado ya está elaborado y no se puede editar.", updated: 0 };
  }

  const { data: items } = await supabase
    .from("project_certificate_items")
    .select("id")
    .eq("certificate_id", certificateId);
  const validIds = new Set((items ?? []).map((i) => i.id as string));

  let updated = 0;
  for (const v of values) {
    if (!validIds.has(v.itemId)) continue;
    if (!Number.isFinite(v.qty_presente) || v.qty_presente < 0) continue;
    const { error } = await supabase
      .from("project_certificate_items")
      .update({ qty_presente: v.qty_presente })
      .eq("id", v.itemId);
    if (!error) updated++;
  }

  await recomputeCertificateTotals(supabase, certificateId);
  await logAudit(supabase, {
    action: "project_certificate.bulk_presente",
    detail: { project_id: cert.project_id, certificate_id: cert.id, numero: cert.numero, updated },
  });
  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null, updated };
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

  const { data: revertedTo, error } = await supabase.rpc(
    "revert_project_certificate_status_atomically",
    { p_certificate_id: certificateId, p_expected_status: cert.status }
  );
  if (error || revertedTo !== target) return { error: "No se pudo retroceder el certificado." };

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

// ──────────────────────────────────────────────────────────────────────────────
// Unidades físicas del proyecto (viviendas, locales, etc.)
// ──────────────────────────────────────────────────────────────────────────────

export async function createProjectUnit(
  projectId: string,
  nombre: string
): Promise<{ id?: string; error?: string }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: proj } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", profile.empresa_id)
    .single();
  if (!proj) return { error: "Proyecto no encontrado." };

  const { data: last } = await supabase
    .from("project_units")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await supabase
    .from("project_units")
    .insert({ project_id: projectId, nombre: nombre.trim(), sort_order: (last?.sort_order ?? -1) + 1 })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Ya existe una unidad con ese nombre." };
    return { error: error.message };
  }
  revalidatePath(`/projects/${projectId}`);
  return { id: data.id };
}

export async function deleteProjectUnit(unitId: string, projectId: string): Promise<{ error?: string }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: unit } = await supabase
    .from("project_units")
    .select("id, project_id")
    .eq("id", unitId)
    .single<ProjectUnit>();
  if (!unit) return { error: "Unidad no encontrada." };

  const { data: proj } = await supabase
    .from("projects")
    .select("id")
    .eq("id", unit.project_id)
    .eq("empresa_id", profile.empresa_id)
    .single();
  if (!proj) return { error: "Proyecto no encontrado." };

  const { error } = await supabase.from("project_units").delete().eq("id", unitId);
  if (error) return { error: error.message };

  revalidatePath(`/projects/${projectId}`);
  return {};
}

export async function updateBudgetItemQuantityPerUnit(
  itemId: string,
  quantityPerUnit: number | null
): Promise<{ error?: string }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: item } = await supabase
    .from("budget_items")
    .select("id, project_id")
    .eq("id", itemId)
    .single<{ id: string; project_id: string }>();
  if (!item) return { error: "Rubro no encontrado." };

  const { data: proj } = await supabase
    .from("projects")
    .select("id")
    .eq("id", item.project_id)
    .eq("empresa_id", profile.empresa_id)
    .single();
  if (!proj) return { error: "Proyecto no encontrado." };

  const { error } = await supabase
    .from("budget_items")
    .update({ quantity_per_unit: quantityPerUnit ?? null })
    .eq("id", itemId);
  if (error) return { error: error.message };

  revalidatePath(`/projects/${item.project_id}`);
  return {};
}

export async function upsertCertificateUnitProgress(
  certificateId: string,
  values: { unit_id: string; pct_avance: number }[]
): Promise<{ error?: string }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== "BORRADOR") return { error: "El certificado ya está elaborado." };

  for (const v of values) {
    if (v.pct_avance < 0 || v.pct_avance > 100) continue;
    await supabase
      .from("project_certificate_unit_progress")
      .upsert(
        { certificate_id: certificateId, unit_id: v.unit_id, pct_avance: v.pct_avance, updated_at: new Date().toISOString() },
        { onConflict: "certificate_id,unit_id" }
      );
  }

  revalidatePath(`/projects/${cert.project_id}`);
  return {};
}

/**
 * Rellena qty_presente de cada línea del certificado usando el avance por unidad.
 * qty_presente[rubro] = Σ (pct_avance[unidad]/100 × quantity_per_unit[rubro])
 * Solo en BORRADOR.
 */
export async function autoFillCertificateFromUnits(certificateId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const cert = await loadOwnedCertificate(supabase, certificateId, profile.empresa_id);
  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== "BORRADOR") return { error: "El certificado ya está elaborado." };

  const [{ data: items }, { data: progress }] = await Promise.all([
    supabase
      .from("project_certificate_items")
      .select("id, budget_item_id")
      .eq("certificate_id", certificateId),
    supabase
      .from("project_certificate_unit_progress")
      .select("unit_id, pct_avance")
      .eq("certificate_id", certificateId),
  ]);

  if (!items || items.length === 0) return { error: null };

  const budgetItemIds = (items ?? []).map((i) => i.budget_item_id).filter(Boolean) as string[];
  const { data: budgetItems } = await supabase
    .from("budget_items")
    .select("id, quantity_per_unit")
    .in("id", budgetItemIds);

  const qpuById = new Map<string, number>();
  for (const bi of budgetItems ?? []) {
    if (bi.quantity_per_unit != null) qpuById.set(bi.id, Number(bi.quantity_per_unit));
  }

  const totalPct = (progress ?? []).reduce((s, p) => s + Number(p.pct_avance), 0);

  for (const it of items) {
    if (!it.budget_item_id) continue;
    const qpu = qpuById.get(it.budget_item_id);
    if (qpu == null) continue;
    const qty_presente = (progress ?? []).reduce(
      (s, p) => s + (Number(p.pct_avance) / 100) * qpu,
      0
    );
    await supabase
      .from("project_certificate_items")
      .update({ qty_presente: Math.round(qty_presente * 10000) / 10000 })
      .eq("id", it.id);
  }

  void totalPct;
  await recomputeCertificateTotals(supabase, certificateId);
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

  const { data: items, error: itemsError } = await supabase
    .from("project_certificate_items")
    .select("id, budget_item_id")
    .eq("certificate_id", certificateId);
  if (itemsError || !items) return { error: "No se pudieron leer las líneas del certificado." };

  const { anterior, presente } = await buildQuantityMaps(
    supabase,
    cert.project_id,
    cert.period_start,
    cert.period_end
  );

  const updates = items.flatMap((item) => item.budget_item_id
    ? [{
        item_id: item.id,
        qty_anterior: anterior.get(item.budget_item_id) ?? 0,
        qty_presente: presente.get(item.budget_item_id) ?? 0,
      }]
    : []);
  const { error: resyncError } = await supabase.rpc("resync_project_certificate_quantities_atomically", {
    p_empresa_id: profile.empresa_id,
    p_certificate_id: certificateId,
    p_actor_id: profile.id,
    p_updates: updates,
  });
  if (resyncError) return { error: resyncError.message };

  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}

/** Lista de clientes de la empresa para el selector de facturación. */
export async function getClientsForSelect(): Promise<{ id: string; name: string }[]> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, name")
    .eq("empresa_id", profile.empresa_id)
    .order("name");
  return data ?? [];
}

/**
 * Crea un borrador de factura de venta pre-llenado desde un certificado aprobado.
 * Establece la FK certificate_id en sales_documents para trazabilidad real
 * (reemplaza el campo texto libre factura_numero sin romper compatibilidad).
 *
 * El borrador queda en /ventas para revisión y emisión por el usuario.
 * El certificado NO se marca FACTURADO aquí — eso ocurre al emitir la factura.
 *
 * @param certificateId  ID del certificado (debe estar en estado APROBADO)
 * @param clientId       FK al cliente en la tabla clients (lo elige el botón en UI)
 */
export async function createSalesDocumentFromCertificate(
  certificateId: string,
  clientId: string
): Promise<{ error: string | null; salesDocumentId?: string }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  // Cargar certificado con datos del proyecto
  const { data: cert } = await supabase
    .from("project_certificates")
    .select(`
      id,
      numero,
      period_start,
      period_end,
      monto_liquido,
      status,
      project_id,
      projects!inner(name, empresa_id)
    `)
    .eq("id", certificateId)
    .eq("projects.empresa_id", profile.empresa_id)
    .maybeSingle();

  if (!cert) return { error: "Certificado no encontrado." };
  if (cert.status !== "APROBADO") return { error: "Solo se puede facturar un certificado APROBADO." };

  // Verificar que no existe ya una factura activa para este certificado
  const { data: existing } = await supabase
    .from("sales_documents")
    .select("id, status")
    .eq("certificate_id", certificateId)
    .not("status", "eq", "ANULADA")
    .maybeSingle();

  if (existing) {
    return { error: `Ya existe una factura para este certificado (estado: ${existing.status}).` };
  }

  // Descripción de la línea: "Certificado Nº 3 — Obra X (01/06 al 30/06/2026)"
  const periodStr = `${cert.period_start} al ${cert.period_end}`;
  const projectName = (cert as any).projects?.name ?? "Obra";
  const itemDescription = `Certificado de avance Nº ${cert.numero} — ${projectName} (período ${periodStr})`;

  // Crear el borrador de factura de venta
  const { data: doc, error: docError } = await supabase
    .from("sales_documents")
    .insert({
      client_id: clientId,
      doc_type: "FACTURA",
      issue_date: new Date().toISOString().slice(0, 10),
      currency: "PYG",
      certificate_id: certificateId,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (docError || !doc) {
    return { error: docError?.message ?? "No se pudo crear la factura." };
  }

  // Insertar línea con el monto líquido del certificado (IVA incluido, tasa 10%)
  const montoLiquido = Number(cert.monto_liquido) || 0;
  const { error: itemError } = await supabase
    .from("sales_document_items")
    .insert({
      sales_document_id: doc.id,
      description: itemDescription,
      quantity: 1,
      unit_price: montoLiquido,
      vat_rate: 10,
      line_total: montoLiquido,
    });

  if (itemError) {
    // Rollback manual: borrar el documento huérfano
    await supabase.from("sales_documents").delete().eq("id", doc.id);
    return { error: itemError.message };
  }

  await logAudit(supabase, {
    action: "sales_document.created_from_certificate",
    detail: { sales_document_id: doc.id, certificate_id: certificateId, certificate_numero: cert.numero },
  });

  revalidatePath("/ventas");
  revalidatePath(`/projects/${cert.project_id}`);

  return { error: null, salesDocumentId: doc.id };
}
