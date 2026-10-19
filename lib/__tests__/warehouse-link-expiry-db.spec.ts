import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../../supabase/migrations/20261018120600_require_warehouse_link_expiry.sql", import.meta.url), "utf8");

describe("warehouse portal link expiration", () => {
  it("expires legacy indefinite links and rejects every new indefinite link", async () => {
    const db = new PGlite();
    try {
      await db.exec(`CREATE TABLE public.warehouse_portal_links(id int PRIMARY KEY, expires_at timestamptz);
        INSERT INTO public.warehouse_portal_links VALUES (1, null);`);
      await db.exec(migration);
      const existing = await db.query<{ expired: boolean }>("SELECT expires_at <= now() AS expired FROM public.warehouse_portal_links WHERE id=1");
      expect(existing.rows[0].expired).toBe(true);
      await expect(db.exec("INSERT INTO public.warehouse_portal_links VALUES (2, null)")).rejects.toThrow(/null value|not-null/i);
    } finally {
      await db.close();
    }
  }, 30000);
});
