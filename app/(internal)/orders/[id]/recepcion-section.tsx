"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/format";
import type { AuthorizedOrderItem, OcRecepcion } from "@/lib/types";
import { registrarRecepcion, eliminarRecepcion } from "../oc-recepcion-actions";

interface Props {
  orderId: string;
  orderItems: AuthorizedOrderItem[];
  recepciones: OcRecepcion[];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function RegistrarDialog({
  orderId,
  orderItems,
}: {
  orderId: string;
  orderItems: AuthorizedOrderItem[];
}) {
  const [open, setOpen] = useState(false);
  const [fecha, setFecha] = useState(today());
  const [recibidoPor, setRecibidoPor] = useState("");
  const [notas, setNotas] = useState("");
  const [cantidades, setCantidades] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function reset() {
    setFecha(today());
    setRecibidoPor("");
    setNotas("");
    setCantidades({});
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const items = orderItems
      .map((it) => ({
        order_item_id: it.id,
        cantidad_recibida: parseFloat(cantidades[it.id] || "0"),
      }))
      .filter((i) => i.cantidad_recibida > 0);

    const res = await registrarRecepcion(orderId, fecha, recibidoPor, items, notas || undefined);
    setPending(false);

    if (res.error) {
      setError(res.error);
      return;
    }

    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button className="h-7 px-2.5 text-[12px]">Registrar recepción</Button>
      </DialogTrigger>
      <DialogContent title="Registrar recepción de mercadería" className="max-w-2xl">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[12px] text-[var(--muted)] mb-1">Fecha de recepción</label>
              <input
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
                required
                className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[13px]"
              />
            </div>
            <div>
              <label className="block text-[12px] text-[var(--muted)] mb-1">Recibido por</label>
              <input
                type="text"
                value={recibidoPor}
                onChange={(e) => setRecibidoPor(e.target.value)}
                required
                placeholder="Nombre y cargo"
                className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 text-[13px]"
              />
            </div>
          </div>

          <div>
            <p className="text-[12px] text-[var(--muted)] mb-1.5">
              Ingresá la cantidad que llegó de cada ítem (dejá en 0 lo que no llegó).
            </p>
            <div className="rounded border border-[var(--border)] overflow-hidden">
              <table className="text-[12px]">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th className="num">Cant. OC</th>
                    <th className="num w-28">Cant. recibida</th>
                  </tr>
                </thead>
                <tbody>
                  {orderItems.map((it) => (
                    <tr key={it.id}>
                      <td>
                        <span className="font-medium">{it.product}</span>
                        {it.unit ? <span className="text-[var(--muted)] ml-1">({it.unit})</span> : null}
                      </td>
                      <td className="num text-[var(--muted)]">{formatNumber(it.quantity, 2)}</td>
                      <td className="num">
                        <input
                          type="number"
                          min="0"
                          step="any"
                          value={cantidades[it.id] ?? ""}
                          onChange={(e) =>
                            setCantidades((prev) => ({ ...prev, [it.id]: e.target.value }))
                          }
                          className="w-24 h-7 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 text-right text-[12px]"
                          placeholder="0"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Notas (opcional)</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={2}
              placeholder="Observaciones sobre la entrega…"
              className="w-full rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-[12px]"
            />
          </div>

          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || !recibidoPor.trim()}>
              {pending ? "Guardando…" : "Guardar recepción"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RecepcionCard({
  recepcion,
  orderItems,
  orderId,
}: {
  recepcion: OcRecepcion;
  orderItems: AuthorizedOrderItem[];
  orderId: string;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const byItemId = new Map(
    (recepcion.oc_recepcion_items ?? []).map((i) => [i.order_item_id, i.cantidad_recibida])
  );

  async function handleDelete() {
    if (!confirm("¿Eliminar esta recepción?")) return;
    setPending(true);
    const res = await eliminarRecepcion(recepcion.id, orderId);
    setPending(false);
    if (res.error) alert(res.error);
    else router.refresh();
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-[13px] font-medium">{formatDate(recepcion.fecha)}</span>
          <span className="text-[12px] text-[var(--muted)] ml-2">· Recibido por: {recepcion.recibido_por}</span>
        </div>
        <Button
          variant="ghost"
          className="h-6 px-2 text-[12px] text-[var(--error)]"
          onClick={handleDelete}
          disabled={pending}
        >
          Eliminar
        </Button>
      </div>

      {recepcion.notas ? (
        <p className="text-[12px] text-[var(--muted)]">{recepcion.notas}</p>
      ) : null}

      <table className="text-[12px]">
        <thead>
          <tr>
            <th>Producto</th>
            <th className="num">Recibido</th>
          </tr>
        </thead>
        <tbody>
          {orderItems
            .filter((it) => byItemId.has(it.id))
            .map((it) => (
              <tr key={it.id}>
                <td>{it.product}</td>
                <td className="num font-medium">
                  {formatNumber(byItemId.get(it.id) ?? 0, 2)} {it.unit}
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}

export function RecepcionSection({ orderId, orderItems, recepciones }: Props) {
  // Solo mostrar si la OC tiene ítems detallados
  if (orderItems.length === 0) return null;

  // Calcular totales recibidos por ítem
  const totalesRecibidos = new Map<string, number>();
  for (const rec of recepciones) {
    for (const ri of rec.oc_recepcion_items ?? []) {
      totalesRecibidos.set(ri.order_item_id, (totalesRecibidos.get(ri.order_item_id) ?? 0) + ri.cantidad_recibida);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-[14px] font-semibold">Recepciones de mercadería</h2>
          {recepciones.length > 0 ? (
            <p className="text-[11px] text-[var(--muted)] mt-0.5">
              {recepciones.length} {recepciones.length === 1 ? "recepción registrada" : "recepciones registradas"}
            </p>
          ) : null}
        </div>
        <RegistrarDialog orderId={orderId} orderItems={orderItems} />
      </div>

      {recepciones.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-center text-[13px] text-[var(--muted)]">
          No hay recepciones registradas. Registrá una cuando llegue la mercadería.
        </div>
      ) : (
        <div className="space-y-3">
          {recepciones.map((r) => (
            <RecepcionCard key={r.id} recepcion={r} orderItems={orderItems} orderId={orderId} />
          ))}
        </div>
      )}

      {/* Resumen de cantidades recibidas vs OC */}
      {recepciones.length > 0 ? (
        <div className="mt-3 rounded border border-[var(--border)] bg-[var(--panel-2)] overflow-hidden">
          <table className="text-[12px]">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Cant. OC</th>
                <th className="num">Total recibido</th>
                <th className="num">Pendiente</th>
              </tr>
            </thead>
            <tbody>
              {orderItems.map((it) => {
                const recibido = totalesRecibidos.get(it.id) ?? 0;
                const pendiente = Math.max(0, it.quantity - recibido);
                const completo = recibido >= it.quantity;
                return (
                  <tr key={it.id}>
                    <td>{it.product}</td>
                    <td className="num text-[var(--muted)]">{formatNumber(it.quantity, 2)}</td>
                    <td className="num font-medium">{formatNumber(recibido, 2)}</td>
                    <td className={`num ${completo ? "text-[var(--muted)]" : "text-[var(--warn)]"}`}>
                      {completo ? "Completo" : formatNumber(pendiente, 2)}
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
