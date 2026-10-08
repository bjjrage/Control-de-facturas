import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const mocks = vi.hoisted(() => ({
  requirePlan: vi.fn(),
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requirePlan: mocks.requirePlan }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/app-origin", () => ({ getAppOrigin: vi.fn(async () => "https://qa.example") }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }));
vi.mock("@/lib/inventory/service", () => ({
  createInventoryReceiptAtomic: vi.fn(),
  confirmInventoryReceipt: vi.fn(),
  confirmWarehouseSubmission: vi.fn(),
  ensureProjectInventoryLocation: vi.fn(),
  postManualInventoryMovement: vi.fn(),
  saveWarehouseSubmissionLinesAtomic: vi.fn(),
}));
vi.mock("@/lib/inventory/portal", () => ({ generateWarehousePortalToken: vi.fn(), sha256Bytes: vi.fn(), warehousePortalUrl: vi.fn() }));
vi.mock("@/lib/inventory/receipt-portal", () => ({ generateReceiptPortalToken: vi.fn(), receiptPortalUrl: vi.fn() }));
vi.mock("@/lib/inventory/evidence", () => ({ parseInventorySpreadsheet: vi.fn(), photoEvidenceProposal: vi.fn() }));
vi.mock("@/lib/storage", () => ({ sanitizeFileName: vi.fn() }));

import { updateWarehouseSubmissionLine } from "@/app/(internal)/inventory/actions";

const readSource = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\r\n/g, "\n");

type Row = Record<string, unknown>;
type TableConfig = { maybeSingle?: { data: Row | null; error: unknown }; updateError?: unknown };

function createFakeSupabase(tables: Record<string, TableConfig>) {
  const updatePayloads: Record<string, unknown> = {};
  const supabase = {
    from(table: string) {
      const conf = tables[table] ?? {};
      const qb: Record<string, unknown> = {};
      qb.select = () => qb;
      qb.eq = () => qb;
      qb.update = (payload: unknown) => {
        updatePayloads[table] = payload;
        return qb;
      };
      qb.maybeSingle = async () => conf.maybeSingle ?? { data: null, error: null };
      qb.then = (onFulfilled: (value: { error: unknown }) => unknown, onRejected?: (reason: unknown) => unknown) =>
        Promise.resolve(conf.updateError ?? null).then(
          (error) => onFulfilled({ error }),
          onRejected,
        );
      return qb;
    },
  };
  return { supabase, updatePayloads };
}

const LINE_ID = "11111111-1111-4111-8111-111111111111";
const SUB_ID = "22222222-2222-4222-8222-222222222222";
const PROD_ID = "33333333-3333-4333-8333-333333333333";
const PARTIDA_ID = "44444444-4444-4444-8444-444444444444";

const validLine: Row = { id: LINE_ID, submission_id: SUB_ID, inventory_movement_id: null };
const validSubmission: Row = { status: "NEEDS_REVIEW", project_id: "proj-1" };
const validProduct: Row = { id: PROD_ID, unidad: "bolsa", activo: true };

function baseTables(overrides: Record<string, TableConfig> = {}): Record<string, TableConfig> {
  return {
    warehouse_submission_lines: { maybeSingle: { data: validLine, error: null } },
    warehouse_submissions: { maybeSingle: { data: validSubmission, error: null } },
    productos: { maybeSingle: { data: validProduct, error: null } },
    budget_items: { maybeSingle: { data: { id: PARTIDA_ID }, error: null } },
    ...overrides,
  };
}

const validArgs = {
  lineId: LINE_ID,
  rawDescription: "Cementos para mampostería",
  productoId: PROD_ID,
  quantity: 20,
  unit: "bolsa",
  budgetItemId: PARTIDA_ID,
  state: "CONFIRMED" as const,
  notes: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePlan.mockResolvedValue({ id: "user-1", empresa_id: "tenant-qa" });
});

