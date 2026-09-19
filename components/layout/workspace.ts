// Mental model del shell: DERECHA = en qué workspace estoy, IZQUIERDA = qué
// puedo hacer ahí adentro. El workspace se deriva siempre de la URL — no hay
// estado propio que pueda desincronizarse de la ruta real.
export type Workspace = "administracion" | "operativo" | "licitaciones";

// Operativo root is a project-selection gate. Shared admin routes never impersonate this workspace.
const OPERATIVO_PREFIX = "/projects";
const LICITACIONES_PREFIX = "/licitaciones";

function matches(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

export function workspaceForPath(pathname: string): Workspace {
  if (matches(pathname, OPERATIVO_PREFIX)) return "operativo";
  if (matches(pathname, LICITACIONES_PREFIX)) return "licitaciones";
  return "administracion";
}

export const WORKSPACE_HOME: Record<Workspace, string> = {
  administracion: "/dashboard",
  operativo: "/projects",
  licitaciones: "/licitaciones",
};

export const WORKSPACE_LABEL: Record<Workspace, string> = {
  administracion: "Administración",
  operativo: "Operativo",
  licitaciones: "Licitaciones",
};
