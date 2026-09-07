"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { crearProducto } from "../stock-actions";

export default function NuevoProductoPage() {
  const [nombre, setNombre] = useState("");
  const [unidad, setUnidad] = useState("");
  const [contenido, setContenido] = useState("");
  const [unidadBase, setUnidadBase] = useState("");
  const [sku, setSku] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [stockMinimo, setStockMinimo] = useState("");
  const [stockInicial, setStockInicial] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const res = await crearProducto({
      nombre,
      unidad,
      sku: sku || undefined,
      descripcion: descripcion || undefined,
      stock_minimo: stockMinimo ? parseFloat(stockMinimo) : 0,
      stock_inicial: stockInicial ? parseFloat(stockInicial) : 0,
      contenido_por_unidad: contenido ? parseFloat(contenido) : undefined,
      unidad_base: unidadBase || undefined,
    });

    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    router.push(`/stock/${res.id}`);
  }

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <Link href="/stock" className="text-action text-[12px] text-[var(--muted)]">
          ← Volver a Stock
        </Link>
        <h1 className="text-[17px] font-semibold mt-1">Nuevo producto</h1>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4">
        <div>
          <label className="block text-[12px] text-[var(--muted)] mb-1">Nombre *</label>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            placeholder="Ej: Cemento Portland 50kg"
            className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Unidad de compra *</label>
            <input
              type="text"
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              required
              placeholder="bolsa, caja, rollo, kg…"
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">SKU / Código</label>
            <input
              type="text"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="Opcional"
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Contenido por unidad</label>
            <input
              type="number"
              min="0"
              step="any"
              value={contenido}
              onChange={(e) => setContenido(e.target.value)}
              placeholder="Ej: 25"
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Unidad base</label>
            <input
              type="text"
              value={unidadBase}
              onChange={(e) => setUnidadBase(e.target.value)}
              placeholder="kg, lt, m², unidad…"
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
          </div>
        </div>
        {contenido && unidadBase ? (
          <p className="text-[11px] text-[var(--muted)] -mt-2">
            Cada {unidad || "unidad"} contiene {contenido} {unidadBase} — el sistema calculará el total automáticamente.
          </p>
        ) : (
          <p className="text-[11px] text-[var(--muted)] -mt-2">
            Opcional. Permite calcular totales en unidad base (ej: bolsa × 25 kg = kg totales).
          </p>
        )}

        <div>
          <label className="block text-[12px] text-[var(--muted)] mb-1">Descripción</label>
          <textarea
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={2}
            placeholder="Opcional"
            className="w-full rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1.5 text-[13px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Stock mínimo</label>
            <input
              type="number"
              min="0"
              step="any"
              value={stockMinimo}
              onChange={(e) => setStockMinimo(e.target.value)}
              placeholder="0"
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">Alerta cuando el stock baje de este valor</p>
          </div>
          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Stock inicial</label>
            <input
              type="number"
              min="0"
              step="any"
              value={stockInicial}
              onChange={(e) => setStockInicial(e.target.value)}
              placeholder="0"
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">Se registra como ENTRADA inicial</p>
          </div>
        </div>

        {error ? (
          <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Link href="/stock">
            <Button type="button" variant="secondary">Cancelar</Button>
          </Link>
          <Button type="submit" disabled={pending || !nombre.trim() || !unidad.trim() || (!!contenido && !unidadBase) || (!contenido && !!unidadBase)}>
            {pending ? "Guardando…" : "Crear producto"}
          </Button>
        </div>
      </form>
    </div>
  );
}
