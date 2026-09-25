import type { UserRole } from "@/lib/types";

export type ProjectFeatureGroup = "Preparar" | "Comprar" | "Avance de obra" | "Certificar";
export type ProjectFeaturePlan = "pro" | "caterpillar";

export type ProjectFeatureKey =
  | "presupuesto"
  | "cronograma"
  | "plan-semanal"
  | "bim"
  | "proveedores"
  | "cotizaciones"
  | "compras"
  | "facturas"
  | "pagos"
  | "ejecucion"
  | "inventario"
  | "recepciones"
  | "panol"
  | "personal"
  | "subcontratistas"
  | "certificados"
  | "avance-fisico"
  | "informes";

export type ProjectFeatureDefinition = {
  key: ProjectFeatureKey;
  label: string;
  group: ProjectFeatureGroup;
  minPlan: ProjectFeaturePlan;
  roles: readonly UserRole[];
};

const PROJECT_ROLES = ["administracion", "admin"] as const satisfies readonly UserRole[];

/**
 * Canonical contract for project-scoped user surfaces.
 *
 * The page's valid tabs and the project's sidebar are derived from this list.
 * Renderers remain explicit in ProjectTabsClient so a missing renderer is
 * visible in review and caught by the structural contract test.
 */
export const PROJECT_FEATURES = [
  { key: "presupuesto", label: "Presupuesto", group: "Preparar", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "cronograma", label: "Cronograma", group: "Preparar", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "plan-semanal", label: "Plan semanal", group: "Preparar", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "bim", label: "BIM / IFC", group: "Preparar", minPlan: "caterpillar", roles: PROJECT_ROLES },
  { key: "proveedores", label: "Proveedores", group: "Comprar", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "cotizaciones", label: "Cotizaciones", group: "Comprar", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "compras", label: "OC", group: "Comprar", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "facturas", label: "Facturas", group: "Comprar", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "pagos", label: "Pagos", group: "Comprar", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "ejecucion", label: "Partes de avance", group: "Avance de obra", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "inventario", label: "Inventario", group: "Avance de obra", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "recepciones", label: "Recepciones", group: "Avance de obra", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "panol", label: "Depósito de obra", group: "Avance de obra", minPlan: "pro", roles: PROJECT_ROLES },
  { key: "personal", label: "Personal", group: "Avance de obra", minPlan: "caterpillar", roles: PROJECT_ROLES },
  { key: "subcontratistas", label: "Subcontratistas", group: "Avance de obra", minPlan: "caterpillar", roles: PROJECT_ROLES },
  { key: "certificados", label: "Certificados", group: "Certificar", minPlan: "caterpillar", roles: PROJECT_ROLES },
  { key: "avance-fisico", label: "Avance físico", group: "Certificar", minPlan: "caterpillar", roles: PROJECT_ROLES },
  { key: "informes", label: "Informes", group: "Certificar", minPlan: "pro", roles: PROJECT_ROLES },
] as const satisfies readonly ProjectFeatureDefinition[];

export const PROJECT_FEATURE_KEYS = PROJECT_FEATURES.map((feature) => feature.key) as ProjectFeatureKey[];

const PLAN_RANK: Record<ProjectFeaturePlan, number> = { pro: 1, caterpillar: 2 };

export function isProjectFeatureKey(value: string | null | undefined): value is ProjectFeatureKey {
  return value != null && PROJECT_FEATURE_KEYS.includes(value as ProjectFeatureKey);
}

export function getProjectFeature(key: ProjectFeatureKey): ProjectFeatureDefinition {
  const feature = PROJECT_FEATURES.find((candidate) => candidate.key === key);
  if (!feature) throw new Error(`Unknown project feature: ${key}`);
  return feature;
}

export function getProjectFeatureGroups() {
  return (["Preparar", "Comprar", "Avance de obra", "Certificar"] as const).map((label) => ({
    label,
    features: PROJECT_FEATURES.filter((feature) => feature.group === label),
  }));
}

export function canAccessProjectFeature(
  feature: ProjectFeatureDefinition,
  access: { role: UserRole; plan: ProjectFeaturePlan; isSuperAdmin?: boolean }
): boolean {
  if (access.isSuperAdmin) return true;
  return feature.roles.some((role) => role === access.role) && PLAN_RANK[access.plan] >= PLAN_RANK[feature.minPlan];
}
