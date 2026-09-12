import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BudgetItem, ComputoItem } from "@/lib/types";

// ── next/cache ──────────────────────────────────────────────────────────────
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// ── audit ────────────────────────────────────────────────────────────────────
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));

// ── auth ─────────────────────────────────────────────────────────────────────
vi.mock("@/lib/auth", () => ({
  requirePlan: vi.fn().mockResolvedValue({ id: "user-1", empresa_id: "empresa-1" }),
}));

// ── DeepSeek matcher ─────────────────────────────────────────────────────────
const mockMatchBatch = vi.fn();
vi.mock("@/lib/bim/deepseek-batch-matcher", () => ({
  DeepSeekBatchSemanticMatcher: class {
    matchBatch = mockMatchBatch;
  },
}));

// ── Supabase chainable mock ───────────────────────────────────────────────────
// Each table gets its own response factory so tests can configure per-table
// behavior. The chain supports: .select().eq().eq().single() (project lookup),
// .insert().select().single() (computo_imports), .insert() (computo_items/matches),
// .select().eq().returns() (computo_items fetch), .select().in().returns() (matches
// fetch), and .select().eq().returns() (budget_items).

type MockResolution = Promise<{ data: unknown; error: unknown }>;

// Per-table overrides set by each test
const tableResponses: Record<string, MockResolution> = {};

