import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canAccessProjectFeature,
  getProjectFeature,
  getProjectFeatureGroups,
  PROJECT_FEATURES,
} from "./project-features";

const repoRoot = process.cwd();
const rendererSource = fs.readFileSync(
  path.join(repoRoot, "app", "(internal)", "projects", "[id]", "project-tabs-client.tsx"),
  "utf8"
);
const bimSource = fs.readFileSync(
  path.join(repoRoot, "app", "(internal)", "projects", "[id]", "bim-section.tsx"),
  "utf8"
);
const physicalProgressSource = fs.readFileSync(
  path.join(repoRoot, "app", "(internal)", "projects", "[id]", "avance-fisico-panel.tsx"),
  "utf8"
);
const topbarSource = fs.readFileSync(path.join(repoRoot, "components", "layout", "topbar.tsx"), "utf8");
const sidebarSource = fs.readFileSync(path.join(repoRoot, "components", "layout", "sidebar.tsx"), "utf8");
const stockCatalogSource = fs.readFileSync(path.join(repoRoot, "app", "(internal)", "stock", "stock-section.tsx"), "utf8");
const inventorySource = fs.readFileSync(
  path.join(repoRoot, "app", "(internal)", "inventario", "inventario-global-section.tsx"),
  "utf8"
);

describe("project surface contract", () => {
  it("has unique keys and valid groups", () => {
    const keys = PROJECT_FEATURES.map((feature) => feature.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(getProjectFeatureGroups().flatMap((group) => group.features)).toHaveLength(PROJECT_FEATURES.length);
    expect(PROJECT_FEATURES.every((feature) => getProjectFeature(feature.key).group === feature.group)).toBe(true);
  });

  it("requires an explicit renderer for every active project surface", () => {
    for (const feature of PROJECT_FEATURES) {
      expect(rendererSource).toContain(`tab === "${feature.key}"`);
    }
  });

  it("keeps the deliberate commercial gates aligned", () => {
    const bim = getProjectFeature("bim");
    const weeklyPlan = getProjectFeature("plan-semanal");
    expect(canAccessProjectFeature(bim, { role: "administracion", plan: "pro" })).toBe(false);
    expect(canAccessProjectFeature(bim, { role: "administracion", plan: "caterpillar" })).toBe(true);
    expect(canAccessProjectFeature(weeklyPlan, { role: "administracion", plan: "pro" })).toBe(true);
  });

  it("exposes the recovered project surfaces and keeps legacy stock out of active nav", () => {
    expect(PROJECT_FEATURES.map((feature) => feature.key)).toEqual(expect.arrayContaining([
      "plan-semanal",
      "inventario",
      "recepciones",
      "panol",
      "certificados",
      "avance-fisico",
      "bim",
    ]));
    expect((PROJECT_FEATURES as readonly { key: string }[]).some((feature) => feature.key === "stock")).toBe(false);
  });

  it("keeps all 18 canonical project surfaces visible through the shared registry", () => {
    expect(PROJECT_FEATURES).toHaveLength(18);
    expect(getProjectFeature("inventario").label).toBe("Inventario");
    expect(getProjectFeature("recepciones").label).toBe("Recepciones");
    expect(getProjectFeature("panol").label).toBe("Depósito de obra");
    expect(getProjectFeature("ejecucion").label).toBe("Partes de avance");
    expect(getProjectFeatureGroups().map((group) => group.label)).toContain("Avance de obra");
    expect(topbarSource).toContain("PROJECT_FEATURES.map(({ key, group, label })");
    expect(topbarSource).toContain('PROJECT_TAB_CONTEXT.stock = { group: "Avance de obra", label: "Catálogo de materiales (legado)" }');
    expect(sidebarSource).toContain("getProjectFeatureGroups");
    expect(sidebarSource).not.toContain("PROJECT_NAV_HIDDEN_FEATURE_KEYS");
  });

  it("distinguishes canonical inventory from legacy material-catalog balances", () => {
    expect(inventorySource).toContain(">Inventario</h1>");
    expect(inventorySource).toContain("dominio canónico de inventario");
    expect(stockCatalogSource).toContain(">Catálogo de materiales</h1>");
    expect(stockCatalogSource).toContain("no saldos autoritativos");
    expect(stockCatalogSource).toContain('href="/inventario"');
    expect(stockCatalogSource).toContain("Stock de referencia");
  });

  it("renders one BIM composition with an accessible IFC CTA and one compute fallback", () => {
    expect(bimSource.match(/<ComputoSection\b/g)).toHaveLength(1);
    expect(bimSource).toContain("MODELO BIM / IFC");
    expect(bimSource).toContain("Subir modelo IFC");
    expect(bimSource).toContain('accept=".ifc"');
    expect(bimSource).toContain("OPCIÓN B · CÓMPUTO EXCEL/PDF");
  });

  it("keeps weekly planning as one navigable surface instead of embedding a duplicate", () => {
    expect(rendererSource).toContain('tab === "plan-semanal"');
    expect(physicalProgressSource).not.toContain("WeeklyPlanSection");
  });
});
