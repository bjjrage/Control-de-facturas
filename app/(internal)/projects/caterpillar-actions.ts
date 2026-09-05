"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { revalidatePath } from "next/cache";

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
  const hourlyCost = Number(formData.get("hourly_cost") ?? 0);
  const entryDate = (formData.get("entry_date") as string | null) || new Date().toISOString().slice(0, 10);
  const taskDescription = (formData.get("task_description") as string | null) || null;

  if (!workerName) return { error: "El nombre del trabajador es obligatorio." };
  if (!(hours > 0)) return { error: "Las horas deben ser mayores a cero." };

  const { error } = await supabase.from("daily_labor_entries").insert({
    project_id: projectId,
    entry_date: entryDate,
    worker_name: workerName,
    hours,
    hourly_cost: hourlyCost,
    task_description: taskDescription,
    recorded_by: profile.id,
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
  await requirePlan("caterpillar", ["administracion", "admin"]);
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

  const { error } = await supabase
    .from("subcontractor_certificates")
    .update({ status: "APROBADO", approved_pct: approvedPct, approved_amount: approvedAmount, notes })
    .eq("id", certificateId);

  if (error) return { error: "No se pudo aprobar el certificado." };

  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}

export async function rejectCertificate(certificateId: string, notes: string | null): Promise<{ error: string | null }> {
  await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: cert } = await supabase
    .from("subcontractor_certificates")
    .select("id, project_id")
    .eq("id", certificateId)
    .single();
  if (!cert) return { error: "Certificado no encontrado." };

  const { error } = await supabase
    .from("subcontractor_certificates")
    .update({ status: "RECHAZADO", notes })
    .eq("id", certificateId);

  if (error) return { error: "No se pudo rechazar el certificado." };

  revalidatePath(`/projects/${cert.project_id}`);
  return { error: null };
}
