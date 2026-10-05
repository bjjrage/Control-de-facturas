import { describe, expect, it, vi } from "vitest";
import { selectClimateDate, saveClimateSelection } from "@/lib/projects/climate-selection";

describe("climate selection without persistence on click", () => {
  it("plain click replaces selection", () => {
    expect(selectClimateDate(["2026-07-03", "2026-08-02"], "2026-09-01", false)).toEqual(["2026-09-01"]);
  });
  it("Ctrl/Meta or touch toggle adds across months, then removes the selected date", () => {
    const first = selectClimateDate(["2026-07-03"], "2026-08-02", true);
    expect(first).toEqual(["2026-07-03", "2026-08-02"]);
    expect(selectClimateDate(first, "2026-07-03", true)).toEqual(["2026-08-02"]);
  });
  it("does not mutate the existing selection", () => {
    const dates = ["2026-09-03"];
    selectClimateDate(dates, "2026-09-04", true);
    expect(dates).toEqual(["2026-09-03"]);
  });
});

describe("sequential canonical action orchestration", () => {
  it("saves each distinct date once and waits for each action", async () => {
    let active = 0;
    const save = vi.fn(async () => {
      expect(active).toBe(0); active++;
      await Promise.resolve(); active--;
      return { error: null };
    });
    expect(await saveClimateSelection(["2026-09-04", "2026-09-03", "2026-09-03"], save)).toEqual({ saved: ["2026-09-03", "2026-09-04"], failed: [] });
    expect(save).toHaveBeenCalledTimes(2);
  });
  it("returns exact failed dates and keeps saving after errors and exceptions", async () => {
    const result = await saveClimateSelection(["2026-09-03", "2026-09-04", "2026-09-05"], async date => {
      if (date === "2026-09-03") return { error: "Proyecto no encontrado." };
      if (date === "2026-09-04") throw new Error("transport failure");
      return { error: null };
    });
    expect(result.saved).toEqual(["2026-09-05"]);
    expect(result.failed).toEqual([{ date: "2026-09-03", error: "Proyecto no encontrado." }, { date: "2026-09-04", error: "No se pudo guardar. Reintentá este día." }]);
  });
  it("empty selection calls no action", async () => {
    const save = vi.fn();
    expect(await saveClimateSelection([], save)).toEqual({ saved: [], failed: [] });
    expect(save).not.toHaveBeenCalled();
  });
});
