import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Profile, UserRole } from "@/lib/types";

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  return (data as Profile) ?? null;
}

export async function requireProfile(allowed?: UserRole[]): Promise<Profile> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
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