describe("validación de partida en revisión de rendiciones (P1 consumos)", () => {
  it("confirma la línea cuando la partida pertenece a la obra de la rendición", async () => {
    const { supabase, updatePayloads } = createFakeSupabase(baseTables());
    mocks.createClient.mockResolvedValue(supabase);
    const result = await updateWarehouseSubmissionLine(validArgs);
    expect(result.error).toBeNull();
    expect(updatePayloads.warehouse_submission_lines).toMatchObject({
      producto_id: PROD_ID,
      quantity: 20,
      budget_item_id: PARTIDA_ID,
      state: "CONFIRMED",
    });
  });

  it("rechaza una partida que no pertenece a la obra sin actualizar la línea", async () => {
    const { supabase, updatePayloads } = createFakeSupabase(baseTables({
      budget_items: { maybeSingle: { data: null, error: null } },
    }));
    mocks.createClient.mockResolvedValue(supabase);
    const result = await updateWarehouseSubmissionLine(validArgs);
    expect(result.error).toBe("La partida no pertenece a la obra de esta rendición.");
    expect(updatePayloads.warehouse_submission_lines).toBeUndefined();
  });

  it("no convierte un error de consulta en ninguna acción de escritura", async () => {
    const { supabase, updatePayloads } = createFakeSupabase(baseTables({
      budget_items: { maybeSingle: { data: null, error: { message: "column empresa_id does not exist" } } },
    }));
    mocks.createClient.mockResolvedValue(supabase);
    const result = await updateWarehouseSubmissionLine(validArgs);
    expect(result.error).toBe("No se pudo validar la partida. Intentá nuevamente.");
    expect(result.error).not.toContain("no pertenece");
    expect(updatePayloads.warehouse_submission_lines).toBeUndefined();
  });

  it("rechaza producto inactivo, de otra empresa o con unidad distinta", async () => {
    const { supabase: inactiveSupabase } = createFakeSupabase(baseTables({
      productos: { maybeSingle: { data: { ...validProduct, activo: false }, error: null } },
    }));
    mocks.createClient.mockResolvedValue(inactiveSupabase);
    expect((await updateWarehouseSubmissionLine(validArgs)).error).toContain("no pertenece a esta empresa");

    const { supabase: foreignProductSupabase } = createFakeSupabase(baseTables({
      productos: { maybeSingle: { data: null, error: null } },
    }));
    mocks.createClient.mockResolvedValue(foreignProductSupabase);
    expect((await updateWarehouseSubmissionLine(validArgs)).error).toContain("no pertenece a esta empresa");

    const { supabase: unitSupabase } = createFakeSupabase(baseTables());
    mocks.createClient.mockResolvedValue(unitSupabase);
    expect((await updateWarehouseSubmissionLine({ ...validArgs, unit: "unidades" })).error).toBe(
      "La unidad debe coincidir con la unidad del producto.",
    );
  });

  it("rechaza cantidades no numéricas o no positivas", async () => {
    const { supabase } = createFakeSupabase(baseTables());
    mocks.createClient.mockResolvedValue(supabase);
    for (const quantity of [0, -5, Number.NaN]) {
      const result = await updateWarehouseSubmissionLine({ ...validArgs, quantity });
      expect(result.error).toBeTruthy();
    }
  });

  it("rechaza línea ya vinculada a un movimiento canónico (doble confirmación)", async () => {
    const { supabase, updatePayloads } = createFakeSupabase(baseTables({
      warehouse_submission_lines: { maybeSingle: { data: { ...validLine, inventory_movement_id: "mov-1" }, error: null } },
    }));
    mocks.createClient.mockResolvedValue(supabase);
    const result = await updateWarehouseSubmissionLine(validArgs);
    expect(result.error).toBe("La línea ya está vinculada a un movimiento canónico y es inmutable.");
    expect(updatePayloads.warehouse_submission_lines).toBeUndefined();
  });

  it("rechaza mutación sobre rendición cerrada o confirmada", async () => {
    const { supabase, updatePayloads } = createFakeSupabase(baseTables({
      warehouse_submissions: { maybeSingle: { data: { ...validSubmission, status: "CONFIRMED" }, error: null } },
    }));
    mocks.createClient.mockResolvedValue(supabase);
    const result = await updateWarehouseSubmissionLine(validArgs);
    expect(result.error).toBe("La rendición está cerrada o en procesamiento y no admite cambios.");
    expect(updatePayloads.warehouse_submission_lines).toBeUndefined();
  });

  it("confirmando exige producto, partida, cantidad y unidad completos", async () => {
    const { supabase } = createFakeSupabase(baseTables());
    mocks.createClient.mockResolvedValue(supabase);
    for (const partial of [
      { ...validArgs, productoId: null },
      { ...validArgs, budgetItemId: null },
      { ...validArgs, unit: null },
      { ...validArgs, quantity: null },
    ] as const) {
      const result = await updateWarehouseSubmissionLine(partial);
      expect(result.error).toBe("Para confirmar la línea completá descripción, producto, cantidad, unidad y partida.");
    }
  });
});

describe("scoping multitenant de budget_items se conserva sin empresa_id inexistente", () => {
  it("la revisión interna ya no consulta empresa_id sobre budget_items", () => {
    const actions = readSource("app/(internal)/inventory/actions.ts");
    const budgetQuery = actions.slice(actions.indexOf('if (budgetItemId)'), actions.indexOf("La partida no pertenece a la obra"));
    expect(budgetQuery).toContain('.from("budget_items")');
    expect(budgetQuery).toContain('.eq("id", budgetItemId)');
    expect(budgetQuery).toContain('.eq("project_id", submission.project_id)');
    expect(budgetQuery).not.toContain('.eq("empresa_id"');
  });

  it("el portal de pañol ya no consulta empresa_id sobre budget_items y trata el error aparte", () => {
    const portalRoute = readSource("app/api/warehouse-portal/[token]/route.ts");
    const budgetQuery = portalRoute.slice(portalRoute.indexOf("verify it belongs to this project"), portalRoute.indexOf("La salida requiere partida"));
    expect(budgetQuery).toContain('.from("budget_items")');
    expect(budgetQuery).toContain('.eq("project_id", location.project_id)');
    expect(budgetQuery).not.toContain('.eq("empresa_id"');
    expect(budgetQuery).toContain("biErr");
    expect(budgetQuery).toContain("500");
  });

  it("el contexto del portal carga las partidas de la obra y falla si la consulta es errónea", () => {
    const portalData = readSource("lib/inventory/warehouse-portal-data.ts");
    const budgetQuery = portalData.slice(portalData.indexOf("Fetch budget items"), portalData.indexOf("WarehousePortalBudgetItem[] ="));
    expect(budgetQuery).toContain('.from("budget_items")');
    expect(budgetQuery).toContain('.eq("project_id", project.id)');
    expect(budgetQuery).not.toContain('.eq("empresa_id"');
    expect(portalData).toContain("if (budgetError) return null;");
  });

  it("la validación canónica en DB sigue atando partida → obra → empresa", () => {
    const baseline = readSource("supabase/migrations/20261002231537_production_schema_baseline.sql");
    expect(baseline).toContain(
      "FROM public.budget_items bi\n      JOIN public.projects pr ON pr.id = bi.project_id",
    );
    expect(baseline).toContain("pr.empresa_id = p_empresa_id");
    expect(baseline).not.toContain('bi."empresa_id"');
  });
});
