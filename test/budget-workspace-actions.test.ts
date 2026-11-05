import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ project: true, rows: [] as Record<string, unknown>[], writes: [] as Record<string, unknown>[], fail: "" }));
vi.mock("@/lib/auth", () => ({ requirePlan: async () => ({ empresa_id: "tenant" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  const filters: [string, unknown][] = []; let patch: Record<string, unknown> | undefined;
  const q = {
    select() { return q; }, eq(key: string, value: unknown) { filters.push([key, value]); return q; }, is(key: string, value: unknown) { return q.eq(key, value); },
    update(value: Record<string, unknown>) { patch = value; return q; },
    async maybeSingle() {
      if (table === "projects") return { data: state.project && filters.some(([key, value]) => key === "empresa_id" && value === "tenant") ? { id: "project" } : null, error: null };
      const row = state.rows.find(item => filters.every(([key, value]) => item[key] === value));
      if (row && row.id === state.fail) return { data: null, error: { message: "DB unavailable" } };
      if (row && patch) { Object.assign(row, patch); state.writes.push(patch); }
      return { data: row ?? null, error: null };
    },
  };
  return q;
} }) }));
import { saveBudgetWorkspace } from "../app/(internal)/projects/[id]/workspace-actions";
const id = "a0000000-0000-4000-8000-000000000001";
const secondId = "a0000000-0000-4000-8000-000000000002";
const expected = { description: "Partida", unit: null, quantity: 1, unitPrice: 100 };
const change = (rowId = id) => ({ id: rowId, expected, next: { ...expected, quantity: 2 } });
beforeEach(() => {
  state.project = true; state.fail = ""; state.writes = [];
  state.rows = [id, secondId].map(id => ({ id, project_id: "project", code: "1", description: "Partida", unit: null, quantity: 1, unit_price: 100, subtotal: 100, start_date: "2026-01-01" }));
});
it("updates the existing budget under tenant authorization and leaves schedules/codes/APU/certificates outside the patch", async () => {
  const result = await saveBudgetWorkspace("project", [change()]);
  expect(result.saved[0]).toMatchObject({ id, quantity: 2, unitPrice: 100 });
  expect(state.writes).toEqual([{ description: "Partida", unit: null, quantity: 2, unit_price: 100 }]);
  expect(state.rows[0].start_date).toBe("2026-01-01");
});
it("rejects stale values atomically without overwriting another editor", async () => {
  state.rows[0].quantity = 3;
  expect((await saveBudgetWorkspace("project", [change()])).failed[0].error).toContain("cambió");
  expect(state.rows[0].quantity).toBe(3); expect(state.writes).toEqual([]);
});
it("denies an inaccessible project and an item belonging to another project", async () => {
  state.project = false;
  expect((await saveBudgetWorkspace("project", [change()])).error).toBeTruthy();
  state.project = true; state.rows[0].project_id = "foreign";
  expect((await saveBudgetWorkspace("project", [change()])).saved).toEqual([]);
  expect(state.writes).toEqual([]);
});
it("validates the complete request before any write", async () => {
  expect((await saveBudgetWorkspace("project", [change(), { ...change(secondId), next: { ...expected, quantity: -1 } }])).error).toBeTruthy();
  expect((await saveBudgetWorkspace("project", [change(), change()])).error).toBeTruthy();
  expect(state.writes).toEqual([]);
});
it("reports a partial failure by row and keeps successes identifiable", async () => {
  state.fail = secondId;
  const result = await saveBudgetWorkspace("project", [change(), change(secondId)]);
  expect(result.saved.map(row => row.id)).toEqual([id]);
  expect(result.failed.map(row => row.id)).toEqual([secondId]);
  expect(state.rows[1].quantity).toBe(1);
});
