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
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
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
        if (table === "invoices") {
          // DB ON DELETE CASCADE conserva la limpieza integral de hard delete.
          const ids = new Set(victims.map((v) => v.id));
          const lineIds = new Set((tables.invoice_items ?? []).filter((l) => ids.has(l.invoice_id)).map((l) => l.id));
          const orphans = (tables.invoice_item_matches ?? []).filter((m) => lineIds.has(m.invoice_item_id));
          tables.invoice_item_matches = (tables.invoice_item_matches ?? []).filter((m) => !lineIds.has(m.invoice_item_id));
          tables.invoice_items = (tables.invoice_items ?? []).filter((l) => !ids.has(l.invoice_id));
          tables.invoice_order_matches = (tables.invoice_order_matches ?? []).filter((m) => !ids.has(m.invoice_id));
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
  const client = {
    from: (t: string) => query(t),
    storage: storageStub,
    rpc: async (name: string, args: Record<string, unknown> = {}) => {
      rpcCalls.push({ name, args: { ...args } });
      const fail = (message: string) => ({ data: null, error: { message, code: "P0001" } });
      if (name === "delete_invoice") {
        const invoice = (tables.invoices ?? []).find((i) => i.id === args.p_invoice_id && i.empresa_id === args.p_empresa_id);
        if (!invoice) return fail("Factura no encontrada o no pertenece a esta empresa");
        if (["APTO_PARA_PAGO", "PAGADO"].includes(String(invoice.status))) return fail("No se puede eliminar una factura aprobada o pagada");
        const invoiceId = invoice.id;
        const attachmentId = invoice.attachment_id ?? null;
        tables.invoice_exceptions = (tables.invoice_exceptions ?? []).filter((r) => r.invoice_id !== invoiceId);
        tables.audit_logs = (tables.audit_logs ?? []).filter((r) => r.invoice_id !== invoiceId);
        tables.payment_order_invoices = (tables.payment_order_invoices ?? []).filter((r) => r.invoice_id !== invoiceId);
        const lineIds = new Set((tables.invoice_items ?? []).filter((l) => l.invoice_id === invoiceId).map((l) => l.id));
        const removed = (tables.invoice_item_matches ?? []).filter((m) => lineIds.has(m.invoice_item_id));
        tables.invoice_item_matches = (tables.invoice_item_matches ?? []).filter((m) => !lineIds.has(m.invoice_item_id));
        tables.invoice_items = (tables.invoice_items ?? []).filter((l) => l.invoice_id !== invoiceId);
        tables.invoice_order_matches = (tables.invoice_order_matches ?? []).filter((m) => m.invoice_id !== invoiceId);
        tables.invoices = (tables.invoices ?? []).filter((i) => i.id !== invoiceId);
        for (const m of removed) recompute(m.order_item_id as string);
        return { data: { ok: true, attachment_id: attachmentId }, error: null };
      }
      if (name === "create_invoice_item_match") {
        const invoice = (tables.invoices ?? []).find((i) => i.id === args.p_invoice_id && i.empresa_id === args.p_empresa_id);
        if (!invoice) return fail("Factura no encontrada o tenant incorrecto");
        if (!["PENDIENTE", "MATCH", "REQUIERE_REVISION"].includes(String(invoice.status))) return fail("factura congelada");
        const link = (tables.invoice_order_matches ?? []).find((m) => m.invoice_id === args.p_invoice_id && m.empresa_id === args.p_empresa_id);
        if (!link || link.authorized_order_id !== args.p_expected_order_id) return fail("El vínculo cambió o no corresponde a la OC esperada");
        const line = (tables.invoice_items ?? []).find((l) => l.id === args.p_invoice_item_id && l.invoice_id === args.p_invoice_id && l.empresa_id === args.p_empresa_id);
        if (!line) return fail("La línea no pertenece a esta factura");
        const order = (tables.authorized_order_items ?? []).find((o) => o.id === args.p_order_item_id && o.order_id === args.p_expected_order_id && o.empresa_id === args.p_empresa_id);
        if (!order) return fail("El ítem no pertenece a la OC esperada");
        const duplicate = (tables.invoice_item_matches ?? []).find((m) => m.invoice_item_id === line.id && m.order_item_id === order.id);
        if (duplicate) {
          if (Number(duplicate.quantity_matched) === Number(args.p_quantity)) return { data: { ok: true, match_id: duplicate.id, duplicate: true }, error: null };
          return fail("ya está imputada con otra cantidad");
        }
        const qty = Number(args.p_quantity);
        if (!Number.isFinite(qty) || qty <= 0) return fail("cantidad debe ser mayor a cero");
        const lineMatched = (tables.invoice_item_matches ?? []).filter((m) => m.invoice_item_id === line.id).reduce((s, m) => s + Number(m.quantity_matched), 0);
        if (line.quantity == null || lineMatched + qty > Number(line.quantity) + 1e-9) return fail("supera cantidad documentada");
        const orderMatched = (tables.invoice_item_matches ?? []).filter((m) => m.order_item_id === order.id).reduce((s, m) => s + Number(m.quantity_matched), 0);
        if (orderMatched + qty > Number(order.quantity) + 1e-9) return fail("supera remanente de la OC");
        const aliases = (u: unknown) => String(u ?? "").trim().toLowerCase().replace(/unidades?/g, "un").replace(/^u$/, "un");
        if (!aliases(line.unit) || aliases(line.unit) !== aliases(order.unit)) return fail("unidad incompatible");
        const single = (tables.invoice_items ?? []).filter((l) => l.invoice_id === args.p_invoice_id).length === 1 && (tables.authorized_order_items ?? []).filter((o) => o.order_id === args.p_expected_order_id).length === 1;
        const normalize = (v: unknown) => String(v ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
        const ld = normalize(line.product_description), od = normalize(order.product);
        if (!single && !(ld === od || ld.includes(od) || od.includes(ld))) return fail("producto no corresponde");
        const id = UID(++seq);
        const match = { id, invoice_item_id: line.id, order_item_id: order.id, empresa_id: args.p_empresa_id, quantity_matched: qty };
        tables.invoice_item_matches = [...(tables.invoice_item_matches ?? []), match];
        recompute(order.id as string);
        return { data: { ok: true, match_id: id, duplicate: false }, error: null };
      }
      if (name === "correct_invoice_item") {
        const line = (tables.invoice_items ?? []).find((l) => l.id === args.p_invoice_item_id && l.empresa_id === args.p_empresa_id);
        if (!line) return fail("Línea no encontrada");
        const invoice = (tables.invoices ?? []).find((i) => i.id === line.invoice_id);
        if (!invoice || !["PENDIENTE", "MATCH", "REQUIERE_REVISION"].includes(String(invoice.status))) return fail("factura congelada");
        const matched = (tables.invoice_item_matches ?? []).filter((m) => m.invoice_item_id === line.id);
        const total = matched.reduce((s, m) => s + Number(m.quantity_matched), 0);
        if (args.p_quantity == null && matched.length) return fail("cantidad no documentada requiere quitar imputaciones");
        if (args.p_quantity != null && total > Number(args.p_quantity) + 1e-9) return fail("corrección dejaría línea sobre-imputada");
        Object.assign(line, { product_description: args.p_description, quantity: args.p_quantity, unit: args.p_unit, unit_price: args.p_unit_price, subtotal: args.p_subtotal });
        for (const m of matched) {
          const order = (tables.authorized_order_items ?? []).find((o) => o.id === m.order_item_id);
          if (order && (String(line.unit).toLowerCase() !== String(order.unit).toLowerCase() || !String(line.product_description).toLowerCase().includes(String(order.product).toLowerCase()))) {
            tables.invoice_item_matches = (tables.invoice_item_matches ?? []).filter((x) => x.id !== m.id);
            recompute(order.id as string);
          }
        }
        return { data: { ok: true, item_id: line.id }, error: null };
      }
      if (name === "unmatch_invoice_order") {
        const link = (tables.invoice_order_matches ?? []).find((m) => m.invoice_id === args.p_invoice_id && m.id === args.p_expected_match_id && m.authorized_order_id === args.p_expected_order_id && m.empresa_id === args.p_empresa_id);
        if (!link) return fail("El vínculo no existe o cambió");
        const lineIds = new Set((tables.invoice_items ?? []).filter((l) => l.invoice_id === args.p_invoice_id && l.empresa_id === args.p_empresa_id).map((l) => l.id));
        const orderIds = new Set((tables.authorized_order_items ?? []).filter((o) => o.order_id === args.p_expected_order_id && o.empresa_id === args.p_empresa_id).map((o) => o.id));
        const victims = (tables.invoice_item_matches ?? []).filter((m) => lineIds.has(m.invoice_item_id) && orderIds.has(m.order_item_id));
        tables.invoice_item_matches = (tables.invoice_item_matches ?? []).filter((m) => !victims.includes(m));
        for (const m of victims) recompute(m.order_item_id as string);
        tables.invoice_order_matches = (tables.invoice_order_matches ?? []).filter((m) => m !== link);
        return { data: { ok: true }, error: null };
      }
      if (name === "delete_invoice_item") {
        const line = (tables.invoice_items ?? []).find((l) => l.id === args.p_invoice_item_id && l.invoice_id === args.p_invoice_id && l.empresa_id === args.p_empresa_id);
        if (!line) return fail("Línea no encontrada");
        const invoice = (tables.invoices ?? []).find((i) => i.id === args.p_invoice_id);
        if (!invoice || !["PENDIENTE", "MATCH", "REQUIERE_REVISION"].includes(String(invoice.status))) return fail("factura congelada");
        const removed = (tables.invoice_item_matches ?? []).filter((m) => m.invoice_item_id === line.id);
        tables.invoice_item_matches = (tables.invoice_item_matches ?? []).filter((m) => m.invoice_item_id !== line.id);
        tables.invoice_items = (tables.invoice_items ?? []).filter((l) => l.id !== line.id);
        for (const m of removed) recompute(m.order_item_id as string);
        return { data: { ok: true }, error: null };
      }
      if (name === "delete_invoice_item_match") {
        const match = (tables.invoice_item_matches ?? []).find((m) => m.id === args.p_invoice_item_match_id);
        const line = (tables.invoice_items ?? []).find((l) => l.id === match?.invoice_item_id && l.invoice_id === args.p_invoice_id && l.empresa_id === args.p_empresa_id);
        if (!match || !line) return fail("Imputación no encontrada");
        const invoice = (tables.invoices ?? []).find((i) => i.id === args.p_invoice_id);
        if (!invoice || !["PENDIENTE", "MATCH", "REQUIERE_REVISION"].includes(String(invoice.status))) return fail("factura congelada");
        tables.invoice_item_matches = (tables.invoice_item_matches ?? []).filter((m) => m.id !== match.id);
        recompute(match.order_item_id as string);
        return { data: { ok: true }, error: null };
      }
      return { data: null, error: null };
    },
  };
  return { client, tables, rpcCalls };
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
import { insertValidatedItemMatches } from "@/lib/invoice-items";
import { resolveInvoiceJob, retryInvoiceJob } from "@/app/(internal)/invoices/revision/actions";

const INV = UID(1);
const INV2 = UID(12);
const OC = UID(2);
const OC_B = UID(7);
const IL1 = UID(3);
const IL2 = UID(11);
const OL1 = UID(4);
const OL_B1 = UID(8);

function seedBase() {
  return {
    invoices: [
      { id: INV, empresa_id: TENANT, provider_id: UID(9), status: "PENDIENTE", total: 3500000 },
      { id: INV2, empresa_id: TENANT, provider_id: UID(9), status: "PENDIENTE", total: 3500000 },
    ],
    invoice_items: [
      { id: IL1, invoice_id: INV, empresa_id: TENANT, product_description: "Ladrillo común", quantity: 2500, unit: "un", unit_price: 1400, subtotal: 3500000, sort_order: 0 },
      { id: IL2, invoice_id: INV2, empresa_id: TENANT, product_description: "Ladrillo común", quantity: 2500, unit: "un", unit_price: 1400, subtotal: 3500000, sort_order: 0 },
    ],
    authorized_orders: [
      { id: OC, empresa_id: TENANT, total_price: 4200000, facturado_amount: 0 },
      { id: OC_B, empresa_id: TENANT, total_price: 1000000, facturado_amount: 0 },
    ],
    authorized_order_items: [
      { id: OL1, order_id: OC, empresa_id: TENANT, product: "Ladrillo común", quantity: 3000, unit: "un", unit_price: 1400, total_price: 4200000, quantity_invoiced: 0, sort_order: 0 },
      { id: OL_B1, order_id: OC_B, empresa_id: TENANT, product: "Ladrillo común", quantity: 700, unit: "un", unit_price: 1400, total_price: 980000, quantity_invoiced: 0, sort_order: 0 },
    ],
    // INV ya vinculada a OC (flujo manual); INV2 fresca para probar el vínculo.
    invoice_order_matches: [{ id: UID(10), invoice_id: INV, authorized_order_id: OC, empresa_id: TENANT }],
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
    const result = await linkInvoiceToOrder(INV2, OC);
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
    // usar una segunda factura vinculada a la misma OC para el segundo parcial
    mocks.db!.tables.invoices.push(
      { id: UID(20), empresa_id: TENANT, provider_id: UID(9), status: "PENDIENTE", total: 1400000 },
    );
    mocks.db!.tables.invoice_items.push(
      { id: UID(21), invoice_id: UID(20), empresa_id: TENANT, product_description: "Ladrillo común", quantity: 1500, unit: "un", unit_price: 1400, subtotal: 2100000, sort_order: 0 },
    );
    mocks.db!.tables.invoice_order_matches.push(
      { id: UID(22), invoice_id: UID(20), authorized_order_id: OC, empresa_id: TENANT },
    );
    mocks.db!.tables.invoice_items = mocks.db!.tables.invoice_items.map((l) =>
      l.id === IL1 ? { ...l, quantity: 1000, subtotal: 1400000 } : l
    );
    const first = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 1000 });
    expect(first.error).toBeNull();
    const second = await createInvoiceItemMatch({ invoiceId: UID(20), invoiceItemId: UID(21), orderItemId: OL1, quantity: 1500 });
    expect(second.error).toBeNull();
    const ol = mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!;
    expect(ol.quantity_invoiced).toBe(2500);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(2);
  });

  it("match repetido no duplica cantidades", async () => {
    await linkInvoiceToOrder(INV2, OC);
    // la misma imputación otra vez por vía manual debe rechazarse
    const dup = await createInvoiceItemMatch({ invoiceId: INV2, invoiceItemId: IL2, orderItemId: OL1, quantity: 2500 });
    expect(dup.error).toContain("ya está imputada");
    const ol = mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!;
    expect(ol.quantity_invoiced).toBe(2500);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(1);
  });
});

