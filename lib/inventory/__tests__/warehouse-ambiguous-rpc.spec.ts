/** D6 (revisión de Claude): un fallo ambiguo del RPC (red, timeout, gateway) NO es un rechazo definitivo.
 * Con el código anterior la ruta respondía 400 a todo, el cliente descartaba su intento y el reintento
 * duplicaba la salida. Handler real con la base simulada. */
import { beforeEach, expect, it, vi } from "vitest";
const tenant = "11111111-1111-4111-8111-111111111111";
const rpcError = vi.hoisted(() => ({ current: null as null | { message: string; code?: string } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from(table: string) {
    const query: any = { select: () => query, eq: () => query, limit: () => query, update: () => query,
      then: (resolve: (value: unknown) => void) => Promise.resolve({ error: null }).then(resolve),
      maybeSingle: async () => ({ error: null, data: table === "warehouse_portal_links" ? { id: "link", empresa_id: tenant, location_id: "location", active: true, expires_at: new Date(Date.now() + 86400000).toISOString(), created_by: "sponsor" }
        : table === "inventory_locations" ? { id: "location", name: "QA", project_id: "project", location_type: "PROJECT", active: true }
        : table === "authorized_orders" ? { id: "order", project_id: "project", status: "AUTORIZADO" }
        : table === "productos" ? { id: "product", activo: true } : table === "budget_items" ? { id: "budget" } : null }) };
    return query;
  },
  rpc: async (name: string) => ({ data: rpcError.current ? null : name === "inventory_portal_consumption" ? "movement" : { receipt_id: "r" }, error: rpcError.current }),
  storage: { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({ error: null }) }) },
}) }));
import { POST } from "@/app/api/warehouse-portal/[token]/route";
beforeEach(() => { rpcError.current = null; });

const consumption = () => {
  const body = new FormData();
  body.set("action", "consumption"); body.set("producto_id", "product"); body.set("quantity", "1");
  body.set("budget_item_id", "budget"); body.set("idempotency_key", "33333333-3333-4333-8333-333333333333");
  return POST(new Request("http://localhost/api/warehouse-portal/t", { method: "POST", body }), { params: Promise.resolve({ token: "A".repeat(43) }) });
};

it("respuesta perdida o fallo de red (sin código SQL): 503 y sin texto interno, para que el cliente conserve el intento", async () => {
  rpcError.current = { message: "TypeError: fetch failed" };
  const res = await consumption();
  expect(res.status).toBe(503);
  const json = await res.json();
  expect(json.error).toMatch(/Reintentá con los mismos datos/);
  expect(JSON.stringify(json)).not.toMatch(/TypeError|fetch failed/);
});
it.each(["08006", "57014", "53300"])("fallo de conexión o de recursos (%s): 503", async code => {
  rpcError.current = { message: "connection issue", code };
  expect((await consumption()).status).toBe(503);
});
it("rechazo de negocio de la base (P0001): 400 con su mensaje", async () => {
  rpcError.current = { message: "Stock insuficiente en la ubicación origen", code: "P0001" };
  const res = await consumption();
  expect(res.status).toBe(400);
  expect((await res.json()).error).toBe("Stock insuficiente en la ubicación origen");
});
