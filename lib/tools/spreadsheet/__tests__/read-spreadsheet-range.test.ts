import { beforeEach, describe, expect, it, vi } from "vitest";

const { getPlanillaAdapter, obtenerPlanilla } = vi.hoisted(() => ({
  getPlanillaAdapter: vi.fn(),
  obtenerPlanilla: vi.fn(),
}));

vi.mock("@/lib/planillas/service", () => ({ obtenerPlanilla }));
vi.mock("@/lib/planillas/registry", () => ({ getPlanillaAdapter }));
vi.mock("@/lib/agent/registry", () => ({ registerTool: vi.fn() }));

import { readSpreadsheetRangeTool, MAX_PAYLOAD_CHARS } from "@/lib/tools/spreadsheet/read-spreadsheet-range";

const planillaId = "00000000-0000-4000-8000-000000000001";
const context = { empresaId: "tenant-1" } as never;
const deps = { db: {} as never };

function setPlanilla(rows: Array<Record<string, unknown>>, columns = [
  { key: "code", label: "Código", type: "text" as const },
  { key: "description", label: "Descripción", type: "text" as const },
]) {
  obtenerPlanilla.mockResolvedValue({
    id: planillaId,
    empresa_id: "tenant-1",
    modulo: "test",
    estado: "draft",
    snapshot: { rows },
  });
  getPlanillaAdapter.mockReturnValue({ columns });
}

describe("read_spreadsheet_range", () => {
  beforeEach(() => vi.clearAllMocks());

  it("selects requested adapter columns even when snapshot metadata comes first", async () => {
    setPlanilla([{
      _rowId: "row-1",
      _version: 1,
      _deleted: false,
      code: "A-01",
      description: "Material",
    }]);

    const result = await readSpreadsheetRangeTool.handler(context, {
      planilla_id: planillaId,
      range: "A1:B1",
    }, deps);

    expect(result.rows).toEqual([{ code: "A-01", description: "Material" }]);
    expect(result.columns.map(({ key }) => key)).toEqual(["code", "description"]);
    expect(obtenerPlanilla).toHaveBeenCalledWith(deps.db, "tenant-1", planillaId);
  });

  it("returns only complete rows within the serialized payload limit and reports the actual range", async () => {
    setPlanilla([
      { code: "A-01", description: "small" },
      { code: "A-02", description: "x".repeat(MAX_PAYLOAD_CHARS - 100) },
    ]);
    expect(JSON.stringify([{ code: "A-02", description: "x".repeat(MAX_PAYLOAD_CHARS - 100) }]).length)
      .toBeLessThan(MAX_PAYLOAD_CHARS);

    const result = await readSpreadsheetRangeTool.handler(context, {
      planilla_id: planillaId,
      range: "A1:B2",
    }, deps);

    expect(JSON.stringify(result).length).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
    expect(result.rows).toEqual([{ code: "A-01", description: "small" }]);
    expect(result.range.rows_returned).toBe(1);
    expect(result.range.actual_end_row).toBe(1);
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/límite de .* caracteres/i);
  });

  it("returns no row when a single row exceeds the hard payload limit", async () => {
    setPlanilla([{ code: "A-01", description: "x".repeat(MAX_PAYLOAD_CHARS) }]);

    const result = await readSpreadsheetRangeTool.handler(context, {
      planilla_id: planillaId,
      range: "A1:B1",
    }, deps);

    expect(result.rows).toEqual([]);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(MAX_PAYLOAD_CHARS);
    expect(result.range.rows_returned).toBe(0);
    expect(result.range.actual_end_row).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.warnings.join(" ")).toMatch(/primera fila supera el límite/i);
  });
});
