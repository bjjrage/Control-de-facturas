"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/format";
import { registrarMovimiento } from "../stock-actions";

type Tipo = "ENTRADA" | "SALIDA" | "AJUSTE";

export function MovimientoDialog({
  productoId,
  unidad,
  stockActual,
}: {
  productoId: string;
  unidad: string;
  stockActual: number;
}) {
  const [open, setOpen] = useState(false);
  const [tipo, setTipo] = useState<Tipo>("ENTRADA");
  const [cantidad, setCantidad] = useState("");
  const [notas, setNotas] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function reset() {
    setTipo("ENTRADA");
    setCantidad("");
    setNotas("");
    setError(null);
  }

  const cantidadNum = parseFloat(cantidad) || 0;
  const preview =
    tipo === "ENTRADA"
      ? stockActual + cantidadNum
      : tipo === "SALIDA"
        ? stockActual - cantidadNum
        : cantidadNum;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (cantidadNum <= 0) {
      setError("La cantidad debe ser mayor a 0");
      return;
    }
    setPending(true);
    setError(null);

    const res = await registrarMovimiento(productoId, tipo, cantidadNum, {
      notas: notas || undefined,
    });
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
        <Button>Registrar movimiento</Button>
      </DialogTrigger>
      <DialogContent title="Registrar movimiento de stock" className="max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Tipo</label>
            <div className="flex gap-2">
              {(["ENTRADA", "SALIDA", "AJUSTE"] as Tipo[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipo(t)}
                  className={`flex-1 h-8 rounded border text-[12px] font-medium transition-colors ${
                    tipo === t
                      ? t === "ENTRADA"
                        ? "bg-[var(--ok-bg)] border-[var(--ok)]/40 text-[var(--ok)]"
                        : t === "SALIDA"
                          ? "bg-[var(--error-bg)] border-[var(--error)]/40 text-[var(--error)]"
                          : "bg-[var(--accent-teal-bg)] border-[var(--accent-teal)]/40 text-[var(--accent-teal)]"
                      : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"
                  }`}
                >
                  {t === "ENTRADA" ? "Entrada" : t === "SALIDA" ? "Salida" : "Ajuste"}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[var(--muted)] mt-1.5">
              {tipo === "ENTRADA" && "Suma al stock existente."}
              {tipo === "SALIDA" && "Resta del stock existente. Falla si no hay suficiente."}
              {tipo === "AJUSTE" && "Fija el stock al valor exacto que ingreses (corrección de inventario)."}
            </p>
          </div>

          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">
              {tipo === "AJUSTE" ? "Nuevo stock total" : "Cantidad"} ({unidad})
            </label>
            <input
              type="number"
              min="0"
              step="any"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              required
              placeholder="0"
              autoFocus
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
          </div>

          {cantidadNum > 0 ? (
            <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px]">
              <span className="text-[var(--muted)]">Stock actual: </span>
              <span className="font-medium">{formatNumber(stockActual, 2)}</span>
              <span className="text-[var(--muted)] mx-1.5">→</span>
              <span className={`font-semibold ${preview < 0 ? "text-[var(--error)]" : ""}`}>
                {formatNumber(preview, 2)} {unidad}
              </span>
            </div>
          ) : null}

          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Notas</label>
            <input
              type="text"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Opcional"
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
          </div>

          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending || cantidadNum <= 0}>
              {pending ? "Guardando…" : "Confirmar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
