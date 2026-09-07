"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { actualizarProducto } from "../../stock-actions";
import { createClient } from "@/lib/supabase/browser";
import type { Producto } from "@/lib/types";

export default function EditarProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string | null>(null);
  const [producto, setProducto] = useState<Producto | null>(null);
  const [nombre, setNombre] = useState("");
  const [unidad, setUnidad] = useState("");
  const [sku, setSku] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [stockMinimo, setStockMinimo] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    params.then(({ id: pid }) => {
      setId(pid);
      const supabase = createClient();
      supabase
        .from("productos")
        .select("*")
        .eq("id", pid)
        .single<Producto>()
        .then(({ data }) => {
          if (!data) { router.push("/stock"); return; }
          setProducto(data);
          setNombre(data.nombre);
          setUnidad(data.unidad);
          setSku(data.sku ?? "");
          setDescripcion(data.descripcion ?? "");
          setStockMinimo(data.stock_minimo > 0 ? String(data.stock_minimo) : "");
        });
    });
  }, [params, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!id) return;
    setPending(true);
    setError(null);

    const res = await actualizarProducto(id, {
      nombre,
      unidad,
      sku: sku || undefined,
      descripcion: descripcion || undefined,
      stock_minimo: stockMinimo ? parseFloat(stockMinimo) : 0,
    });

    setPending(false);
    if (res.error) { setError(res.error); return; }
    router.push(`/stock/${id}`);
  }

  if (!producto) {
    return (
      <div className="max-w-lg space-y-5">
        <div className="h-4 w-32 rounded bg-[var(--hover)] animate-pulse" />
        <div className="h-64 rounded-lg bg-[var(--panel)] animate-pulse" />
      </div>
    );
  }

  return (
    <div className="max-w-lg space-y-5">
      <div>
        <Link href={`/stock/${producto.id}`} className="text-action text-[12px] text-[var(--muted)]">
          ← Volver a {producto.nombre}
        </Link>
        <h1 className="text-[17px] font-semibold mt-1">Editar producto</h1>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4">
        <div>
          <label className="block text-[12px] text-[var(--muted)] mb-1">Nombre *</label>
          <input
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Unidad *</label>
            <input
              type="text"
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              required
              placeholder="bolsa, kg, m², unidad…"
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

        {error ? (
          <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end gap-2 pt-1">
          <Link href={`/stock/${producto.id}`}>
            <Button type="button" variant="secondary">Cancelar</Button>
          </Link>
          <Button type="submit" disabled={pending || !nombre.trim() || !unidad.trim()}>
            {pending ? "Guardando…" : "Guardar cambios"}
          </Button>
        </div>
      </form>
    </div>
  );
}
