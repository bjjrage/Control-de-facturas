"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { crearProducto } from "../stock-actions";
import { createClient } from "@/lib/supabase/browser";
import type { CategoriaProducto } from "@/lib/types";
import { UNIDADES_COMPRA, UNIDADES_BASE } from "@/lib/stock-units";

export default function NuevoProductoPage() {
  const [nombre, setNombre] = useState("");
  const [unidad, setUnidad] = useState("");
  const [contenido, setContenido] = useState("");
  const [unidadBase, setUnidadBase] = useState("");
  const [sku, setSku] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoriaId, setCategoriaId] = useState("");
  const [categorias, setCategorias] = useState<CategoriaProducto[]>([]);
  const [stockMinimo, setStockMinimo] = useState("");
  const [stockInicial, setStockInicial] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase
      .from("categorias_producto")
      .select("*")
      .order("orden")
      .order("nombre")
      .returns<CategoriaProducto[]>()
      .then(({ data }) => setCategorias(data ?? []));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);

    const res = await crearProducto({
      nombre,
      unidad,
      sku: sku || undefined,
      descripcion: descripcion || undefined,
      categoria_id: categoriaId || null,
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
          <label htmlFor="p-nombre" className="block text-[12px] text-[var(--muted)] mb-1">Nombre *</label>
          <input
            id="p-nombre"
            name="nombre"
            type="text"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            required
            placeholder="Ej: Cemento Portland 50kg"
            className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
          />
        </div>

        <div>
          <label htmlFor="p-categoria" className="block text-[12px] text-[var(--muted)] mb-1">Categoría</label>
          <select
            id="p-categoria"
            name="categoria"
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
          >
            <option value="">Sin categoría</option>
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>{c.nombre}</option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="p-unidad" className="block text-[12px] text-[var(--muted)] mb-1">Unidad de compra *</label>
            <select
              id="p-unidad"
              name="unidad"
              value={unidad}
              onChange={(e) => setUnidad(e.target.value)}
              required
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            >
              <option value="">— seleccioná —</option>
              {UNIDADES_COMPRA.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
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
              onChange={(e) => { setContenido(e.target.value); if (!e.target.value) setUnidadBase(""); }}
              placeholder="Ej: 25"
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]"
            />
          </div>
          <div>
            <label className="block text-[12px] text-[var(--muted)] mb-1">Unidad base</label>
            <select
              value={unidadBase}
              onChange={(e) => setUnidadBase(e.target.value)}
              disabled={!contenido}
              className="w-full h-8 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px] disabled:opacity-40"
            >
              <option value="">— seleccioná —</option>
              {UNIDADES_BASE.map((u) => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        </div>
        {contenido && unidadBase ? (
          <p className="text-[11px] text-[var(--muted)] -mt-2">
            Cada {unidad || "unidad"} contiene {contenido} {unidadBase} — el sistema calculará el total automáticamente.
          </p>
        ) : (
          <p className="text-[11px] text-[var(--muted)] -mt-2">
            Opcional. Si cada unidad de compra tiene un peso/volumen fijo, el sistema calcula el total en unidad base.
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
