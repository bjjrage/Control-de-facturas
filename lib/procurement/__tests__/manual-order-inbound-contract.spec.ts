import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const action = readFileSync(
  resolve(process.cwd(), "app/(internal)/orders/actions.ts"),
  "utf8",
);
const dialog = readFileSync(
  resolve(process.cwd(), "app/(internal)/orders/order-dialog.tsx"),
  "utf8",
);

describe("manual purchase order MRP inputs", () => {
  it("persists tenant-validated catalog product and optional expected delivery date on each OC line", () => {
    expect(action).toContain('.from("productos")');
    expect(action).toContain('.eq("empresa_id", profile.empresa_id)');
    expect(action).toContain("selectedProduct.unidad.trim() !== item.unit.trim()");
    expect(action).toContain("producto_id: item.producto_id?.trim() || null");
    expect(action).toContain("expected_delivery_date: item.expected_delivery_date || null");
    expect(action).toContain("isDateOnly(item.expected_delivery_date)");
  });

  it("lets the user link a stock product and set the line's delivery date", () => {
    expect(dialog).toContain('value={row.producto_id}');
    expect(dialog).toContain('value={row.expected_delivery_date}');
    expect(dialog).toContain("producto_id: r.producto_id || null");
    expect(dialog).toContain("expected_delivery_date: r.expected_delivery_date || null");
  });
});
