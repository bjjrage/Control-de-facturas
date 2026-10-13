import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ profile: vi.fn(), client: vi.fn(), admin: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireProfile: mocks.profile }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.admin }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
import { createRfq } from "@/app/(internal)/rfqs/actions";
const id = "10000000-0000-4000-8000-000000000001";
const db = { rpc: vi.fn() };
function form() {
  const fd = new FormData();
  for (const [key, value] of Object.entries({ product: "Cemento", quantity: "5", unit: "bolsa", purpose: "PROCUREMENT", quote_type: "COT", project_id: id })) fd.set(key, value);
  return fd;
}
describe("RFQ recovery creation boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.profile.mockResolvedValue({ id, empresa_id: id, active: true, role: "admin" });
    mocks.client.mockResolvedValue(db);
    db.rpc.mockResolvedValue({ data: { id, code: "COT-TEST" }, error: null });
  });
  it("retains project, purpose and mono-item/COT through the current RPC", async () => {
    expect(await createRfq(form())).toEqual({ id, error: null });
    expect(db.rpc).toHaveBeenCalledWith("rfq_create", expect.objectContaining({
      p_header: expect.objectContaining({ purpose: "PROCUREMENT", quote_type: "COT", project_id: id }),
      p_items: [{ descripcion: "Cemento", cantidad: 5, unidad: "bolsa", producto_id: null }],
    }));
    expect(mocks.refresh).toHaveBeenCalledWith(`/projects/${id}`);
  });
  it("returns the created identity after upload failure so UI can avoid another RFQ", async () => {
    const chain = { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: { id } }) };
    mocks.admin.mockReturnValue({ from: () => chain, storage: { from: () => ({ upload: async () => { throw new Error("Storage unavailable"); } }) } });
    const fd = form(); fd.set("attachments", new File(["pdf"], "referencia.pdf", { type: "application/pdf" }));
    const result = await createRfq(fd);
    expect(result.id).toBe(id);
    expect(result.error).toMatch(/Solicitud creada.*Storage unavailable/);
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.refresh).toHaveBeenCalledWith(`/projects/${id}`);
  });
  it("reports RPC failure without claiming creation or starting uploads", async () => {
    db.rpc.mockResolvedValue({ data: null, error: { message: "Proyecto de otra empresa" } });
    expect(await createRfq(form())).toEqual({ error: "Proyecto de otra empresa", id: null });
    expect(mocks.admin).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
