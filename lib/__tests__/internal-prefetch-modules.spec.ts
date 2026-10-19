import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const profile = vi.hoisted(() => ({
  role: "admin", plan: "pro", is_super_admin: false, modulo_compras: false, modulo_ventas: true,
  full_name: "QA",
}));
vi.mock("@/lib/auth", () => ({ requireProfile: async () => profile }));
vi.mock("@/components/layout/sidebar", () => ({ Sidebar: () => null }));
vi.mock("@/components/layout/admin-rail-panel", () => ({ AdminRailPanel: () => null }));
vi.mock("@/components/layout/topbar", () => ({ Topbar: () => null }));
vi.mock("@/components/layout/app-shell-client", () => ({ AppShellClient: () => null }));
vi.mock("@/components/agent/rodrigo-agent-provider", () => ({ RodrigoAgentProvider: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/agent/rodrigo-agent-widget", () => ({ RodrigoAgentWidget: () => null }));

import InternalLayout from "@/app/(internal)/layout";
import { AppShellClient } from "@/components/layout/app-shell-client";

function findShell(node: ReactNode): { warmPaths: string[] } | null {
  if (!isValidElement(node)) return null;
  if (node.type === AppShellClient) return node.props as { warmPaths: string[] };
  for (const child of Children.toArray((node.props as { children?: ReactNode }).children)) {
    const found = findShell(child);
    if (found) return found;
  }
  return null;
}

describe("module-scoped prefetch", () => {
  it("excludes purchase routes when the company has Compras disabled", async () => {
    const shell = findShell(await InternalLayout({ children: null }));
    expect(shell?.warmPaths).not.toContain("/orders");
    expect(shell?.warmPaths).not.toContain("/rfqs");
    expect(shell?.warmPaths).toContain("/facturas-venta");
  });
});
