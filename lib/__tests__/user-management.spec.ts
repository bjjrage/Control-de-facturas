import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { manageUser } from "@/lib/users/management";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor = { id: id(1), empresa_id: id(10), role: "admin" as const, is_super_admin: false };
const state = { target: { id: id(2), empresa_id: id(10), role: "comercial", active: true, is_super_admin: false }, count: 1, writeError: null as { code?: string; message: string } | null, authError: null as { message: string } | null, rows: [{ id: id(2) }] };
const filters: [string, unknown][] = [];
const mutate = vi.fn(), authDelete = vi.fn();
function builder() {
  let mutation = false, count = false;
  const q = {
    select: (_?: string, options?: { head: boolean }) => { count = Boolean(options?.head); return q; },
    eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
    neq: () => q,
    maybeSingle: async () => ({ data: state.target, error: null }),
    update: (value: unknown) => { mutation = true; mutate(value); return q; },
    delete: () => { mutation = true; mutate("delete"); return q; },
    then: (resolve: (value: unknown) => unknown) => Promise.resolve(mutation ? { data: state.rows, error: state.writeError } : count ? { count: state.count, error: null } : {}).then(resolve),
  };
  return q;
}
const db = { from: builder, auth: { admin: { deleteUser: authDelete } } } as unknown as SupabaseClient;
beforeEach(() => {
  filters.length = 0; vi.clearAllMocks();
  Object.assign(state, { target: { id: id(2), empresa_id: id(10), role: "comercial", active: true, is_super_admin: false }, count: 1, writeError: null, authError: null, rows: [{ id: id(2) }] });
  authDelete.mockImplementation(async () => ({ error: state.authError }));
});
describe("privileged user mutations", () => {
  it("scopes both lookup and mutation to the tenant", async () => {
    expect(await manageUser(db, actor, id(2), { kind: "role", role: "administracion" })).toEqual({ error: null });
    expect(filters.filter(([key, value]) => key === "empresa_id" && value === actor.empresa_id)).toHaveLength(2);
  });
  it("rejects global scope without superadmin", async () => {
    expect((await manageUser(db, actor, id(2), { kind: "delete" }, "global")).error).toBeTruthy();
    expect(mutate).not.toHaveBeenCalled();
  });
  it.each([{ kind: "delete" }, { kind: "active", active: false }, { kind: "role", role: "comercial" }] as const)("protects self from %j", async (change) => {
    state.target.id = actor.id;
    expect((await manageUser(db, actor, actor.id, change)).error).toMatch(/propio rol/);
    expect(mutate).not.toHaveBeenCalled();
  });
  it("protects superadmin accounts", async () => {
    state.target.is_super_admin = true;
    expect((await manageUser(db, actor, id(2), { kind: "delete" })).error).toMatch(/superadmin/);
    expect(authDelete).not.toHaveBeenCalled();
  });
  it("protects the last active administrator", async () => {
    state.target.role = "admin"; state.count = 0;
    expect((await manageUser(db, actor, id(2), { kind: "active", active: false })).error).toMatch(/único admin/);
    expect(mutate).not.toHaveBeenCalled();
  });
  it("allows removal of an already inactive admin", async () => {
    state.target.role = "admin"; state.target.active = false; state.count = 0;
    expect((await manageUser(db, actor, id(2), { kind: "delete" })).error).toBeNull();
    expect(authDelete).toHaveBeenCalledWith(id(2));
  });
  it("retains the Auth account when operations prevent profile deletion", async () => {
    state.writeError = { code: "23503", message: "foreign key" };
    expect((await manageUser(db, actor, id(2), { kind: "delete" })).error).toMatch(/desactivalo/);
    expect(authDelete).not.toHaveBeenCalled();
  });
  it("reports Auth cleanup failure instead of claiming success", async () => {
    state.authError = { message: "Auth unavailable" };
    expect((await manageUser(db, actor, id(2), { kind: "delete" })).error).toMatch(/falta eliminar su cuenta/);
  });
  it("does not delete Auth after a concurrent profile change", async () => {
    state.rows = [];
    expect((await manageUser(db, actor, id(2), { kind: "delete" })).error).toMatch(/Recargá/);
    expect(authDelete).not.toHaveBeenCalled();
  });
});
