import { beforeEach, expect, it, vi } from "vitest";
import { createEmptyProjectWorkbook } from "@/lib/projects/workspace-book";

const state = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], tables: [] as string[], calls: [] as unknown[], unavailable: false }));
vi.mock("@/lib/auth", () => ({ requirePlan: async (...args: unknown[]) => { state.calls.push(args); return { id: "editor", empresa_id: "tenant" }; } }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from(table: string) {
  state.tables.push(table);
  const filters: [string, unknown][] = []; let patch: Record<string, unknown> | undefined;
  const q = {
    select() { return q; },
    eq(key: string, value: unknown) { filters.push([key, value]); return q; },
    update(value: Record<string, unknown>) { patch = value; return q; },
    async upsert(value: Record<string, unknown>, options: { ignoreDuplicates: boolean }) {
      expect(options.ignoreDuplicates).toBe(true);
      if (!state.rows.some(row => row.id === value.id)) state.rows.push({ ...value, revision: 1 });
      return { error: state.unavailable ? { message: "unavailable" } : null };
    },
    async maybeSingle() {
      if (state.unavailable) return { data: null, error: { message: "unavailable" } };
      const row = state.rows.find(item => filters.every(([key, value]) => item[key] === value));
      if (row && patch) Object.assign(row, patch);
      return { data: row ?? null, error: null };
    },
  };
  return q;
} }) }));
import { createProjectWorkspace, saveProjectWorkspace } from "../app/(internal)/projects/workspaces/actions";
const id = "a0000000-0000-4000-8000-000000000001";
beforeEach(() => { state.rows = []; state.tables = []; state.calls = []; state.unavailable = false; });

it("creates an empty book under the authenticated company and is idempotent", async () => {
  expect(await createProjectWorkspace(id)).toEqual({ revision: 1, error: null });
  state.rows[0].name = "Existing work";
  await createProjectWorkspace(id);
  expect(state.rows).toHaveLength(1);
  expect(state.rows[0]).toMatchObject({ name: "Existing work", empresa_id: "tenant", created_by: "editor" });
  expect(state.calls[0]).toEqual(["pro", ["administracion", "admin"]]);
  expect(new Set(state.tables)).toEqual(new Set(["project_workspaces"]));
});
it("saves native workbook and rejects a stale revision without overwriting", async () => {
  await createProjectWorkspace(id);
  const book = createEmptyProjectWorkbook(id); book.name = "Reviewed work";
  expect(await saveProjectWorkspace(id, 1, book)).toEqual({ revision: 2, error: null });
  expect((await saveProjectWorkspace(id, 1, { ...book, name: "Stale" })).error).toContain("Otra sesión");
  expect(state.rows[0]).toMatchObject({ name: "Reviewed work", revision: 2, workbook: book });
});
it("denies a different company and rejects malformed books before touching data", async () => {
  state.rows = [{ id, empresa_id: "foreign", revision: 1 }];
  expect((await saveProjectWorkspace(id, 1, createEmptyProjectWorkbook(id))).error).toBeTruthy();
  expect(state.rows[0].revision).toBe(1);
  state.tables = [];
  expect((await saveProjectWorkspace(id, 0, {})).error).toBeTruthy();
  expect((await saveProjectWorkspace(id, 1, { id })).error).toBeTruthy();
  expect((await createProjectWorkspace("invalid")).error).toBeTruthy();
  expect(state.tables).toEqual([]);
});
it("reports a failed save and keeps the persisted revision intact", async () => {
  await createProjectWorkspace(id); state.unavailable = true;
  expect((await saveProjectWorkspace(id, 1, createEmptyProjectWorkbook(id))).error).toContain("Tus cambios siguen abiertos");
  expect(state.rows[0].revision).toBe(1);
});
