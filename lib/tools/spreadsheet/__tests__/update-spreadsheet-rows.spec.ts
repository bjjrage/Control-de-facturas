import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentToolContext } from "@/lib/agent/context";
import { actualizarSnapshot, obtenerPlanilla } from "@/lib/planillas/service";
import { updateSpreadsheetRowsTool } from "../update-spreadsheet-rows";

vi.mock("@/lib/planillas/service", () => ({
  actualizarSnapshot: vi.fn(),
  obtenerPlanilla: vi.fn(),
}));

const planillaId = "00000000-0000-4000-a000-000000000010";
const firstRowId = "00000000-0000-4000-a000-000000000001";
const secondRowId = "00000000-0000-4000-a000-000000000002";
const empresaId = "00000000-0000-4000-a000-000000000099";
const ctx: AgentToolContext = {
  empresaId,
  userId: "user-1",
  role: "admin",
  actorType: "user",
  source: "web",
};
const db = {} as SupabaseClient;

const rows = [
  {
    _rowId: firstRowId,
    _version: "2026-01-01T00:00:00.000Z",
    _style: { bold: true as const },
    code: "1",
    description: "Hormigón",
    unit: "m3",
    quantity: 2,
    unit_price: 100,
    subtotal: 200,
  },
  {
    _rowId: secondRowId,
    _version: "2026-01-02T00:00:00.000Z",
    code: "2",
    description: "Acero",
    unit: "kg",
    quantity: 4,
    unit_price: 20,
    subtotal: 80,
  },
];

describe("update_spreadsheet_rows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(obtenerPlanilla).mockResolvedValue({
      id: planillaId,
      empresa_id: empresaId,
      usuario_id: "user-1",
      modulo: "computo_presupuesto",
      contexto: { projectId: "project-1" },
      snapshot: { rows },
      estado: "draft",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      confirmed_at: null,
    });
    vi.mocked(actualizarSnapshot).mockResolvedValue({ updated_at: "2026-01-03T00:00:00.000Z" });
  });

  it("persists edited cells, retaining untouched rows and trusted metadata", async () => {
    await updateSpreadsheetRowsTool.handler(
      ctx,
      {
        planilla_id: planillaId,
        expected_updated_at: "2026-01-01T00:00:00.000Z",
        rows: [
          {
            _rowId: firstRowId,
            _version: "forged-version",
            description: "Hormigón armado",
            quantity: 3,
            subtotal: 999999,
            arbitrary_column: "ignored",
          },
        ],
      },
      { db }
    );

    expect(actualizarSnapshot).toHaveBeenCalledWith(
      db,
      empresaId,
      planillaId,
      [
        {
          ...rows[0],
          description: "Hormigón armado",
          quantity: 3,
        },
        rows[1],
      ],
      "2026-01-01T00:00:00.000Z"
    );
  });

  it("rejects unknown row ids rather than inserting forged source identities", async () => {
    await expect(
      updateSpreadsheetRowsTool.handler(
        ctx,
        {
          planilla_id: planillaId,
          expected_updated_at: "2026-01-01T00:00:00.000Z",
          rows: [{ _rowId: "not-in-this-snapshot", description: "forged" }],
        },
        { db }
      )
    ).rejects.toThrow(/no pertenece al snapshot/);
    expect(actualizarSnapshot).not.toHaveBeenCalled();
  });

  it("rejects a patch from an old snapshot before merging or saving", async () => {
    await expect(
      updateSpreadsheetRowsTool.handler(
        ctx,
        {
          planilla_id: planillaId,
          expected_updated_at: "2025-12-31T23:59:59.000Z",
          rows: [{ _rowId: firstRowId, description: "stale edit" }],
        },
        { db }
      )
    ).rejects.toThrow(/cambió desde que se obtuvo el snapshot/);
    expect(actualizarSnapshot).not.toHaveBeenCalled();
  });
});
