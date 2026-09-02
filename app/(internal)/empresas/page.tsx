import { requireSuperAdmin } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { EmpresaDialog } from "./empresa-dialog";
import { EmpresaAdminDialog } from "./empresa-admin-dialog";
import { EmpresaActiveToggle } from "./empresa-active-toggle";
import { UserRowActions } from "./user-row-actions";

type EmpresaRow = { id: string; nombre: string; slug: string | null; active: boolean; created_at: string };
type ProfileRow = { id: string; empresa_id: string; full_name: string; email: string; role: string; active: boolean };

export default async function EmpresasPage() {
  const me = await requireSuperAdmin();
  const admin = createAdminClient();

  const [{ data: empresas }, { data: profiles }] = await Promise.all([
    admin.from("empresas").select("id, nombre, slug, active, created_at").order("created_at").returns<EmpresaRow[]>(),
    admin
      .from("profiles")
      .select("id, empresa_id, full_name, email, role, active")
      .order("full_name")
      .returns<ProfileRow[]>(),
  ]);

  const usersByEmpresa = new Map<string, ProfileRow[]>();
  for (const p of profiles ?? []) {
    const list = usersByEmpresa.get(p.empresa_id) ?? [];
    list.push(p);
    usersByEmpresa.set(p.empresa_id, list);
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-[17px] font-semibold">Empresas</h1>
        <EmpresaDialog trigger={<Button>Nueva empresa</Button>} />
      </div>
      <p className="text-[12px] text-[var(--muted)] mb-4">
        Cada empresa ve solo sus propios datos. Creá la empresa, agregale su primer usuario admin, y
        ese admin gestiona su equipo desde Usuarios.
      </p>

      <div className="space-y-3">
        {(empresas ?? []).map((e) => {
          const users = usersByEmpresa.get(e.id) ?? [];
          const isMine = e.id === me.empresa_id;
          return (
            <div key={e.id} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold">{e.nombre}</span>
                    {e.slug ? <span className="text-[11px] text-[var(--muted)]">/{e.slug}</span> : null}
                    <Badge tone={e.active ? "ok" : "neutral"}>{e.active ? "Activa" : "Inactiva"}</Badge>
                    {isMine ? <Badge tone="neutral">Tu empresa</Badge> : null}
                  </div>
                  <div className="text-[11px] text-[var(--muted)] mt-0.5">
                    Alta {formatDate(e.created_at)} · {users.length} usuario{users.length === 1 ? "" : "s"}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <EmpresaAdminDialog
                    empresaId={e.id}
                    empresaNombre={e.nombre}
                    trigger={
                      <Button variant="secondary" className="h-7 px-2.5 text-[12px]">
                        Agregar usuario
                      </Button>
                    }
                  />
                  <EmpresaActiveToggle
                    empresaId={e.id}
                    empresaNombre={e.nombre}
                    active={e.active}
                    disabled={isMine}
                  />
                </div>
              </div>

              {users.length > 0 ? (
                <div className="mt-3 border-t border-[var(--border)] pt-2">
                  <table>
                    <tbody>
                      {users.map((u) => (
                        <tr key={u.id}>
                          <td className="font-medium">{u.full_name}</td>
                          <td className="text-[var(--muted)]">{u.email}</td>
                          <td className="capitalize text-[var(--muted)]">{u.role}</td>
                          <td>
                            <Badge tone={u.active ? "ok" : "neutral"}>{u.active ? "Activo" : "Inactivo"}</Badge>
                          </td>
                          <td>
                            <UserRowActions
                              userId={u.id}
                              email={u.email}
                              active={u.active}
                              isSelf={u.id === me.id}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="mt-3 border-t border-[var(--border)] pt-2 text-[12px] text-[var(--muted)]">
                  Todavía sin usuarios — agregá el primer admin.
                </div>
              )}
            </div>
          );
        })}
        {(empresas ?? []).length === 0 ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] py-8 text-center text-[var(--muted)]">
            No hay empresas.
          </div>
        ) : null}
      </div>
    </div>
  );
}
