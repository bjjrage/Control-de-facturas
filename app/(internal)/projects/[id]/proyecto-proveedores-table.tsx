"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { ColumnFilter, uniqueValues, passesColumnFilter } from "@/components/ui/column-filter";
import { Provider } from "@/lib/types";
import { unlinkProviderFromProject } from "./provider-actions";

type ColKey = "name" | "contact" | "email" | "phone";

export function ProyectoProveedoresTable({
  rows,
  projectId,
  removableIds,
}: {
  rows: Provider[];
  projectId: string;
  /** ids que se agregaron a mano y todavía no tienen ninguna OC — se pueden sacar. */
  removableIds: string[];
}) {
  const [q, setQ] = useState("");
  const removable = useMemo(() => new Set(removableIds), [removableIds]);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const router = useRouter();

  async function handleRemove(providerId: string) {
    if (!confirm("¿Sacar este proveedor de la obra?")) return;
    setRemovingId(providerId);
    await unlinkProviderFromProject(projectId, providerId);
    setRemovingId(null);
    router.refresh();
  }

  const [colFilters, setColFilters] = useState<Record<ColKey, Set<string> | null>>({
    name: null,
    contact: null,
    email: null,
    phone: null,
  });

  const uniques = useMemo(
    () => ({
      name: uniqueValues(rows, (r) => r.name),
      contact: uniqueValues(rows, (r) => r.contact_name ?? "—"),
      email: uniqueValues(rows, (r) => r.email ?? "—"),
      phone: uniqueValues(rows, (r) => r.phone ?? "—"),
    }),
    [rows]
  );

  function setCol(key: ColKey, next: Set<string> | null) {
    setColFilters((f) => ({ ...f, [key]: next }));
  }

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (!passesColumnFilter(r.name, colFilters.name)) return false;
      if (!passesColumnFilter(r.contact_name ?? "—", colFilters.contact)) return false;
      if (!passesColumnFilter(r.email ?? "—", colFilters.email)) return false;
      if (!passesColumnFilter(r.phone ?? "—", colFilters.phone)) return false;
      if (!term) return true;
      return (
        r.name.toLowerCase().includes(term) ||
        (r.contact_name ?? "").toLowerCase().includes(term) ||
        (r.email ?? "").toLowerCase().includes(term)
      );
    });
  }, [rows, q, colFilters]);

  return (
    <div className="space-y-2">
      {rows.length > 5 ? (
        <Input
          placeholder="Buscar por nombre o contacto…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="max-w-xs"
        />
      ) : null}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>
                Proveedor
                <ColumnFilter values={uniques.name} selected={colFilters.name} onChange={(v) => setCol("name", v)} />
              </th>
              <th>
                Contacto
                <ColumnFilter values={uniques.contact} selected={colFilters.contact} onChange={(v) => setCol("contact", v)} />
              </th>
              <th>
                Email
                <ColumnFilter values={uniques.email} selected={colFilters.email} onChange={(v) => setCol("email", v)} />
              </th>
              <th>
                Teléfono
                <ColumnFilter values={uniques.phone} selected={colFilters.phone} onChange={(v) => setCol("phone", v)} />
              </th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-center text-[var(--muted)] py-6">
                  {rows.length === 0
                    ? 'Todavía no hay proveedores en esta obra. Usá "+ Agregar proveedor".'
                    : "Sin resultados para ese filtro."}
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/providers/${r.id}`} className="text-action font-medium">
                      {r.name}
                    </Link>
                  </td>
                  <td>{r.contact_name ?? "—"}</td>
                  <td>{r.email ? <a href={`mailto:${r.email}`} className="text-action">{r.email}</a> : "—"}</td>
                  <td>{r.phone ?? "—"}</td>
                  <td>
                    {removable.has(r.id) ? (
                      <button
                        type="button"
                        disabled={removingId === r.id}
                        onClick={() => handleRemove(r.id)}
                        className="text-[12px] text-[var(--muted)] hover:text-[var(--error)] disabled:opacity-50"
                      >
                        {removingId === r.id ? "Sacando…" : "Quitar"}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {rows.length > 0 ? (
        <p className="text-[11px] text-[var(--muted)]">
          Incluye los que ya tienen una OC en esta obra y los que agregaste a mano.
        </p>
      ) : null}
    </div>
  );
}
