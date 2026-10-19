import { expect, it } from "vitest";
import { updateOpenWarehouseSubmission } from "@/lib/inventory/update-open-warehouse-submission";

it("#15 cannot overwrite a submission confirmed after the portal read", async () => {
  let status = "UPLOADED";
  const query = {
    update: (_patch: unknown) => query,
    eq: (_column: string, _value: string) => query,
    in: (column: string, values: string[]) => { expect(column).toBe("status"); expect(values).not.toContain("CONFIRMED"); return query; },
    select: (_columns: string) => query,
    maybeSingle: async () => ({ data: status === "CONFIRMED" ? null : { id: "submission" }, error: null }),
  };
  const admin = { from: () => query };
  status = "CONFIRMED"; // another session finished after the initial portal read
  const updated = await updateOpenWarehouseSubmission(admin as never, "submission", "tenant", { status: "NEEDS_REVIEW", processing_error: "late error" });
  expect(updated).toBe(false);
  expect(status).toBe("CONFIRMED");
});