describe("BUG-038: casos que quedan sin conciliar (no se inventa)", () => {
  it("factura sin líneas verificables queda sin conciliar y sin error", async () => {
    mocks.db!.tables.invoice_items = mocks.db!.tables.invoice_items.filter((l) => l.invoice_id !== INV2);
    const result = await linkInvoiceToOrder(INV2, OC);
    expect(result.error).toBeNull();
    expect(result.itemMatched).toBe(0);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
  });

  it("unidad incompatible no confirma match", async () => {
    mocks.db!.tables.invoice_items = mocks.db!.tables.invoice_items.map((l) =>
      l.id === IL2 ? { ...l, unit: "kg" } : l
    );
    const result = await linkInvoiceToOrder(INV2, OC);
    expect(result.error).toBeNull();
    expect(result.itemMatched).toBe(0);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("cantidad superior al remanente no se contabiliza (queda pendiente)", async () => {
    mocks.db!.tables.invoice_items = mocks.db!.tables.invoice_items.map((l) =>
      l.id === IL2 ? { ...l, quantity: 5000, subtotal: 7000000 } : l
    );
    const result = await linkInvoiceToOrder(INV2, OC);
    expect(result.error).toBeNull();
    expect(result.itemMatched).toBe(0);
    expect(result.itemPending).toBeGreaterThan(0);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
  });

  it("imputación manual que supera el remanente se rechaza (R3-02 regla B)", async () => {
    // Línea documentada por 3500, remanente de OC 3000: 3500 > 3000.
    mocks.db!.tables.invoice_items = mocks.db!.tables.invoice_items.map((l) =>
      l.id === IL1 ? { ...l, quantity: 3500, subtotal: 4900000 } : l
    );
    const result = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 3500 });
    expect(result.error).toContain("remanente");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
  });

  it("imputación manual que supera lo documentado se rechaza (R3-02 regla A)", async () => {
    const result = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 2501 });
    expect(result.error).toContain("documentada");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("producto ajeno a la OC se rechaza en imputación manual", async () => {
    const result = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 100 });
    // sanity: el caso válido pasa; ahora con producto ajeno:
    expect(result.error).toBeNull();
    const matchId = mocks.db!.tables.invoice_item_matches[0].id as string;
    await deleteInvoiceItemMatch(matchId, INV);
    expect(mocks.db!.rpcCalls.at(-1)).toEqual({
      name: "delete_invoice_item_match",
      args: { p_empresa_id: TENANT, p_invoice_id: INV, p_invoice_item_match_id: matchId },
    });
    mocks.db!.tables.invoice_items = mocks.db!.tables.invoice_items.map((l) =>
      l.id === IL1 ? { ...l, product_description: "Cemento Portland", unit: "m³" } : l
    );
    mocks.db!.tables.authorized_order_items.push(
      { id: UID(6), order_id: OC, empresa_id: TENANT, product: "Arena lavada", quantity: 5, unit: "m³", quantity_invoiced: 0, sort_order: 1 },
    );
    const bad = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: UID(6), quantity: 5 });
    expect(bad.error).toContain("no corresponde");
  });

  it("factura de otra empresa se rechaza", async () => {
    mocks.requireProfile.mockResolvedValue({ id: "user-1", empresa_id: OTHER_TENANT });
    const result = await linkInvoiceToOrder(INV2, OC);
    expect(result.error).toBe("Factura no encontrada.");
    const manual = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 10 });
    expect(manual.error).toBe("Factura no encontrada.");
  });
});

