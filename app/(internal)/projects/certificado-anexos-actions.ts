"use server";

import { createClient } from "@/lib/supabase/server";
import { requirePlan } from "@/lib/auth";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { WeatherCode } from "@/lib/types";

const WEATHER_CODES: WeatherCode[] = ["B", "LL", "HH", "O"];

async function assertOwnedProject(supabase: SupabaseClient, projectId: string, empresaId: string) {
  const { data } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("empresa_id", empresaId)
    .single();
  return !!data;
}

async function projectIdOfCertificate(supabase: SupabaseClient, certificateId: string, empresaId: string) {
  const { data } = await supabase
    .from("project_certificates")
    .select("project_id, projects!inner(empresa_id)")
    .eq("id", certificateId)
    .single();
  if (!data) return null;
  const proj = data.projects as unknown as { empresa_id: string };
  if (proj.empresa_id !== empresaId) return null;
  return data.project_id as string;
}

// ---------------------------------------------------------------------------
// Días no trabajados
// ---------------------------------------------------------------------------

/** Fija (o borra, si code es null) el clima de un día. */
export async function setWeatherDay(
  projectId: string,
  logDate: string,
  code: WeatherCode | null
): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  if (!(await assertOwnedProject(supabase, projectId, profile.empresa_id))) {
    return { error: "Proyecto no encontrado." };
  }
  if (code !== null && !WEATHER_CODES.includes(code)) return { error: "Código inválido." };

  if (code === null) {
    await supabase.from("project_weather_log").delete().eq("project_id", projectId).eq("log_date", logDate);
  } else {
    await supabase
      .from("project_weather_log")
      .upsert(
        { project_id: projectId, log_date: logDate, code, recorded_by: profile.id },
        { onConflict: "project_id,log_date" }
      );
  }

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Cronograma / curva de avance
// ---------------------------------------------------------------------------

/**
 * Crea o reemplaza una versión del cronograma. Si planId viene, reemplaza sus
 * meses; si no, crea una versión nueva. La primera versión de un proyecto
 * queda activa automáticamente.
 */
export async function saveSchedulePlan(
  projectId: string,
  input: { planId: string | null; label: string; months: { month_index: number; programado_pct: number }[] }
): Promise<{ error: string | null; id: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  if (!(await assertOwnedProject(supabase, projectId, profile.empresa_id))) {
    return { error: "Proyecto no encontrado.", id: null };
  }
  const label = input.label.trim();
  if (!label) return { error: "Poné un nombre a la versión (ej. Original, Adenda 1).", id: null };

  const months = input.months
    .filter((m) => m.month_index >= 1 && Number.isFinite(m.programado_pct))
    .map((m) => ({ month_index: m.month_index, programado_pct: Math.max(0, m.programado_pct) }));

  let planId = input.planId;
  if (planId) {
    const { data: existing } = await supabase
      .from("project_schedule_plans")
      .select("id, project_id")
      .eq("id", planId)
      .single();
    if (!existing || existing.project_id !== projectId) return { error: "Versión no encontrada.", id: null };
    await supabase.from("project_schedule_plans").update({ label }).eq("id", planId);
    await supabase.from("project_schedule_plan_months").delete().eq("plan_id", planId);
  } else {
    const { count } = await supabase
      .from("project_schedule_plans")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId);
    const { data: created, error: createError } = await supabase
      .from("project_schedule_plans")
      .insert({ project_id: projectId, label, is_active: (count ?? 0) === 0 })
      .select("id")
      .single();
    if (createError || !created) return { error: "No se pudo crear la versión.", id: null };
    planId = created.id as string;
  }

  if (months.length > 0) {
    const { error: monthsError } = await supabase
      .from("project_schedule_plan_months")
      .insert(months.map((m) => ({ plan_id: planId, ...m })));
    if (monthsError) return { error: "No se pudieron guardar los meses.", id: planId };
  }

  revalidatePath(`/projects/${projectId}`);
  return { error: null, id: planId };
}

/** Marca una versión como la vigente (índice parcial garantiza una sola activa). */
export async function activateSchedulePlan(planId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("project_schedule_plans")
    .select("id, project_id, projects!inner(empresa_id)")
    .eq("id", planId)
    .single();
  if (!plan) return { error: "Versión no encontrada." };
  const proj = plan.projects as unknown as { empresa_id: string };
  if (proj.empresa_id !== profile.empresa_id) return { error: "Versión no encontrada." };

  await supabase
    .from("project_schedule_plans")
    .update({ is_active: false })
    .eq("project_id", plan.project_id)
    .eq("is_active", true);
  const { error } = await supabase.from("project_schedule_plans").update({ is_active: true }).eq("id", planId);
  if (error) return { error: "No se pudo activar la versión." };

  revalidatePath(`/projects/${plan.project_id}`);
  return { error: null };
}

export async function deleteSchedulePlan(planId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("project_schedule_plans")
    .select("id, project_id, is_active, projects!inner(empresa_id)")
    .eq("id", planId)
    .single();
  if (!plan) return { error: "Versión no encontrada." };
  const proj = plan.projects as unknown as { empresa_id: string };
  if (proj.empresa_id !== profile.empresa_id) return { error: "Versión no encontrada." };
  if (plan.is_active) return { error: "No se puede eliminar la versión activa. Activá otra primero." };

  const { error } = await supabase.from("project_schedule_plans").delete().eq("id", planId);
  if (error) return { error: "No se pudo eliminar la versión." };

  revalidatePath(`/projects/${plan.project_id}`);
  return { error: null };
}

// ---------------------------------------------------------------------------
// Personal del período (roster por certificado)
// ---------------------------------------------------------------------------

export async function addCertificateStaff(
  certificateId: string,
  nombre: string,
  rol: string
): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const projectId = await projectIdOfCertificate(supabase, certificateId, profile.empresa_id);
  if (!projectId) return { error: "Certificado no encontrado." };

  const n = nombre.trim();
  const r = rol.trim();
  if (!n || !r) return { error: "Nombre y rol son obligatorios." };

  const { count } = await supabase
    .from("project_certificate_staff")
    .select("id", { count: "exact", head: true })
    .eq("certificate_id", certificateId);

  const { error } = await supabase
    .from("project_certificate_staff")
    .insert({ certificate_id: certificateId, nombre: n, rol: r, sort_order: count ?? 0 });
  if (error) return { error: "No se pudo agregar." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}

export async function removeCertificateStaff(staffId: string): Promise<{ error: string | null }> {
  const profile = await requirePlan("caterpillar", ["administracion", "admin"]);
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("project_certificate_staff")
    .select("id, certificate_id")
    .eq("id", staffId)
    .single();
  if (!row) return { error: "Registro no encontrado." };

  const projectId = await projectIdOfCertificate(supabase, row.certificate_id, profile.empresa_id);
  if (!projectId) return { error: "Registro no encontrado." };

  const { error } = await supabase.from("project_certificate_staff").delete().eq("id", staffId);
  if (error) return { error: "No se pudo eliminar." };

  revalidatePath(`/projects/${projectId}`);
  return { error: null };
}
