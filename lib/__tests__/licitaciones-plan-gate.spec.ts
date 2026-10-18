import { describe, expect, it, vi } from "vitest";

const requirePlan = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ requirePlan }));

import LicitacionesLayout from "@/app/(internal)/licitaciones/layout";

describe("licitaciones route access", () => {
  it("checks the Pro plan at the shared server entry before rendering child routes", async () => {
    requirePlan.mockRejectedValueOnce(new Error("plan denied"));
    await expect(LicitacionesLayout({ children: "private tender" })).rejects.toThrow("plan denied");
    expect(requirePlan).toHaveBeenCalledWith("pro", ["comercial", "administracion", "admin"]);
  });
});
