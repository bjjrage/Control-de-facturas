// Shared by navigation links and the shell without importing every screen.
export const SHELL_PATHS = [
  "/dashboard", "/invoices", "/orders", "/pagos", "/providers", "/rfqs",
  "/clientes", "/proformas", "/remisiones", "/facturas-venta", "/cobros",
  "/projects", "/stock", "/inventario",
] as const;

export type SectionKey = (typeof SHELL_PATHS)[number];

export function isSectionPath(path: string): path is SectionKey {
  return (SHELL_PATHS as readonly string[]).includes(path);
}

export function prefetchShellSection(path: string) {
  if (isSectionPath(path)) {
    window.dispatchEvent(new CustomEvent("niupack:prefetch", { detail: path }));
  }
}

export function cancelShellPrefetch(path: string) {
  if (isSectionPath(path)) {
    window.dispatchEvent(new CustomEvent("niupack:cancel-prefetch", { detail: path }));
  }
}
