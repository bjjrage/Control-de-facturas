import * as XLSX from "xlsx";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  buildScheduleUpdates,
  deriveScheduleDates,
  detectScheduleColumns,
  excelSerialToIso,
  interpretScheduleSheet,
  matchScheduleItem,
  normalizeDepType,
  parseDurationDays,
  parseScheduleDate,
  resolveSchedulePredecessors,
  type ScheduleErpItem,
} from "@/lib/schedule/schedule-import";

const ITEMS: ScheduleErpItem[] = [
  { id: "a1", code: "1", description: "Limpieza de terreno" },
  { id: "a2", code: "2", description: "Replanteo y marcación" },
  { id: "a3", code: "3.1", description: "Excavación de pozos y zanjas para fundación" },
];

describe("schedule column detection (no exact headers required)", () => {
  it("detects Spanish schedule headers", () => {
    expect(
      detectScheduleColumns(["Partida", "Descripción", "Inicio", "Fin", "Duración", "Predecesora", "Tipo"])
    ).toMatchObject({ code: 0, description: 1, start: 2, end: 3, duration: 4, predecessor: 5, depType: 6 });
  });

  it("detects equivalent header names", () => {
    expect(
      detectScheduleColumns(["Cod", "Tarea", "Fecha inicio", "Fecha fin", "Días", "Dependencia"])
    ).toMatchObject({ code: 0, description: 1, start: 2, end: 3, duration: 4, predecessor: 5 });
  });

  it("detects English headers", () => {
    expect(detectScheduleColumns(["Item", "Activity", "Start", "End", "Duration", "Predecessor"])).toMatchObject({
      code: 0, description: 1, start: 2, end: 3, duration: 4, predecessor: 5,
    });
  });
});

describe("schedule date parsing (real Excel formats)", () => {
  it("parses dd/mm/yyyy", () => {
    expect(parseScheduleDate("04/10/2025")).toBe("2025-10-04");
  });

  it("parses yyyy-mm-dd", () => {
    expect(parseScheduleDate("2025-10-04")).toBe("2025-10-04");
  });

  it("parses Excel serial numbers", () => {
    expect(excelSerialToIso(45658)).toBe("2025-01-01");
    expect(parseScheduleDate(45658)).toBe("2025-01-01");
  });

  it("parses JS Date objects ignoring time", () => {
    expect(parseScheduleDate(new Date(2025, 9, 4, 15, 30))).toBe("2025-10-04");
  });

  it("rejects garbage without inventing dates", () => {
    expect(parseScheduleDate("s/d")).toBeNull();
    expect(parseScheduleDate("")).toBeNull();
    expect(parseScheduleDate(null)).toBeNull();
    expect(parseScheduleDate(12)).toBeNull();
  });

  it("derives end from start + duration (inclusive days)", () => {
    expect(deriveScheduleDates("2025-10-01", null, 5)).toEqual({ start: "2025-10-01", end: "2025-10-05" });
  });

  it("derives start from end + duration", () => {
    expect(deriveScheduleDates(null, "2025-10-05", 5)).toEqual({ start: "2025-10-01", end: "2025-10-05" });
  });

  it("keeps explicit start + end and never invents from nothing", () => {
    expect(deriveScheduleDates("2025-10-01", "2025-10-03", null)).toEqual({ start: "2025-10-01", end: "2025-10-03" });
    expect(deriveScheduleDates(null, null, null)).toEqual({ start: null, end: null });
  });

  it("parses durations like '12 días'", () => {
    expect(parseDurationDays("12 días")).toBe(12);
    expect(parseDurationDays(7)).toBe(7);
    expect(parseDurationDays("s/d")).toBeNull();
  });

  it("normalizes dependency types", () => {
    expect(normalizeDepType("FS")).toBe("FS");
    expect(normalizeDepType("fin-comienzo (SS)")).toBe("SS");
    expect(normalizeDepType("")).toBeNull();
  });
});

describe("schedule matching (never blocks on unlinked rows)", () => {
  it("matches by exact code first", () => {
    expect(matchScheduleItem("3.1", "otra cosa", ITEMS)).toMatchObject({ itemId: "a3", method: "exact-code" });
  });

  it("matches by normalized code and exact description", () => {
    expect(matchScheduleItem(" 1 ", "otra cosa", ITEMS)).toMatchObject({ itemId: "a1", method: "exact-code" });
    expect(matchScheduleItem("", "Replanteo y marcación", ITEMS)).toMatchObject({ itemId: "a2", method: "exact-desc" });
  });

  it("matches by fuzzy description and leaves unknown rows unlinked", () => {
    expect(matchScheduleItem("", "excavacion pozos zanjas fundacion", ITEMS)?.method).toBe("fuzzy-desc");
    expect(matchScheduleItem("99", "Rubro inexistente total", ITEMS)).toBeNull();
  });
});

