"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate, formatMoney } from "@/lib/format";
import type { UnlinkedPurchase } from "@/lib/costing/price-list";
import { linkPurchaseDescriptionAction, linkPurchasesAutomaticallyAction } from "./actions";

export function UnlinkedPurchases({
  purchases,
  catalog,
}: {
  purchases: UnlinkedPurchase[];
  catalog: { id: string; nombre: string }[];
}) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (purchases.length === 0) return null;

  async function auto() {
    setPending(true);
    setError(null);
    const res = await linkPurchasesAutomaticallyAction();
    setPending(false);
    if (res.error) return setError(res.error);
    setMessage(`${res.vinculadas} compras vinculadas; ${res.sinCoincidencia} descripciones sin coincidencia exacta.`);
    router.refresh();
  }

  async function link(descripcion: string) {
    const product = catalog.find((c) => c.nombre.toLowerCase() === (values[descripcion] ?? "").trim().toLowerCase());
    if (!product) return setError("Elegí un material de la lista (escribí el nombre exacto y seleccionalo).");
    setPending(true);
    setError(null);
    const res = await linkPurchaseDescriptionAction({ descripcion, productoId: product.id });
    setPending(false);
    if (res.error) return setError(res.error);
    setMessage(`${res.vinculadas} compras vinculadas a ${product.nombre}.`);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-[14px] font-semibold">Compras sin material asignado ({purchases.length})</h2>
          <p className="text-[12px] text-[var(--muted)] max-w-3xl">
            Facturas y cotizaciones cuyo producto no coincide con un material del catálogo. Mientras no estén asignadas, esos precios no
            cuentan para la lista. Vincularlas hace que cada compra real actualice el precio del material.
          </p>
        </div>
        <Button type="button" variant="secondary" onClick={auto} disabled={pending}>
          Vincular las que coinciden por nombre
        </Button>
      </div>
      {message ? <p className="text-[12px] text-emerald-500">{message}</p> : null}
      {error ? <p className="text-[12px] text-[var(--error)]">{error}</p> : null}
      <datalist id="catalog-materials">
        {catalog.map((c) => (
          <option key={c.id} value={c.nombre} />
        ))}
      </datalist>
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-x-auto">
        <table>
          <thead>
            <tr>
              <th>Descripción en la compra</th>
              <th className="num">Registros</th>
              <th>Último precio</th>
              <th>Asignar al material</th>
            </tr>
          </thead>
          <tbody>
            {purchases.slice(0, 50).map((p) => (
              <tr key={p.descripcion}>
                <td className="font-medium">{p.descripcion}</td>
                <td className="num">{p.registros}</td>
                <td className="text-[12px]">
                  {formatMoney(p.ultimoPrecio, "PYG")} · {p.fuente}
                  <div className="text-[11px] text-[var(--muted)]">{formatDate(p.ultimaFecha)}</div>
                </td>
                <td>
                  <div className="flex items-center gap-1.5">
                    <Input
                      list="catalog-materials"
                      value={values[p.descripcion] ?? ""}
                      onChange={(e) => setValues((v) => ({ ...v, [p.descripcion]: e.target.value }))}
                      placeholder="Material del catálogo…"
                      className="h-8 w-56"
                    />
                    <Button type="button" className="h-8 text-xs" disabled={pending || !(values[p.descripcion] ?? "").trim()} onClick={() => link(p.descripcion)}>
                      Vincular
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
