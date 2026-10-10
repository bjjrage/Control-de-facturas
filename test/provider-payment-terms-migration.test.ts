import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("provider payment terms additive migration", () => {
  // Initializing the PostgreSQL WASM engine can exceed Vitest's 5s default.
  it("applies to the baseline provider table, preserves existing rows and bounds new terms", { timeout: 30_000 }, async () => {
    const pg = new PGlite();
    try {
      const baseline = readFileSync(resolve("supabase/migrations/20261002231537_production_schema_baseline.sql"), "utf8");
      const providerTable = baseline.match(/CREATE TABLE "public"\."providers" \([\s\S]*?\n\);/)?.[0];
      expect(providerTable).toBeTruthy();
      await pg.exec(providerTable!);
      await pg.exec("INSERT INTO public.providers (name,empresa_id) VALUES ('Existing supplier','11111111-1111-1111-1111-111111111111');");
      const before = (await pg.query("SELECT to_jsonb(p) AS row FROM public.providers p")).rows;
      await pg.exec(readFileSync(resolve("supabase/migrations/20261007224037_provider_payment_terms.sql"), "utf8"));
      expect((await pg.query("SELECT to_jsonb(p) - 'payment_terms' AS row FROM public.providers p")).rows).toEqual(before);
      expect((await pg.query<{ payment_terms: string | null }>("SELECT payment_terms FROM public.providers")).rows[0].payment_terms).toBeNull();
      await pg.query("UPDATE public.providers SET payment_terms=$1", ["30 días"]);
      expect((await pg.query<{ payment_terms: string }>("SELECT payment_terms FROM public.providers")).rows[0].payment_terms).toBe("30 días");
      await expect(pg.query("UPDATE public.providers SET payment_terms=$1", ["x".repeat(501)])).rejects.toThrow("providers_payment_terms_length");
      await pg.exec("INSERT INTO public.providers (name,empresa_id) VALUES ('No terms','11111111-1111-1111-1111-111111111111');");
      expect((await pg.query<{ payment_terms: string | null }>("SELECT payment_terms FROM public.providers WHERE name='No terms'")).rows[0].payment_terms).toBeNull();
    } finally {
      await pg.close();
    }
  });
});