describe("schedule sheet interpretation", () => {
  const SHEET = [
    ["Partida", "Descripción", "Inicio", "Fin", "Duración", "Predecesora", "Tipo"],
    ["1", "Limpieza de terreno", "01/10/2025", "05/10/2025", "", "", ""],
    ["2", "Replanteo y marcación", "06/10/2025", "", 3, "1", "FS"],
    ["99", "Rubro fantasma", "06/10/2025", "07/10/2025", "", "", ""],
    ["3.1", "Excavación de pozos", "", "10/10/2025", 2, "", ""],
  ];

  it("detects, matches, derives and flags without blocking", () => {
    const interpreted = interpretScheduleSheet(SHEET, ITEMS);
    expect(interpreted.stats).toEqual({ detected: 4, matched: 3, unlinked: 1 });
    expect(interpreted.rows[1]).toMatchObject({ start: "2025-10-06", end: "2025-10-08", depType: "FS" });
    expect(interpreted.rows[2].match).toBeNull();
    expect(interpreted.rows[3]).toMatchObject({ start: "2025-10-09", end: "2025-10-10" });
  });

  it("resolves predecessors to ERP ids and builds appliable updates only", () => {
    const interpreted = interpretScheduleSheet(SHEET, ITEMS);
    const preds = resolveSchedulePredecessors(interpreted.rows, ITEMS);
    expect(preds.get(1)).toMatchObject({ itemId: "a1", depType: "FS" });
    const updates = buildScheduleUpdates(interpreted.rows, preds);
    expect(updates).toHaveLength(3);
    expect(updates[1]).toMatchObject({ itemId: "a2", start_date: "2025-10-06", end_date: "2025-10-08", depends_on: "a1" });
    // La fila fantasma (índice 2) no genera update ni bloquea al resto.
    expect(updates.every((u) => u.itemId !== "ghost")).toBe(true);
  });

  it("reads the same sheet from a real XLSX buffer", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(SHEET), "Cronograma");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const read = XLSX.read(buf, { type: "buffer", cellDates: true });
    const rows: unknown[][] = XLSX.utils.sheet_to_json(read.Sheets[read.SheetNames[0]], {
      header: 1, raw: true, defval: "",
    });
    const interpreted = interpretScheduleSheet(rows, ITEMS);
    expect(interpreted.stats).toEqual({ detected: 4, matched: 3, unlinked: 1 });
  });
});

describe("schedule persistence safety (temporal columns only)", () => {
  it("updates dates/depends_on without touching quantities or prices", async () => {
    const db = new PGlite();
    await db.exec(`
      CREATE TABLE public.budget_items (
        id uuid PRIMARY KEY, project_id uuid NOT NULL, code text NOT NULL,
        description text NOT NULL, quantity numeric, unit_price numeric,
        start_date date, end_date date, depends_on uuid
      );
      INSERT INTO public.budget_items (id, project_id, code, description, quantity, unit_price)
      VALUES ('11111111-1111-4000-8000-000000000001','22222222-2222-4000-8000-000000000001','1','Limpieza',100,50000);
    `);
    // El server action solo emite este shape: whitelist de 3 columnas temporales.
    await db.query(
      "UPDATE public.budget_items SET start_date=$1, end_date=$2, depends_on=$3 WHERE id=$4 AND project_id=$5",
      ["2025-10-01", "2025-10-05", null, "11111111-1111-4000-8000-000000000001", "22222222-2222-4000-8000-000000000001"]
    );
    const res = await db.query(
      "SELECT code, quantity, unit_price, start_date, end_date FROM public.budget_items"
    );
    const rows = (res.rows as Record<string, unknown>[]).map((r) => ({
      ...r,
      start_date: r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : r.start_date,
      end_date: r.end_date instanceof Date ? r.end_date.toISOString().slice(0, 10) : r.end_date,
    }));
    expect(rows).toEqual([
      { code: "1", quantity: "100", unit_price: "50000", start_date: "2025-10-01", end_date: "2025-10-05" },
    ]);
    await db.close();
  });
});
