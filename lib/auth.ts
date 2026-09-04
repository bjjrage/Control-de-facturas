import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { Profile, UserRole } from "@/lib/types";

export type EmpresaPlan = "basico" | "pro" | "caterpillar";

export type CurrentProfile = Profile & {
  empresa_active: boolean;
  modulo_compras: boolean;
  modulo_ventas: boolean;
  plan: EmpresaPlan;
};

/**
 * Deduped per request: the layout and the page both call requireProfile(), and
 * without cache() that's two auth.getUser() round-trips + two profile queries on
 * every single navigation.
 */
export const getCurrentProfile = cache(async function getCurrentProfile(): Promise<CurrentProfile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  // `empresas(*)` en vez de columnas explícitas: si la migración 0020 todavía
  // no corrió, modulo_* llega undefined y caemos al default, sin romper el login.
  const { data } = await supabase
    .from("profiles")
    .select("*, empresas(*)")
    .eq("id", user.id)
    .single();
  if (!data) return null;

  const empresa = (data as unknown as {
    empresas: { active: boolean; modulo_compras: boolean; modulo_ventas: boolean; plan: EmpresaPlan } | null;
  }).empresas;
  return {
    ...(data as Profile),
    empresa_active: empresa?.active ?? true,
    modulo_compras: empresa?.modulo_compras ?? true,
    modulo_ventas: empresa?.modulo_ventas ?? false,
    plan: empresa?.plan ?? "basico",
  };
});

export async function requireProfile(allowed?: UserRole[]): Promise<CurrentProfile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // A user whose empresa was deactivated is locked out (super-admins excepted).
  if (!profile.empresa_active && !profile.is_super_admin) redirect("/suspendido");
  if (allowed && !allowed.includes(profile.role)) redirect("/dashboard");
  return profile;
}

/**
 * Every internal request belongs to one empresa (multi-tenant). Server actions
 * that use the service-role client — which bypasses RLS — must scope their
 * queries with this id explicitly. Redirects to /login if the profile somehow
 * has no empresa (shouldn't happen after the 0011 migration backfill).
 */
export async function requireEmpresaId(allowed?: UserRole[]): Promise<string> {
  const profile = await requireProfile(allowed);
  if (!profile.empresa_id) redirect("/login");
  return profile.empresa_id;
}

/**
 * Gate para las secciones de un módulo opcional (SaaS: cada empresa habilita
 * lo que paga). Redirige al dashboard si el módulo está apagado.
 */
export async function requireModule(
  module: "compras" | "ventas",
  allowed?: UserRole[]
): Promise<CurrentProfile> {
  const profile = await requireProfile(allowed);
  const on = module === "compras" ? profile.modulo_compras : profile.modulo_ventas;
  if (!on && !profile.is_super_admin) redirect("/dashboard");
  return profile;
}

const PLAN_RANK: Record<EmpresaPlan, number> = { basico: 0, pro: 1, caterpillar: 2 };

/**
 * Gate para las rutas del módulo Construcción. Jerárquico: 'pro' habilita
 * también a las empresas en 'caterpillar'. Un cliente en 'basico' que
 * escribe la URL a mano recibe 404 — no debe poder detectar que el módulo
 * existe.
 */
export async function requirePlan(minPlan: EmpresaPlan, allowed?: UserRole[]): Promise<CurrentProfile> {
  const profile = await requireProfile(allowed);
  if (PLAN_RANK[profile.plan] < PLAN_RANK[minPlan] && !profile.is_super_admin) notFound();
  return profile;
}

/**
 * Gate for the cross-tenant /empresas section. Super-admins manage the list of
 * companies and seed each one's first admin user.
 */
export async function requireSuperAdmin(): Promise<CurrentProfile> {
  const profile = await requireProfile();
  if (!profile.is_super_admin) redirect("/dashboard");
  return profile;
}
