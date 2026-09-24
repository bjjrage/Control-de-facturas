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
