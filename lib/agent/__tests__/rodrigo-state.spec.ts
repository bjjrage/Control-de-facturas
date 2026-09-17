import { describe, expect, it } from "vitest";
import {
  RODRIGO_SUCCESS_FEEDBACK_MS,
  deriveRodrigoState,
  getRodrigoStatePresentation,
} from "../rodrigo-state";

const NOW = Date.parse("2026-09-16T20:30:00.000Z");

describe("Rodrigo visual state", () => {
  it("queda idle cuando no hay tareas", () => {
    expect(deriveRodrigoState([], NOW)).toBe("idle");
  });

  it("prioriza una aprobación sobre trabajo y éxitos recientes", () => {
    expect(
      deriveRodrigoState(
        [
          { status: "RUNNING" },
          { status: "COMPLETED", completedAt: "2026-09-16T20:29:59.000Z" },
          { status: "WAITING_APPROVAL" },
        ],
        NOW
      )
    ).toBe("approval");
  });

  it("mapea PENDING a thinking desde el estado durable", () => {
    expect(deriveRodrigoState([{ status: "PENDING" }], NOW)).toBe("thinking");
  });

  it.each(["RUNNING", "WAITING_EXTERNAL", "SCHEDULED"])("mapea %s a working", (status) => {
    expect(deriveRodrigoState([{ status }], NOW)).toBe("working");
  });

  it("mantiene un error visible hasta que se resuelva", () => {
    expect(deriveRodrigoState([{ status: "FAILED", updatedAt: "2026-09-10T00:00:00.000Z" }], NOW)).toBe("error");
  });

  it("muestra éxito sólo durante la ventana de feedback", () => {
    expect(deriveRodrigoState([{ status: "COMPLETED", completedAt: "2026-09-16T20:29:59.000Z" }], NOW)).toBe("success");
    expect(
      deriveRodrigoState(
        [{ status: "COMPLETED", completedAt: new Date(NOW - RODRIGO_SUCCESS_FEEDBACK_MS - 1).toISOString() }],
        NOW
      )
    ).toBe("idle");
  });

  it("expone copy humano para cada estado", () => {
    expect(getRodrigoStatePresentation("approval").label).toContain("decisión");
    expect(getRodrigoStatePresentation("disabled").description).toContain("runtime");
  });
});