describe("BUG-038: desvinculación, eliminación y factura pagada", () => {
  it("desvinculación válida recalcula sin residuos", async () => {
    await linkInvoiceToOrder(INV2, OC);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(2500);
    const matchId = mocks.db!.tables.invoice_order_matches.find((m) => m.invoice_id === INV2)!.id as string;
    const result = await unmatchOrder(INV2, matchId, OC);
    expect(result.error).toBeNull();
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
  });

  it("eliminación permitida no deja cantidades fantasma", async () => {
    await linkInvoiceToOrder(INV2, OC);
    const result = await deleteInvoice(INV2);
    expect(result.error).toBeNull();
    expect(mocks.db!.tables.invoice_items.filter((l) => l.invoice_id === INV2)).toHaveLength(0);
    // la línea de INV (otra factura) sigue intacta
    expect(mocks.db!.tables.invoice_items.some((l) => l.id === IL1)).toBe(true);
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

  it("corregir una línea la revalida: si sigue inequívoca, se re-imputa (R3-03)", async () => {
    await linkInvoiceToOrder(INV2, OC);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(2500);
    const corrected = await updateInvoiceItem(IL2, { description: "Ladrillo común segunda entrega", quantity: 2500, unit: "un" });
    expect(corrected.error).toBeNull();
    expect(corrected.id).toBe(IL2);
    // La RPC corrige in-place y conserva la identidad del ítem.
    expect(mocks.db!.tables.invoice_items.find((l) => l.id === IL2)?.quantity).toBe(2500);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(2500);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(1);
    expect(mocks.db!.tables.invoice_item_matches[0].quantity_matched).toBe(2500);
  });

  it("corregir invalidando la conciliación la deja sin conciliar (sin pérdida)", async () => {
    await linkInvoiceToOrder(INV2, OC);
    // Unidad incompatible: la corrección aplica pero ya no corresponde a la OC.
    const corrected = await updateInvoiceItem(IL2, { description: "Ladrillo común", quantity: 2500, unit: "kg" });
    expect(corrected.error).toBeNull();
    expect(mocks.db!.tables.invoice_items.some((l) => l.id === IL2)).toBe(true);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });
});

describe("R3-01: imputación solo a la OC vinculada (backend, no solo UI)", () => {
  it("factura vinculada a OC-A no puede imputar a OC-B del mismo tenant", async () => {
    const result = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL_B1, quantity: 700 });
    expect(result.error).toContain("OC");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL_B1)!.quantity_invoiced).toBe(0);
  });

  it("ítem de OC de otra empresa se rechaza", async () => {
    mocks.db!.tables.authorized_order_items.push(
      { id: UID(13), order_id: OC_B, empresa_id: OTHER_TENANT, product: "Ladrillo común", quantity: 100, unit: "un", quantity_invoiced: 0, sort_order: 2 },
    );
    const result = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: UID(13), quantity: 100 });
    expect(result.error).toContain("empresa");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("factura sin OC vinculada no admite imputación", async () => {
    mocks.db!.tables.invoice_order_matches = [];
    const result = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 100 });
    expect(result.error).toContain("no tiene una OC vinculada");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("factura con vínculo eliminado no admite imputación", async () => {
    const matchId = mocks.db!.tables.invoice_order_matches[0].id as string;
    await unmatchOrder(INV, matchId, OC);
    const result = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 100 });
    expect(result.error).toContain("no tiene una OC vinculada");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("línea de otra factura se rechaza", async () => {
    mocks.db!.tables.invoice_order_matches.push(
      { id: UID(31), invoice_id: INV2, authorized_order_id: OC, empresa_id: TENANT },
    );
    const result = await createInvoiceItemMatch({ invoiceId: INV2, invoiceItemId: IL1, orderItemId: OL1, quantity: 100 });
    expect(result.error).toContain("factura");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("línea inexistente se rechaza", async () => {
    const result = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: UID(99), orderItemId: OL1, quantity: 100 });
    expect(result.error).toContain("factura");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("error consultando el vínculo falla cerrado (sin escritura)", async () => {
    const origFrom = mocks.db!.client.from.bind(mocks.db!.client);
    mocks.db!.client.from = ((table: string) => {
      const q = origFrom(table) as Record<string, (...args: never[]) => unknown>;
      if (table === "invoice_order_matches") {
        const origMaybeSingle = q.maybeSingle as () => Promise<unknown>;
        void origMaybeSingle;
        q.maybeSingle = (async () => ({ data: null, error: { message: "boom", code: "XX000" } })) as never;
      }
      return q;
    }) as never;
    try {
      const result = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 100 });
      expect(result.error).toContain("Intentá nuevamente");
      expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    } finally {
      mocks.db!.client.from = origFrom as never;
    }
  });

  it("la RPC vuelve a comprobar el vínculo esperado antes de insertar", async () => {
    const origRpc = mocks.db!.client.rpc;
    mocks.db!.client.rpc = (async (name: string, args: Record<string, unknown>) => {
      if (name === "create_invoice_item_match") {
        mocks.db!.tables.invoice_order_matches = mocks.db!.tables.invoice_order_matches.filter((m) => m.invoice_id !== INV);
      }
      return origRpc(name, args);
    }) as never;
    try {
      const result = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 100 });
      expect(result.error).toContain("vínculo");
      expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
      expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
    } finally {
      mocks.db!.client.rpc = origRpc;
    }
  });
});

