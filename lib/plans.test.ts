import { describe, expect, it } from "vitest";
import { planMeetsMinimum } from "./plans";

describe("jerarquía de planes", () => {
  it("mantiene a Caterpillar como superset de Pro y Básico", () => {
    expect(planMeetsMinimum("caterpillar", "pro")).toBe(true);
    expect(planMeetsMinimum("caterpillar", "basico")).toBe(true);
    expect(planMeetsMinimum("pro", "caterpillar")).toBe(false);
    expect(planMeetsMinimum("basico", "pro")).toBe(false);
  });

  it("conserva el bypass explícito de planes para superadministración", () => {
    expect(planMeetsMinimum("basico", "caterpillar", true)).toBe(true);
  });
});
