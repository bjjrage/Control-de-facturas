"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import Link from "next/link";
import { Provider } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { ProviderDialog } from "./provider-dialog";
import { createProvider, updateProvider, toggleProviderActive } from "./actions";
import { ProvidersSectionData } from "./section-action";

export function ProvidersSection({ initialData }: { initialData: ProvidersSectionData }) {
  const [providers, setProviders] = useState(initialData.providers);
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

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

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return providers.filter((p) => {
      if (filterStatus === "active" && !p.active) return false;
      if (filterStatus === "inactive" && p.active) return false;
      if (!term) return true;
      return (
        p.name.toLowerCase().includes(term) ||
        (p.tax_id ?? "").toLowerCase().includes(term) ||
        (p.email ?? "").toLowerCase().includes(term) ||
        (p.contact_name ?? "").toLowerCase().includes(term)
      );
    });
  }, [providers, q, filterStatus]);

  const hasFilters = !!(q || filterStatus);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between mt-1">
        <h1 className="text-[17px] font-semibold">Proveedores</h1>
        <ProviderDialog action={createProvider} trigger={<Button>Nuevo proveedor</Button>} />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="prov-q">Buscar</Label>
            <Input
              id="prov-q"
              type="search"
              placeholder="Nombre, RUC, email…"
              value={q}
              onChange={(e) => setQ((e.target as HTMLInputElement).value)}
              className="w-60"
            />
          </div>
          <div>
            <Label htmlFor="prov-status">Estado</Label>
            <Select
              id="prov-status"
              value={filterStatus}
              onChange={(e) => setFilterStatus((e.target as HTMLSelectElement).value)}
              className="w-36"
            >
              <option value="">Todos</option>
              <option value="active">Activo</option>
              <option value="inactive">Inactivo</option>
            </Select>
          </div>
          {hasFilters ? (
            <button
              onClick={() => { setQ(""); setFilterStatus(""); }}
              className="text-[12px] text-[var(--muted)] pb-1.5 hover:text-[var(--foreground)]"
            >
              Limpiar
            </button>
          ) : null}
        </div>
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
            {filtered.map((p) => (
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
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-[var(--muted)] py-6">
                  {providers.length === 0 ? "No hay proveedores cargados." : "Ningún proveedor coincide con los filtros."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
