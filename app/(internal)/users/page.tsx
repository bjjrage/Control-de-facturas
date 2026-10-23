import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Profile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { UserDialog } from "./user-dialog";
import { UserRowActions } from "./user-row-actions";
import { RoleSelect } from "./role-select";
import { createUser, updateUserRole } from "./actions";
import { BackButton } from "@/components/ui/back-button";

export default async function UsersPage() {
  const me = await requireProfile(["admin"]);
  const supabase = await createClient();
  const { data: users } = await supabase
    .from("profiles")
    .select("*")
    .eq("empresa_id", me.empresa_id)
    .order("created_at")
    .returns<Profile[]>();

  return (
    <div className="max-w-4xl">
      <BackButton />
      <div className="flex items-center justify-between mt-1 mb-4">
        <h1 className="text-[17px] font-semibold">Usuarios</h1>
        <UserDialog action={createUser} trigger={<Button>Nuevo usuario</Button>} />
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Email</th>
              <th>Rol</th>
              <th>Alta</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(users ?? []).map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.full_name}</td>
                <td>{u.email}</td>
                <td className="w-36">
                  <RoleSelect id={u.id} role={u.role} action={updateUserRole} disabled={u.id === me.id || u.is_super_admin} />
                </td>
                <td>{formatDate(u.created_at)}</td>
                <td>
                  <Badge tone={u.active ? "ok" : "neutral"}>{u.active ? "Activo" : "Inactivo"}</Badge>
                </td>
                <td>
                  <UserRowActions id={u.id} email={u.email} active={u.active} disabled={u.id === me.id || u.is_super_admin} />
                </td>
              </tr>
            ))}
            {(users ?? []).length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-[var(--muted)] py-6">
                  No hay usuarios.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
