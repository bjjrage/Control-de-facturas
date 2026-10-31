import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyImportedProject } from "../verify-persistence";
import type { CanonicalImportCandidate } from "../canonical-import";
import { budgetFixture, certificateFixture } from "./contract-fixtures";

type Row = Record<string, unknown>;
function persisted(candidate: CanonicalImportCandidate) {
  const budget = candidate.budgetItems.map((item, i) => ({ id: "b" + i, project_id: "p", parent_id: null, code: item.code, description: item.description, unit: item.unit, quantity: item.quantity, unit_price: item.unitPrice }));
  const dates = candidate.integrity!.project;
  const tables: Record<string, Row[]> = {
    projects: [{ id: "p", start_date: dates.startDate?.value ?? null, end_date: dates.endDate?.value ?? null, orden_inicio_date: dates.orderDate?.value ?? null, plazo_dias: dates.durationDays?.value ?? null, budget_total: candidate.budgetTotal }],
    budget_items: budget,
    project_certificates: [{ id: "c", project_id: "p", numero: candidate.certificate.number, period_start: candidate.certificate.periodStart, period_end: candidate.certificate.periodEnd, monto_anterior: candidate.certificate.previousTotal, monto_presente: candidate.certificate.currentTotal }],
    project_certificate_items: candidate.certificate.items.map((item, i) => ({ id: "c" + i, certificate_id: "c", sort_order: i, codigo: item.code, descripcion: item.description, unidad: item.unit, budget_item_id: budget.find(b => b.code === item.matchedBudgetCode)?.id ?? null, qty_contractual: item.quantityContractual, qty_anterior: item.quantityPrevious, qty_presente: item.quantityCurrent, precio_unitario: item.unitPrice })),
    project_certificate_staff: [], execution_entries: [], project_workday_status: [], project_schedule_plans: [], project_schedule_plan_months: [],
  };
  return tables;
}
function database(tables: Record<string, Row[]>, options: { cap?: number; missingCount?: boolean; truncated?: boolean } = {}) {
  const reads: { table: string; start: number }[] = [];
  const client = { from(table: string) {
    const predicates: ((row: Row) => boolean)[] = [];
    const rows = () => (tables[table] ?? []).filter(r => predicates.every(p => p(r))).sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { predicates.push(r => r[key] === value); return query; },
      in(key: string, values: unknown[]) { predicates.push(r => values.includes(r[key])); return query; }, order() { return query; },
      async single() { return { data: rows()[0] ?? null, error: null }; },
      async range(start: number, end: number) {
        reads.push({ table, start });
        const all = rows();
        return { data: options.truncated && start > 0 ? [] : all.slice(start, Math.min(end + 1, start + (options.cap ?? 1000))), count: options.missingCount ? null : all.length, error: null };
      },
    };
    return query;
  } } as unknown as SupabaseClient;
  return { client, reads };
}

describe("complete operational read-back", () => {
  it("reads all pages even when the API cap is lower than requested", async () => {
    const candidate = budgetFixture({ items: Array.from({ length: 5 }, (_, i) => ({ code: String(i + 1), description: "Partida " + i, unit: "un", quantity: 1, unitPrice: 10 })) }).candidate();
    const db = database(persisted(candidate), { cap: 2 });
    expect(await verifyImportedProject(db.client, "p", candidate, { schedule: false, weather: false, certificateId: null })).toEqual([]);
    expect(db.reads.filter(r => r.table === "budget_items").map(r => r.start)).toEqual([0, 2, 4]);
  });
  it.each([{ missingCount: true }, { cap: 1, truncated: true }])("fails a truncated or uncounted read instead of declaring success: %j", async options => {
    const candidate = budgetFixture({ items: [1, 2].map(n => ({ code: String(n), description: "Partida", unit: "un", quantity: 1, unitPrice: 10 })) }).candidate();
    const db = database(persisted(candidate), options);
    expect((await verifyImportedProject(db.client, "p", candidate, { schedule: false, weather: false, certificateId: null })).some(p => p.section === "PRESUPUESTO")).toBe(true);
  });
  it.each(["unit", "description", "parent_id"])("detects a wrong %s with unchanged counts and totals", async key => {
    const candidate = budgetFixture().candidate(), tables = persisted(candidate);
    tables.budget_items[0][key] = "wrong";
    const db = database(tables);
    expect((await verifyImportedProject(db.client, "p", candidate, { schedule: false, weather: false, certificateId: null })).some(p => p.section === "PRESUPUESTO")).toBe(true);
  });
  it("verifies each certificate line and the exact budget link, not just the total", async () => {
    const candidate = certificateFixture().candidate(), tables = persisted(candidate);
    expect(await verifyImportedProject(database(tables).client, "p", candidate, { schedule: false, weather: false, certificateId: "c" })).toEqual([]);
    tables.project_certificate_items[0].budget_item_id = null;
    expect((await verifyImportedProject(database(tables).client, "p", candidate, { schedule: false, weather: false, certificateId: "c" })).some(p => p.section === "CERTIFICADO")).toBe(true);
  });
  it("reports missing staff and incorrectly linked execution even when other modules match", async () => {
    const candidate = certificateFixture().candidate();
    candidate.staff = [{ name: "Ana", role: "Residente", sheet: "Personal", row: 2 }];
    candidate.executionEntries = [{ code: "1", description: "Excavación", unit: "m3", quantityExecuted: 1, matchedBudgetCode: "1", matchedBudgetRow: 2, matchQuality: "EXACT", source: { sheet: "LDO", row: 2, range: "A1:D2" } }];
    const tables = persisted(candidate);
    tables.execution_entries.push({ id: "e", project_id: "p", budget_item_id: "unrelated", entry_date: candidate.certificate.periodEnd, quantity_executed: 1 });
    const problems = await verifyImportedProject(database(tables).client, "p", candidate, { schedule: false, weather: false, certificateId: "c", staff: true, execution: true });
    expect(problems.map(p => p.section)).toEqual(["PERSONAL", "EXECUTION"]);
    tables.project_certificate_staff.push({ id: "s", certificate_id: "c", nombre: "Ana", rol: "Residente", sort_order: 0 });
    tables.execution_entries[0].budget_item_id = "b0";
    expect(await verifyImportedProject(database(tables).client, "p", candidate, { schedule: false, weather: false, certificateId: "c", staff: true, execution: true })).toEqual([]);
  });
});