describe("R3-02: integridad de cantidades a nivel acción", () => {
  it("cantidad exacta documentada se acepta", async () => {
    expect((await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 2500 })).error).toBeNull();
  });

  it("cantidad menor se acepta", async () => {
    expect((await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 1000 })).error).toBeNull();
  });

  it("cantidad mayor a la documentada se rechaza", async () => {
    const r = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 2501 });
    expect(r.error).toContain("documentada");
  });

  it("negativa, cero y NaN se rechazan", async () => {
    for (const q of [-5, 0, NaN]) {
      const r = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: q });
      expect(r.error).toContain("mayor a cero");
    }
  });

  it("fracción finita válida se acepta (numeric, sin regla de enteros)", async () => {
    mocks.db!.tables.invoice_items = mocks.db!.tables.invoice_items.map((l) =>
      l.id === IL1 ? { ...l, quantity: 2500.5, subtotal: 3500700 } : l
    );
    const r = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 2500.5 });
    expect(r.error).toBeNull();
  });

  it("dos matches de una línea limitados por su suma documentada", async () => {
    // Misma línea IL1 hacia dos ítems de OC distintos: 1000 + 1500 = 2500 OK;
    // 1000 + 1600 = 2600 > 2500 se rechaza.
    mocks.db!.tables.authorized_order_items.push(
      { id: UID(6), order_id: OC, empresa_id: TENANT, product: "Ladrillo común segunda entrega", quantity: 3000, unit: "un", quantity_invoiced: 0, sort_order: 1 },
    );
    const first = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 1000 });
    expect(first.error).toBeNull();
    const over = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: UID(6), quantity: 1600 });
    expect(over.error).toContain("documentada");
    const ok = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: UID(6), quantity: 1500 });
    expect(ok.error).toBeNull();
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(1000);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === UID(6))!.quantity_invoiced).toBe(1500);
  });

  it("dos facturas compiten por el remanente: la segunda excedida se rechaza", async () => {
    mocks.db!.tables.invoice_items = mocks.db!.tables.invoice_items.map((l) =>
      l.id === IL1 ? { ...l, quantity: 2000, subtotal: 2800000 } : l
    );
    expect((await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 2000 })).error).toBeNull();
    // INV2 vinculada a la misma OC intenta 1500 con remanente 1000.
    mocks.db!.tables.invoice_order_matches.push(
      { id: UID(30), invoice_id: INV2, authorized_order_id: OC, empresa_id: TENANT },
    );
    const loser = await createInvoiceItemMatch({ invoiceId: INV2, invoiceItemId: IL2, orderItemId: OL1, quantity: 1500 });
    expect(loser.error).toContain("remanente");
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(2000);
    // Con cantidad dentro del remanente sí pasa.
    mocks.db!.tables.invoice_items = mocks.db!.tables.invoice_items.map((l) =>
      l.id === IL2 ? { ...l, quantity: 1000, subtotal: 1400000 } : l
    );
    expect((await createInvoiceItemMatch({ invoiceId: INV2, invoiceItemId: IL2, orderItemId: OL1, quantity: 1000 })).error).toBeNull();
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(3000);
  });

  it("reintento idéntico no duplica (error fail-closed, cantidad intacta)", async () => {
    expect((await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 2500 })).error).toBeNull();
    const retry = await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 2500 });
    expect(retry.error).toContain("ya está imputada");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(1);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(2500);
  });

  it("factura APTO_PARA_PAGO congela la conciliación", async () => {
    mocks.db!.tables.invoices.find((i) => i.id === INV)!.status = "APTO_PARA_PAGO";
    expect((await createInvoiceItemMatch({ invoiceId: INV, invoiceItemId: IL1, orderItemId: OL1, quantity: 10 })).error).toContain("congelada");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });
});

