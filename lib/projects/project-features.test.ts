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
const ganttSource = fs.readFileSync(path.join(repoRoot, "app", "(internal)", "projects", "[id]", "project-gantt.tsx"), "utf8");
const projectActionsSource = fs.readFileSync(path.join(repoRoot, "app", "(internal)", "projects", "actions.ts"), "utf8");
const topbarSource = fs.readFileSync(path.join(repoRoot, "components", "layout", "topbar.tsx"), "utf8");
const sidebarSource = fs.readFileSync(path.join(repoRoot, "components", "layout", "sidebar.tsx"), "utf8");
const layoutSource = fs.readFileSync(path.join(repoRoot, "app", "(internal)", "layout.tsx"), "utf8");
const projectPageSource = fs.readFileSync(path.join(repoRoot, "app", "(internal)", "projects", "[id]", "page.tsx"), "utf8");
const adminDashboardSource = fs.readFileSync(path.join(repoRoot, "app", "(internal)", "dashboard", "data.ts"), "utf8");
const stockCatalogSource = fs.readFileSync(path.join(repoRoot, "app", "(internal)", "stock", "stock-section.tsx"), "utf8");
const inventorySource = fs.readFileSync(
  path.join(repoRoot, "app", "(internal)", "inventario", "inventario-global-section.tsx"),
  "utf8"
);

function sourceBlock(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start === -1 || end === -1) throw new Error(`Could not locate source block: ${startMarker}`);
  return source.slice(start, end);
}

const operativoItemsSource = sourceBlock(
  sidebarSource,
  "const OPERATIVO_ITEMS: NavItem[] = [",
  "const LICITACIONES_ITEMS: NavItem[] = ["
);
const comprasItemsSource = sourceBlock(
  sidebarSource,
  "const COMPRAS_ITEMS: NavItem[] = [",
  "const FINANZAS_ITEMS: NavItem[] = ["
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

  it("guarantees every Pro project surface is available in Caterpillar", () => {
    const proKeys = PROJECT_FEATURES.filter((feature) => feature.minPlan === "pro").map((feature) => feature.key);
    const caterpillarKeys = PROJECT_FEATURES
      .filter((feature) => canAccessProjectFeature(feature, { role: "administracion", plan: "caterpillar" }))
      .map((feature) => feature.key);

    expect(caterpillarKeys).toEqual(expect.arrayContaining(proKeys));
    for (const key of proKeys) {
      expect(canAccessProjectFeature(getProjectFeature(key), { role: "administracion", plan: "pro" })).toBe(true);
      expect(canAccessProjectFeature(getProjectFeature(key), { role: "administracion", plan: "caterpillar" })).toBe(true);
    }
  });

  it("keeps the Operativo root limited to Dashboard and its project-selection guidance", () => {
    const items = [...operativoItemsSource.matchAll(/href: "([^"]+)", label: "([^"]+)"/g)].map((match) => ({
      href: match[1],
      label: match[2],
    }));

    expect(items).toEqual([{ href: "/projects", label: "Dashboard" }]);
    expect(operativoItemsSource).not.toContain('href: "/stock"');
    expect(operativoItemsSource).not.toContain('href: "/inventario"');
    expect(sidebarSource).toContain('workspace === "operativo" ? (');
    expect(sidebarSource).toContain("Elegí una obra para habilitar las herramientas operativas.");
  });

  it("keeps global Materials and Inventory under Administración → Comprar", () => {
    expect(comprasItemsSource).toContain('href: "/stock", label: "Materiales"');
    expect(comprasItemsSource).toContain('href: "/inventario", label: "Stock e Inventario"');
    expect(sidebarSource).toContain('renderSection("Comprar", comprasItems)');
  });

  it("keeps project inventory tools inside the selected project", () => {
    expect(getProjectFeature("inventario").label).toBe("Inventario");
    expect(getProjectFeature("recepciones").label).toBe("Recepciones");
    expect(getProjectFeature("panol").label).toBe("Depósito de obra");
    expect(sidebarSource).toContain("{PROJECT_TAB_GROUPS.map(renderProjectSection)}");
    expect(sidebarSource).toContain('const url = `/projects/${activeProjectId}?tab=${t.key}`;');
    expect(sidebarSource).toContain('new CustomEvent("niupack:tab", { detail: t.key })');
  });

  it("keeps administration entry points and superadmin access coherent", () => {
    expect(sidebarSource).toContain('const COMPRAS_ITEMS: NavItem[]');
    expect(sidebarSource).toContain('plan === "caterpillar" || isSuperAdmin');
    expect(sidebarSource).toContain('(plan !== "basico" || isSuperAdmin)');
    expect(layoutSource).toContain('planMeetsMinimum(profile.plan, "pro", profile.is_super_admin)');
    expect(projectPageSource).toContain('profile.plan === "caterpillar" || profile.is_super_admin');
    expect(adminDashboardSource).toContain("p.modulo_compras || p.is_super_admin");
    expect(adminDashboardSource).toContain("p.modulo_ventas || p.is_super_admin");
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
    expect(inventorySource).toContain(">Stock e Inventario</h1>");
    expect(inventorySource).toContain("dominio canónico certificado");
    expect(stockCatalogSource).toContain(">Materiales</h1>");
    expect(stockCatalogSource).toContain("no implica que haya stock");
    expect(stockCatalogSource).toContain('href="/inventario"');
    expect(stockCatalogSource).not.toContain("stock_actual");
    expect(stockCatalogSource).not.toContain("stock_por_proyecto");
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

  it("makes the existing Gantt schedulable without changing its progress or climate sources", () => {
    expect(getProjectFeature("cronograma").label).toBe("Cronograma / Gantt");
    expect(ganttSource).toContain("ProgramarPartidasDialog budgetItems={budgetItems}");
    expect(ganttSource).toContain("if (rows.length === 0)");
    expect(ganttSource).toContain("budgetItems.filter((i) => i.start_date && i.end_date)");
    expect(ganttSource).toContain("e.quantity_executed");
    expect(ganttSource).toContain("updateBudgetItemSchedule(id, toIso(s), toIso(en))");
    expect(projectActionsSource).toContain('.from("budget_items")');
    expect(projectActionsSource).toContain(".update(update)");
    expect(projectActionsSource).toContain("if (dependsOn !== undefined) update.depends_on = dependsOn");
    expect(rendererSource).toContain("<ClimateWorkdaysPanel");
  });
});
