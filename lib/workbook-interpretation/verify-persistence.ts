import type { SupabaseClient } from "@supabase/supabase-js";
import type { CanonicalImportCandidate } from "./canonical-import";
import { libroCode } from "@/lib/procurement/climate-calendar";
import type { ProjectWorkdayStatus } from "@/lib/types";

type Applied = { schedule: boolean; weather: boolean; certificateId: string | null; staff?: boolean; execution?: boolean };
type BudgetRow = { id: string; parent_id: string | null; code: string; description: string; unit: string | null; quantity: number | null; unit_price: number | null };
type CertificateLine = { sort_order: number; codigo: string | null; descripcion: string; unidad: string | null; budget_item_id: string | null; qty_contractual: number; qty_anterior: number; qty_presente: number; precio_unitario: number };

/** Exact counts and stable pagination prevent a Data API row cap from
 * masquerading as a complete read-back. A changing/truncated read fails. */
async function allRows<T>(db: SupabaseClient, table: string, columns: string, filter: string, value: string | string[]) {
  const rows: T[] = [];
  let expected: number | null = null;
  while (rows.length < 100_000) {
    let query = db.from(table).select(columns, { count: "exact" });
    query = Array.isArray(value) ? query.in(filter, value) : query.eq(filter, value);
    const page = await query.order("id").range(rows.length, rows.length + 999);
    if (page.error || page.count === null || (expected !== null && page.count !== expected)) return null;
    expected = page.count;
    rows.push(...(page.data ?? []) as unknown as T[]);
    if (rows.length === expected) return rows;
    if (!page.data?.length || rows.length > expected) return null;
  }
  return null;
}

