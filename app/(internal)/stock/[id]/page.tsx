import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePlan } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatNumber } from "@/lib/format";
import type { Producto, StockMovimiento } from "@/lib/types";
import { MovimientoDialog } from "./movimiento-dialog";
import { Button } from "@/components/ui/button";

const TIPO_LABEL: Record<string, string> = { ENTRADA: "Entrada", SALIDA: "Salida", AJUSTE: "Ajuste" };
const TIPO_COLOR: Record<string, string> = {
  ENTRADA: "text-[var(--ok)]",
  SALIDA: "text-[var(--error)]",
  AJUSTE: "text-[var(--accent-teal)]",
};
const TIPO_SIGN: Record<string, string> = { ENTRADA: "+", SALIDA: "−", AJUSTE: "=" };

export default async function ProductoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const profile = await requirePlan("pro");
  const supabase = await createClient();

  const { data: producto } = await supabase
    .from("productos")
    .select("*")
    .eq("id", id)
    .single<Producto>();

  if (!producto) notFound();

  const { data: categoria } = producto.categoria_id
    ? await supabase
        .from("categorias_producto")
        .select("nombre")
        .eq("id", producto.categoria_id)
        .single<{ nombre: string }>()
    : { data: null };

  const { data: movimientos } = await supabase
    .from("stock_movimientos")
    .select("*")
    .eq("producto_id", id)
    .order("created_at", { ascending: false })
    .returns<StockMovimiento[]>();

  const mov = movimientos ?? [];
  const bajo = producto.stock_minimo > 0 && producto.stock_actual <= producto.stock_minimo;
  const isAdmin = profile.role === "admin";
  const totalBase = producto.contenido_por_unidad
    ? producto.stock_actual * producto.contenido_por_unidad
    : null;
  const valorStock = producto.stock_actual * producto.costo_promedio;

  return (
    <div className="max-w-3xl space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/stock" className="text-action text-[12px] text-[var(--muted)]">
            ← Volver a Stock
          </Link>
          <div className="flex items-center gap-2 mt-1">
            <h1 className="text-[17px] font-semibold">{producto.nombre}</h1>
            {!producto.activo ? (
              <span className="text-[11px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
                Inactivo
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {producto.sku ? (
              <span className="text-[12px] text-[var(--muted)] font-mono">{producto.sku}</span>
            ) : null}
            {categoria?.nombre ? (
              <span className="text-[11px] text-[var(--muted)] border border-[var(--border)] rounded px-1.5 py-0.5">
                {categoria.nombre}
              </span>
            ) : null}
          </div>
          {producto.descripcion ? (
            <p className="text-[12px] text-[var(--muted)] mt-0.5">{producto.descripcion}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Link href={`/stock/${producto.id}/editar`}>
              <Button variant="secondary" className="h-8 px-3 text-[12px]">Editar</Button>
            </Link>
          ) : null}
          <MovimientoDialog
            productoId={producto.id}
            unidad={producto.unidad}
            stockActual={producto.stock_actual}
            costoPromedio={producto.costo_promedio}
          />
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="text-[11px] text-[var(--muted)] mb-1">Stock actual</div>
          <div className={`text-[22px] font-semibold tabular-nums ${bajo ? "text-[var(--warn)]" : ""}`}>
            {formatNumber(producto.stock_actual, 2)}
          </div>
          <div className="text-[11px] text-[var(--muted)]">{producto.unidad}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="text-[11px] text-[var(--muted)] mb-1">Costo promedio</div>
          <div className="text-[22px] font-semibold tabular-nums">
            {producto.costo_promedio > 0 ? formatMoney(producto.costo_promedio) : "—"}
          </div>
          <div className="text-[11px] text-[var(--muted)]">por {producto.unidad}</div>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
          <div className="text-[11px] text-[var(--muted)] mb-1">Valor en stock</div>
          <div className="text-[22px] font-semibold tabular-nums">
            {valorStock > 0 ? formatMoney(valorStock) : "—"}
          </div>
          <div className="text-[11px] text-[var(--muted)]">
            {formatNumber(producto.stock_actual, 2)} × costo prom.
          </div>
        </div>
        {totalBase !== null ? (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
            <div className="text-[11px] text-[var(--muted)] mb-1">Total en {producto.unidad_base}</div>
            <div className={`text-[22px] font-semibold tabular-nums ${bajo ? "text-[var(--warn)]" : ""}`}>
              {formatNumber(totalBase, 2)}
            </div>
            <div className="text-[11px] text-[var(--muted)]">{producto.unidad_base}</div>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
            <div className="text-[11px] text-[var(--muted)] mb-1">Stock mínimo</div>
            <div className="text-[22px] font-semibold tabular-nums">
              {producto.stock_minimo > 0 ? formatNumber(producto.stock_minimo, 2) : "—"}
            </div>
            <div className="text-[11px] text-[var(--muted)]">{producto.unidad}</div>
          </div>
        )}
      </div>

      {bajo ? (
        <div className="rounded border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-2 text-[12px] text-[var(--warn)]">
          Stock bajo el mínimo — quedan {formatNumber(producto.stock_actual, 2)} {producto.unidad}, mínimo es {formatNumber(producto.stock_minimo, 2)}.
        </div>
      ) : null}

      {/* Historial de movimientos */}
      <div>
        <h2 className="text-[14px] font-semibold mb-2">Historial de movimientos</h2>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo</th>
                <th className="num">Cantidad</th>
                <th className="num">Stock resultante</th>
                <th className="num">Costo unit.</th>
                <th className="num">Valor</th>
                <th>Referencia</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              {mov.map((m) => (
                <tr key={m.id}>
                  <td className="text-[var(--muted)] whitespace-nowrap">{formatDate(m.created_at)}</td>
                  <td>
                    <span className={`font-medium text-[12px] ${TIPO_COLOR[m.tipo]}`}>
                      {TIPO_LABEL[m.tipo]}
                    </span>
                  </td>
                  <td className={`num font-semibold ${TIPO_COLOR[m.tipo]}`}>
                    {TIPO_SIGN[m.tipo]}{formatNumber(m.cantidad, 2)}
                  </td>
                  <td className="num tabular-nums">{formatNumber(m.stock_resultante, 2)}</td>
                  <td className="num tabular-nums text-[var(--muted)]">
                    {m.costo_unitario != null && m.costo_unitario > 0 ? formatMoney(m.costo_unitario) : "—"}
                  </td>
                  <td className="num tabular-nums text-[var(--muted)]">
                    {m.costo_total != null && m.costo_total !== 0 ? formatMoney(m.costo_total) : "—"}
                  </td>
                  <td className="text-[11px] text-[var(--muted)]">
                    {m.referencia_tipo ? `${m.referencia_tipo}` : "—"}
                  </td>
                  <td className="text-[12px] text-[var(--muted)]">{m.notas ?? "—"}</td>
                </tr>
              ))}
              {mov.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-[var(--muted)] py-8">
                    Sin movimientos todavía.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>

      {isAdmin ? (
        <div className="flex justify-end">
          {producto.activo ? (
            <form
              action={async () => {
                "use server";
                const { desactivarProducto } = await import("../stock-actions");
                await desactivarProducto(id);
              }}
            >
              <button
                type="submit"
                className="text-[12px] text-[var(--muted)] hover:text-[var(--error)] transition-colors"
              >
                Desactivar producto
              </button>
            </form>
          ) : (
            <form
              action={async () => {
                "use server";
                const { reactivarProducto } = await import("../stock-actions");
                await reactivarProducto(id);
              }}
            >
              <button
                type="submit"
                className="text-[12px] text-[var(--muted)] hover:text-[var(--ok)] transition-colors"
              >
                Reactivar producto
              </button>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
