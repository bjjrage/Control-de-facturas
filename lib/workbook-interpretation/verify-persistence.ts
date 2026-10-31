import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalImportCandidate } from "./canonical-import";
import { libroCode } from "@/lib/procurement/climate-calendar";
import type { ProjectWorkdayStatus } from "@/lib/types";

/** Verify the actual read models, not just INSERT counts. Each mismatch is
 * returned to the import receipt and audit log instead of a green success. */
export async function verifyImportedProject(db: SupabaseClient, projectId: string, candidate: CanonicalImportCandidate, applied: { schedule: boolean; weather: boolean; certificateId: string | null }) {
  const problems: { section: string; reason: string }[] = [];
  const fail = (section: string, reason: string) => problems.push({ section, reason });
  const [project, budget] = await Promise.all([
    db.from("projects").select("start_date,end_date,orden_inicio_date,plazo_dias").eq("id",projectId).single(),
    db.from("budget_items").select("code,quantity,unit_price").eq("project_id",projectId).limit(10000),
  ]);
  const dates = candidate.integrity?.project;
  if (project.error || !project.data) fail("VERIFICACION","No se pudieron releer las fechas de la obra.");
  else if (dates && (project.data.start_date !== (dates.startDate?.value ?? null) || project.data.end_date !== (dates.endDate?.value ?? null) || project.data.orden_inicio_date !== (dates.orderDate?.value ?? null) || project.data.plazo_dias !== (dates.durationDays?.value ?? null))) fail("FECHAS","Las fechas guardadas no coinciden con la evidencia contractual.");
  const same = (a: unknown,b: unknown) => a === null || b === null ? a === b : Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a)-Number(b)) <= Math.max(1e-8, Math.abs(Number(b))*1e-10);
  if (budget.error || budget.data?.length !== candidate.budgetItems.length || candidate.budgetItems.some(item => {
    const saved = budget.data?.find(row => row.code === item.code);
    return !saved || !same(saved.quantity,item.quantity) || !same(saved.unit_price,item.unitPrice);
  })) fail("PRESUPUESTO","La lectura del presupuesto no coincide con las partidas verificadas.");
  if (applied.schedule) {
    const plans = await db.from("project_schedule_plans").select("id,label").eq("project_id",projectId);
    if (plans.error || plans.data?.length !== candidate.schedulePlans.length) fail("CRONOGRAMA","No coinciden las versiones de la curva guardada.");
    else {
      const months = await db.from("project_schedule_plan_months").select("plan_id,month_index,programado_pct,ejecutado_pct_documento").in("plan_id",plans.data.map(p=>p.id));
      if (months.error) fail("CRONOGRAMA","No se pudo releer la curva guardada.");
      else for (const plan of candidate.schedulePlans) {
        const id=plans.data.find(p=>p.label===(plan.label||plan.planVersion))?.id;
        const saved=months.data.filter(m=>m.plan_id===id);
        if (!id || saved.length!==plan.months.length || plan.months.some(m=>{
          const row=saved.find(s=>s.month_index===m.monthIndex);
          const executed=plan.documentedExecuted.find(e=>e.monthIndex===m.monthIndex)?.ejecutadoPct ?? null;
          return !row || Math.abs(Number(row.programado_pct)-m.programadoPct)>0.000501 || (executed === null ? row.ejecutado_pct_documento !== null : row.ejecutado_pct_documento === null || Math.abs(Number(row.ejecutado_pct_documento)-executed)>0.000501);
        })) fail("CRONOGRAMA",`La curva «${plan.label}» leída por el ERP no coincide con sus celdas de origen.`);
      }
    }
  }
  if (applied.weather) {
    const days=await db.from("project_workday_status").select("work_date,classification,reason_code,decision_status").eq("project_id",projectId).limit(20000);
    if (days.error || candidate.weatherDays.some(day=>{
      const saved=days.data?.find(d=>d.work_date===day.date);
      return !saved || saved.decision_status!=="CONFIRMED" || libroCode(saved as ProjectWorkdayStatus)!==day.code;
    })) fail("LIBRO_DE_OBRA","Los días que consume el calendario no coinciden con los códigos importados.");
  }
  if (applied.certificateId) {
    const certificate=await db.from("project_certificates").select("period_start,period_end,monto_presente").eq("id",applied.certificateId).eq("project_id",projectId).single();
    if (certificate.error || certificate.data?.period_start!==candidate.certificate.periodStart || certificate.data?.period_end!==candidate.certificate.periodEnd || Math.abs(Number(certificate.data?.monto_presente)-Number(candidate.certificate.currentTotal))>1) fail("CERTIFICADO","El período o importe del certificado guardado no coincide con la planilla.");
  }
  return problems;
}
