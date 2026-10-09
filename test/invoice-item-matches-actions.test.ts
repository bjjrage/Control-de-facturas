import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const UID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

// ---------------------------------------------------------------------------
// Fake de Supabase en memoria con simulación del trigger
// trg_recompute_order_item_qty (recalcula quantity_invoiced al sumar matches).
// ---------------------------------------------------------------------------
function makeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map((r) => ({ ...r }));
  let seq = 100;

  function recompute(orderItemId: string) {
    const sum = (tables.invoice_item_matches ?? [])
      .filter((m) => m.order_item_id === orderItemId)
      .reduce((s, m) => s + Number(m.quantity_matched), 0);
    const ol = (tables.authorized_order_items ?? []).find((o) => o.id === orderItemId);
    if (ol) ol.quantity_invoiced = sum;
  }

  function pick(row: Row, cols: string): Row {
    const out: Row = {};
    for (const part of cols.split(",")) {
      const c = part.trim();
      if (!c || c === "*") { Object.assign(out, row); continue; }
      const inner = c.match(/^(\w+)!inner\((\w+)\)$/);
      if (inner) {
        if (inner[1] === "invoices") {
          const inv = (tables.invoices ?? []).find((i) => i.id === row.invoice_id);
          out.invoices = inv ? { status: inv.status } : null;
        }
        continue;
      }
      out[c] = row[c];
    }
    return out;
  }

  function query(table: string) {
    const state = {
      filters: [] as Array<(r: Row) => boolean>,
      orderBy: null as null | string,
      selectCols: "*",
      countExact: false,
      head: false,
    };
    const api: Record<string, (...args: never[]) => unknown> = {};
    api.select = ((cols?: string, opts?: { count?: string; head?: boolean }) => {
      if (typeof cols === "string") state.selectCols = cols;
      if (opts?.count === "exact") state.countExact = true;
      if (opts?.head) state.head = true;
      return api;
    }) as never;
    api.eq = ((col: string, val: unknown) => {
      state.filters.push((r) => r[col] === val);
      return api;
    }) as never;
    api.in = ((col: string, vals: unknown[]) => {
      state.filters.push((r) => vals.includes(r[col]));
      return api;
    }) as never;
    api.order = ((col: string) => {
      state.orderBy = col;
      return api;
    }) as never;
    const rows = () => {
      let rs = (tables[table] ?? []).filter((r) => state.filters.every((f) => f(r)));
      if (state.orderBy) rs = [...rs].sort((a, b) => Number(a[state.orderBy as string] ?? 0) - Number(b[state.orderBy as string] ?? 0));
      return rs;
    };
    api.maybeSingle = (async () => {
      const rs = rows();
      return { data: rs.length ? pick(rs[0], state.selectCols) : null, error: null };
    }) as never;
    api.single = (async () => {
      const rs = rows();
      if (!rs.length) return { data: null, error: { message: "No rows", code: "PGRST116" } };
      return { data: pick(rs[0], state.selectCols), error: null };
    }) as never;
    api.insert = ((payload: Row | Row[]) => {
      const list = Array.isArray(payload) ? payload : [payload];
      const inserted: Row[] = list.map((p) => ({ id: UID(++seq), ...p }));
      tables[table] = [...(tables[table] ?? []), ...inserted];
      if (table === "invoice_item_matches") {
        for (const m of inserted) recompute(m.order_item_id as string);
      }
      const sub: Record<string, (...args: never[]) => unknown> = {};
      sub.select = ((_cols?: string) => {
        if (typeof _cols === "string") state.selectCols = _cols;
        return sub;
      }) as never;
      sub.single = (async () => ({ data: pick(inserted[0], state.selectCols), error: null })) as never;
      return sub;
    }) as never;
    api.update = (() => {
      const sub: Record<string, (...args: never[]) => unknown> = {};
      sub.eq = api.eq;
      return sub;
    }) as never;
    api.delete = (() => {
      const sub: Record<string, (...args: never[]) => unknown> = {};
      const delFilters: Array<(r: Row) => boolean> = [];
      sub.eq = ((col: string, val: unknown) => {
        delFilters.push((r) => r[col] === val);
        return sub;
      }) as never;
      sub.in = ((col: string, vals: unknown[]) => {
        delFilters.push((r) => vals.includes(r[col]));
        return sub;
      }) as never;
      sub.select = ((_cols?: string) => {
        if (typeof _cols === "string") state.selectCols = _cols;
        return sub;
      }) as never;
      const run = () => {
        const victims = (tables[table] ?? []).filter((r) => delFilters.every((f) => f(r)));
        tables[table] = (tables[table] ?? []).filter((r) => !delFilters.every((f) => f(r)));
        if (table === "invoice_item_matches") {
          for (const m of victims) recompute(m.order_item_id as string);
        }
        if (table === "invoice_items") {
          // ON DELETE CASCADE hacia invoice_item_matches + trigger
          const ids = new Set(victims.map((v) => v.id));
          const orphans = (tables.invoice_item_matches ?? []).filter((m) => ids.has(m.invoice_item_id));
          tables.invoice_item_matches = (tables.invoice_item_matches ?? []).filter((m) => !ids.has(m.invoice_item_id));
          for (const m of orphans) recompute(m.order_item_id as string);
        }
        return victims.map((v) => pick(v, state.selectCols));
      };
      (sub as { then: unknown }).then = (
        onF: (v: { data: Row[]; error: null }) => unknown,
        onR?: (e: unknown) => unknown
      ) => Promise.resolve({ data: run(), error: null }).then(onF, onR);
      sub.maybeSingle = (async () => {
        const vs = run();
        return { data: vs.length ? vs[0] : null, error: null };
      }) as never;
      return sub;
    }) as never;
    // terminal await directo (p. ej. await ...update(...).eq(...))
    (api as { then: unknown }).then = (
      onF: (v: { data: Row[]; error: null }) => unknown,
      onR?: (e: unknown) => unknown
    ) => {
      const rs = rows();
      if (state.head) return Promise.resolve({ data: [], count: rs.length, error: null }).then(onF as never, onR as never);
      return Promise.resolve({ data: rs.map((r) => pick(r, state.selectCols)), error: null }).then(onF as never, onR as never);
    };
    return api;
  }

  const storageStub = { from: () => ({ upload: async () => ({ error: null }), remove: async () => ({}) }) };
  const client = { from: (t: string) => query(t), storage: storageStub, rpc: async () => ({ data: null, error: null }) };
  return { client, tables };
}

