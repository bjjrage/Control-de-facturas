import { describe, expect, it } from "vitest";
import { SaveWeeklyPlanInputSchema } from "@/lib/tools/erp/save-weekly-plan";

const baseInput = {
  project_id: "2a5b9ef9-d13a-4ca9-a165-e44f4a14a011",
  start_date: "2026-09-24",
  end_date: "2026-09-30",
  notes: null,
  items: [],
};

describe("save_weekly_plan MRP commit input", () => {
  it("rejects COMMITTED without a current MRP reference", () => {
    const result = SaveWeeklyPlanInputSchema.safeParse({
      ...baseInput,
      status: "COMMITTED",
    });

    expect(result.success).toBe(false);
  });

  it("allows COMMITTED with an MRP preview reference and DRAFT without one", () => {
    const committed = SaveWeeklyPlanInputSchema.safeParse({
      ...baseInput,
      status: "COMMITTED",
      mrp_commit: {
        needed_by_date: "2026-09-30",
        lines: [],
      },
    });
    const draft = SaveWeeklyPlanInputSchema.safeParse({
      ...baseInput,
      status: "DRAFT",
    });

    expect(committed.success).toBe(true);
    expect(draft.success).toBe(true);
  });
});
