import { describe, expect, it } from "vitest";
import {
  deriveRodrigoState,
  getRodrigoStatePresentation,
  isRodrigoState,
  isWorkingTaskStatus,
  RODRIGO_STATES,
  RODRIGO_SUCCESS_FEEDBACK_MS,
} from "../rodrigo-state";

const NOW = 1_700_000_000_000;
const recentIso = new Date(NOW - 5_000).toISOString();
const staleIso = new Date(NOW - RODRIGO_SUCCESS_FEEDBACK_MS - 1_000).toISOString();
const futureIso = new Date(NOW + 60_000).toISOString();

describe("Rodrigo visual state", () => {
  it("sin tareas muestra idle", () => {
    expect(deriveRodrigoState([], NOW)).toBe("idle");
  });

  it("mapea PENDING a thinking desde el estado durable", () => {
    expect(deriveRodrigoState([{ status: "PENDING" }], NOW)).toBe("thinking");
  });

  it.each(["RUNNING", "WAITING_EXTERNAL", "SCHEDULED"])("mapea %s a working", (status) => {
    expect(deriveRodrigoState([{ status }], NOW)).toBe("working");
  });

  it("mapea WAITING_APPROVAL a approval con prioridad sobre working", () => {
    expect(
      deriveRodrigoState([{ status: "RUNNING" }, { status: "WAITING_APPROVAL" }], NOW)
    ).toBe("approval");
  });

  it("working tiene prioridad sobre thinking pendiente", () => {
    expect(
      deriveRodrigoState([{ status: "PENDING" }, { status: "RUNNING" }], NOW)
    ).toBe("working");
  });

  it("mapea FAILED a error", () => {
    expect(deriveRodrigoState([{ status: "FAILED" }], NOW)).toBe("error");
  });

  it("COMPLETED reciente muestra success", () => {
    expect(deriveRodrigoState([{ status: "COMPLETED", completedAt: recentIso }], NOW)).toBe("success");
  });

  it("COMPLETED viejo no muestra success", () => {
    expect(deriveRodrigoState([{ status: "COMPLETED", completedAt: staleIso }], NOW)).toBe("idle");
  });

  it("COMPLETED futuro no muestra success", () => {
    expect(deriveRodrigoState([{ status: "COMPLETED", completedAt: futureIso }], NOW)).toBe("idle");
  });

  it("usa updatedAt cuando no hay completedAt", () => {
    expect(deriveRodrigoState([{ status: "COMPLETED", updatedAt: recentIso }], NOW)).toBe("success");
  });

  it("ignora CANCELLED", () => {
    expect(deriveRodrigoState([{ status: "CANCELLED" }], NOW)).toBe("idle");
  });

  it("isWorkingTaskStatus cuenta PENDING como actividad", () => {
    expect(isWorkingTaskStatus("PENDING")).toBe(true);
    expect(isWorkingTaskStatus("RUNNING")).toBe(true);
    expect(isWorkingTaskStatus("COMPLETED")).toBe(false);
    expect(isWorkingTaskStatus("FAILED")).toBe(false);
  });

  it("isRodrigoState valida los 8 estados", () => {
    expect(RODRIGO_STATES).toHaveLength(8);
    for (const s of RODRIGO_STATES) expect(isRodrigoState(s)).toBe(true);
    expect(isRodrigoState("bailando")).toBe(false);
    expect(isRodrigoState(null)).toBe(false);
  });

  it("cada estado tiene presentación no vacía", () => {
    for (const s of RODRIGO_STATES) {
      const p = getRodrigoStatePresentation(s);
      expect(p.label.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
    }
  });
});
