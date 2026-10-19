import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const sql = readFileSync(new URL("../../supabase/migrations/20261018120300_payment_requires_account.sql", import.meta.url), "utf8");
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE TABLE public.payment_orders(id uuid PRIMARY KEY, status text NOT NULL, cuenta_id uuid);");
  await db.exec(sql);
}, 120000);
afterAll(async () => { await db?.close(); });

describe("#4 executed payment account", () => {
  it("cannot mark an OP executed without a treasury account", async () => {
    await db.exec("INSERT INTO public.payment_orders VALUES ('11111111-1111-4111-8111-111111111111','EMITIDA',NULL)");
    await expect(db.exec("UPDATE public.payment_orders SET status='EJECUTADA'"))
      .rejects.toThrow(/payment_order_executed_account_required/);
    expect((await db.query<{ status: string }>("SELECT status FROM public.payment_orders")).rows[0].status).toBe("EMITIDA");
  });
});
