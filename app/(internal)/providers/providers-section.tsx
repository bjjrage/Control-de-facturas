"use client";

import { useState, useTransition, useEffect } from "react";
import Link from "next/link";
import { Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProviderDialog } from "./provider-dialog";
import { createProvider, updateProvider, toggleProviderActive } from "./actions";
import { ProvidersSectionData } from "./section-action";

export function ProvidersSection({ initialData }: { initialData: ProvidersSectionData }) {
  const [providers, setProviders] = useState(initialData.providers);
  const [pending, startTransition] = useTransition();

  // Sección keep-alive del AppShell: al volver de otra pantalla, el AppShell
  // trae `initialData` fresco pero el componente sigue montado y su useState
  // no lo relee solo — sin esto un proveedor se veía desactualizado al volver.
  useEffect(() => {
    setProviders(initialData.providers);
  }, [initialData]);

  function handleToggle(p: Provider) {
    startTransition(async () => {
      await toggleProviderActive(p.id, !p.active);
      setProviders((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x))
      );
    });
  }

  return (
    <div className="max-w-4xl">
      <div className="flex items-center justify-between mt-1 mb-4">
        <h1 className="text-[17px] font-semibold">Proveedores</h1>
        <ProviderDialog action={createProvider} trigger={<Button>Nuevo proveedor</Button>} />
      </div>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Contacto</th>
              <th>Email</th>
              <th>Teléfono</th>
              <th>RUC</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {providers.map((p) => (
              <tr key={p.id}>
                <td className="font-medium">
                  <Link href={`/providers/${p.id}`} className="text-action">
                    {p.name}
                  </Link>
                </td>
                <td>{p.contact_name ?? "-"}</td>
                <td>{p.email ?? "-"}</td>
                <td>{p.phone ?? "-"}</td>
                <td>{p.tax_id ?? "-"}</td>
                <td>
                  <Badge tone={p.active ? "ok" : "neutral"}>
                    {p.active ? "Activo" : "Inactivo"}
                  </Badge>
                </td>
                <td>
                  <div className="flex justify-end gap-2">
                    <ProviderDialog
                      provider={p}
                      action={updateProvider.bind(null, p.id)}
                      trigger={
                        <Button variant="secondary" className="h-6 px-2 text-[12px]">
                          Editar
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost"
                      className="h-6 px-2 text-[12px]"
                      onClick={() => handleToggle(p)}
                      disabled={pending}
                    >
                      {p.active ? "Desactivar" : "Activar"}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {providers.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-[var(--muted)] py-6">
                  No hay proveedores cargados.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
