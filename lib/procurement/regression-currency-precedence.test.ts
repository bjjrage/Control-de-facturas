import { describe, it, expect, beforeAll } from "vitest";
import { createClient } from "@supabase/supabase-js";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Regression: Currency Precedence & Fail-Closed Integrity", () => {
  let supabase: any;

  beforeAll(() => {
    const env = Object.fromEntries(
      fs.readFileSync(path.resolve(process.cwd(), ".env.local"), "utf8")
        .split("\n")
        .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
        .map((l) => {
          const i = l.indexOf("=");
          return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
        })
    );
    expect(env.NEXT_PUBLIC_SUPABASE_URL).toContain("klvvlybltcmowoptogpe");
    supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
  });

  it("1. tender.value.currency takes precedence when both tender and planning currencies exist", async () => {
    const ocid = "ocds-03ad3f-test-curr-tender-precedence-" + Date.now();
    const payload = {
      compiledRelease: {
        ocid,
        date: new Date().toISOString(),
        tender: {
          id: "test-tender-1",
          title: "Test Tender Precedence",
          status: "active",
          value: { amount: 1000, currency: "USD" }
        },
        planning: {
          budget: {
            amount: { amount: 7000000, currency: "PYG" }
          }
        }
      }
    };

    const { data: id, error } = await supabase.rpc("ingestar_proceso_ocds_global", {
      p_cr: payload,
      p_fuente: "TEST_REGRESSION"
    });

    expect(error).toBeNull();
    expect(id).toBeDefined();

    const { data: row } = await supabase.from("procurement_processes").select("moneda, monto_referencial, monto_disponible").eq("id", id).single();
    expect(row.moneda).toBe("USD");
    expect(row.monto_referencial).toBe(1000);
    expect(row.monto_disponible).toBe(7000000);

    // cleanup
    await supabase.from("procurement_processes").delete().eq("id", id);
  });

  it("2. planning.budget.amount.currency is recovered when tender currency is missing", async () => {
    const ocid = "ocds-03ad3f-test-curr-planning-recovery-" + Date.now();
    const payload = {
      compiledRelease: {
        ocid,
        date: new Date().toISOString(),
        tender: {
          id: "planned",
          status: "planning"
        },
        planning: {
          budget: {
            description: "Planning Only Title",
            amount: { amount: 50000000, currency: "PYG" }
          }
        }
      }
    };

    const { data: id, error } = await supabase.rpc("ingestar_proceso_ocds_global", {
      p_cr: payload,
      p_fuente: "TEST_REGRESSION"
    });

    expect(error).toBeNull();
    expect(id).toBeDefined();

    const { data: row } = await supabase.from("procurement_processes").select("moneda, titulo, monto_disponible").eq("id", id).single();
    expect(row.moneda).toBe("PYG");
    expect(row.titulo).toBe("Planning Only Title");
    expect(row.monto_disponible).toBe(50000000);

    // cleanup
    await supabase.from("procurement_processes").delete().eq("id", id);
  });

  it("3. FAILS CLOSED when neither tender nor planning have currency", async () => {
    const ocid = "ocds-03ad3f-test-curr-fail-closed-" + Date.now();
    const payload = {
      compiledRelease: {
        ocid,
        date: new Date().toISOString(),
        tender: {
          id: "planned",
          status: "planning"
        },
        planning: {
          budget: {
            description: "No Currency Anywhere"
          }
        }
      }
    };

    const { data: id, error } = await supabase.rpc("ingestar_proceso_ocds_global", {
      p_cr: payload,
      p_fuente: "TEST_REGRESSION"
    });

    expect(error).not.toBeNull();
    expect(error.code).toBe("23502"); // NOT NULL violation on moneda
    expect(id).toBeNull();
  });
});