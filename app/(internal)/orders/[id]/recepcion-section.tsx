"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { formatDate, formatNumber } from "@/lib/format";
import { createClient } from "@/lib/supabase/browser";
import type { AuthorizedOrderItem, OcRecepcion } from "@/lib/types";
import { registrarRecepcion, eliminarRecepcion } from "../oc-recepcion-actions";

type ProductoLite = { id: string; nombre: string; unidad: string };

// ─── RegistrarDialog ────────────────────────────────────────────────────────

function RegistrarDialog({
  orderId,
  orderItems,
  onDone,
}: {
  orderId: string;
  orderItems: AuthorizedOrderItem[];
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [recibidoPor, setRecibidoPor] = useState("");
  const [notas, setNotas] = useState("");
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [productoPorItem, setProductoPorItem] = useState<Record<string, string>>({});
  const [productos, setProductos] = useState<ProductoLite[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const supabase = createClient();
    supabase
      .from("productos")
      .select("id, nombre, unidad")
      .eq("activo", true)
      .order("nombre")
      .then(({ data }) => setProductos((data as ProductoLite[]) ?? []));
  }, [open]);

  function reset() {
    setFecha(new Date().toISOString().slice(0, 10));
    setRecibidoPor("");
    setNotas("");
    setCantidades({});
    setProductoPorItem({});
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const items = orderItems
      .map((it) => ({
        order_item_id: it.id,
        cantidad_recibida: parseFloat(cantidades[it.id] || "0") || 0,
        producto_id: productoPorItem[it.id] || null,
      }))
      .filter((i) => i.cantidad_recibida > 0);

    if (items.length === 0) {
      setError("Ingresá al menos una cantidad recibida");
      return;
    }

    setPending(true);
    const res = await registrarRecepcion(orderId, fecha, recibidoPor, items, notas || undefined);
    setPending(false);

    if (res.error) {
      setError(res.error);
      return;
    }

    setOpen(false);
    reset();
    onDone();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button className="h-8 px-3 text-[12px]">Registrar recepción</Button>
      </DialogTrigger>
      <DialogContent title="Registrar recepción de mercadería" className="max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-[var(--muted)] mb-1">Fecha *</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                required
                className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[12px] text-[var(--muted)] mb-1">Recibido por *</label>
              <input
                type="text"
                value={recibidoPor}
                onChange={(e) => setRecibidoPor(e.target.value)}
                required
                placeholder="Nombre del receptor"
                className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
              />
            </div>
          </div>

          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1.5">
              Cantidades recibidas
            </label>
            <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] overflow-hidden">
              <table>
                <thead>
                  <tr>
                    <th>Ítem</th>
                    <th className="num">Ordenado</th>
                    <th className="num w-24">Recibida</th>
                    <th className="w-40">Producto de stock</th>
                  </tr>
                </thead>
                <tbody>
                  {orderItems.map((it) => (
                    <tr key={it.id}>
                      <td className="text-[13px]">{it.product}</td>
                      <td className="num text-[var(--muted)]">
                        {formatNumber(it.quantity, 2)} {it.unit}
                      </td>
                      <td className="num">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={cantidades[it.id] ?? ""}
                          onChange={(e) =>
                            setCantidades((prev) => ({ ...prev, [it.id]: e.target.value }))
                          }
                          placeholder="0"
                          className="w-full h-7 rounded border border-[var(--border)] bg-[var(--panel)] px-2 text-[13px] text-right"
                        />
                      </td>
                      <td>
                        <select
                          value={productoPorItem[it.id] ?? ""}
                          onChange={(e) =>
                            setProductoPorItem((prev) => ({ ...prev, [it.id]: e.target.value }))
                          }
                          className="w-full h-7 rounded border border-[var(--border)] bg-[var(--panel)] px-1.5 text-[12px]"
                        >
                          <option value="">— no cargar a stock —</option>
                          {productos.map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-1">
              Elegí un producto para que la recepción genere la entrada de stock automáticamente,
              al precio unitario de la OC.
            </p>
          </div>

          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Notas</label>
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Opcional — estado de la mercadería, remito, etc."
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
          </div>

          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !recibidoPor.trim()}>
              {pending ? "Guardando…" : "Confirmar recepción"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── RecepcionCard ───────────────────────────────────────────────────────────

function RecepcionCard({
  recepcion,
  orderItems,
  canDelete,
  orderId,
}: {
  recepcion: OcRecepcion;
  orderItems: AuthorizedOrderItem[];
  canDelete: boolean;
  orderId: string;
}) {
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();
  const items = recepcion.oc_recepcion_items ?? [];

  async function handleDelete() {
    if (!confirm("¿Eliminar esta recepción? La acción no se puede deshacer.")) return;
    setDeleting(true);
    await eliminarRecepcion(recepcion.id, orderId);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[13px] font-medium">{formatDate(recepcion.fecha)}</div>
          <div className="text-[12px] text-[var(--muted)] mt-0.5">
            Recibido por: <span className="text-[var(--foreground)]">{recepcion.recibido_por}</span>
          </div>
          {recepcion.notas ? (
            <div className="text-[12px] text-[var(--muted)] mt-0.5">{recepcion.notas}</div>
          ) : null}
        </div>
        {canDelete ? (
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="text-[11px] text-[var(--muted)] hover:text-[var(--error)] transition-colors shrink-0 disabled:opacity-50"
          >
            {deleting ? "Eliminando…" : "Eliminar"}
          </button>
        ) : null}
      </div>

      {items.length > 0 ? (
        <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] overflow-hidden">
          <table>
            <thead>
              <tr>
                <th>Ítem</th>
                <th className="num">Recibido</th>
              </tr>
            </thead>
            <tbody>
              {items.map((ri) => {
                const oi = orderItems.find((o) => o.id === ri.order_item_id);
                return (
                  <tr key={ri.id}>
                    <td className="text-[13px]">{oi?.product ?? ri.order_item_id}</td>
                    <td className="num">
                      {formatNumber(ri.cantidad_recibida, 2)} {oi?.unit ?? ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

// ─── RecepcionSection ────────────────────────────────────────────────────────

export function RecepcionSection({
  orderId,
  orderItems,
  recepciones,
  canDelete = false,
}: {
  orderId: string;
  orderItems: AuthorizedOrderItem[];
  recepciones: OcRecepcion[];
  canDelete?: boolean;
}) {
  const [key, setKey] = useState(0);

  if (orderItems.length === 0) return null;

  // Totales recibidos por ítem (suma de todas las recepciones)
  const totalesRecibidos: Record<string, number> = {};
  for (const rec of recepciones) {
    for (const ri of rec.oc_recepcion_items ?? []) {
      totalesRecibidos[ri.order_item_id] = (totalesRecibidos[ri.order_item_id] ?? 0) + ri.cantidad_recibida;
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[14px] font-semibold">Recepción de mercadería</h2>
        <RegistrarDialog
          key={key}
          orderId={orderId}
          orderItems={orderItems}
          onDone={() => setKey((k) => k + 1)}
        />
      </div>

      {/* Resumen de cantidades recibidas vs ordenadas */}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>Ítem</th>
              <th className="num">Ordenado</th>
              <th className="num">Recibido</th>
              <th className="num">Pendiente</th>
            </tr>
          </thead>
          <tbody>
            {orderItems.map((it) => {
              const recibido = totalesRecibidos[it.id] ?? 0;
              const pendiente = Math.max(0, it.quantity - recibido);
              const completo = pendiente === 0;
              const excedido = recibido > it.quantity;
              return (
                <tr key={it.id}>
                  <td className="font-medium">{it.product}</td>
                  <td className="num">{formatNumber(it.quantity, 2)} {it.unit}</td>
                  <td className={`num ${excedido ? "text-[var(--warn)]" : recibido > 0 ? "text-[var(--ok)]" : "text-[var(--muted)]"}`}>
                    {formatNumber(recibido, 2)} {it.unit}
                  </td>
                  <td className={`num ${completo ? "text-[var(--muted)]" : excedido ? "text-[var(--warn)]" : ""}`}>
                    {excedido
                      ? "Excedido"
                      : completo
                        ? <span className="text-[var(--ok)]">Completo</span>
                        : `${formatNumber(pendiente, 2)} ${it.unit}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Historial de recepciones */}
      {recepciones.length > 0 ? (
        <div className="space-y-2">
          <div className="text-[12px] text-[var(--muted)] font-medium uppercase tracking-wide">
            Historial ({recepciones.length})
          </div>
          {recepciones.map((rec) => (
            <RecepcionCard
              key={rec.id}
              recepcion={rec}
              orderItems={orderItems}
              canDelete={canDelete}
              orderId={orderId}
            />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-[var(--muted)]">
          Todavía no se registraron recepciones para esta orden.
        </p>
      )}
    </div>
  );
}
