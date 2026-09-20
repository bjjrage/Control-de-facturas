import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { workspaceForPath } from "@/components/layout/workspace";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8").replace(/\r\n/g, "\n");

describe("dashboard workspace separation", () => {
  it("keeps the administration loader free of tender and portfolio queries", () => {
    const source = read("app/(internal)/dashboard/data.ts");
    expect(source).not.toContain('from("licitaciones")');
    expect(source).not.toContain('from("licitacion_documentos")');
    expect(source).not.toContain('from("empresa_documentos")');
    expect(source).not.toContain('from("project_certificates")');
    expect(source).not.toContain('from("projects")');
    expect(source).not.toContain('from("budget_items")');
    expect(source).not.toContain('from("execution_entries")');
    expect(read("app/(internal)/dashboard/dashboard-view.tsx")).not.toContain("PortfolioTable");
    expect(read("app/(internal)/dashboard/dashboard-view.tsx")).not.toContain("PanoramaObras");
  });

  it("keeps the operational loader free of general administration and tender queries", () => {
    const source = read("app/(internal)/projects/portfolio-data.ts");
    expect(source).toContain('from("projects")');
    expect(source).toContain('from("budget_items")');
    expect(source).toContain('from("authorized_orders")');
    expect(source).not.toContain('from("sales_documents")');
    expect(source).not.toContain('from("invoices")');
    expect(source).not.toContain('from("cuentas_financieras")');
    expect(source).not.toContain('from("licitaciones")');
  });

  it("keeps the tender loader free of administration and portfolio queries", () => {
    const source = read("app/(internal)/licitaciones/dashboard-data.ts");
    expect(source).toContain('from("licitaciones")');
    expect(source).toContain('from("licitacion_documentos")');
    expect(source).toContain('from("empresa_documentos")');
    expect(source).not.toContain('from("projects")');
    expect(source).not.toContain('from("budget_items")');
    expect(source).not.toContain('from("sales_documents")');
    expect(source).not.toContain('from("invoices")');
  });

  it("routes each workspace home to its own domain", () => {
    expect(workspaceForPath("/dashboard")).toBe("administracion");
    expect(workspaceForPath("/projects")).toBe("operativo");
    expect(workspaceForPath("/projects/123")).toBe("operativo");
    expect(workspaceForPath("/licitaciones")).toBe("licitaciones");
    expect(workspaceForPath("/licitaciones/documentos")).toBe("licitaciones");
  });
});