describe("H3: corrección transaccional de líneas", () => {
  it("preserva ID y match cuando la corrección sigue siendo compatible", async () => {
    await linkInvoiceToOrder(INV2, OC);
    const beforeId = mocks.db!.tables.invoice_items.find((l) => l.id === IL2)!.id;
    const result = await updateInvoiceItem(IL2, { description: "Ladrillo común segunda entrega", quantity: 2500, unit: "un" });
    expect(result.error).toBeNull();
    expect(result.id).toBe(beforeId);
    expect(mocks.db!.tables.invoice_items.find((l) => l.id === IL2)?.quantity).toBe(2500);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(1);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)?.quantity_invoiced).toBe(2500);
  });

  it("quita el match incompatible y recalcula la cantidad de OC", async () => {
    await linkInvoiceToOrder(INV2, OC);
    const result = await updateInvoiceItem(IL2, { description: "Ladrillo común", quantity: 2500, unit: "kg" });
    expect(result.error).toBeNull();
    expect(mocks.db!.tables.invoice_items.find((l) => l.id === IL2)?.unit).toBe("kg");
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)?.quantity_invoiced).toBe(0);
  });

  it("rechaza corrección que dejaría la línea sobre-imputada sin mutar nada", async () => {
    await linkInvoiceToOrder(INV2, OC);
    const result = await updateInvoiceItem(IL2, { description: "Ladrillo común", quantity: 1000, unit: "un" });
    expect(result.error).toContain("sobre-imputada");
    expect(mocks.db!.tables.invoice_items.find((l) => l.id === IL2)?.quantity).toBe(2500);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(1);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)?.quantity_invoiced).toBe(2500);
  });

  it("ante error SQL conserva línea y conciliación existentes", async () => {
    await linkInvoiceToOrder(INV2, OC);
    const original = mocks.db!.client.rpc;
    mocks.db!.client.rpc = (async (name: string, args: Record<string, unknown>) =>
      name === "correct_invoice_item" ? { data: null, error: { message: "DB caída", code: "XX000" } } : original(name, args)) as never;
    try {
      const result = await updateInvoiceItem(IL2, { description: "Ladrillo común segunda entrega", quantity: 2500, unit: "un" });
      expect(result.error).toContain("DB caída");
      expect(mocks.db!.tables.invoice_items.find((l) => l.id === IL2)?.quantity).toBe(2500);
      expect(mocks.db!.tables.invoice_item_matches).toHaveLength(1);
      expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)?.quantity_invoiced).toBe(2500);
    } finally {
      mocks.db!.client.rpc = original;
    }
  });

  it("factura aprobada congela la corrección", async () => {
    mocks.db!.tables.invoices.find((i) => i.id === INV2)!.status = "APTO_PARA_PAGO";
    const result = await updateInvoiceItem(IL2, { description: "Ladrillo común segunda entrega", quantity: 2500, unit: "un" });
    expect(result.error).toContain("congeladas");
    expect(mocks.db!.tables.invoice_items.find((l) => l.id === IL2)?.quantity).toBe(2500);
  });
});
describe("worker job recovery: evita facturas duplicadas", () => {
  const jobId = UID(90);

  beforeEach(() => {
    mocks.db!.tables.invoice_jobs = [{ id: jobId, empresa_id: TENANT, invoice_id: INV, status: "needs_review" }];
  });

  it("retryInvoiceJob no reencola un job que ya creó factura", async () => {
    const result = await retryInvoiceJob(jobId);
    expect(result.error).toContain("ya creó una factura");
    expect(mocks.db!.tables.invoice_jobs[0].status).toBe("needs_review");
  });

  it("resolveInvoiceJob no crea una segunda factura para el mismo job", async () => {
    const result = await resolveInvoiceJob(jobId, new FormData());
    expect(result.error).toContain("ya creó una factura");
    expect(result.invoiceId).toBe(INV);
    expect(mocks.db!.tables.invoices).toHaveLength(2);
  });
});

