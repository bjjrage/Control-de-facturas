import Link from "next/link";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import type { Producto } from "@/lib/types";

export default async function StockPage() {
  await requirePlan("pro");
  const supabase = await createClient();

  const { data: productos } = await supabase
    .from("productos")
    .select("*")
    .order("nombre")
    .returns<Producto[]>();

  const lista = productos ?? [];
  const activos = lista.filter((p) => p.activo);
  const bajoMinimo = activos.filter((p) => p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo);

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[17px] font-semibold">Stock</h1>
          <p className="text-[12px] text-[var(--muted)] mt-0.5">
            {activos.length} {activos.length === 1 ? "producto activo" : "productos activos"}
            {bajoMinimo.length > 0 ? (
              <span className="ml-2 text-[var(--warn)]">· {bajoMinimo.length} bajo mínimo</span>
            ) : null}
          </p>
        </div>
        <Link href="/stock/nuevo">
          <Button>Nuevo producto</Button>
        </Link>
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>SKU</th>
              <th>Unidad</th>
              <th className="num">Stock actual</th>
              <th className="num">Mínimo</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {lista.map((p) => {
              const bajo = p.stock_minimo > 0 && p.stock_actual <= p.stock_minimo;
              return (
                <tr key={p.id}>
                  <td>
                    <Link href={`/stock/${p.id}`} className="text-action font-medium">
                      {p.nombre}
                    </Link>
                    {p.descripcion ? (
                      <div className="text-[11px] text-[var(--muted)] truncate max-w-[260px]">{p.descripcion}</div>
                    ) : null}
                  </td>
                  <td className="text-[var(--muted)] font-mono text-[12px]">{p.sku ?? "—"}</td>
                  <td className="text-[var(--muted)]">{p.unidad}</td>
                  <td className={`num font-semibold ${bajo ? "text-[var(--warn)]" : ""}`}>
                    {formatNumber(p.stock_actual, 2)}
                  </td>
                  <td className="num text-[var(--muted)]">
                    {p.stock_minimo > 0 ? formatNumber(p.stock_minimo, 2) : "—"}
                  </td>
                  <td>
                    {!p.activo ? (
                      <span className="text-[11px] text-[var(--muted)]">Inactivo</span>
                    ) : bajo ? (
                      <span className="text-[11px] font-medium text-[var(--warn)]">Bajo mínimo</span>
                    ) : (
                      <span className="text-[11px] text-[var(--ok)]">OK</span>
                    )}
                  </td>
                </tr>
              );
            })}
            {lista.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-center text-[var(--muted)] py-8">
                  No hay productos. <Link href="/stock/nuevo" className="text-action">Creá el primero.</Link>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
