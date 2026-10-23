import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CurrentProfile } from "@/lib/auth";
import type { UserRole } from "@/lib/types";
import { z } from "zod";

export type ManagementResult = { error: string | null };
type Actor = Pick<CurrentProfile, "id" | "empresa_id" | "role" | "is_super_admin">;
type Change = { kind: "role"; role: UserRole } | { kind: "active"; active: boolean } | { kind: "delete" };
const roles: readonly string[] = ["admin", "administracion", "comercial"];
const lastAdmin = "Es el único admin activo de su empresa. Asigná otro admin antes de continuar.";

/** Service-role access is scoped here, before every privileged mutation. */
export async function manageUser(
  client: SupabaseClient,
  actor: Actor,
  userId: string,
  change: Change,
  scope: "tenant" | "global" = "tenant",
): Promise<ManagementResult> {
  if (scope === "global" ? !actor.is_super_admin : actor.role !== "admin") return { error: "No autorizado." };
  if (!z.uuid().safeParse(userId).success) return { error: "Usuario inválido." };
  if (change.kind === "role" && !roles.includes(change.role)) return { error: "Rol inválido." };
  if (change.kind === "active" && typeof change.active !== "boolean") return { error: "Estado inválido." };
  let query = client.from("profiles").select("id, empresa_id, role, active, is_super_admin").eq("id", userId);
  if (scope === "tenant") query = query.eq("empresa_id", actor.empresa_id);
  const { data: target, error: readError } = await query.maybeSingle();
  if (readError) return { error: "No se pudo comprobar el usuario." };
  if (!target) return { error: "Usuario no encontrado en el ámbito autorizado." };
  if (target.is_super_admin) return { error: "Este perfil superadmin está protegido." };
  if (userId === actor.id && (change.kind === "delete" || (change.kind === "active" && !change.active) || (change.kind === "role" && change.role !== actor.role))) {
    return { error: "No podés eliminarte, desactivarte ni cambiar tu propio rol." };
  }
  const removesAdmin = target.active && target.role === "admin" && (change.kind === "delete" || (change.kind === "active" && !change.active) || (change.kind === "role" && change.role !== "admin"));
  if (removesAdmin) {
    const { count, error } = await client.from("profiles").select("id", { count: "exact", head: true })
      .eq("empresa_id", target.empresa_id).eq("role", "admin").eq("active", true).neq("id", userId);
    if (error) return { error: "No se pudo comprobar si queda otro administrador." };
    if (!count) return { error: lastAdmin };
  }
  // The database trigger serializes concurrent changes; this pre-check gives a
  // friendly message but is not the authority for the last-admin invariant.
  const mutation = change.kind === "delete"
    ? client.from("profiles").delete()
    : client.from("profiles").update(change.kind === "role" ? { role: change.role } : { active: change.active });
  const { data, error } = await mutation.eq("id", userId).eq("empresa_id", target.empresa_id).select("id");
  if (error) {
    if (error.code === "23503") return { error: "Este usuario ya registró operaciones. No se puede borrar; desactivalo." };
    if (error.message.includes("last_active_admin")) return { error: lastAdmin };
    return { error: "No se pudo modificar el usuario. Recargá y comprobá su estado." };
  }
  if (!data?.length) return { error: "El usuario cambió mientras se procesaba la acción. Recargá la lista." };
  if (change.kind === "delete") {
    const { error: authError } = await client.auth.admin.deleteUser(userId);
    if (authError) return { error: "El perfil ya se eliminó y no puede entrar a la app, pero falta eliminar su cuenta de acceso. Contactá al superadmin para completar la limpieza." };
  }
  return { error: null };
}
