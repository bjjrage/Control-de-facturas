"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requirePlan } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { revalidatePath } from "next/cache";
import { ProjectStatus } from "@/lib/types";
import { createHash } from "node:crypto";
import { buildCanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import { validateWorkbookInterpretation } from "@/lib/workbook-interpretation/interpreter";
import { parseWorkbook } from "@/lib/workbook-interpretation/parser";
import { certificateTotals } from "@/lib/certificates/math";
import { ensureProjectInventoryLocation } from "@/lib/inventory/service";
import { validateScheduleDates } from "@/lib/projects/schedule";

export async function createProject(formData: FormData): Promise<{ error: string | null; projectId?: string }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const name = formData.get("name") as string | null;
  const code = formData.get("code") as string | null;
  const client = (formData.get("client") as string | null) || null;
  const projectAddress = (formData.get("location") as string | null) || null;
  const startDate = (formData.get("start_date") as string | null) || null;
  const endDate = (formData.get("end_date") as string | null) || null;
  const budgetTotal = Number(formData.get("budget_total") ?? 0);

  if (!name) return { error: "El nombre es obligatorio." };
  if (!code) return { error: "El código es obligatorio." };

  const { data: project, error } = await supabase
    .from("projects")
    .insert({
      empresa_id: empresaId,
      name,
      code,
      client,
      location: projectAddress,
      start_date: startDate,
      end_date: endDate,
      budget_total: Number.isFinite(budgetTotal) ? budgetTotal : 0,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error || !project) {
    const dup = error?.code === "23505";
    return { error: dup ? `Ya existe un proyecto con el código "${code}".` : (error?.message ?? "No se pudo crear el proyecto.") };
  }

  const projectLocationResult = await ensureProjectInventoryLocation(supabase, {
    empresaId,
    projectId: String(project.id),
    createdBy: profile.id,
  });
  if (projectLocationResult.error || !projectLocationResult.data) {
    await logAudit(supabase, {
      action: "project.created",
      detail: { project_id: project.id, code, inventory_location_error: projectLocationResult.error },
    });
    revalidatePath("/projects");
    return {
      error: `La obra se creó, pero no se pudo preparar su ubicación canónica de stock. Abrí Ubicaciones y reintentá: ${projectLocationResult.error ?? "error desconocido"}`,
      projectId: String(project.id),
    };
  }

  await logAudit(supabase, {
    action: "project.created",
    detail: { project_id: project.id, code, inventory_location_id: projectLocationResult.data.id },
  });

  revalidatePath("/projects");
  return { error: null, projectId: String(project.id) };
}

type WorkbookCreateResult = {
  error: string | null;
  projectId?: string;
  applied?: { project: boolean; budgetItems: number; certificateItems: number };
  pending?: { section: string; reason: string }[];
};

function importedText(field: { status: string; value: string | number | null }): string | null {
  if (field.status === "NOT_FOUND" || field.value === null) return null;
  const value = String(field.value).trim();
  return value || null;
}

function importedNumber(field: { status: string; value: string | number | null }): number | null {
  if (field.status === "NOT_FOUND" || field.value === null) return null;
  const value = typeof field.value === "number" ? field.value : Number(String(field.value).replace(/[^0-9.,-]/g, "").replace(/\.(?=\d{3}(?:\.|,|$))/g, "").replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function importedDate(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const match = value.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

/**
 * Confirma un preview semántico contra el XLSX original y materializa la
 * obra, su presupuesto y (si el usuario lo aceptó) el certificado. Los demás
 * dominios detectados (curva, clima, personal, mediciones) se informan como
 * pendientes: su persistencia todavía no está conectada.
 */
export async function createProjectFromWorkbook(formData: FormData): Promise<WorkbookCreateResult> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const uploaded = formData.get("file");
  const rawResult = formData.get("result_json");
  if (!(uploaded instanceof File) || typeof rawResult !== "string") return { error: "El preview de la planilla ya no es válido." };

  let result;
  try {
    const workbook = parseWorkbook(new Uint8Array(await uploaded.arrayBuffer()), uploaded.name);
    const parsedResult = JSON.parse(rawResult);
    const validated = validateWorkbookInterpretation(parsedResult, workbook);
    const candidate = buildCanonicalImportCandidate(workbook, validated);
    result = { workbook, validated, candidate };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "No se pudo validar nuevamente la planilla." };
  }

  const name = ((formData.get("name_override") as string | null) || importedText(result.validated.project.name) || "").trim();
  const code = ((formData.get("code_override") as string | null) || importedText(result.validated.project.code) || "").trim();
  if (!name) return { error: "Falta un nombre de obra utilizable para crear el proyecto." };
  if (!code) return { error: "Falta un código de obra utilizable para crear el proyecto." };

  const budgetItems = result.candidate.budgetItems.filter((item) => item.code && item.description.trim());
  if (budgetItems.length !== result.candidate.budgetItems.length) return { error: "El presupuesto contiene filas sin código o descripción; no se creó la obra." };
  if (new Set(budgetItems.map((item) => item.code)).size !== budgetItems.length) return { error: "El presupuesto contiene códigos duplicados; no se creó la obra." };

  const admin = createAdminClient();
  const fingerprint = createHash("sha256").update(new Uint8Array(await uploaded.arrayBuffer())).digest("hex");
  const { data: priorImport } = await admin
    .from("audit_logs")
    .select("detail")
    .eq("empresa_id", profile.empresa_id)
    .eq("action", "project.workbook_imported")
    .contains("detail", { source_fingerprint: fingerprint })
    .limit(1);
  if (priorImport && priorImport.length > 0) return { error: "Esta planilla ya fue importada para esta empresa; no se creó una segunda obra." };
  const { data: existing } = await admin
    .from("projects")
    .select("id")
    .eq("empresa_id", profile.empresa_id)
    .eq("code", code)
    .maybeSingle();
  if (existing) return { error: `Ya existe una obra con el código "${code}". La importación no creó otra.` };

  const projectFields = result.validated.project;
  const contractAmount = result.candidate.budgetTotal || importedNumber(projectFields.totalAmount) || 0;
  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({
      empresa_id: profile.empresa_id,
      name,
      code,
      client: importedText(projectFields.client),
      location: importedText(projectFields.location),
      start_date: importedDate(importedText(projectFields.startDate)),
      end_date: importedDate(importedText(projectFields.endDate)),
      budget_total: contractAmount,
      comitente: importedText(projectFields.client),
      contract_number: importedText(projectFields.contractNumber),
      contract_amount: contractAmount,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (projectError || !project) return { error: projectError?.message ?? "No se pudo crear la obra." };

  const rollback = async () => {
    await admin.from("projects").delete().eq("id", project.id).eq("empresa_id", profile.empresa_id);
  };
  const codeToId = new Map<string, string>();
  let sortOrder = 0;
  let budgetError: string | null = null;
  const depthOf = (codeValue: string) => (codeValue.match(/\./g) ?? []).length;
  const maxDepth = Math.max(0, ...budgetItems.map((item) => depthOf(item.code as string)));
  for (let depth = 0; depth <= maxDepth && !budgetError; depth++) {
    const level = budgetItems.filter((item) => depthOf(item.code as string) === depth);
    if (!level.length) continue;
    const rows = level.map((item) => {
      const codeValue = item.code as string;
      const parentCode = codeValue.includes(".") ? codeValue.slice(0, codeValue.lastIndexOf(".")) : null;
      return {
        project_id: project.id,
        parent_id: parentCode ? codeToId.get(parentCode) ?? null : null,
        code: codeValue,
        description: item.description.trim(),
        unit: item.unit,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        sort_order: sortOrder++,
      };
    });
    const { data: inserted, error } = await admin.from("budget_items").insert(rows).select("id, code");
    if (error || !inserted) budgetError = error?.message ?? "No se pudo importar el presupuesto.";
    else for (const row of inserted) codeToId.set(String(row.code), String(row.id));
  }
  if (budgetError) {
    await rollback();
    return { error: `No se creó la obra porque falló el presupuesto: ${budgetError}` };
  }

  let certificateItems = 0;
  const pending: { section: string; reason: string }[] = result.candidate.domains.map((domain) => ({
    section: domain.target,
    reason: `Detectado (${domain.labels.join(" · ")}); su persistencia todavía no está conectada.`,
  }));
  const certificateApplicable = result.candidate.certificate.status === "SAFE_TO_APPLY" || result.candidate.certificate.status === "APPLY_WITH_WARNINGS";
  // The preview asks the user; a certificate with observations is only
  // written when the user explicitly accepted it.
  const certificateAccepted = formData.get("apply_certificate") === "1";
  if (certificateApplicable && certificateAccepted) {
    // Keep certificate writes under the authenticated tenant context so the
    // database creation guard can validate auth.uid(), role and company.
    const certificateWriter = await createClient();
    const certificate = result.candidate.certificate;
    const { data: header, error: headerError } = await certificateWriter
      .from("project_certificates")
      .insert({
        project_id: project.id,
        numero: certificate.number,
        period_start: certificate.periodStart,
        period_end: certificate.periodEnd,
        status: "BORRADOR",
        notes: `Importado desde ${uploaded.name}. Revisar y elaborar antes de avanzar el circuito.`,
        created_by: profile.id,
      })
      .select("id")
      .single();
    if (headerError || !header) {
      await rollback();
      return { error: `No se creó la obra porque falló el certificado: ${headerError?.message ?? "error desconocido"}` };
    }
    const lines = certificate.items.map((item, index) => ({
      certificate_id: header.id,
      // Lines without a budget counterpart are kept as autonomous
      // contractual lines (budget_item_id is nullable by design).
      budget_item_id: item.matchedBudgetCode ? codeToId.get(item.matchedBudgetCode) ?? null : null,
      codigo: item.code,
      descripcion: item.description,
      unidad: item.unit,
      qty_contractual: item.quantityContractual,
      precio_unitario: item.unitPrice,
      qty_anterior: item.quantityPrevious,
      qty_presente: item.quantityCurrent,
      sort_order: index,
    }));
    const { error: linesError } = await certificateWriter.from("project_certificate_items").insert(lines);
    if (linesError) {
      await rollback();
      return { error: `No se creó la obra porque fallaron las líneas del certificado: ${linesError.message}` };
    }
    const { montoAnterior, montoPresente } = certificateTotals(lines);
    const { error: totalsError } = await certificateWriter.from("project_certificates").update({ monto_anterior: montoAnterior, monto_presente: montoPresente }).eq("id", header.id).eq("project_id", project.id);
    if (totalsError) {
      await rollback();
      return { error: `No se creó la obra porque no se pudieron calcular los totales del certificado: ${totalsError.message}` };
    }
    certificateItems = lines.length;
  } else if (result.candidate.certificate.status !== "NOT_DETECTED") {
    pending.push({ section: "CERTIFICADO", reason: certificateApplicable ? "No se importó: no fue aceptado en el preview." : result.candidate.certificate.reason });
  }

  const projectLocation = await ensureProjectInventoryLocation(admin, {
    empresaId: profile.empresa_id,
    projectId: String(project.id),
    createdBy: profile.id,
  });
  if (projectLocation.error || !projectLocation.data) {
    await logAudit(await createClient(), {
      action: "project.workbook_imported",
      detail: {
        project_id: project.id,
        source_file: uploaded.name,
        source_fingerprint: fingerprint,
        budget_items: budgetItems.length,
        certificate_items: certificateItems,
        inventory_location_error: projectLocation.error,
      },
    });
    revalidatePath("/projects");
    return {
      error: `La obra y sus datos se importaron, pero falta su ubicación canónica. Abrí Ubicaciones y reintentá: ${projectLocation.error ?? "error desconocido"}`,
      projectId: String(project.id),
      applied: { project: true, budgetItems: budgetItems.length, certificateItems },
      pending,
    };
  }

  await logAudit(await createClient(), {
    action: "project.workbook_imported",
    detail: {
      project_id: project.id,
      source_file: uploaded.name,
      source_fingerprint: fingerprint,
      budget_items: budgetItems.length,
      certificate_items: certificateItems,
      certificate_status: result.candidate.certificate.status,
      detected_domains: result.candidate.domains.map((domain) => domain.target),
      pending_sections: pending,
    },
  });
  revalidatePath("/projects");
  revalidatePath(`/projects/${project.id}`);
  return { error: null, projectId: String(project.id), applied: { project: true, budgetItems: budgetItems.length, certificateItems }, pending };
}

export async function updateProjectStatus(projectId: string, status: ProjectStatus): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { error } = await supabase
    .from("projects")
    .update({ status })
    .eq("id", projectId)
    .eq("empresa_id", empresaId);

  if (error) return { error: "No se pudo actualizar el estado del proyecto." };

  await logAudit(supabase, {
    action: "project.status_updated",
    detail: { project_id: projectId, status },
  });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function updateProject(projectId: string, formData: FormData): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const name = formData.get("name") as string | null;
  const client = (formData.get("client") as string | null) || null;
  const location = (formData.get("location") as string | null) || null;
  const startDate = (formData.get("start_date") as string | null) || null;
  const endDate = (formData.get("end_date") as string | null) || null;
  const budgetTotal = Number(formData.get("budget_total") ?? 0);

  if (!name) return { error: "El nombre es obligatorio." };

  // Datos de contrato (obra pública) — solo se envían desde el bloque plegable
  // del formulario. Si el form no los trae, no se tocan.
  const num = (key: string, fallback: number): number => {
    if (!formData.has(key)) return fallback;
    const v = Number(formData.get(key));
    return Number.isFinite(v) ? v : fallback;
  };
  const contractPatch = formData.has("contract_amount")
    ? {
        comitente: (formData.get("comitente") as string | null) || null,
        contract_number: (formData.get("contract_number") as string | null) || null,
        contract_amount: num("contract_amount", 0),
        plazo_dias: formData.get("plazo_dias") ? num("plazo_dias", 0) : null,
        orden_inicio_date: (formData.get("orden_inicio_date") as string | null) || null,
        fiscalizacion_nombre: (formData.get("fiscalizacion_nombre") as string | null) || null,
        fiscalizacion_contrato: (formData.get("fiscalizacion_contrato") as string | null) || null,
        anticipo_pct: num("anticipo_pct", 30),
        devolucion_anticipo_pct: num("devolucion_anticipo_pct", 40),
        retencion_pct: num("retencion_pct", 5),
        iva_pct: num("iva_pct", 10),
      }
    : {};

  const { error } = await supabase
    .from("projects")
    .update({
      name,
      client,
      location,
      start_date: startDate,
      end_date: endDate,
      budget_total: Number.isFinite(budgetTotal) ? budgetTotal : 0,
      ...contractPatch,
    })
    .eq("id", projectId)
    .eq("empresa_id", empresaId);

  if (error) return { error: "No se pudo actualizar el proyecto." };

  await logAudit(supabase, { action: "project.updated", detail: { project_id: projectId } });

  revalidatePath("/projects");
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

/**
 * Limpia el cronograma de la obra: deja start_date, end_date y depends_on en
 * NULL para todas sus partidas. Solo columnas temporales — cantidades,
 * precios, avance, certificados y stock intactos. Reversible re-importando.
 */
export async function clearProjectSchedule(projectId: string): Promise<{ cleared: number; error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { cleared: 0, error: "Proyecto no encontrado." };

  // Whitelist: SOLO columnas temporales. Ningún otro campo viaja en este update.
  const { data, error } = await supabase
    .from("budget_items")
    .update({ start_date: null, end_date: null, depends_on: null })
    .eq("project_id", projectId)
    .select("id");
  if (error) return { cleared: 0, error: "No se pudo limpiar el cronograma." };

  revalidatePath(`/projects/${projectId}`);
  return { cleared: data?.length ?? 0, error: null };
}

export async function deleteProject(projectId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  // Las ubicaciones de inventario tipo PROJECT referencian la obra con
  // ON DELETE RESTRICT (blindaje del pañol, 20260913230000) y no tienen
  // policy RLS de DELETE: el cliente autenticado no puede borrarlas (no-op
  // silencioso). Se usa el cliente admin con scoping manual por empresa para
  // eliminar la ubicación VACÍA y desbloquear el borrado. Si tiene
  // movimientos, recepciones o presentaciones, el DELETE falla y se explica
  // en vez del genérico "No se pudo eliminar".
  const admin = createAdminClient();
  const { error: locationError } = await admin
    .from("inventory_locations")
    .delete()
    .eq("project_id", projectId)
    .eq("location_type", "PROJECT")
    .eq("empresa_id", empresaId);
  if (locationError) {
    return {
      error:
        "No se puede eliminar: la obra tiene ubicación de inventario con movimientos o presentaciones de pañol. Limpiá el cronograma si solo querés quitar las fechas.",
    };
  }

  const { error } = await supabase.from("projects").delete().eq("id", projectId).eq("empresa_id", empresaId);
  if (error) return { error: "No se pudo eliminar el proyecto." };

  await logAudit(supabase, { action: "project.deleted", detail: { project_id: projectId } });

  revalidatePath("/projects");
  return { error: null };
}

export async function addBudgetItem(projectId: string, formData: FormData): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  // Verifica pertenencia del proyecto a la empresa antes de insertar el ítem
  // (budget_items no tiene empresa_id propio, se deriva vía project_id en RLS).
  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { error: "Proyecto no encontrado." };

  const code = formData.get("code") as string | null;
  const description = formData.get("description") as string | null;
  const unit = (formData.get("unit") as string | null) || null;
  const quantity = formData.get("quantity") ? Number(formData.get("quantity")) : null;
  const unitPrice = formData.get("unit_price") ? Number(formData.get("unit_price")) : null;
  const startDate = (formData.get("start_date") as string | null) || null;
  const endDate = (formData.get("end_date") as string | null) || null;

  if (!code) return { error: "El código es obligatorio." };
  if (!description) return { error: "La descripción es obligatoria." };

  const { data: maxRow } = await supabase
    .from("budget_items")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const { error } = await supabase.from("budget_items").insert({
    project_id: projectId,
    code,
    description,
    unit,
    quantity,
    unit_price: unitPrice,
    start_date: startDate,
    end_date: endDate,
    sort_order: nextSortOrder,
  });

  if (error) return { error: "No se pudo agregar el ítem." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function updateBudgetItem(
  projectId: string,
  itemId: string,
  formData: FormData
): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { error: "Proyecto no encontrado." };

  const code = formData.get("code") as string | null;
  const description = formData.get("description") as string | null;
  const unit = (formData.get("unit") as string | null) || null;
  const quantity = formData.get("quantity") ? Number(formData.get("quantity")) : null;
  const unitPrice = formData.get("unit_price") ? Number(formData.get("unit_price")) : null;
  const startDate = (formData.get("start_date") as string | null) || null;
  const endDate = (formData.get("end_date") as string | null) || null;
  const rawQpu = formData.get("quantity_per_unit") as string | null;
  const quantityPerUnit = rawQpu ? Number(rawQpu) : null;

  if (!code) return { error: "El código es obligatorio." };
  if (!description) return { error: "La descripción es obligatoria." };
  if (startDate && endDate && startDate > endDate) {
    return { error: "La fecha de inicio no puede ser posterior a la de fin." };
  }

  const { error } = await supabase
    .from("budget_items")
    .update({
      code,
      description,
      unit,
      quantity,
      unit_price: unitPrice,
      start_date: startDate,
      end_date: endDate,
      quantity_per_unit: quantityPerUnit,
    })
    .eq("id", itemId)
    .eq("project_id", projectId);

  if (error) return { error: "No se pudo actualizar el ítem." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function deleteBudgetItem(projectId: string, itemId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { error: "Proyecto no encontrado." };

  const { error } = await supabase.from("budget_items").delete().eq("id", itemId).eq("project_id", projectId);
  if (error) return { error: "No se pudo eliminar el ítem." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

/** Borra varios ítems de una — usado por "Seleccionar todo" en Presupuesto.
 *  ON DELETE CASCADE en budget_items.parent_id se encarga de los sub-ítems
 *  de cualquiera que quede seleccionado junto a su padre. */
export async function deleteBudgetItems(
  projectId: string,
  itemIds: string[]
): Promise<{ error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  if (itemIds.length === 0) return { error: null };

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { error: "Proyecto no encontrado." };

  const { error } = await supabase
    .from("budget_items")
    .delete()
    .in("id", itemIds)
    .eq("project_id", projectId);
  if (error) return { error: "No se pudieron eliminar los ítems." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function addExecutionEntry(
  projectId: string,
  formData: FormData
): Promise<{ error: string | null; entryId?: string }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { error: "Proyecto no encontrado." };

  const budgetItemId = formData.get("budget_item_id") as string | null;
  const quantityExecuted = Number(formData.get("quantity_executed") ?? 0);
  const entryDate = (formData.get("entry_date") as string | null) || new Date().toISOString().slice(0, 10);
  const notes = (formData.get("notes") as string | null) || null;

  if (!budgetItemId) return { error: "Seleccioná un ítem del presupuesto." };
  if (!(quantityExecuted > 0)) return { error: "La cantidad ejecutada debe ser mayor a cero." };

  const { data: entry, error } = await supabase.from("execution_entries").insert({
    project_id: projectId,
    budget_item_id: budgetItemId,
    entry_date: entryDate,
    quantity_executed: quantityExecuted,
    notes,
    recorded_by: profile.id,
  }).select("id").single();

  if (error || !entry) return { error: "No se pudo registrar el avance." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null, entryId: entry.id as string };
}

/**
 * Persiste las rutas de fotos DESPUÉS de que el cliente ya las subió a
 * Storage (bucket execution-photos, ruta {project_id}/{entry_id}/{n}.jpg).
 * Separado de addExecutionEntry porque el entry_id recién existe después del
 * insert — el flujo real es: insertar entrada -> subir fotos -> guardar rutas.
 * Si esto falla, la entrada de avance ya está guardada igual; solo se pierden
 * las fotos, nunca el dato de ejecución.
 */
type UploadedPhoto = {
  path: string;
  capturedAt?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracy?: number | null;
  source?: "camara" | "archivo";
};

export async function updateExecutionEntryPhotos(
  entryId: string,
  photos: UploadedPhoto[]
): Promise<{ error: string | null }> {
  await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();

  // execution_entries no tiene empresa_id propio: RLS ya filtra por
  // project_id IN (SELECT id FROM projects WHERE empresa_id = current_empresa_id()).
  const { data: entry } = await supabase
    .from("execution_entries")
    .select("id, project_id")
    .eq("id", entryId)
    .single();
  if (!entry) return { error: "Entrada no encontrada." };

  const { error } = await supabase
    .from("execution_entries")
    .update({ photo_paths: photos.map((p) => p.path) })
    .eq("id", entryId);

  if (error) return { error: "No se pudieron guardar las fotos." };

  // Metadata de verificación — aditiva, no bloquea si falla.
  await supabase.from("execution_entry_photos").insert(
    photos.map((p, i) => ({
      entry_id: entryId,
      project_id: entry.project_id as string,
      storage_path: p.path,
      sort_order: i,
      source: p.source === "archivo" ? "archivo" : "camara",
      captured_at: p.capturedAt ?? null,
      lat: typeof p.lat === "number" ? p.lat : null,
      lng: typeof p.lng === "number" ? p.lng : null,
      gps_accuracy_m: typeof p.accuracy === "number" ? p.accuracy : null,
    }))
  );

  return { error: null };
}

export type ImportedBudgetItem = {
  code: string;
  description: string;
  unit: string | null;
  quantity: number | null;
  unit_price: number | null;
  start_date: string | null;
  end_date: string | null;
};

/**
 * Inserta ítems importados de Excel, resolviendo jerarquía por código
 * ("1.1" cuelga de "1", "2.3.1" cuelga de "2.3"). Inserta por niveles de
 * profundidad — todos los padres de un nivel deben existir en la DB (y en
 * codeToId) antes de insertar sus hijos, si no el parent_id quedaría mal
 * resuelto dentro del mismo chunk. Un código cuyo padre no está en el
 * archivo se inserta plano (parent_id null), no falla el import entero.
 */
export async function importBudgetItems(
  projectId: string,
  items: ImportedBudgetItem[]
): Promise<{ inserted: number; skipped: number; error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { inserted: 0, skipped: 0, error: "Proyecto no encontrado." };

  const valid = items.filter((i) => i.code.trim() && i.description.trim());
  const skipped = items.length - valid.length;
  if (valid.length === 0) return { inserted: 0, skipped, error: "Ningún ítem válido para importar." };

  const { data: maxRow } = await supabase
    .from("budget_items")
    .select("sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const depthOf = (code: string) => (code.match(/\./g) ?? []).length;
  const maxDepth = Math.max(0, ...valid.map((i) => depthOf(i.code)));

  const codeToId = new Map<string, string>();
  let insertedCount = 0;
  let lastError: string | null = null;
  const CHUNK = 100;

  for (let depth = 0; depth <= maxDepth && !lastError; depth++) {
    const levelItems = valid.filter((i) => depthOf(i.code) === depth);
    if (levelItems.length === 0) continue;

    for (let i = 0; i < levelItems.length; i += CHUNK) {
      const chunk = levelItems.slice(i, i + CHUNK);
      const rows = chunk.map((item) => {
        const dotIdx = item.code.lastIndexOf(".");
        const parentCode = dotIdx >= 0 ? item.code.slice(0, dotIdx) : null;
        const parentId = parentCode ? codeToId.get(parentCode) ?? null : null;
        return {
          project_id: projectId,
          parent_id: parentId,
          code: item.code,
          description: item.description,
          unit: item.unit,
          quantity: item.quantity,
          unit_price: item.unit_price,
          start_date: item.start_date,
          end_date: item.end_date,
          sort_order: nextSortOrder++,
        };
      });

      const { data: insertedRows, error } = await supabase
        .from("budget_items")
        .insert(rows)
        .select("id, code");

      if (error) {
        lastError = error.message;
        break;
      }
      for (const row of insertedRows ?? []) {
        codeToId.set(row.code as string, row.id as string);
      }
      insertedCount += (insertedRows ?? []).length;
    }
  }

  if (lastError) {
    return { inserted: insertedCount, skipped, error: `Se importaron ${insertedCount} ítems antes de un error: ${lastError}` };
  }

  revalidatePath(`/projects/${projectId}`);
  return { inserted: insertedCount, skipped, error: null };
}

export type ScheduleImportAssignment = {
  itemId: string;
  start_date: string;
  end_date: string;
  depends_on: string | null;
};

/**
 * Aplica un import de cronograma ya previsualizado y confirmado por el usuario.
 *
 * SEGURIDAD: whitelist estricta — solo start_date, end_date y depends_on de
 * budget_items existentes de ESTA obra. Jamás toca cantidades, precios,
 * certificados, avance, stock ni crea/borra partidas. Las filas sin vincular
 * o sin fechas nunca llegan acá (las filtra buildScheduleUpdates).
 */
export async function applyScheduleImport(
  projectId: string,
  assignments: ScheduleImportAssignment[]
): Promise<{ applied: number; failed: { itemId: string; error: string }[] }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { applied: 0, failed: [{ itemId: "", error: "Proyecto no encontrado." }] };

  const { data: projectItems } = await supabase
    .from("budget_items")
    .select("id")
    .eq("project_id", projectId);
  const allowedIds = new Set((projectItems ?? []).map((i) => String(i.id)));

  let applied = 0;
  const failed: { itemId: string; error: string }[] = [];
  for (const a of assignments) {
    if (!allowedIds.has(a.itemId)) {
      failed.push({ itemId: a.itemId, error: "La partida no pertenece a esta obra." });
      continue;
    }
    const dateError = validateScheduleDates(a.start_date, a.end_date);
    if (dateError) {
      failed.push({ itemId: a.itemId, error: dateError });
      continue;
    }
    if (a.depends_on !== null && !allowedIds.has(a.depends_on)) {
      failed.push({ itemId: a.itemId, error: "La predecesora no pertenece a esta obra." });
      continue;
    }
    // Whitelist: SOLO columnas temporales. Ningún otro campo viaja en este update.
    const { error } = await supabase
      .from("budget_items")
      .update({ start_date: a.start_date, end_date: a.end_date, depends_on: a.depends_on })
      .eq("id", a.itemId)
      .eq("project_id", projectId);
    if (error) failed.push({ itemId: a.itemId, error: "No se pudo actualizar el cronograma." });
    else applied++;
  }

  if (applied > 0) revalidatePath(`/projects/${projectId}`);
  return { applied, failed };
}

export async function updateBudgetItemSchedule(
  itemId: string,
  startDate: string | null,
  endDate: string | null,
  dependsOn?: string | null
): Promise<{ error: string | null }> {
  await requirePlan("pro", ["administracion", "admin"]);
  const scheduleError = validateScheduleDates(startDate, endDate);
  if (scheduleError) return { error: scheduleError };
  const supabase = await createClient();

  // budget_items no tiene empresa_id propio: RLS ya filtra por
  // project_id IN (SELECT id FROM projects WHERE empresa_id = current_empresa_id()),
  // así que un select/update que no matchee esa política simplemente no afecta filas.
  const { data: item, error: fetchError } = await supabase
    .from("budget_items")
    .select("id, project_id")
    .eq("id", itemId)
    .single();
  if (fetchError || !item) return { error: "Ítem no encontrado." };

  const update: { start_date: string | null; end_date: string | null; depends_on?: string | null } = {
    start_date: startDate,
    end_date: endDate,
  };
  if (dependsOn !== undefined) update.depends_on = dependsOn;
  const { error } = await supabase
    .from("budget_items")
    .update(update)
    .eq("id", itemId);

  if (error) return { error: "No se pudo actualizar el cronograma." };

  revalidatePath(`/projects/${item.project_id}`);
  return { error: null };
}

export type DuplicateBudgetOptions = {
  quantities: boolean;
  prices: boolean;
  dates: boolean;
};

/**
 * Copia el cómputo métrico de un proyecto a otro. Remapea parent_id por id
 * real (no por código, a diferencia de importBudgetItems) — acá ya tenemos
 * la jerarquía exacta de la DB, no hay que inferirla.
 *
 * Inserta UN ítem A LA VEZ (no en batch): un insert masivo con .select() no
 * garantiza que las filas devueltas vengan en el mismo orden que el array
 * insertado, así que no hay forma confiable de mapear id-viejo -> id-nuevo
 * por posición si se insertan varios juntos. Uno a la vez es más lento pero
 * inequívoco. Procesa por niveles (BFS desde parent_id null) para que el
 * padre siempre exista en el mapa antes de insertar sus hijos.
 *
 * depends_on se remapea recién al final, cuando todos los ids nuevos existen
 * — son ids de budget_items del proyecto origen, sin remapear quedarían
 * apuntando a filas que no existen en el proyecto destino.
 */
export async function duplicateBudgetFromProject(
  sourceProjectId: string,
  targetProjectId: string,
  opts: DuplicateBudgetOptions
): Promise<{ copied: number; error: string | null }> {
  const profile = await requirePlan("pro", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: projects } = await supabase
    .from("projects")
    .select("id")
    .in("id", [sourceProjectId, targetProjectId])
    .eq("empresa_id", empresaId);
  if ((projects ?? []).length !== 2) {
    return { copied: 0, error: "Uno de los proyectos no existe o no pertenece a tu empresa." };
  }

  const { data: sourceItems } = await supabase
    .from("budget_items")
    .select("*")
    .eq("project_id", sourceProjectId)
    .order("sort_order")
    .returns<import("@/lib/types").BudgetItem[]>();

  const items = sourceItems ?? [];
  if (items.length === 0) return { copied: 0, error: "El proyecto origen no tiene ítems." };

  const { data: maxRow } = await supabase
    .from("budget_items")
    .select("sort_order")
    .eq("project_id", targetProjectId)
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  let nextSortOrder = (maxRow?.sort_order ?? 0) + 1;

  const oldToNewId = new Map<string, string>();
  let copiedCount = 0;
  let lastError: string | null = null;

  let pending = items;
  let guard = 0; // corta si queda algo huérfano que nunca resuelve (no debería pasar)
  while (pending.length > 0 && guard < 50 && !lastError) {
    guard++;
    const ready = pending.filter((i) => i.parent_id === null || oldToNewId.has(i.parent_id));
    const notReady = pending.filter((i) => !(i.parent_id === null || oldToNewId.has(i.parent_id)));
    if (ready.length === 0) break; // huérfanos reales — se insertan planos abajo

    for (const item of ready) {
      const { data: inserted, error } = await supabase
        .from("budget_items")
        .insert({
          project_id: targetProjectId,
          parent_id: item.parent_id ? oldToNewId.get(item.parent_id) ?? null : null,
          code: item.code,
          description: item.description,
          unit: item.unit,
          quantity: opts.quantities ? item.quantity : null,
          unit_price: opts.prices ? item.unit_price : null,
          start_date: opts.dates ? item.start_date : null,
          end_date: opts.dates ? item.end_date : null,
          sort_order: nextSortOrder++,
        })
        .select("id")
        .single();

      if (error || !inserted) {
        lastError = error?.message ?? "Error insertando ítem.";
        break;
      }
      oldToNewId.set(item.id, inserted.id as string);
      copiedCount++;
    }
    pending = notReady;
  }

  // Huérfanos que nunca resolvieron parent (no debería pasar dentro del
  // mismo proyecto, pero por las dudas se insertan planos, no se pierden).
  for (const item of pending) {
    if (lastError) break;
    const { data: inserted, error } = await supabase
      .from("budget_items")
      .insert({
        project_id: targetProjectId,
        parent_id: null,
        code: item.code,
        description: item.description,
        unit: item.unit,
        quantity: opts.quantities ? item.quantity : null,
        unit_price: opts.prices ? item.unit_price : null,
        start_date: opts.dates ? item.start_date : null,
        end_date: opts.dates ? item.end_date : null,
        sort_order: nextSortOrder++,
      })
      .select("id")
      .single();
    if (error || !inserted) {
      lastError = error?.message ?? "Error insertando ítem.";
      break;
    }
    oldToNewId.set(item.id, inserted.id as string);
    copiedCount++;
  }

  if (lastError) {
    return { copied: copiedCount, error: `Se copiaron ${copiedCount} ítems antes de un error: ${lastError}` };
  }

  // Ahora que todos los ids nuevos existen, remapeamos depends_on.
  if (opts.dates) {
    for (const item of items) {
      if (!item.depends_on) continue;
      const newId = oldToNewId.get(item.id);
      if (!newId) continue;
      const remapped = item.depends_on
        .split(",")
        .map((oldDepId) => oldToNewId.get(oldDepId.trim()))
        .filter((x): x is string => !!x)
        .join(",");
      if (remapped) {
        await supabase.from("budget_items").update({ depends_on: remapped }).eq("id", newId);
      }
    }
  }

  await logAudit(supabase, {
    action: "project.budget_duplicated",
    detail: { source_project_id: sourceProjectId, target_project_id: targetProjectId, copied: copiedCount },
  });

  revalidatePath(`/projects/${targetProjectId}`);
  return { copied: copiedCount, error: null };
}

/**
 * Info mínima para el sidebar cuando el usuario está "dentro" de un proyecto
 * (modo carpeta): nombre + código para el banner. No usa requirePlan/notFound
 * a propósito — el Sidebar necesita degradar en silencio (volver al nav
 * global) si el proyecto no existe o el usuario no tiene plan, en vez de
 * romper toda la navegación.
 */
export async function getProjectNavInfo(
  projectId: string
): Promise<{ id: string; name: string; code: string } | null> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select("id, name, code")
      .eq("id", projectId)
      .eq("empresa_id", profile.empresa_id)
      .single();
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Listado liviano para el selector de obra del workspace Operativo (sidebar).
 * Mismo criterio de degradación silenciosa que getProjectNavInfo: si el
 * usuario no tiene plan/rol habilitado, devuelve lista vacía en vez de
 * romper el nav. Activos primero, después el resto por nombre.
 */
export async function getProjectsForSwitcher(): Promise<
  { id: string; name: string; code: string; status: ProjectStatus }[]
> {
  try {
    const profile = await requirePlan("pro", ["administracion", "admin"]);
    const supabase = await createClient();
    const { data } = await supabase
      .from("projects")
      .select("id, name, code, status")
      .eq("empresa_id", profile.empresa_id)
      .order("status", { ascending: true })
      .order("name", { ascending: true })
      .limit(100)
      .returns<{ id: string; name: string; code: string; status: ProjectStatus }[]>();
    return data ?? [];
  } catch {
    return [];
  }
}
