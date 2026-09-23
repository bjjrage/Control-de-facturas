import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { actualizarSnapshot } from "./service";
import { PlanillaConcurrencyError } from "./types";

function makeDb(currentUpdatedAt: string, updateResult: { data: unknown; error: unknown } = {
  data: { updated_at: "2026-09-22T12:00:01.000Z" },
  error: null,
}) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.maybeSingle = vi.fn().mockResolvedValue({
    data: { estado: "draft", updated_at: currentUpdatedAt },
    error: null,
  });
  builder.update = vi.fn(() => builder);
  builder.single = vi.fn().mockResolvedValue(updateResult);
  const db = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
  return { db, builder };
}

describe("actualizarSnapshot concurrency guard", () => {
  it("rejects an old client snapshot before writing", async () => {
    const { db, builder } = makeDb("2026-09-22T12:00:02.000Z");

    await expect(
      actualizarSnapshot(
        db,
        "00000000-0000-4000-a000-000000000010",
        "00000000-0000-4000-a000-000000000099",
        [],
        "2026-09-22T12:00:01.000Z"
      )
    ).rejects.toBeInstanceOf(PlanillaConcurrencyError);

    expect(builder.update).not.toHaveBeenCalled();
  });

  it("rejects a stale snapshot before issuing an update", async () => {
    const { db, builder } = makeDb("2026-09-22T12:00:02.000Z");

    await expect(
      actualizarSnapshot(
        db,
        "00000000-0000-4000-a000-000000000099",
        "00000000-0000-4000-a000-000000000010",
        [],
        "2026-09-22T12:00:01.000Z"
      )
    ).rejects.toBeInstanceOf(PlanillaConcurrencyError);

    expect(builder.update).not.toHaveBeenCalled();
  });

  it("uses updated_at in the write predicate to close the read/write race", async () => {
    const expectedUpdatedAt = "2026-09-22T12:00:01.000Z";
    const { db, builder } = makeDb(expectedUpdatedAt, {
      data: null,
      error: { code: "PGRST116", message: "row changed" },
    });

    await expect(
      actualizarSnapshot(
        db,
        "00000000-0000-4000-a000-000000000099",
        "00000000-0000-4000-a000-000000000010",
        [],
        expectedUpdatedAt
      )
    ).rejects.toBeInstanceOf(PlanillaConcurrencyError);

    expect(builder.eq).toHaveBeenCalledWith("updated_at", expectedUpdatedAt);
    expect(builder.eq).toHaveBeenCalledWith("estado", "draft");
  });
});
