import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const sidebar = read("components/layout/sidebar.tsx");
const dashboard = read("app/(internal)/licitaciones/licitaciones-section.tsx");
const prebidIndex = read("app/(internal)/licitaciones/prebid/page.tsx");
const tenderDetail = read("app/(internal)/licitaciones/[id]/page.tsx");
const existingPrebidRoute = read("app/(internal)/licitaciones/[id]/prebid/page.tsx");
const tenderData = read("app/(internal)/licitaciones/dashboard-data.ts");
const prebidActions = read("lib/workspace/actions.ts");

describe("PREBID visibility surface contract", () => {
  it("adds the PREBID nav entry with the existing plan and role gates", () => {
    expect(sidebar).toMatch(/href: "\/licitaciones\/prebid", label: "PREBID"/);
    expect(sidebar).toContain('roles: ["comercial", "administracion", "admin"]');
    expect(sidebar).toContain('minPlan: "pro"');
    expect(sidebar).toContain('workspace === "licitaciones"');
  });

  it("lists existing tenders and links each one to the existing PREBID workspace", () => {
    expect(prebidIndex).toContain('requirePlan("pro", ["comercial", "administracion", "admin"])');
    expect(prebidIndex).toContain("getLicitacionesPageData(profile)");
    expect(prebidIndex).toContain('href={`/licitaciones/${licitacion.id}/prebid`}');
    expect(prebidIndex).toContain("ABRIR PREBID");
    expect(prebidIndex).toContain("estado_detalle ?? licitacion.estado");
    expect(prebidIndex).toContain("licitacion.fecha_entrega_ofertas");
  });

  it("keeps direct dashboard and tender-detail entries", () => {
    expect(dashboard).toContain('href={`/licitaciones/${lic.id}/prebid`}');
    expect(tenderDetail).toContain('href={`/licitaciones/${id}/prebid`}');
    expect(existingPrebidRoute).toContain("loadPrebidWorkspaceAction(id, version)");
    expect(existingPrebidRoute).toContain("<PrebidWorkspace");
  });

  it("reuses the existing DNCP import flow for the empty state", () => {
    expect(prebidIndex).toContain("No hay licitaciones para preparar.");
    expect(prebidIndex).toContain('<ImportarDialog triggerLabel="IMPORTAR DNCP" />');
    expect(dashboard).toContain("importarLicitacion(valor.trim())");
  });

  it("clarifies historical costs without changing the import action", () => {
    expect(dashboard).not.toContain("Calibrar costos");
    expect(dashboard).not.toContain("Calibrar Cost Engine");
    expect(dashboard).toContain("Costos históricos");
    expect(dashboard).toContain("Base histórica del Cost Engine");
    expect(dashboard).toContain("APUs, cómputos o costos reales de obras anteriores");
    expect(dashboard).toContain("No uses este importador para cargar la oferta económica de la licitación actual.");
    expect(dashboard).toContain("importarPlanillaCostosHistoricos(fd)");
  });

  it("reuses tenant-scoped tender access and existing PREBID permissions", () => {
    expect(tenderData).toContain('.from("licitaciones")');
    expect(prebidIndex).toContain('requirePlan("pro", ["comercial", "administracion", "admin"])');
    expect(prebidActions).toContain('requirePlan("pro", ["comercial", "administracion", "admin"])');
    expect(prebidActions).toContain('.eq("empresa_id", profile.empresa_id)');
  });
});
