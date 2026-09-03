import Link from "next/link";
import { requireModule } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Client } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientDialog } from "./client-dialog";
import { createClientRecord, updateClientRecord, toggleClientActive } from "./actions";
import { BackButton } from "@/components/ui/back-button";

export default async function ClientesPage() {
  await requireModule("ventas", ["administracion", "admin"]);
  const supabase = await createClient();
  const { data: clients } = await supabase.from("clients").select("*").order("name").returns<Client[]>();

  return (
    <div className="max-w-4xl">
      <BackButton />
      <div className="flex items-center justify-between mt-1 mb-4">
        <h1 className="text-[17px] font-semibold">Clientes</h1>
        <ClientDialog action={createClientRecord} trigger={<Button>Nuevo cliente</Button>} />
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>RUC / CI</th>
              <th>Contacto</th>
              <th>Email</th>
              <th>Condición</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(clients ?? []).map((c) => (
              <tr key={c.id}>
                <td className="font-medium">
                  <Link href={`/clientes/${c.id}`} className="text-action">
                    {c.name}
                  </Link>
                </td>
                <td>{c.tax_id ?? "-"}</td>
                <td>{c.contact_name ?? "-"}</td>
                <td>{c.email ?? "-"}</td>
                <td>{c.payment_terms ?? "-"}</td>
                <td>
                  <Badge tone={c.active ? "ok" : "neutral"}>{c.active ? "Activo" : "Inactivo"}</Badge>
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    <ClientDialog
                      client={c}
                      action={updateClientRecord.bind(null, c.id)}
                      trigger={
                        <Button variant="secondary" className="h-6 px-2 text-[12px]">
                          Editar
                        </Button>
                      }
                    />
                    <form
                      action={async () => {
                        "use server";
                        await toggleClientActive(c.id, !c.active);
                      }}
                    >
                      <Button variant="ghost" className="h-6 px-2 text-[12px]" type="submit">
                        {c.active ? "Desactivar" : "Activar"}
                      </Button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
            {(clients ?? []).length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-[var(--muted)] py-6">
                  No hay clientes cargados.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
