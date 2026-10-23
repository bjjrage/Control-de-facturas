import { describe, expect, it } from "vitest";
import { accessFromForm } from "@/lib/empresas/access";
describe("company entitlements input", () => {
  it("preserves explicitly selected modules", () => {
    const form = new FormData(); form.set("plan", "pro"); form.set("modulo_ventas", "on");
    expect(accessFromForm(form)).toMatchObject({ success: true, data: { plan: "pro", modulo_compras: false, modulo_ventas: true } });
  });
  it.each(["enterprise", "", "PRO"])("rejects unsupported plan %s", (plan) => {
    const form = new FormData(); form.set("plan", plan);
    expect(accessFromForm(form).success).toBe(false);
  });
});