const mocks = vi.hoisted(() => ({ requireProfile: vi.fn(), requireEmpresaId: vi.fn(), db: null as null | ReturnType<typeof makeDb> }));

vi.mock("@/lib/auth", () => ({ requireProfile: mocks.requireProfile, requireEmpresaId: mocks.requireEmpresaId }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mocks.db!.client }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mocks.db!.client }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => ({})) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/procurement/flywheel", () => ({ recordCostObservationFromInvoice: vi.fn(async () => ({})) }));

import { linkInvoiceToOrder } from "@/app/(internal)/invoices/actions";
import {
  createInvoiceItemMatch,
  deleteInvoiceItemMatch,
  deleteInvoiceItem,
  unmatchOrder,
  deleteInvoice,
  updateInvoiceItem,
} from "@/app/(internal)/invoices/[id]/actions";

const INV = UID(1);
const OC = UID(2);
const IL1 = UID(3);
const OL1 = UID(4);

function seedBase() {
  return {
    invoices: [{ id: INV, empresa_id: TENANT, provider_id: UID(9), status: "PENDIENTE", total: 3500000 }],
    invoice_items: [{ id: IL1, invoice_id: INV, empresa_id: TENANT, product_description: "Ladrillo común", quantity: 2500, unit: "un", unit_price: 1400, subtotal: 3500000, sort_order: 0 }],
    authorized_orders: [{ id: OC, empresa_id: TENANT, total_price: 4200000, facturado_amount: 0 }],
    authorized_order_items: [{ id: OL1, order_id: OC, empresa_id: TENANT, product: "Ladrillo común", quantity: 3000, unit: "un", unit_price: 1400, total_price: 4200000, quantity_invoiced: 0, sort_order: 0 }],
    invoice_order_matches: [],
    invoice_item_matches: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireProfile.mockResolvedValue({ id: "user-1", empresa_id: TENANT });
  mocks.requireEmpresaId.mockResolvedValue(TENANT);
  mocks.db = makeDb(seedBase());
});

describe("BUG-038: vínculo crea imputación inequívoca y el trigger recalcula", () => {
  it("OC 3000 + factura 2500 → Facturado 2500, pendiente 500", async () => {
    const result = await linkInvoiceToOrder(INV, OC);
    expect(result.error).toBeNull();
    expect(result.itemMatched).toBe(1);
    expect(result.itemPending).toBe(0);
    const ol = mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!;
    expect(ol.quantity_invoiced).toBe(2500);
    expect(Number(ol.quantity) - Number(ol.quantity_invoiced)).toBe(500);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(1);
    expect(mocks.db!.tables.invoice_item_matches[0].quantity_matched).toBe(2500);
  });

  it("dos parciales acumulan: 1000 + 1500 = 2500 sin duplicar", async () => {
    mocks.db!.tables.invoice_items.push(
      { id: UID(5), invoice_id: INV, empresa_id: TENANT, product_description: "Ladrillo común", quantity: 1000, unit: "un", unit_price: 1400, subtotal: 1400000, sort_order: 1 },
    );
    // primera línea ya imputada manualmente
    const first = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 2500 });
    expect(first.error).toBeNull();
    // segunda línea distinta → segundo match (mismo par línea-OC distinto)
    const second = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: UID(5), orderItemId: OL1, quantity: 1000 });
    expect(second.error).toBeNull();
    const ol = mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!;
    expect(ol.quantity_invoiced).toBe(3500);
  });

  it("match repetido no duplica cantidades", async () => {
    await linkInvoiceToOrder(INV, OC);
    // la misma imputación otra vez por vía manual debe rechazarse
    const dup = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 2500 });
    expect(dup.error).toContain("ya está imputada");
    const ol = mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!;
    expect(ol.quantity_invoiced).toBe(2500);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(1);
  });
});

