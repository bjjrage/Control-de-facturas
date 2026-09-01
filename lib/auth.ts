import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Profile, UserRole } from "@/lib/types";

export type CurrentProfile = Profile & { empresa_active: boolean };

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

  const { data } = await supabase
    .from("profiles")
    .select("*, empresas(active)")
    .eq("id", user.id)
    .single();
  if (!data) return null;

  const empresaActive = (data as unknown as { empresas: { active: boolean } | null }).empresas?.active ?? true;
  return { ...(data as Profile), empresa_active: empresaActive };
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
 * Gate for the cross-tenant /empresas section. Super-admins manage the list of
 * companies and seed each one's first admin user.
 */
export async function requireSuperAdmin(): Promise<CurrentProfile> {
  const profile = await requireProfile();
  if (!profile.is_super_admin) redirect("/dashboard");
  return profile;
}
