import { describe, expect, it } from "vitest";
import { classifyWarehouseSubmission } from "@/lib/inventory/warehouse-portal-client-state";

describe("#14 portal submission response", () => {
  it("treats HTTP 207 as incomplete even though Response.ok is true", () => {
    const result = classifyWarehouseSubmission(207, {
      ok: true, partial: true, uploaded: 1, total: 2, rejected: [{ file: "second.pdf", reason: "Storage unavailable" }],
    });
    expect(result.complete).toBe(false);
    expect(result.message).toMatch(/parcial|pendiente/i);
  });
  it("only a complete result may clear the submitted form", () => {
    expect(classifyWarehouseSubmission(200, { ok: true, partial: false, uploadIncomplete: false }).complete).toBe(true);
    expect(classifyWarehouseSubmission(207, { ok: true, uploadIncomplete: true }).complete).toBe(false);
    expect(classifyWarehouseSubmission(500, { ok: false, error: "No se pudo guardar" }).complete).toBe(false);
  });
});
