export function purchaseDetailPath(kind: "orders" | "rfqs", id: string, projectId?: string | null) {
  return projectId ? `/projects/${projectId}/${kind}/${id}` : `/${kind}/${id}`;
}

export function projectTabForPath(pathname: string, search: string) {
  if (/^\/projects\/[^/]+\/orders\//.test(pathname)) return "compras";
  if (/^\/projects\/[^/]+\/rfqs\//.test(pathname)) return "cotizaciones";
  return new URLSearchParams(search).get("tab") ?? "presupuesto";
}

export function belongsToPurchaseContext(
  record: { empresa_id: string; project_id: string | null },
  empresaId: string,
  projectId?: string,
) {
  return record.empresa_id === empresaId && (!projectId || record.project_id === projectId);
}