describe("BUG-038: casos que quedan sin conciliar (no se inventa)", () => {
  it("factura sin líneas verificables queda sin conciliar y sin error", async () => {
    mocks.db!.tables.invoice_items = [];
    const result = await linkInvoiceToOrder(INV, OC);
    expect(result.error).toBeNull();
    expect(result.itemMatched).toBe(0);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
  });

  it("unidad incompatible no confirma match", async () => {
    mocks.db!.tables.invoice_items = [
      { id: IL1, invoice_id: INV, empresa_id: TENANT, product_description: "Ladrillo común", quantity: 2500, unit: "kg", sort_order: 0 },
    ];
    const result = await linkInvoiceToOrder(INV, OC);
    expect(result.error).toBeNull();
    expect(result.itemMatched).toBe(0);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("cantidad superior al remanente no se imputa sola (alerta: queda pendiente)", async () => {
    mocks.db!.tables.invoice_items = [
      { id: IL1, invoice_id: INV, empresa_id: TENANT, product_description: "Ladrillo común", quantity: 5000, unit: "un", sort_order: 0 },
    ];
    const result = await linkInvoiceToOrder(INV, OC);
    expect(result.error).toBeNull();
    expect(result.itemMatched).toBe(0);
    expect(result.itemPending).toBeGreaterThan(0);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
  });

  it("producto ajeno a la OC se rechaza en imputación manual", async () => {
    const result = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 100 });
    // sanity: el caso válido pasa; ahora con producto ajeno:
    expect(result.error).toBeNull();
    await deleteInvoiceItemMatch(mocks.db!.tables.invoice_item_matches[0].id as string, INV);
    mocks.db!.tables.invoice_items = [
      { id: IL1, invoice_id: INV, empresa_id: TENANT, product_description: "Cemento Portland", quantity: 100, unit: "m³", sort_order: 0 },
    ];
    mocks.db!.tables.authorized_order_items.push(
      { id: UID(6), order_id: OC, empresa_id: TENANT, product: "Arena lavada", quantity: 5, unit: "m³", quantity_invoiced: 0, sort_order: 1 },
    );
    const bad = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: UID(6), quantity: 5 });
    expect(bad.error).toContain("no corresponde");
  });

  it("factura de otra empresa se rechaza", async () => {
    mocks.requireProfile.mockResolvedValue({ id: "user-1", empresa_id: OTHER_TENANT });
    const result = await linkInvoiceToOrder(INV, OC);
    expect(result.error).toBe("Factura no encontrada.");
    const manual = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 10 });
    expect(manual.error).toBe("Factura no encontrada.");
  });
});

describe("BUG-038: desvinculación, eliminación y factura pagada", () => {
  it("desvinculación válida recalcula sin residuos", async () => {
    await linkInvoiceToOrder(INV, OC);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(2500);
    const matchId = mocks.db!.tables.invoice_order_matches[0].id as string;
    const result = await unmatchOrder(INV, matchId, OC);
    expect(result.error).toBeNull();
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
  });

  it("eliminación permitida no deja cantidades fantasma", async () => {
    await linkInvoiceToOrder(INV, OC);
    const result = await deleteInvoice(INV);
    expect(result.error).toBeNull();
    expect(mocks.db!.tables.invoice_items).toHaveLength(0);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
  });

  it("factura pagada preserva integridad (sin mutaciones de ítems)", async () => {
    mocks.db!.tables.invoices[0].status = "PAGADO";
    expect((await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 10 })).error).toContain("congelada");
    expect((await deleteInvoiceItem(IL1)).error).toContain("congeladas");
    expect((await updateInvoiceItem(IL1, { description: "X" })).error).toContain("congeladas");
    expect((await deleteInvoice(INV)).error).toContain("pagada");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("auto-match no toca facturas aprobadas aunque el vínculo exista", async () => {
    const { applyDeterministicItemMatches } = await import("@/lib/invoice-items");
    mocks.db!.tables.invoices[0].status = "APTO_PARA_PAGO";
    const result = await applyDeterministicItemMatches(mocks.db!.client as never, {
      empresaId: TENANT,
      invoiceId: INV,
      orderId: OC,
    });
    expect(result.error).toBeNull();
    expect(result.applied).toHaveLength(0);
    expect(result.pending).toBe(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("corregir una línea la devuelve a sin conciliar (baja+alta)", async () => {
    await linkInvoiceToOrder(INV, OC);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(2500);
    const corrected = await updateInvoiceItem(IL1, { description: "Ladrillo común", quantity: 2000, unit: "un" });
    expect(corrected.error).toBeNull();
    // el match anterior murió por CASCADE y el trigger recalculó a 0
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });
});
