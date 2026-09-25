import { describe, expect, it } from "vitest";
import { inclusiveScheduleDuration, scheduleLeafBudgetItems, validateScheduleDates } from "./schedule";

describe("programación de partidas", () => {
  it("valida rangos inclusivos y permite quitar ambas fechas", () => {
    expect(validateScheduleDates(null, null)).toBeNull();
    expect(validateScheduleDates("2026-09-01", "2026-09-03")).toBeNull();
    expect(inclusiveScheduleDuration("2026-09-01", "2026-09-03")).toBe(3);
    expect(validateScheduleDates("2026-02-30", "2026-03-02")).toContain("inicio");
    expect(validateScheduleDates("2026-09-03", "2026-09-01")).toContain("anterior");
    expect(validateScheduleDates("2026-09-01", null)).toContain("ambas");
  });

  it("programa partidas hoja y deja que el Gantt resuma los rubros", () => {
    const items = [
      { id: "root", code: "1" },
      { id: "child", code: "1.1" },
      { id: "grandchild", code: "1.1.1" },
      { id: "other", code: "2" },
    ];
    expect(scheduleLeafBudgetItems(items).map((item) => item.id)).toEqual(["grandchild", "other"]);
  });
});
