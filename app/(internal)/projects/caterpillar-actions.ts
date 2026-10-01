"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import { destajoAmount } from "@/lib/costing/real-vs-budget";

export async function addLaborEntry(projectId: string, formData: FormData): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { error: "Proyecto no encontrado." };

  const workerName = (formData.get("worker_name") as string | null)?.trim();
  const hours = Number(formData.get("hours") ?? 0);
  const hourlyCostRaw = ((formData.get("hourly_cost") as string | null) ?? "").trim();
  const entryDate = (formData.get("entry_date") as string | null) || new Date().toISOString().slice(0, 10);
  const taskDescription = (formData.get("task_description") as string | null) || null;
  const budgetItemId = (formData.get("budget_item_id") as string | null) || null;
  const laborRateId = (formData.get("labor_rate_id") as string | null) || null;

  if (!workerName) return { error: "El nombre del trabajador es obligatorio." };
  if (!(hours > 0)) return { error: "Las horas deben ser mayores a cero." };

  if (budgetItemId) {
    const { data: item } = await supabase.from("budget_items").select("id").eq("id", budgetItemId).eq("project_id", projectId).maybeSingle();
    if (!item) return { error: "La partida no pertenece a esta obra." };
  }
  let rateCost: number | null = null;
  if (laborRateId) {
    const { data: rate } = await supabase.from("labor_rates").select("costo_hora").eq("id", laborRateId).eq("empresa_id", empresaId).maybeSingle();
    if (!rate) return { error: "Categoría de jornal no encontrada." };
    rateCost = Number(rate.costo_hora);
  }
  // El costo por hora escrito manda; si está vacío, sale del jornal. Vacío y
  // sin categoría no se guarda como 0: el parte quedaría con costo falso.
  const hourlyCost = hourlyCostRaw !== "" ? Number(hourlyCostRaw) : rateCost;
  if (hourlyCost == null || !Number.isFinite(hourlyCost) || hourlyCost < 0) {
    return { error: "Cargá el costo por hora o elegí una categoría de jornal." };
  }

  const { error } = await supabase.from("daily_labor_entries").insert({
    project_id: projectId,
    entry_date: entryDate,
    worker_name: workerName,
    hours,
    hourly_cost: hourlyCost,
    task_description: taskDescription,
    recorded_by: profile.id,
    budget_item_id: budgetItemId,
    labor_rate_id: laborRateId,
  });

  if (error) return { error: "No se pudo registrar el parte." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

/**
 * Crea un contrato de subcontratista para un proyecto. Si subcontractor_id
 * viene vacío, crea el subcontratista nuevo primero (dentro del mismo submit
 * — evita que el usuario tenga que ir a otra pantalla a cargarlo antes).
 */
export async function addSubcontractorContract(
  projectId: string,
  formData: FormData
): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  if (!project) return { error: "Proyecto no encontrado." };

  let subcontractorId = (formData.get("subcontractor_id") as string | null) || null;

  if (!subcontractorId) {
    const newName = (formData.get("new_subcontractor_name") as string | null)?.trim();
    if (!newName) return { error: "Elegí un subcontratista existente o cargá uno nuevo." };

    const newRuc = (formData.get("new_subcontractor_ruc") as string | null)?.trim() || null;
    const newContact = (formData.get("new_subcontractor_contact") as string | null)?.trim() || null;
    const newPhone = (formData.get("new_subcontractor_phone") as string | null)?.trim() || null;
    const newSpecialty = (formData.get("new_subcontractor_specialty") as string | null)?.trim() || null;

    const { data: newSub, error: subError } = await supabase
      .from("subcontractors")
      .insert({
        empresa_id: empresaId,
        name: newName,
        ruc: newRuc,
        contact_name: newContact,
        contact_phone: newPhone,
        specialty: newSpecialty,
      })
      .select("id")
      .single();

    if (subError || !newSub) {
      const dup = subError?.code === "23505";
      return { error: dup ? `Ya existe un subcontratista con RUC "${newRuc}".` : "No se pudo crear el subcontratista." };
    }
    subcontractorId = newSub.id as string;
  } else {
    const { data: existing } = await supabase
      .from("subcontractors")
      .select("id")
      .eq("id", subcontractorId)
      .eq("empresa_id", empresaId)
      .single();
    if (!existing) return { error: "Subcontratista no encontrado." };
  }

  const budgetItemId = (formData.get("budget_item_id") as string | null) || null;
  const contractedAmount = Number(formData.get("contracted_amount") ?? 0);
  const retentionPct = Number(formData.get("retention_pct") ?? 5);
  const description = (formData.get("description") as string | null)?.trim() || null;
  const signedDate = (formData.get("signed_date") as string | null) || null;

  if (!(contractedAmount > 0)) return { error: "El monto contratado debe ser mayor a cero." };
  if (budgetItemId) {
    const { data: budgetItem } = await supabase
      .from("budget_items")
      .select("id")
      .eq("id", budgetItemId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (!budgetItem) return { error: "La partida no pertenece a este proyecto." };
  }

  const { error } = await supabase.from("subcontractor_contracts").insert({
    project_id: projectId,
    subcontractor_id: subcontractorId,
    budget_item_id: budgetItemId,
    contracted_amount: contractedAmount,
    retention_pct: retentionPct,
    description,
    signed_date: signedDate,
  });

  if (error) return { error: "No se pudo crear el contrato." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

/**
 * Aprueba un certificado. Bloquea si la suma de certificados ya aprobados/
 * pagados de ESE contrato más este nuevo supera el monto contratado — la
 * alerta de techo real, no solo el badge visual de la lista.
 */
export async function approveCertificate(
  certificateId: string,
  approvedPct: number,
  approvedAmount: number,
  notes: string | null
): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  if (!(approvedPct > 0 && approvedPct <= 100)) return { error: "El % aprobado debe estar entre 1 y 100." };
  if (!(approvedAmount > 0)) return { error: "El monto aprobado debe ser mayor a cero." };

  const { data: cert } = await supabase
    .from("subcontractor_certificates")
    .select("id, contract_id, project_id")
    .eq("id", certificateId)
    .single();
  if (!cert) return { error: "Certificado no encontrado." };

  const { data: contract } = await supabase
    .from("subcontractor_contracts")
    .select("contracted_amount")
    .eq("id", cert.contract_id)
    .single();
  if (!contract) return { error: "Contrato no encontrado." };

  const { data: otherApproved } = await supabase
    .from("subcontractor_certificates")
    .select("approved_amount")
    .eq("contract_id", cert.contract_id)
    .in("status", ["APROBADO", "PAGADO"])
    .neq("id", certificateId);
  const alreadyApproved = (otherApproved ?? []).reduce((s, c) => s + (c.approved_amount ?? 0), 0);

  if (alreadyApproved + approvedAmount > contract.contracted_amount) {
    const disponible = contract.contracted_amount - alreadyApproved;
    return {
      error: `Este certificado superaría el monto contratado. Disponible: ${disponible.toLocaleString("es-PY")} Gs.`,
    };
  }

  const { data: approvedId, error } = await supabase.rpc("approve_subcontractor_certificate_atomically", {
    p_empresa_id: profile.empresa_id,
    p_certificate_id: certificateId,
    p_approved_pct: approvedPct,
    p_approved_amount: approvedAmount,
    p_notes: notes,
    p_actor_id: profile.id,
  });
  if (error) return { error: error.message };
  if (!approvedId) return { error: "No se pudo confirmar la aprobación." };

  const { data: persisted } = await supabase
    .from("subcontractor_certificates")
    .select("status, approved_pct, approved_amount")
    .eq("id", certificateId)
    .eq("project_id", cert.project_id)
    .maybeSingle();
  if (persisted?.status !== "APROBADO"
      || Number(persisted.approved_pct) !== approvedPct
      || Number(persisted.approved_amount) !== approvedAmount) {
    return { error: "La aprobación se ejecutó, pero no se pudo verificar su lectura posterior." };
  }

  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}

export async function rejectCertificate(certificateId: string, notes: string | null): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: cert } = await supabase
    .from("subcontractor_certificates")
    .select("id, project_id")
    .eq("id", certificateId)
    .single();
  if (!cert) return { error: "Certificado no encontrado." };

  const { data: rejectedId, error } = await supabase.rpc("reject_subcontractor_certificate_atomically", {
    p_empresa_id: profile.empresa_id,
    p_certificate_id: certificateId,
    p_notes: notes,
    p_actor_id: profile.id,
  });
  if (error) return { error: error.message };
  if (!rejectedId) return { error: "No se pudo confirmar el rechazo." };

  const { data: persisted } = await supabase
    .from("subcontractor_certificates")
    .select("status")
    .eq("id", certificateId)
    .eq("project_id", cert.project_id)
    .maybeSingle();
  if (persisted?.status !== "RECHAZADO") {
    return { error: "El rechazo se ejecutó, pero no se pudo verificar su lectura posterior." };
  }

  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Pagos de mano de obra por período (cuadrilla) y destajos. La mano de obra
// propia se controla por lo pagado en cada período, no por horas por partida.
// ---------------------------------------------------------------------------

export interface LaborPayment {
  id: string;
  crew_name: string;
  modalidad: "SEMANAL" | "QUINCENAL" | "MENSUAL" | "DESTAJO";
  period_from: string;
  period_to: string;
  amount: number;
  budget_item_id: string | null;
  quantity: number | null;
  unit_price: number | null;
  notes: string | null;
}

export async function listLaborPaymentsAction(projectId: string): Promise<{ data: LaborPayment[] | null; error: string | null }> {
  try {
    const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("labor_payments")
      .select("id, crew_name, modalidad, period_from, period_to, amount, budget_item_id, quantity, unit_price, notes")
      .eq("empresa_id", profile.empresa_id)
      .eq("project_id", projectId)
      .order("period_from", { ascending: false });
    if (error) return { data: null, error: error.message };
    return {
      data: (data ?? []).map((p: any) => ({
        ...p,
        amount: Number(p.amount),
        quantity: p.quantity == null ? null : Number(p.quantity),
        unit_price: p.unit_price == null ? null : Number(p.unit_price),
      })) as LaborPayment[],
      error: null,
    };
  } catch (e) {
    return { data: null, error: e instanceof Error ? e.message : "No se pudieron cargar los pagos." };
  }
}

export async function addLaborPayment(projectId: string, formData: FormData): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();
  const empresaId = profile.empresa_id;

  const { data: project } = await supabase.from("projects").select("id").eq("id", projectId).eq("empresa_id", empresaId).maybeSingle();
  if (!project) return { error: "Proyecto no encontrado." };

  const crewName = ((formData.get("crew_name") as string | null) ?? "").trim();
  const modalidad = (formData.get("modalidad") as string | null) ?? "";
  const periodFrom = (formData.get("period_from") as string | null) ?? "";
  const periodTo = (formData.get("period_to") as string | null) ?? "";
  const notes = ((formData.get("notes") as string | null) ?? "").trim() || null;

  if (!crewName) return { error: "Indicá la cuadrilla o la persona." };
  if (!["SEMANAL", "QUINCENAL", "MENSUAL", "DESTAJO"].includes(modalidad)) return { error: "Elegí la modalidad de pago." };
  if (!periodFrom || !periodTo) return { error: "Indicá el período." };
  if (periodTo < periodFrom) return { error: "El período termina antes de empezar." };

  let amount = Number(formData.get("amount") ?? 0);
  let budgetItemId: string | null = null;
  let quantity: number | null = null;
  let unitPrice: number | null = null;

  if (modalidad === "DESTAJO") {
    budgetItemId = (formData.get("budget_item_id") as string | null) || null;
    quantity = Number(formData.get("quantity") ?? 0);
    unitPrice = Number(formData.get("unit_price") ?? 0);
    if (!budgetItemId) return { error: "El destajo va a una partida: elegila." };
    if (!(quantity > 0)) return { error: "Indicá la cantidad ejecutada del destajo." };
    if (!(unitPrice >= 0) || formData.get("unit_price") === "") return { error: "Indicá el precio por unidad." };
    const { data: item } = await supabase.from("budget_items").select("id").eq("id", budgetItemId).eq("project_id", projectId).maybeSingle();
    if (!item) return { error: "La partida no pertenece a esta obra." };
    amount = destajoAmount(quantity, unitPrice);
  } else if (!(amount > 0)) {
    return { error: "Indicá el monto pagado." };
  }

  const { error } = await supabase.from("labor_payments").insert({
    empresa_id: empresaId,
    project_id: projectId,
    crew_name: crewName,
    modalidad,
    period_from: periodFrom,
    period_to: periodTo,
    amount,
    budget_item_id: budgetItemId,
    quantity,
    unit_price: unitPrice,
    notes,
    created_by: profile.id,
  });
  if (error) return { error: "No se pudo registrar el pago." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function deleteLaborPayment(projectId: string, paymentId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();
  const { error } = await supabase
    .from("labor_payments")
    .delete()
    .eq("id", paymentId)
    .eq("project_id", projectId)
    .eq("empresa_id", profile.empresa_id);
  if (error) return { error: "No se pudo borrar el pago." };
  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}
