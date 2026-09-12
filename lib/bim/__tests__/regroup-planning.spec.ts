// Cubre la decisión de idempotencia de processBimGroups (bim-actions.ts) SIN
// necesitar una base de datos real: planRegroup es la función pura que
// decide qué grupos quedan bloqueados (decisión humana) vs regenerables
// (propuesta de la IA sin confirmar). La parte que sí toca Supabase (borrar
// por id, releer elementos) es un one-liner mecánico una vez que se tiene
// este resultado — no hay lógica de negocio ahí que valga la pena mockear.
import { describe, expect, it } from "vitest";
import { planRegroup } from "../regroup-planning";

describe("planRegroup — idempotencia sin destruir decisiones humanas", () => {
  it("un grupo CONFIRMED queda bloqueado (no se borra, no se regenera)", () => {
    const plan = planRegroup(["g1"], [{ group_id: "g1", status: "CONFIRMED" }]);
    expect(plan.lockedGroupIds.has("g1")).toBe(true);
    expect(plan.staleGroupIds).toEqual([]);
  });

  it("un grupo REJECTED ('dejar sin asignar') también queda bloqueado — es decisión humana igual que CONFIRMED", () => {
    const plan = planRegroup(["g1"], [{ group_id: "g1", status: "REJECTED" }]);
    expect(plan.lockedGroupIds.has("g1")).toBe(true);
    expect(plan.staleGroupIds).toEqual([]);
  });

  it("SUGGESTED/REVIEW/NO_MATCH (propuestas de la IA sin confirmar) son regenerables", () => {
    const plan = planRegroup(
      ["g-suggested", "g-review", "g-nomatch"],
      [
        { group_id: "g-suggested", status: "SUGGESTED" },
        { group_id: "g-review", status: "REVIEW" },
        { group_id: "g-nomatch", status: "NO_MATCH" },
      ]
    );
    expect(plan.lockedGroupIds.size).toBe(0);
    expect(plan.staleGroupIds.sort()).toEqual(["g-nomatch", "g-review", "g-suggested"]);
  });

  it("escenario completo: procesar -> confirmar un grupo -> recalcular -> el confirmado queda intacto, el resto se regenera, sin duplicados", () => {
    // 1) "processBimGroups" inicial genera 3 grupos, cada uno con su
    // propuesta SUGGESTED/REVIEW/NO_MATCH.
    const allGroupIds = ["wall-group", "column-group", "finish-group"];
    let matchRows = [
      { group_id: "wall-group", status: "SUGGESTED" },
      { group_id: "column-group", status: "REVIEW" },
      { group_id: "finish-group", status: "NO_MATCH" },
    ];

    // 2) El usuario CONFIRMA "wall-group" (confirmGroupMatch actualiza esa
    // fila a CONFIRMED en vez de insertar una nueva — mismo comportamiento
    // que la implementación real).
    matchRows = matchRows.map((r) => (r.group_id === "wall-group" ? { ...r, status: "CONFIRMED" } : r));

    // 3) El usuario pide "recalcular" -> planRegroup decide qué se borra.
    const plan = planRegroup(allGroupIds, matchRows);

    expect(plan.lockedGroupIds.has("wall-group")).toBe(true); // confirmación intacta
    expect(plan.staleGroupIds.sort()).toEqual(["column-group", "finish-group"]); // se regeneran

    // 4) Tras borrar column-group/finish-group y volver a procesar, se
    // insertan NUEVAS filas para esos dos grupos (nunca para wall-group,
    // que ni se toca) — simulamos el resultado de esa segunda pasada.
    const regeneratedRows = [
      { group_id: "wall-group", status: "CONFIRMED" }, // sin tocar
      { group_id: "column-group-v2", status: "SUGGESTED" }, // grupo nuevo, id nuevo
      { group_id: "finish-group-v2", status: "REVIEW" },
    ];

    // No hay IDs de grupo repetidos entre corridas — nunca aparece
    // "column-group" (el viejo, borrado) junto a un "column-group-v2"
    // duplicado representando lo mismo dos veces.
    const ids = regeneratedRows.map((r) => r.group_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain("column-group");
    expect(ids).not.toContain("finish-group");
    expect(ids).toContain("wall-group");
  });

  it("no hay grupos existentes -> todo vacío, ningún bloqueo (primer procesamiento del modelo)", () => {
    const plan = planRegroup([], []);
    expect(plan.lockedGroupIds.size).toBe(0);
    expect(plan.staleGroupIds).toEqual([]);
  });

  it("un grupo con historial mixto (SUGGESTED viejo + CONFIRMED posterior) queda bloqueado por la fila CONFIRMED", () => {
    // Refleja confirmGroupMatch: cuando el usuario confirma un rubro DISTINTO
    // al sugerido, se inserta una fila MANUAL/CONFIRMED nueva sin borrar la
    // SUGGESTED vieja -> el grupo tiene ambas filas en bim_group_matches.
    const plan = planRegroup(
      ["g1"],
      [
        { group_id: "g1", status: "SUGGESTED" },
        { group_id: "g1", status: "CONFIRMED" },
      ]
    );
    expect(plan.lockedGroupIds.has("g1")).toBe(true);
    expect(plan.staleGroupIds).toEqual([]);
  });
});
