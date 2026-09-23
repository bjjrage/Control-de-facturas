import { beforeEach, describe, expect, it, vi } from "vitest";
import { actualizarSnapshot } from "@/lib/planillas/service";
import { PlanillaConcurrencyError } from "@/lib/planillas/types";
import { PATCH, POST } from "@/app/api/planillas/[id]/route";
import type { NextRequest } from "next/server";

vi.mock("@/lib/planillas/service", () => ({
  actualizarSnapshot: vi.fn(),
  obtenerPlanilla: vi.fn(),
  PlanillaNotFoundError: class PlanillaNotFoundError extends Error {},
}));

const planillaId = "00000000-0000-4000-a000-000000000010";
const updatedAt = "2026-09-23T12:00:00.000Z";
const rows = [{ _rowId: "new:1", code: "A-1" }];

function requestWithJson(body: unknown): NextRequest {
  return { json: vi.fn().mockResolvedValue(body) } as unknown as NextRequest;
}

describe("Planillas snapshot route optimistic version", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["PATCH", PATCH],
    ["POST sendBeacon", POST],
  ])("%s pasa el token de versión y devuelve la versión nueva", async (_name, handler) => {
    vi.mocked(actualizarSnapshot).mockResolvedValue({ updated_at: "2026-09-23T12:00:01.000Z" });

    const response = await handler(requestWithJson({ rows, expectedUpdatedAt: updatedAt }), {
      params: Promise.resolve({ id: planillaId }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ updated_at: "2026-09-23T12:00:01.000Z" });
    expect(actualizarSnapshot).toHaveBeenCalledWith(planillaId, rows, updatedAt);
  });

  it("rechaza escrituras sin token para no aceptar snapshots obsoletos", async () => {
    const response = await PATCH(requestWithJson({ rows }), { params: Promise.resolve({ id: planillaId }) });

    expect(response.status).toBe(400);
    expect(actualizarSnapshot).not.toHaveBeenCalled();
  });

  it("mapea una versión obsoleta a 409 para que el cliente no sobrescriba otra sesión", async () => {
    vi.mocked(actualizarSnapshot).mockRejectedValue(new PlanillaConcurrencyError("stale snapshot"));

    const response = await PATCH(requestWithJson({ rows, expectedUpdatedAt: updatedAt }), {
      params: Promise.resolve({ id: planillaId }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "stale snapshot" });
  });
});
