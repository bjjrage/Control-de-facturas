import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";

const PROJECT = "33333333-3333-4000-8000-000000000001";
const ITEM = "44444444-4444-4000-8000-000000000001";
const LOCATION = "55555555-5555-4000-8000-000000000001";

describe("schedule clearing and project deletion blockers", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let db: any;
  beforeEach(async () => {
    db = new PGlite();
    await db.exec(`
      CREATE TABLE public.projects (id uuid PRIMARY KEY);
      CREATE TABLE public.budget_items (
        id uuid PRIMARY KEY, project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
        code text NOT NULL, description text NOT NULL, quantity numeric, unit_price numeric,
        start_date date, end_date date, depends_on text
      );
      CREATE TABLE public.inventory_locations (
        id uuid PRIMARY KEY,
        project_id uuid REFERENCES public.projects(id) ON DELETE RESTRICT
      );
      INSERT INTO public.projects VALUES ('${PROJECT}');
      INSERT INTO public.budget_items (id,project_id,code,description,quantity,unit_price,start_date,end_date,depends_on)
      VALUES ('${ITEM}','${PROJECT}','1','Limpieza',100,50000,'2026-02-01','2026-02-05',NULL);
      INSERT INTO public.inventory_locations VALUES ('${LOCATION}','${PROJECT}');
    `);
  });

  it("clearing the schedule nulls only temporal columns", async () => {
    // Mismo shape que emite clearProjectSchedule: whitelist temporal.
    await db.query(
      "UPDATE public.budget_items SET start_date=NULL, end_date=NULL, depends_on=NULL WHERE project_id=$1",
      [PROJECT]
    );
    const res = await db.query("SELECT quantity, unit_price, start_date, end_date FROM public.budget_items");
    expect(res.rows).toEqual([{ quantity: "100", unit_price: "50000", start_date: null, end_date: null }]);
    await db.close();
  });

  it("RESTRICT location blocks project delete; removing the empty location unblocks it", async () => {
    await expect(db.query("DELETE FROM public.projects WHERE id=$1", [PROJECT])).rejects.toThrow();
    const stillThere = await db.query("SELECT id FROM public.projects WHERE id=$1", [PROJECT]);
    expect(stillThere.rows).toHaveLength(1);

    // Ubicación vacía (sin movimientos): el fix la elimina primero.
    await db.query("DELETE FROM public.inventory_locations WHERE project_id=$1", [PROJECT]);
    await db.query("DELETE FROM public.projects WHERE id=$1", [PROJECT]);
    const gone = await db.query("SELECT id FROM public.projects WHERE id=$1", [PROJECT]);
    expect(gone.rows).toHaveLength(0);
    // Las partidas caen por CASCADE.
    const items = await db.query("SELECT id FROM public.budget_items WHERE project_id=$1", [PROJECT]);
    expect(items.rows).toHaveLength(0);
    await db.close();
  });
});