export async function verifyImportedProject(db: SupabaseClient, projectId: string, candidate: CanonicalImportCandidate, applied: Applied) {
  const problems: { section: string; reason: string }[] = [];
  const fail = (section: string, reason: string) => problems.push({ section, reason });
  const same = (a: unknown, b: unknown) => a == null || b == null ? a == null && b == null
    : Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) <= Math.max(1e-8, Math.abs(Number(b)) * 1e-10);
  const [project, budget] = await Promise.all([
    db.from("projects").select("start_date,end_date,orden_inicio_date,plazo_dias,budget_total").eq("id", projectId).single(),
    allRows<BudgetRow>(db, "budget_items", "id,parent_id,code,description,unit,quantity,unit_price", "project_id", projectId),
  ]);
  const dates = candidate.integrity?.project;
  if (project.error || !project.data) fail("VERIFICACION", "No se pudieron releer las fechas de la obra.");
  else {
    if (dates && (project.data.start_date !== (dates.startDate?.value ?? null) || project.data.end_date !== (dates.endDate?.value ?? null) || project.data.orden_inicio_date !== (dates.orderDate?.value ?? null) || project.data.plazo_dias !== (dates.durationDays?.value ?? null))) fail("FECHAS", "Las fechas guardadas no coinciden con la evidencia contractual.");
    if (candidate.budgetItems.length && !same(project.data.budget_total, candidate.budgetTotal)) fail("PRESUPUESTO", "El presupuesto total guardado no coincide con el importe verificado.");
  }
  const budgetByCode = new Map((budget ?? []).map(row => [row.code, row]));
  if (!budget || budget.length !== candidate.budgetItems.length || candidate.budgetItems.some(item => {
    const saved = item.code ? budgetByCode.get(item.code) : null;
    const parentCode = item.code?.includes(".") ? item.code.slice(0, item.code.lastIndexOf(".")) : null;
    const expectedParent = parentCode ? budgetByCode.get(parentCode)?.id ?? null : null;
    return !saved || saved.parent_id !== expectedParent || saved.description !== item.description.trim() || saved.unit !== item.unit || !same(saved.quantity, item.quantity) || !same(saved.unit_price, item.unitPrice);
  })) fail("PRESUPUESTO", "La lectura completa de las partidas, unidades, cantidades, precios o jerarquía no coincide con la planilla.");
  if (applied.schedule) {
    const plans = await allRows<{ id: string; label: string }>(db, "project_schedule_plans", "id,label", "project_id", projectId);
    if (!plans || plans.length !== candidate.schedulePlans.length) fail("CRONOGRAMA", "No coinciden las versiones de la curva guardada.");
    else {
      const months = plans.length ? await allRows<{ plan_id: string; month_index: number; programado_pct: number; ejecutado_pct_documento: number | null }>(db, "project_schedule_plan_months", "id,plan_id,month_index,programado_pct,ejecutado_pct_documento", "plan_id", plans.map(p => p.id)) : [];
      if (!months) fail("CRONOGRAMA", "No se pudo releer la curva completa.");
      else for (const plan of candidate.schedulePlans) {
        const id = plans.find(p => p.label === (plan.label || plan.planVersion))?.id;
        const saved = months.filter(m => m.plan_id === id);
        if (!id || saved.length !== plan.months.length || plan.months.some(m => {
          const row = saved.find(s => s.month_index === m.monthIndex);
          const executed = plan.documentedExecuted.find(e => e.monthIndex === m.monthIndex)?.ejecutadoPct ?? null;
          return !row || Math.abs(Number(row.programado_pct) - m.programadoPct) > 0.000501 || (executed === null ? row.ejecutado_pct_documento !== null : row.ejecutado_pct_documento === null || Math.abs(Number(row.ejecutado_pct_documento) - executed) > 0.000501);
        })) fail("CRONOGRAMA", "La curva «" + plan.label + "» leída por el ERP no coincide con sus celdas de origen.");
      }
    }
  }
  if (applied.weather) {
    const days = await allRows<ProjectWorkdayStatus>(db, "project_workday_status", "id,work_date,classification,reason_code,decision_status", "project_id", projectId);
    if (!days || days.length !== candidate.weatherDays.length || candidate.weatherDays.some(day => {
      const saved = days.find(d => d.work_date === day.date);
      return !saved || saved.decision_status !== "CONFIRMED" || libroCode(saved) !== day.code;
    })) fail("LIBRO_DE_OBRA", "Las jornadas completas que consume el calendario no coinciden con los códigos importados.");
  }
  if (applied.certificateId) {
    const [certificate, lines] = await Promise.all([
      db.from("project_certificates").select("numero,period_start,period_end,monto_anterior,monto_presente").eq("id", applied.certificateId).eq("project_id", projectId).single(),
      allRows<CertificateLine>(db, "project_certificate_items", "id,sort_order,codigo,descripcion,unidad,budget_item_id,qty_contractual,qty_anterior,qty_presente,precio_unitario", "certificate_id", applied.certificateId),
    ]);
    if (certificate.error || !certificate.data || certificate.data.numero !== candidate.certificate.number || certificate.data.period_start !== candidate.certificate.periodStart || certificate.data.period_end !== candidate.certificate.periodEnd || Math.abs(Number(certificate.data.monto_presente) - Number(candidate.certificate.currentTotal)) > 1 || Math.abs(Number(certificate.data.monto_anterior) - Number(candidate.certificate.previousTotal)) > 1) fail("CERTIFICADO", "La identidad, período o importes del certificado guardado no coinciden con la planilla.");
    if (!lines || lines.length !== candidate.certificate.items.length || candidate.certificate.items.some((item, index) => {
      const saved = lines.find(line => line.sort_order === index);
      const expectedLink = item.matchedBudgetCode ? budgetByCode.get(item.matchedBudgetCode)?.id ?? null : null;
      return !saved || saved.codigo !== item.code || saved.descripcion !== item.description || saved.unidad !== item.unit || saved.budget_item_id !== expectedLink || !same(saved.qty_contractual, item.quantityContractual) || !same(saved.qty_anterior, item.quantityPrevious) || !same(saved.qty_presente, item.quantityCurrent) || !same(saved.precio_unitario, item.unitPrice);
    })) fail("CERTIFICADO", "Las líneas del certificado o sus vínculos a partidas no coinciden con lo aprobado.");
    if (applied.staff) {
      const staff = await allRows<{ nombre: string; rol: string; sort_order: number }>(db, "project_certificate_staff", "id,nombre,rol,sort_order", "certificate_id", applied.certificateId);
      if (!staff || staff.length !== candidate.staff.length || candidate.staff.some((person, index) => {
        const saved = staff.find(p => p.sort_order === index);
        return !saved || saved.nombre !== person.name.trim() || saved.rol !== person.role.trim();
      })) fail("PERSONAL", "El personal del certificado guardado no coincide con las filas seleccionadas.");
    }
  }
  if (applied.execution) {
    const entries = await allRows<{ budget_item_id: string; entry_date: string; quantity_executed: number }>(db, "execution_entries", "id,budget_item_id,entry_date,quantity_executed", "project_id", projectId);
    const expected = candidate.executionEntries.filter(e => e.matchedBudgetCode);
    const remaining = [...(entries ?? [])];
    if (!entries || entries.length !== expected.length || expected.some(entry => {
      const index = remaining.findIndex(saved => saved.budget_item_id === budgetByCode.get(entry.matchedBudgetCode!)?.id && saved.entry_date === candidate.certificate.periodEnd && same(saved.quantity_executed, entry.quantityExecuted));
      if (index < 0) return true;
      remaining.splice(index, 1);
      return false;
    })) fail("EXECUTION", "El avance guardado, su fecha o los vínculos a partidas no coinciden con lo seleccionado.");
  }
  return problems;
}
