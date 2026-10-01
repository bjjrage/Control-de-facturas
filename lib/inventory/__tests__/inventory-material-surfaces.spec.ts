import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const materialsPage = read("app/(internal)/stock/page.tsx");
const materialsSection = read("app/(internal)/stock/stock-section.tsx");
const materialDetail = read("app/(internal)/stock/[id]/page.tsx");
const stockScreen = read("app/(internal)/inventario/inventario-global-section.tsx");
const initialStockDialog = read("app/(internal)/inventario/carga-inicial-stock-dialog.tsx");
const manualMovement = read("lib/inventory/manual.ts");
const locationService = read("lib/inventory/service.ts");
const locationsAction = read("app/(internal)/inventory/actions.ts");
const sidebar = read("components/layout/sidebar.tsx");
const projectsPortfolio = read("app/(internal)/projects/portfolio-data.ts");

describe("superficies de materiales y stock canónico", () => {
  it("mantiene el maestro separado de las existencias legacy", () => {
    expect(materialsSection).toContain("Materiales");
    expect(materialsPage).not.toContain("stock_actual");
    expect(materialDetail).toContain("Stock e Inventario");
    expect(materialDetail).not.toMatch(/stock_movimientos|stock_por_deposito|depositos|stock_actual|costo_promedio/);
  });

  it("expone carga inicial, ubicaciones y movimientos sobre el ledger canónico", () => {
    expect(stockScreen).toContain("Stock e Inventario");
    expect(stockScreen).toContain("CargaInicialStockDialog");
    expect(stockScreen).toContain("UbicacionesDialog");
    expect(initialStockDialog).toContain("postCanonicalInventoryMovement");
    expect(initialStockDialog).toContain('movementType: "ADJUSTMENT"');
    expect(manualMovement).toContain('reason_type: "INITIAL_STOCK"');
    expect(initialStockDialog).not.toMatch(/\.from\(["']inventory_balances["']\)\s*\.insert/);
  });

  it("crea/reutiliza ubicaciones de obra dentro de la empresa y publica ambas rutas de acceso", () => {
    expect(locationService).toContain("ensureProjectInventoryLocation");
    expect(locationService).toContain('.eq("empresa_id", args.empresaId)');
    expect(locationService).toContain('.eq("project_id", args.projectId)');
    expect(locationsAction).toContain("ensureProjectInventoryLocation");
    expect(sidebar).toContain('label: "Materiales"');
    expect(sidebar).toContain('label: "Stock e Inventario"');
  });

  it("calcula la alerta operativa con el agregado canónico de stock", () => {
    expect(projectsPortfolio).toContain('from("inventory_stock_global_quantity")');
    expect(projectsPortfolio).not.toContain('select("id, stock_actual, stock_minimo")');
  });
});
