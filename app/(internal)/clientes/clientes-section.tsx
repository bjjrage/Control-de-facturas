"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { Client } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ClientDialog } from "./client-dialog";
import { createClientRecord, updateClientRecord, toggleClientActive } from "./actions";
import { ClientesSectionData } from "./section-action";

export function ClientesSection({ initialData }: { initialData: ClientesSectionData }) {
  const [clients, setClients] = useState(initialData.clients);
  const [pending, startTransition] = useTransition();

  // Sección keep-alive del AppShell: al volver de otra pantalla, el AppShell
  // trae `initialData` fresco pero el componente sigue montado y su useState
  // no lo relee solo — sin esto un cliente se veía desactualizado al volver.
  useEffect(() => {
    setClients(initialData.clients);
  }, [initialData]);

  function handleToggle(c: Client) {
    startTransition(async () => {
      await toggleClientActive(c.id, !c.active);
      setClients((prev) =>
        prev.map((x) => (x.id === c.id ? { ...x, active: !x.active } : x))
      );
    });
  }

  return (
    <div className="max-w-4xl">
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
            {clients.map((c) => (
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
                  <Badge tone={c.active ? "ok" : "neutral"}>
                    {c.active ? "Activo" : "Inactivo"}
                  </Badge>
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
                    <Button
                      variant="ghost"
                      className="h-6 px-2 text-[12px]"
                      onClick={() => handleToggle(c)}
                      disabled={pending}
                    >
                      {c.active ? "Desactivar" : "Activar"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {clients.length === 0 ? (
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
