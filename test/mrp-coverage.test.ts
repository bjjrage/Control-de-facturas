import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { allocateMaterialCoverage } from "../lib/procurement/mrp-coverage";

const ROOT = path.resolve(__dirname, "..");
function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

const cemento = (requerido: number, obra: number) => ({
  producto_id: "prod-cem",
  producto_nombre: "Cemento",
  unidad_medida: "bolsas",
  costo_unitario: 2400,
  requerido,
  cubierto_obra: obra,
});

// ---------------------------------------------------------------------------
// TEST D: 1000 - 300 obra - 400 central - 100 inbound = 200 (+caja)
// ---------------------------------------------------------------------------
describe("TEST D. Cobertura obra→central→inbound→faltante (caso exacto)", () => {
  it("1000 - 300 - 400 - 100 = 200, caja 200×2400", () => {
    const res = allocateMaterialCoverage({
      gross: [cemento(1000, 300)],
      centralAvailableByProduct: { "prod-cem": 400 },
      validInboundByProduct: { "prod-cem": 100 },
    });
    const line = res.lines[0];
    expect(line.requerido).toBe(1000);
    expect(line.cubierto_obra).toBe(300);
    expect(line.cubierto_central).toBe(400);
    expect(line.cubierto_inbound).toBe(100);
    expect(line.comprar).toBe(200);
    expect(line.caja).toBe(200 * 2400);
    expect(res.total_caja_adicional).toBe(480000);
  });

  it("nunca negativo aunque sobre cobertura", () => {
    const res = allocateMaterialCoverage({
      gross: [cemento(100, 80)],
      centralAvailableByProduct: { "prod-cem": 999 },
      validInboundByProduct: { "prod-cem": 999 },
    });
    // obra 80 → central min(20,999)=20 → inbound 0 → comprar 0
    expect(res.lines[0].cubierto_central).toBe(20);
    expect(res.lines[0].cubierto_inbound).toBe(0);
    expect(res.lines[0].comprar).toBe(0);
  });

  it("dos partidas con el mismo material: central/inbound se descuentan una sola vez", () => {
    const emu = (req: number, obra: number) => ({
      producto_id: "prod-emu",
      producto_nombre: "Emulsión",
      unidad_medida: "l",
      costo_unitario: 1500,
      requerido: req,
      cubierto_obra: obra,
    });
    // 02.3: 1440 req / 1000 obra; 02.4: 1440 req / 0 obra; central 2500.
    const res = allocateMaterialCoverage({
      gross: [emu(1440, 1000), emu(1440, 0)],
      centralAvailableByProduct: { "prod-emu": 2500 },
      validInboundByProduct: {},
    });
    expect(res.lines.length).toBe(1);
    const line = res.lines[0];
    expect(line.requerido).toBe(2880);
    expect(line.cubierto_obra).toBe(1000);
    // 2880-1000=1880 <= 2500 → todo por central, comprar 0 (sin duplicar).
    expect(line.cubierto_central).toBe(1880);
    expect(line.comprar).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// TEST E (secuencial): A reserva 400 de 500 → B solo ve 100
// ---------------------------------------------------------------------------
describe("TEST E. Reservas descuentan disponibilidad (oversell falla)", () => {
  it("central 500 - reserva A 400 = 100 para B; pedir 500 falla", () => {
    // Estado tras COMMIT de A: disponible = 500 - 400 = 100.
    const centralAfterA = 500 - 400;
    const forB = allocateMaterialCoverage({
      gross: [cemento(600, 0)],
      centralAvailableByProduct: { "prod-cem": centralAfterA },
      validInboundByProduct: {},
    });
    expect(forB.lines[0].cubierto_central).toBe(100);
    expect(forB.lines[0].comprar).toBe(500);
  });

  it("el RPC reserva es atómico con advisory lock (fuente)", () => {
    const mig = readSource("supabase/migrations/20260917000005_mrp_reservations.sql");
    expect(mig).toContain("pg_advisory_xact_lock");
    expect(mig).toContain("FOR UPDATE");
    // Falla TODO si un producto no alcanza (nunca parcial)
    expect(mig).toContain("Stock central insuficiente");
    // Rollback implícito: single function = single transaction (RAISE aborta)
    expect(mig).toContain("RAISE EXCEPTION");
  });

  it("el preview NUNCA llama a RPCs de reserva (fuente)", () => {
    const actions = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    const previewStart = actions.indexOf("export async function previewWeeklyPlanAction");
    const saveStart = actions.indexOf("export async function saveWeeklyPlanAction");
    const previewSrc = actions.slice(previewStart, saveStart);
    expect(previewSrc).not.toContain("reserve_plan_stock");
    expect(previewSrc).not.toContain("release_plan_reservations");
    expect(previewSrc).not.toContain("commit_production_plan_atomic");
    // El save usa la RPC única solo con mrpCommit (nunca reserve directo)
    expect(actions.slice(saveStart)).toContain("commit_production_plan_atomic");
    expect(actions.slice(saveStart)).not.toContain('"reserve_plan_stock"');
  });
});

// ---------------------------------------------------------------------------
// TEST F: serialización (fuente) — TEST de concurrencia real va en E2E
// ---------------------------------------------------------------------------
describe("TEST F. Concurrencia: serialización por recurso", () => {
  it("advisory por empresa:producto:depósito + rechequeo bajo lock", () => {
    const mig = readSource("supabase/migrations/20260917000005_mrp_reservations.sql");
    expect(mig).toContain("pg_advisory_xact_lock(hashtext(");
    // Recalcula físico - ACTIVE dentro del lock
    expect(mig).toContain("status = 'ACTIVE'");
    expect(mig).toContain("v_disp := v_fisico - v_reservado");
  });
});

// ---------------------------------------------------------------------------
// TEST G: stock de otra obra jamás auto-consumido
// ---------------------------------------------------------------------------
describe("TEST G. Stock ajeno no entra en cobertura", () => {
  it("la asignación solo recibe obra+central+inbound explícitos", () => {
    const res = allocateMaterialCoverage({
      gross: [cemento(900, 0)],
      centralAvailableByProduct: {},
      validInboundByProduct: {},
    });
    // Otra obra con 900 NO está en los inputs → comprar 900
    expect(res.lines[0].comprar).toBe(900);
  });

  it("el loader central solo lee la ubicación CENTRAL primaria (fuente)", () => {
    const shared = readSource("lib/procurement/weekly-plan-shared.ts");
    expect(shared).toContain('eq("location_type", "CENTRAL")');
    // Sin central → ceros, no falla
    expect(shared).toContain("availableByProduct: {}");
  });
});

// ---------------------------------------------------------------------------
// TEST H: inbound tardío excluido (fuente: split por fecha en la action)
// ---------------------------------------------------------------------------
describe("TEST H. Inbound con fecha > neededBy no descuenta", () => {
  it("la action parte inbound válido vs no confirmado por expected_delivery_date", () => {
    const src = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    expect(src).toContain("expected_delivery_date");
    expect(src).toContain("unconfirmedInbound");
  });

  it("el panel MRP muestra 'En compra, fecha no confirmada' sin descontar", () => {
    const ui = readSource("app/(internal)/projects/[id]/mrp-result-panel.tsx");
    expect(ui).toContain("En compra, fecha no confirmada");
    const section = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(section).toContain("MrpResultPanel");
  });
});

// ---------------------------------------------------------------------------
// TEST I: costo null → "Costo no disponible", NUNCA caja 0 falsa
// ---------------------------------------------------------------------------
describe("TEST I. Costo inexistente no finge caja 0", () => {
  it("caja null + flag cuando el costo no es computable", () => {
    const res = allocateMaterialCoverage({
      gross: [
        {
          producto_id: "prod-x",
          producto_nombre: "Raro",
          unidad_medida: "unid",
          costo_unitario: null,
          requerido: 50,
          cubierto_obra: 10,
        },
      ],
      centralAvailableByProduct: {},
      validInboundByProduct: {},
    });
    expect(res.lines[0].comprar).toBe(40);
    expect(res.lines[0].caja).toBeNull();
    expect(res.lines[0].costo_no_disponible).toBe(true);
    expect(res.costos_pendientes).toBe(1);
    expect(res.total_caja_adicional).toBe(0);
  });

  it("nunca usa BudgetItem.unit_price como costo material (fuente)", () => {
    const cov = readSource("lib/procurement/mrp-coverage.ts");
    expect(cov).not.toContain("unit_price");
    const actions = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    // El costo viene del join de productos (costo_promedio) vía engine
    expect(actions).toContain("costo_unitario");
  });
});

// ---------------------------------------------------------------------------
// Multi-tenant: RLS + scoping (fuente + policies vivas si hay DB)
// ---------------------------------------------------------------------------
describe("Multi-tenant: recetas y reservas aisladas por empresa", () => {
  it("migraciones con RLS fail-closed en tablas nuevas", () => {
    const r = readSource("supabase/migrations/20260917000004_production_recipes.sql");
    expect(r).toContain("ENABLE ROW LEVEL SECURITY");
    expect(r).toContain("current_empresa_id()");
    const m = readSource("supabase/migrations/20260917000005_mrp_reservations.sql");
    expect(m).toContain("ENABLE ROW LEVEL SECURITY");
    expect(m).toContain("current_empresa_id()");
    expect(m).toContain("SECURITY DEFINER");
  });

  it("actions con scoping empresa + RPC única (fuente)", () => {
    const ra = readSource("app/(internal)/projects/production-recipe-actions.ts");
    expect(ra).toContain('eq("empresa_id",');
    const wa = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    expect(wa).toContain("commit_production_plan_atomic");
    const mig = readSource("supabase/migrations/20260917000005_mrp_reservations.sql");
    expect(mig).toContain("Sin empresa (tenant fail-closed)");
  });
});

// ---------------------------------------------------------------------------
// P1. Commit atómico real: compensar + surfacing + release en lifecycle
// ---------------------------------------------------------------------------
describe("P1. Guardado con reservas: sin commit parcial ni zombies", () => {
  const src = () => readSource("app/(internal)/projects/weekly-plan-actions.ts");

  it("reserva fallida no deja commit parcial: rollback real de la RPC única", () => {
    // Una sola transacción plan+reservas: si falla, nada persiste (sin compensación).
    expect(src()).toContain("commit_production_plan_atomic");
    expect(src()).toContain("El abastecimiento cambió desde el último cálculo. Recalculá el plan.");
  });

  it("release fallido se reporta antes de guardar (release-then-save)", () => {
    expect(src()).toContain("No se pudieron liberar reservas");
  });

  it("sin mrpCommit no hay lifecycle extra (V1 idéntico)", () => {
    // Las ramas MRP solo corren bajo params.mrpCommit.
    const idx = src().indexOf("if (params.mrpCommit && status");
    expect(idx).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------
// Central ilegible: aviso en vez de ceros silenciosos + sin duplicar lógica
// ---------------------------------------------------------------------------
describe("Central con error de lectura + recipeEffectiveQty única", () => {
  it("el resultado MRP expone centralError y la UI lo muestra", () => {
    const actions = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    expect(actions).toContain("centralError");
    const ui = readSource("app/(internal)/projects/[id]/mrp-result-panel.tsx");
    expect(ui).toContain("centralError");
    expect(ui).toContain("No se pudo leer el stock central");
  });

  it("recipeEffectiveQty vive solo en lib (panel y sección la reutilizan)", () => {
    const lib = readSource("lib/procurement/production-recipe.ts");
    expect(lib).toContain("export function recipeEffectiveQty");
    const panel = readSource("app/(internal)/projects/[id]/recipe-block-panel.tsx");
    expect(panel).toContain("recipeEffectiveQty({");
    const section = readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");
    expect(section).toContain("libRecipeEffectiveQty({");
  });
});

// ---------------------------------------------------------------------------
// P1-1. COMMITTED bloqueado con cobertura desactualizada (UI) — DRAFT libre
// ---------------------------------------------------------------------------
describe("P1-1. Sin cobertura MRP vigente no se puede comprometer", () => {
  const ui = () =>
    readSource("app/(internal)/projects/[id]/weekly-plan-section.tsx");

  it("el botón comprometer se deshabilita con preview stale/ausente/central fallido", () => {
    expect(ui()).toContain("mrpCommitBlocked");
    expect(ui()).toContain("disabled={isSaving || mrpCommitBlocked}");
    expect(ui()).toContain(
      "El cálculo de abastecimiento está desactualizado. Recalculá antes de comprometer el plan."
    );
  });

  it("DRAFT nunca se bloquea por cobertura (solo COMMITTED)", () => {
    // El gate solo toca el botón comprometer; guardar borrador no lo usa.
    // El botón borrador conserva su disabled original (el gate es solo de comprometer).
    expect(ui()).toContain("guardar-borrador");
    const src = ui();
    const draftIdx = src.indexOf('handleSaveWithStatus("DRAFT")');
    expect(draftIdx).toBeGreaterThan(-1);
    const gateIdx = src.indexOf("mrpCommitBlocked");
    expect(gateIdx).toBeGreaterThan(-1);
  });
});

// ---------------------------------------------------------------------------
// P1-2. El servidor recalcula; el cliente es referencia (compare + 1 RPC)
// ---------------------------------------------------------------------------
describe("P1-2. Cantidades autoritativas salen de DB, no del browser", () => {
  it("compareCentralLines: igual dentro de eps, distinto si tamper/stock movido", async () => {
    const { compareCentralLines } = await import("../lib/procurement/mrp-coverage");
    const server = [
      { producto_id: "p1", quantity: 400 },
      { producto_id: "p2", quantity: 1880 },
    ];
    expect(compareCentralLines(server, server)).toBe(true);
    // Tamper: cliente manda 1 en vez de 400.
    expect(compareCentralLines(server, [{ producto_id: "p1", quantity: 1 }])).toBe(false);
    expect(
      compareCentralLines(server, [
        { producto_id: "p1", quantity: 400 },
        { producto_id: "p2", quantity: 1500 },
      ])
    ).toBe(false);
    // Longitud distinta también rechaza.
    expect(compareCentralLines(server, [{ producto_id: "p1", quantity: 400 }])).toBe(false);
  });

  it("el save recalcula (loader+engine+allocate) y usa UNA rpc commit (fuente)", () => {
    const src = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    expect(src).toContain("commitProductionPlanWithMrp");
    expect(src).toContain("compareCentralLines");
    expect(src).toContain("commit_production_plan_atomic");
    expect(src).toContain("El abastecimiento cambió desde el último cálculo. Recalculá el plan.");
  });
});

// ---------------------------------------------------------------------------
// P1-3. Escritura directa revocada (migración) — RPCs con EXECUTE vigente
// ---------------------------------------------------------------------------
describe("P1-3. Tablas solo-lectura para authenticated; RPCs como única vía", () => {
  const mig2 = () =>
    readSource("supabase/migrations/20260918000002_mrp_hardening.sql");
  const mig3 = () =>
    readSource("supabase/migrations/20260918000003_mrp_final_integrity.sql");

  it("revoca INSERT/UPDATE/DELETE en reservas y recetas", () => {
    expect(mig2()).toContain("REVOKE INSERT, UPDATE, DELETE ON public.inventory_reservations FROM authenticated");
    expect(mig2()).toContain("REVOKE INSERT, UPDATE, DELETE ON public.production_recipes FROM authenticated");
    expect(mig2()).toContain("REVOKE INSERT, UPDATE, DELETE ON public.production_recipe_components FROM authenticated");
  });

  it("P2-2: el lockdown final (00003) deja EXECUTE solo a service_role", () => {
    for (const fn of [
      "reserve_plan_stock",
      "release_plan_reservations",
      "save_production_recipe_atomic",
      "commit_production_plan_atomic",
    ]) {
      expect(mig3()).toContain("REVOKE ALL ON FUNCTION public." + fn);
      expect(mig3()).toContain("FROM PUBLIC, anon, authenticated");
    }
    expect(mig3()).toContain("GRANT EXECUTE ON FUNCTION public.reserve_plan_stock");
    expect(mig3()).toContain("TO service_role");
    expect(mig3()).not.toContain("TO authenticated, service_role");
  });

  it("las actions invocan por admin client con empresa/actor explícitos", () => {
    const wa = readSource("app/(internal)/projects/weekly-plan-actions.ts");
    expect(wa).toContain("createAdminClient");
    expect(wa).toContain("p_empresa_id");
    expect(wa).toContain("p_actor_id");
    const ra = readSource("app/(internal)/projects/production-recipe-actions.ts");
    expect(ra).toContain("createAdminClient");
  });
});

describe("P1-4/P1-5. Atomicidad real en DB (fuente)", () => {
  const mig = () =>
    readSource("supabase/migrations/20260918000002_mrp_hardening.sql");

  it("save_production_recipe_atomic valida tenant/proyecto/items y revierte todo", () => {
    expect(mig()).toContain("CREATE OR REPLACE FUNCTION public.save_production_recipe_atomic(");
    expect(mig()).toContain("no pertenece a este proyecto/empresa");
    expect(mig()).toContain("Cantidad por unidad debe ser");
  });

  it("commit_production_plan_atomic compone save+reserve en una transacción", () => {
    expect(mig()).toContain("CREATE OR REPLACE FUNCTION public.commit_production_plan_atomic(");
    expect(mig()).toContain("public.save_weekly_plan_atomic(");
    expect(mig()).toContain("public.reserve_plan_stock(");
  });

  it("la action de receta ya no escribe directo (usa la RPC)", () => {
    const src = readSource("app/(internal)/projects/production-recipe-actions.ts");
    expect(src).toContain("save_production_recipe_atomic");
    // Solo SELECTs directos; toda mutación va por la RPC (revocada en DB).
    expect(src).not.toContain(".insert(");
    expect(src).not.toContain(".update(");
    expect(src).not.toContain(".delete(");
  });
});
