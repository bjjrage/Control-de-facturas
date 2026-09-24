import { describe, expect, it } from "vitest";
import { PreviewWeeklyPlanInputSchema } from "@/lib/tools/erp/preview-weekly-plan";
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

  it("rejects MRP coverage dates outside the plan period for preview and commit", () => {
    const futureCommit = SaveWeeklyPlanInputSchema.safeParse({
      ...baseInput,
      status: "COMMITTED",
      mrp_commit: {
        needed_by_date: "2026-10-01",
        lines: [],
      },
    });
    const futurePreview = PreviewWeeklyPlanInputSchema.safeParse({
      project_id: baseInput.project_id,
      start_date: baseInput.start_date,
      end_date: baseInput.end_date,
      weather_overlay: false,
      items: [],
      mrp: { mode: "MRP", needed_by_date: "2026-10-01" },
    });
    const defaultDeadlinePreview = PreviewWeeklyPlanInputSchema.safeParse({
      project_id: baseInput.project_id,
      start_date: baseInput.start_date,
      end_date: baseInput.end_date,
      weather_overlay: false,
      items: [],
      mrp: { mode: "MRP" },
    });

    expect(futureCommit.success).toBe(false);
    expect(futurePreview.success).toBe(false);
    expect(defaultDeadlinePreview.success).toBe(true);
  });
});
