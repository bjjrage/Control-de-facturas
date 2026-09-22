import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  canAccessProjectFeature,
  getProjectFeature,
  getProjectFeatureGroups,
  isProjectFeatureKey,
  PROJECT_FEATURES,
} from "./project-features";

const repoRoot = process.cwd();
const rendererSource = fs.readFileSync(
  path.join(repoRoot, "app", "(internal)", "projects", "[id]", "project-tabs-client.tsx"),
  "utf8"
);
const projectPageSource = fs.readFileSync(
  path.join(repoRoot, "app", "(internal)", "projects", "[id]", "page.tsx"),
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
const sidebarSource = fs.readFileSync(path.join(repoRoot, "components", "layout", "sidebar.tsx"), "utf8");

describe("project surface contract", () => {
  it("has unique keys and valid groups", () => {
    const keys = PROJECT_FEATURES.map((feature) => feature.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(getProjectFeatureGroups().flatMap((group) => group.features)).toHaveLength(PROJECT_FEATURES.length - 3);
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

  it("keeps compatibility routes while exposing only Stock / Materiales in project stock navigation", () => {
    const routeKeys = ["stock", "inventario", "recepciones", "panol"] as const;
    expect(routeKeys.every((key) => isProjectFeatureKey(key))).toBe(true);
    expect(routeKeys.every((key) => rendererSource.includes(`tab === "${key}"`))).toBe(true);
    expect(projectPageSource).toContain("isProjectFeatureKey(rawTab)");
    expect(projectPageSource).toContain("getProjectFeature(rawTab)");

    const executingNav = getProjectFeatureGroups().find((group) => group.label === "Ejecutar");
    const stockNavKeys = executingNav?.features
      .map((feature) => feature.key)
      .filter((key) => routeKeys.includes(key as (typeof routeKeys)[number]));
    expect(stockNavKeys).toEqual(["stock"]);
    expect(getProjectFeature("stock").label).toBe("Stock / Materiales");
  });

  it("keeps /stock as the only global stock entry and leaves /inventario unlinked", () => {
    const comprasNav = sidebarSource.match(/const COMPRAS_ITEMS: NavItem\[\] = \[([\s\S]*?)\n\];/)?.[1] ?? "";
    const stockItems = [...comprasNav.matchAll(/\{ href: "(\/[^\"]+)", label: "([^\"]+)"/g)]
      .filter(([, href]) => href === "/stock" || href === "/inventario")
      .map(([, href, label]) => ({ href, label }));

    expect(stockItems).toEqual([{ href: "/stock", label: "Stock" }]);
    expect(comprasNav).not.toContain('href: "/inventario"');
    expect(fs.existsSync(path.join(repoRoot, "app", "(internal)", "stock", "page.tsx"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "app", "(internal)", "inventario", "page.tsx"))).toBe(true);
  });

  it("renders one BIM composition with an accessible IFC CTA and one compute fallback", () => {
    expect(bimSource.match(/<ComputoSection\b/g)).toHaveLength(1);
    expect(bimSource).toContain("MODELO BIM / IFC");
    expect(bimSource).toContain("Subir modelo IFC");
    expect(bimSource).toContain('accept=".ifc"');
    expect(bimSource).toContain("CÓMPUTO SIN MODELO BIM");
  });

  it("keeps weekly planning as one navigable surface instead of embedding a duplicate", () => {
    expect(rendererSource).toContain('tab === "plan-semanal"');
    expect(physicalProgressSource).not.toContain("WeeklyPlanSection");
  });
});
