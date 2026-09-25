import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getProjectFeature } from "@/lib/projects/project-features";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("field operations QR product contract", () => {
  it("uses construction wording for the project navigation and daily report", () => {
    expect(getProjectFeature("ejecucion")).toMatchObject({
      label: "Partes de avance",
      group: "Avance de obra",
    });
    expect(read("app/(internal)/projects/[id]/execution-link-dialog.tsx")).toContain("QR para Residente");
    expect(read("app/(internal)/projects/[id]/execution-link-dialog.tsx")).not.toContain("capataz");
    expect(read("app/avance/[token]/page.tsx")).toContain("Registrar parte diario");
    expect(read("app/avance/[token]/avance-form.tsx")).toContain("Registrar parte diario");
    expect(read("app/(internal)/projects/[id]/ejecucion-table.tsx")).not.toContain("capataz");
  });

  it("keeps the resident QR tied to the existing avance token portal", () => {
    const dialog = read("app/(internal)/projects/[id]/execution-link-dialog.tsx");
    const portal = read("app/avance/[token]/page.tsx");
    expect(dialog).toContain("`${appUrl}/avance/${token}`");
    expect(dialog).toContain("QRCode.toDataURL(portalUrl");
    expect(dialog).toContain("Descargar QR");
    expect(dialog).toContain("Copiar link");
    expect(portal).toContain("<AvanceForm token={token}");
  });

  it("shows one-time warehouse QR material while preserving scoped revoke and rotate actions", () => {
    const section = read("app/(internal)/projects/[id]/panol-obra-section.tsx");
    const actions = read("app/(internal)/inventory/actions.ts");
    const portal = read("app/warehouse/[token]/page.tsx");
    expect(section).toContain("QR para Depositero");
    expect(section).toContain("QRCode.toDataURL(createdLink.url");
    expect(section).toContain("Descargar QR");
    expect(section).toContain("Copiar link");
    expect(section).toContain("Regenerar QR");
    expect(section).toContain("Revocar");
    expect(section).toContain("Activo");
    expect(section).toContain("Inactivo");
    expect(actions).toContain('.from("warehouse_portal_links").insert({');
    expect(actions).toContain('.eq("empresa_id", profile.empresa_id)');
    expect(portal).toContain('.from("warehouse_portal_links")');
    expect(portal).toContain("hashWarehousePortalToken(token)");
  });
});
