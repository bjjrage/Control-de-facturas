"use client";

import { useState, useTransition, useEffect, useMemo } from "react";
import Link from "next/link";
import { Client } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select } from "@/components/ui/input";
import { ClientDialog } from "./client-dialog";
import { createClientRecord, updateClientRecord, toggleClientActive } from "./actions";
import { ClientesSectionData } from "./section-action";

export function ClientesSection({ initialData }: { initialData: ClientesSectionData }) {
  const [clients, setClients] = useState(initialData.clients);
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState("");
  const [filterStatus, setFilterStatus] = useState("");

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

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return clients.filter((c) => {
      if (filterStatus === "active" && !c.active) return false;
      if (filterStatus === "inactive" && c.active) return false;
      if (!term) return true;
      return (
        c.name.toLowerCase().includes(term) ||
        (c.tax_id ?? "").toLowerCase().includes(term) ||
        (c.email ?? "").toLowerCase().includes(term) ||
        (c.contact_name ?? "").toLowerCase().includes(term)
      );
    });
  }, [clients, q, filterStatus]);

  const hasFilters = !!(q || filterStatus);

  return (
    <div className="max-w-4xl space-y-4">
      <div className="flex items-center justify-between mt-1">
        <h1 className="text-[17px] font-semibold">Clientes</h1>
        <ClientDialog action={createClientRecord} trigger={<Button>Nuevo cliente</Button>} />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="cli-q">Buscar</Label>
            <Input
              id="cli-q"
              type="search"
              placeholder="Nombre, RUC/CI, email…"
              value={q}
              onChange={(e) => setQ((e.target as HTMLInputElement).value)}
              className="w-60"
            />
          </div>
          <div>
            <Label htmlFor="cli-status">Estado</Label>
            <Select
              id="cli-status"
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
              <th>RUC / CI</th>
              <th>Contacto</th>
              <th>Email</th>
              <th>Condición</th>
              <th>Estado</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
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
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-[var(--muted)] py-6">
                  {clients.length === 0 ? "No hay clientes cargados." : "Ningún cliente coincide con los filtros."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