describe("H1: servicio compartido insertValidatedItemMatches (invariantes propias)", () => {
  const svc = (proposals: Array<{ invoiceItemId: string; orderItemId: string; quantityMatched: number }>, invoiceId = INV, orderId = OC) =>
    insertValidatedItemMatches(mocks.db!.client as never, {
      empresaId: TENANT,
      invoiceId,
      expectedOrderId: orderId,
      proposals,
    });

  it("H1-4: línea de otra factura (misma empresa) se omite aunque exista", async () => {
    const r = await svc([{ invoiceItemId: IL2, orderItemId: OL1, quantityMatched: 100 }]);
    expect(r.error).toBeNull();
    expect(r.applied).toHaveLength(0);
    expect(r.skippedNoLink).toBe(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("H1-2: línea de otra empresa se omite (filtro empresa_id, no confía en el id)", async () => {
    mocks.db!.tables.invoice_items.push(
      { id: UID(40), invoice_id: UID(41), empresa_id: OTHER_TENANT, product_description: "Ladrillo común", quantity: 100, unit: "un", sort_order: 0 },
    );
    const r = await svc([{ invoiceItemId: UID(40), orderItemId: OL1, quantityMatched: 100 }]);
    expect(r.error).toBeNull();
    expect(r.applied).toHaveLength(0);
    expect(r.skippedNoLink).toBe(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("H1-6: ítem de otra OC (misma empresa) se omite", async () => {
    const r = await svc([{ invoiceItemId: IL1, orderItemId: OL_B1, quantityMatched: 100 }]);
    expect(r.error).toBeNull();
    expect(r.applied).toHaveLength(0);
    expect(r.skippedNoLink).toBe(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL_B1)!.quantity_invoiced).toBe(0);
  });

  it("H1-5: sin vínculo de cabecera todo se omite (nada se contabiliza)", async () => {
    mocks.db!.tables.invoice_order_matches = [];
    const r = await svc([{ invoiceItemId: IL1, orderItemId: OL1, quantityMatched: 100 }]);
    expect(r.error).toBeNull();
    expect(r.applied).toHaveLength(0);
    expect(r.skippedNoLink).toBe(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("H1-3: factura aprobada congela el servicio (error fuerte, no skip silencioso)", async () => {
    mocks.db!.tables.invoices.find((i) => i.id === INV)!.status = "PAGADO";
    const r = await svc([{ invoiceItemId: IL1, orderItemId: OL1, quantityMatched: 100 }]);
    expect(r.error).toContain("congelada");
    expect(r.applied).toHaveLength(0);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("H1-1: factura sin vínculo falla cerrado (nada se contabiliza)", async () => {
    const r = await svc([{ invoiceItemId: IL1, orderItemId: OL1, quantityMatched: 100 }], UID(99));
    expect(r.error).toBeNull();
    expect(r.applied).toHaveLength(0);
    expect(r.skippedNoLink).toBe(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });

  it("H1-9a: línea parcialmente imputada acepta completar hasta lo documentado", async () => {
    mocks.db!.tables.authorized_order_items.push(
      { id: UID(51), order_id: OC, empresa_id: TENANT, product: "Ladrillo común", quantity: 5000, unit: "un", quantity_invoiced: 0, sort_order: 1 },
    );
    const first = await svc([{ invoiceItemId: IL1, orderItemId: OL1, quantityMatched: 1000 }]);
    expect(first.error).toBeNull();
    expect(first.applied).toHaveLength(1);
    // 1000 ya imputados + 1500 nuevos = 2500 documentados: se aplica.
    const second = await svc([{ invoiceItemId: IL1, orderItemId: UID(51), quantityMatched: 1500 }]);
    expect(second.error).toBeNull();
    expect(second.applied).toHaveLength(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(2);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(1000);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === UID(51))!.quantity_invoiced).toBe(1500);
  });

  it("H1-9b: matches previos persistidos + nueva propuesta respetan el tope documentado", async () => {
    mocks.db!.tables.authorized_order_items.push(
      { id: UID(51), order_id: OC, empresa_id: TENANT, product: "Ladrillo común", quantity: 9000, unit: "un", quantity_invoiced: 0, sort_order: 1 },
      { id: UID(52), order_id: OC, empresa_id: TENANT, product: "Ladrillo común", quantity: 9000, unit: "un", quantity_invoiced: 0, sort_order: 2 },
    );
    const first = await svc([{ invoiceItemId: IL1, orderItemId: UID(51), quantityMatched: 2000 }]);
    expect(first.error).toBeNull();
    expect(first.applied).toHaveLength(1);
    // 2000 previos + 1000 no caben, pero 500 sí (tope exacto 2500).
    const over = await svc([{ invoiceItemId: IL1, orderItemId: UID(52), quantityMatched: 1000 }]);
    expect(over.error).toBeNull();
    expect(over.applied).toHaveLength(0);
    expect(over.skippedOverDocumented).toBe(1);
    const exact = await svc([{ invoiceItemId: IL1, orderItemId: UID(52), quantityMatched: 500 }]);
    expect(exact.error).toBeNull();
    expect(exact.applied).toHaveLength(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(2);
  });

  it("H1-9c: segunda imputación que excede lo documentado se omite", async () => {
    mocks.db!.tables.authorized_order_items.push(
      { id: UID(51), order_id: OC, empresa_id: TENANT, product: "Ladrillo común", quantity: 9000, unit: "un", quantity_invoiced: 0, sort_order: 1 },
      { id: UID(52), order_id: OC, empresa_id: TENANT, product: "Ladrillo común", quantity: 9000, unit: "un", quantity_invoiced: 0, sort_order: 2 },
    );
    const first = await svc([{ invoiceItemId: IL1, orderItemId: UID(51), quantityMatched: 2000 }]);
    expect(first.error).toBeNull();
    expect(first.applied).toHaveLength(1);
    // 2000 previos + 600 nuevos = 2600 > 2500 documentados.
    const second = await svc([{ invoiceItemId: IL1, orderItemId: UID(52), quantityMatched: 600 }]);
    expect(second.error).toBeNull();
    expect(second.applied).toHaveLength(0);
    expect(second.skippedOverDocumented).toBe(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(1);
  });

  it("H1-batch: dos propuestas válidas en el mismo batch se aplican", async () => {
    mocks.db!.tables.invoice_items.push(
      { id: UID(53), invoice_id: INV, empresa_id: TENANT, product_description: "Ladrillo común segunda entrega", quantity: 800, unit: "un", sort_order: 1 },
    );
    const r = await svc([
      { invoiceItemId: IL1, orderItemId: OL1, quantityMatched: 1000 },
      { invoiceItemId: UID(53), orderItemId: OL1, quantityMatched: 800 },
    ]);
    expect(r.error).toBeNull();
    expect(r.applied).toHaveLength(2);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(2);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(1800);
  });

  it("H1-batch: dos propuestas cuya suma excede el documento aplican solo la primera", async () => {
    mocks.db!.tables.invoice_items.push(
      { id: UID(53), invoice_id: INV, empresa_id: TENANT, product_description: "Ladrillo común", quantity: 1000, unit: "un", sort_order: 1 },
    );
    mocks.db!.tables.authorized_order_items.push(
      { id: UID(54), order_id: OC, empresa_id: TENANT, product: "Ladrillo común", quantity: 9000, unit: "un", quantity_invoiced: 0, sort_order: 1 },
      { id: UID(55), order_id: OC, empresa_id: TENANT, product: "Ladrillo común", quantity: 9000, unit: "un", quantity_invoiced: 0, sort_order: 2 },
    );
    const r = await svc([
      { invoiceItemId: UID(53), orderItemId: UID(54), quantityMatched: 600 },
      { invoiceItemId: UID(53), orderItemId: UID(55), quantityMatched: 600 },
    ]);
    expect(r.error).toBeNull();
    expect(r.applied).toHaveLength(1);
    expect(r.skippedOverDocumented).toBe(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(1);
  });

  it("H1-10: error consultando matches previos falla cerrado (sin escritura)", async () => {
    const client = mocks.db!.client as unknown as { from: (t: string) => unknown };
    const origFrom = client.from.bind(client);
    client.from = ((table: string) => {
      if (table !== "invoice_item_matches") return origFrom(table);
      return {
        select: () => ({
          eq: () => ({
            in: async () => ({ data: null, error: { message: "DB caída", code: "XX000" } }),
          }),
        }),
      };
    }) as never;
    try {
      const r = await svc([{ invoiceItemId: IL1, orderItemId: OL1, quantityMatched: 100 }]);
      expect(r.error).toContain("ya imputado");
      expect(r.applied).toHaveLength(0);
      expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
      expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
    } finally {
      client.from = origFrom as never;
    }
  });

  it("H1-11: reintento idéntico no duplica", async () => {
    const first = await svc([{ invoiceItemId: IL1, orderItemId: OL1, quantityMatched: 2500 }]);
    expect(first.error).toBeNull();
    expect(first.applied).toHaveLength(1);
    const retry = await svc([{ invoiceItemId: IL1, orderItemId: OL1, quantityMatched: 2500 }]);
    expect(retry.error).toBeNull();
    expect(retry.applied).toHaveLength(0);
    expect(retry.skippedDuplicate).toBe(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(1);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(2500);
  });

  it("H1-7/12: worker con referencias inconsistentes (unidad y producto) se omite todo", async () => {
    // Simula propuestas GPT alucinadas: unidad incompatible y producto ajeno.
    mocks.db!.tables.authorized_order_items.push(
      { id: UID(60), order_id: OC, empresa_id: TENANT, product: "Cemento puzolánico", quantity: 5000, unit: "bolsa", quantity_invoiced: 0, sort_order: 1 },
    );
    const r = await svc([
      { invoiceItemId: IL1, orderItemId: UID(60), quantityMatched: 100 },
      { invoiceItemId: IL1, orderItemId: OL1, quantityMatched: 0 },
    ]);
    expect(r.error).toBeNull();
    expect(r.applied).toHaveLength(0);
    // unidad incompatible → mismatch; cantidad no positiva → documentado.
    expect(r.skippedMismatch).toBe(1);
    expect(r.skippedOverDocumented).toBe(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
    expect(mocks.db!.tables.authorized_order_items.find((o) => o.id === OL1)!.quantity_invoiced).toBe(0);
  });

  it("H1-12b: producto ajeno a la OC se omite aunque la unidad coincida", async () => {
    mocks.db!.tables.authorized_order_items.push(
      { id: UID(61), order_id: OC, empresa_id: TENANT, product: "Cemento puzolánico", quantity: 5000, unit: "un", quantity_invoiced: 0, sort_order: 1 },
    );
    const r = await svc([{ invoiceItemId: IL1, orderItemId: UID(61), quantityMatched: 100 }]);
    expect(r.error).toBeNull();
    expect(r.applied).toHaveLength(0);
    expect(r.skippedMismatch).toBe(1);
    expect(mocks.db!.tables.invoice_item_matches).toHaveLength(0);
  });
});
