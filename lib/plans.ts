export type EmpresaPlan = "basico" | "pro" | "caterpillar";

const PLAN_RANK: Record<EmpresaPlan, number> = {
  basico: 0,
  pro: 1,
  caterpillar: 2,
};

/** Plan gates are hierarchical: every higher tier includes lower-tier access. */
export function planMeetsMinimum(
  plan: EmpresaPlan,
  minimum: EmpresaPlan,
  isSuperAdmin = false,
): boolean {
  return isSuperAdmin || PLAN_RANK[plan] >= PLAN_RANK[minimum];
}