// makeChain builds a Proxy where:
// - terminal methods (single, maybeSingle, returns) resolve the given promise
// - any other method returns the same proxy (for chaining .select().eq().etc())
// - properties can be overridden on `overrides` and take precedence over the default
function makeChain(resolution: MockResolution) {
  const overrides: Record<string, unknown> = {
    single: () => resolution,
    maybeSingle: () => resolution,
    returns: () => resolution,
  };
  const chain: Record<string, unknown> = new Proxy(overrides, {
    get(target, prop: string) {
      if (prop in target) return target[prop];
      if (prop === "then") {
        return (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          resolution.then(resolve, reject);
      }
      return (..._args: unknown[]) => chain;
    },
    set(target, prop: string, value: unknown) {
      target[prop] = value;
      return true;
    },
  });
  return chain;
}

// Stateful tracker so tests can inspect what was inserted
const insertedRows: Record<string, unknown[]> = {};

const mockSupabase = {
  from: (table: string) => {
    const res = tableResponses[table] ?? Promise.resolve({ data: null, error: null });
    const chain = makeChain(res);
    chain["insert"] = (rows: unknown) => {
      insertedRows[table] = insertedRows[table] ?? [];
      (insertedRows[table] as unknown[]).push(...(Array.isArray(rows) ? rows : [rows]));
      const insertRes = tableResponses[`${table}:insert`] ?? Promise.resolve({ data: null, error: null });
      return makeChain(insertRes);
    };
    return chain;
  },
  storage: { from: () => ({ download: async () => ({ data: null, error: { message: "no file" } }) }) },
  auth: { getUser: async () => ({ data: { user: null } }) },
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue(mockSupabase),
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function seedBudgetItems(): BudgetItem[] {
  return [
    { id: "bi-1", project_id: "proj-1", parent_id: null, code: "1.1", description: "Excavación manual de terreno", unit: "m3", quantity: 100, unit_price: 25000, created_at: "" },
    { id: "bi-2", project_id: "proj-1", parent_id: null, code: "1.2", description: "Relleno y compactación con material selecto", unit: "m3", quantity: 80, unit_price: 18000, created_at: "" },
    { id: "bi-3", project_id: "proj-1", parent_id: null, code: "2.1", description: "Hormigón armado H-30 para columnas", unit: "m3", quantity: 40, unit_price: 850000, created_at: "" },
    { id: "bi-4", project_id: "proj-1", parent_id: null, code: "2.2", description: "Acero corrugado fy=4200", unit: "kg", quantity: 5000, unit_price: 7500, created_at: "" },
    { id: "bi-5", project_id: "proj-1", parent_id: null, code: "3.1", description: "Losa de entrepiso", unit: "m2", quantity: 200, unit_price: 320000, created_at: "" },
  ];
}

function seedComputoItems(importId: string): ComputoItem[] {
  return [
    { id: "ci-1", computo_import_id: importId, project_id: "proj-1", row_index: 0, description: "Excavación manual en terreno natural", quantity_value: 95, quantity_unit: "m3", raw_row: {}, row_confidence: null, created_at: "" },
    { id: "ci-2", computo_import_id: importId, project_id: "proj-1", row_index: 1, description: "Hormigón estructural H30 columnas", quantity_value: 38, quantity_unit: "m3", raw_row: {}, row_confidence: null, created_at: "" },
    { id: "ci-3", computo_import_id: importId, project_id: "proj-1", row_index: 2, description: "Acero nervurado", quantity_value: 4800, quantity_unit: "kg", raw_row: {}, row_confidence: null, created_at: "" },
  ];
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe("importComputoExcel — flujo de acción servidor (integración mockeada)", () => {
  const PROJECT_ID = "proj-1";
  const IMPORT_ID = "import-uuid-1";

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(tableResponses).forEach((k) => delete tableResponses[k]);
    Object.keys(insertedRows).forEach((k) => delete insertedRows[k]);
    process.env.DEEPSEEK_API_KEY = "test-key";

    // projects lookup (assertProjectAccess)
    tableResponses["projects"] = Promise.resolve({ data: { id: PROJECT_ID }, error: null });

    // computo_imports insert -> returns new id
    tableResponses["computo_imports:insert"] = Promise.resolve({ data: { id: IMPORT_ID }, error: null });

    // computo_items insert
    tableResponses["computo_items:insert"] = Promise.resolve({ data: null, error: null });

    // computo_items select (in runComputoMatching)
    tableResponses["computo_items"] = Promise.resolve({
      data: seedComputoItems(IMPORT_ID),
      error: null,
    });

    // computo_item_matches select (existing matches — none)
    tableResponses["computo_item_matches"] = Promise.resolve({ data: [], error: null });

    // budget_items select
    tableResponses["budget_items"] = Promise.resolve({ data: seedBudgetItems(), error: null });

    // computo_item_matches insert
    tableResponses["computo_item_matches:insert"] = Promise.resolve({ data: null, error: null });
  });

  it("registra el import y los ítems en Supabase", async () => {
    mockMatchBatch.mockResolvedValue(
      new Map([
        ["ci-1", { decision: "MATCH", candidateId: "bi-1", confidence: 0.9, reason: "excavación = excavación" }],
        ["ci-2", { decision: "MATCH", candidateId: "bi-3", confidence: 0.88, reason: "hormigón H30 columnas" }],
        ["ci-3", { decision: "MATCH", candidateId: "bi-4", confidence: 0.85, reason: "acero nervurado ≈ corrugado" }],
      ])
    );

    const { importComputoExcel } = await import("@/app/(internal)/projects/[id]/computo-actions");
    const result = await importComputoExcel(PROJECT_ID, "computo-mock.xlsx", [
      { description: "Excavación manual en terreno natural", quantity: 95, unit: "m3" },
      { description: "Hormigón estructural H30 columnas", quantity: 38, unit: "m3" },
      { description: "Acero nervurado", quantity: 4800, unit: "kg" },
    ]);

    expect(result.error).toBeNull();
    expect(result.computoImportId).toBe(IMPORT_ID);
    expect(result.suggested).toBe(3);
    expect(result.review).toBe(0);
    expect(result.noMatch).toBe(0);

    // computo_items rows inserted
    expect(insertedRows["computo_items"]).toHaveLength(3);
    expect((insertedRows["computo_items"] as Record<string, unknown>[])[0]).toMatchObject({
      computo_import_id: IMPORT_ID,
      project_id: PROJECT_ID,
      row_index: 0,
      description: "Excavación manual en terreno natural",
      quantity_value: 95,
      quantity_unit: "m3",
    });
  });

  it("devuelve error si no hay filas en el Excel", async () => {
    const { importComputoExcel } = await import("@/app/(internal)/projects/[id]/computo-actions");
    const result = await importComputoExcel(PROJECT_ID, "vacio.xlsx", []);
    expect(result.error).toMatch(/filas/i);
    expect(result.computoImportId).toBeNull();
  });

  it("REVIEW cuando DeepSeek no puede decidir (REVIEW)", async () => {
    mockMatchBatch.mockResolvedValue(
      new Map([
        ["ci-1", { decision: "MATCH", candidateId: "bi-1", confidence: 0.9, reason: "" }],
        ["ci-2", { decision: "REVIEW", candidateId: null, confidence: 0.55, reason: "ambiguo" }],
        ["ci-3", { decision: "NO_MATCH", candidateId: null, confidence: 0.1, reason: "no encontrado" }],
      ])
    );

    const { importComputoExcel } = await import("@/app/(internal)/projects/[id]/computo-actions");
    const result = await importComputoExcel(PROJECT_ID, "computo-mock.xlsx", [
      { description: "Excavación manual en terreno natural", quantity: 95, unit: "m3" },
      { description: "Hormigón estructural H30 columnas", quantity: 38, unit: "m3" },
      { description: "Acero nervurado", quantity: 4800, unit: "kg" },
    ]);

    expect(result.suggested).toBe(1);
    expect(result.review).toBe(1);
    expect(result.noMatch).toBe(1);
    expect(result.error).toBeNull();
  });

  it("propaga error de Supabase al insertar computo_imports", async () => {
    tableResponses["computo_imports:insert"] = Promise.resolve({ data: null, error: { message: "FK violation" } });

    const { importComputoExcel } = await import("@/app/(internal)/projects/[id]/computo-actions");
    const result = await importComputoExcel(PROJECT_ID, "computo-mock.xlsx", [
      { description: "Excavación manual en terreno natural", quantity: 95, unit: "m3" },
    ]);

    expect(result.error).toMatch(/FK violation|No se pudo registrar/i);
  });

  it("devuelve error informativo si DeepSeek falla a mitad", async () => {
    mockMatchBatch.mockRejectedValue(new Error("timeout DeepSeek"));

    const { importComputoExcel } = await import("@/app/(internal)/projects/[id]/computo-actions");
    const result = await importComputoExcel(PROJECT_ID, "computo-mock.xlsx", [
      { description: "Excavación manual en terreno natural", quantity: 95, unit: "m3" },
    ]);

    expect(result.error).toMatch(/DeepSeek/i);
  });

  it("REVIEW_REQUIRED cuando la descripción tiene un rango de espesores ambiguo", async () => {
    // "Revoque interior entre 15 y 20 mm" tiene un rango que cubre DOS espesores
    // distintos en el catálogo → checkTechnicalIntegrity marca AMBIGUOUS_RANGE → vicious
    tableResponses["budget_items"] = Promise.resolve({
      data: [
        { id: "bi-rev15", project_id: PROJECT_ID, parent_id: null, code: "R1", description: "Revoque fino 15mm", unit: "m2", quantity: 100, unit_price: 12000, created_at: "" },
        { id: "bi-rev20", project_id: PROJECT_ID, parent_id: null, code: "R2", description: "Revoque fino 20mm", unit: "m2", quantity: 100, unit_price: 15000, created_at: "" },
      ],
      error: null,
    });
    tableResponses["computo_items"] = Promise.resolve({
      data: [
        {
          id: "ci-rev",
          computo_import_id: IMPORT_ID,
          project_id: PROJECT_ID,
          row_index: 0,
          description: "Revoque interior entre 15 y 20 mm",
          quantity_value: 80,
          quantity_unit: "m2",
          raw_row: {},
          row_confidence: null,
          created_at: "",
        },
      ],
      error: null,
    });

    mockMatchBatch.mockResolvedValue(
      new Map([["ci-rev", { decision: "MATCH", candidateId: "bi-rev15", confidence: 0.75, reason: "revoque 15mm" }]])
    );

    const { importComputoExcel } = await import("@/app/(internal)/projects/[id]/computo-actions");
    const result = await importComputoExcel(PROJECT_ID, "computo-mock.xlsx", [
      { description: "Revoque interior entre 15 y 20 mm", quantity: 80, unit: "m2" },
    ]);

    expect(result.reviewRequired).toBe(1);
    expect(result.suggested).toBe(0);
  });

  it("devuelve error si no hay budget_items en el proyecto", async () => {
    tableResponses["budget_items"] = Promise.resolve({ data: [], error: null });

    const { importComputoExcel } = await import("@/app/(internal)/projects/[id]/computo-actions");
    const result = await importComputoExcel(PROJECT_ID, "computo-mock.xlsx", [
      { description: "Excavación manual en terreno natural", quantity: 95, unit: "m3" },
    ]);

    expect(result.error).toMatch(/presupuesto/i);
  });
});
