"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import type { PriceListRow } from "@/lib/costing/price-list";
import { setMaterialPriceAction } from "./actions";

const ORIGEN_LABEL: Record<string, string> = {
  HISTORIAL: "Historial de precios",
  COSTO_PROMEDIO: "Costo promedio del stock",
};

type Filter = "all" | "sin" | "con";

export function PricesSection({ rows, providers }: { rows: PriceListRow[]; providers: Record<string, string> }) {
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const sinPrecio = rows.filter((r) => r.precio == null).length;
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "sin" && r.precio != null) return false;
      if (filter === "con" && r.precio == null) return false;
      if (!term) return true;
      return r.nombre.toLowerCase().includes(term) || (r.rubro ?? "").toLowerCase().includes(term);
    });
  }, [rows, q, filter]);

  async function save(productoId: string) {
    setPending(true);
    const res = await setMaterialPriceAction({ productoId, precio: Number(value) });
    setPending(false);
    if (res.error) return setError(res.error);
    setError(null);
    setEditing(null);
    setValue("");
    router.refresh();
  }

  return (
    <div className="max-w-6xl space-y-4">
      <div>
        <h1 className="text-[17px] font-semibold">Lista de precios de materiales</h1>
        <p className="text-[12px] text-[var(--muted)] max-w-3xl">
          El precio de referencia de cada material y de dónde salió. Se arma solo con lo que entra al sistema: facturas, recepciones,
          órdenes de compra, cotizaciones de proveedores y las planillas de recetas (APU). También podés fijar un precio a mano. Con estos
          precios se calcula el costo de las partidas en Costeo.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Buscar material o rubro…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        {(
          [
            ["all", `Todos (${rows.length})`],
            ["sin", `Sin precio (${sinPrecio})`],
            ["con", `Con precio (${rows.length - sinPrecio})`],
          ] as [Filter, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`h-8 px-2.5 rounded-md text-[12px] font-medium border transition-colors ${
              filter === key ? "bg-[var(--primary)] text-white border-transparent" : "bg-[var(--panel-2)] text-[var(--muted)] border-[var(--border)] hover:text-[var(--foreground)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Material</th>
              <th>Rubro</th>
              <th>Unidad</th>
              <th className="num">Precio de referencia</th>
              <th>Último precio</th>
              <th className="num">Registros</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center text-[var(--muted)] py-6">
                  {rows.length === 0 ? "No hay materiales en el catálogo todavía." : "Sin resultados."}
                </td>
              </tr>
            ) : (
              visible.map((r) => (
                <tr key={r.productoId}>
                  <td className="font-medium">{r.nombre}</td>
                  <td className="text-[var(--muted)]">{r.rubro ?? "Sin rubro"}</td>
                  <td>{r.unidad}</td>
                  <td className="num">
                    {r.precio == null ? (
                      <span className="text-amber-500">Sin precio</span>
                    ) : (
                      <div>
                        <div className="font-medium">{formatMoney(r.precio, "PYG")}</div>
                        <div className="text-[11px] text-[var(--muted)]">{r.origen ? ORIGEN_LABEL[r.origen] : ""}</div>
                      </div>
                    )}
                  </td>
                  <td className="text-[12px]">
                    {r.ultimo ? (
                      <div>
                        <div>
                          {formatMoney(r.ultimo.precio, "PYG")} · {r.ultimo.fuente}
                        </div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {formatDate(r.ultimo.fecha)}
                          {r.ultimo.proveedorId && providers[r.ultimo.proveedorId] ? ` · ${providers[r.ultimo.proveedorId]}` : ""}
                        </div>
                      </div>
                    ) : (
                      <span className="text-[var(--muted)]">—</span>
                    )}
                  </td>
                  <td className="num">{r.observaciones}</td>
                  <td>
                    {editing === r.productoId ? (
                      <div className="flex items-center gap-1.5">
                        <Input
                          type="number"
                          min="0"
                          step="any"
                          autoFocus
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          placeholder={`Gs. por ${r.unidad}`}
                          className="h-8 w-32"
                        />
                        <Button type="button" className="h-8 text-xs" disabled={pending || !(Number(value) > 0)} onClick={() => save(r.productoId)}>
                          Guardar
                        </Button>
                        <Button type="button" variant="ghost" className="h-8 text-xs" onClick={() => setEditing(null)}>
                          Cancelar
                        </Button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="text-action text-[12px]"
                        onClick={() => {
                          setEditing(r.productoId);
                          setValue(r.precio == null ? "" : String(Math.round(r.precio)));
                          setError(null);
                        }}
                      >
                        Fijar precio
                      </button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
