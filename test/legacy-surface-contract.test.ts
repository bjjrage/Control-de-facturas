import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(__dirname, "..");
function readSource(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

describe("legacy ERP surface contract", () => {
  it("restores direct global links and keeps the project-folder additions reachable", () => {
    const sidebar = readSource("components/layout/sidebar.tsx");
    const topbar = readSource("components/layout/topbar.tsx");
    const layout = readSource("app/(internal)/layout.tsx");

    expect(sidebar).toContain('href: "/projects"');
    expect(sidebar).toContain('href: "/licitaciones"');
    expect(sidebar).toContain('href: "/inventario"');
    expect(sidebar).toContain('{ key: "inventario", label: "Inventario"');
    expect(sidebar).toContain('{ key: "recepciones", label: "Recepciones"');
    expect(sidebar).toContain('{ key: "panol", label: "Pañol"');
    expect(topbar).not.toContain("WorkspaceSwitcher");
    expect(layout).toContain("<PlanNav");
  });

  it("serves the historical dashboard cards and recent requests in both render paths", () => {
    const data = readSource("app/(internal)/dashboard/data.ts");
    const view = readSource("app/(internal)/dashboard/dashboard-view.tsx");
    const action = readSource("app/(internal)/dashboard/section-action.ts");

    for (const label of [
      "Solicitudes abiertas",
      "Con ofertas para elegir",
      "Facturas pendientes",
      "Requieren revisión",
      "Aptas para pago",
      "Ventas por cobrar",
      "Ventas vencidas",
      "NC sin FE emitida",
      "Productos bajo mínimo",
      "Documentos por vencer",
      "Licitaciones cierran esta semana",
    ]) {
      expect(data).toContain(`label: "${label}"`);
    }
    expect(view).toContain("legacyStats.map");
    expect(view).toContain("Solicitudes recientes");
    expect(view).toContain("href={`/rfqs/${rfq.id}`}");
    expect(action).toContain("getDashboardViewData");
  });
});
