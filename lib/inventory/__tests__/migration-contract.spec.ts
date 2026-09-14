import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/0087_inventory_panol.sql"),
  "utf8",
);

describe("0087 inventory migration contract", () => {
  it("fails closed when legacy cost evidence is unavailable", () => {
    expect(migration).toContain("IF to_regclass('public.cost_observations') IS NULL");
    expect(migration).toContain("LEGACY_COST_EVIDENCE_TABLE_MISSING");
    expect(migration).toContain("LEGACY_FOREIGN_COST_REQUIRES_FX");
    expect(migration).toContain("LEGACY_COST_CURRENCY_UNKNOWN");
  });

  it("does not leave inventory SECURITY DEFINER objects callable by anon", () => {
    expect(migration).toContain(
      "REVOKE ALL ON TABLE public.inventory_locations",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.resolve_legacy_inventory_cost(uuid, uuid, numeric) FROM anon, authenticated;",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.inventory_post_movement(",
    );
    expect(migration).toContain(
      "REVOKE ALL ON FUNCTION public.inventory_confirm_receipt(uuid, uuid, uuid, text, uuid) FROM anon;",
    );
  });
});
