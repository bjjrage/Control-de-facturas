"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CategoriaProducto, Producto } from "@/lib/types";
import {
  crearCategoria,
  renombrarCategoria,
  eliminarCategoria,
  crearCategoriasSugeridas,
} from "./stock-actions";

export function CategoriasDialog({
  categorias,
  productos,
  trigger,
}: {
  categorias: CategoriaProducto[];
  productos: Producto[];
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [nueva, setNueva] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const conteoPorCat = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of productos) {
      if (!p.categoria_id) continue;
      m.set(p.categoria_id, (m.get(p.categoria_id) ?? 0) + 1);
    }
    return m;
  }, [productos]);

  function run(fn: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  function agregar() {
    const nombre = nueva.trim();
    if (!nombre) return;
    run(async () => {
      const res = await crearCategoria(nombre);
      if (!res.error) setNueva("");
      return res;
    });
  }

  function guardarEdit(id: string) {
    const nombre = editNombre.trim();
    if (!nombre) return;
    run(async () => {
      const res = await renombrarCategoria(id, nombre);
      if (!res.error) setEditId(null);
      return res;
    });
  }

  function borrar(c: CategoriaProducto) {
    const n = conteoPorCat.get(c.id) ?? 0;
    const msg =
      n > 0
        ? `Eliminar "${c.nombre}"? Sus ${n} ${n === 1 ? "producto queda" : "productos quedan"} sin categoría.`
        : `Eliminar "${c.nombre}"?`;
    if (!confirm(msg)) return;
    run(() => eliminarCategoria(c.id));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setError(null); setEditId(null); setNueva(""); } }}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="secondary">Gestionar categorías</Button>
        )}
      </DialogTrigger>
      <DialogContent title="Categorías de stock">
        <div className="space-y-3">
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          {categorias.length === 0 ? (
            <div className="rounded border border-dashed border-[var(--border)] px-3 py-3 text-[12px] text-[var(--muted)] space-y-2">
              <p>Todavía no hay categorías. Podés arrancar con un set típico de constructora.</p>
              <Button
                variant="secondary"
                className="h-7 px-2.5 text-[12px]"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const res = await crearCategoriasSugeridas();
                    return { error: res.error };
                  })
                }
              >
                {pending ? "Creando…" : "Crear categorías sugeridas"}
              </Button>
            </div>
          ) : (
            <ul className="divide-y divide-[var(--border)] rounded border border-[var(--border)]">
              {categorias.map((c) => {
                const n = conteoPorCat.get(c.id) ?? 0;
                const editing = editId === c.id;
                return (
                  <li key={c.id} className="flex items-center gap-2 px-2.5 py-1.5">
                    {editing ? (
                      <>
                        <Input
                          value={editNombre}
                          onChange={(e) => setEditNombre((e.target as HTMLInputElement).value)}
                          autoFocus
                          className="h-7 flex-1"
                          onKeyDown={(e) => {
                            if (e.key === "Enter") guardarEdit(c.id);
                            if (e.key === "Escape") setEditId(null);
                          }}
                        />
                        <button
                          className="text-[12px] text-action"
                          disabled={pending}
                          onClick={() => guardarEdit(c.id)}
                        >
                          Guardar
                        </button>
                        <button
                          className="text-[12px] text-[var(--muted)]"
                          onClick={() => setEditId(null)}
                        >
                          Cancelar
                        </button>
                      </>
                    ) : (
                      <>
                        <span className="text-[13px] flex-1">{c.nombre}</span>
                        <span className="text-[11px] text-[var(--muted)]">
                          {n} {n === 1 ? "ítem" : "ítems"}
                        </span>
                        <button
                          className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]"
                          onClick={() => { setEditId(c.id); setEditNombre(c.nombre); }}
                        >
                          Renombrar
                        </button>
                        <button
                          className="text-[12px] text-[var(--muted)] hover:text-[var(--error)]"
                          disabled={pending}
                          onClick={() => borrar(c)}
                        >
                          Eliminar
                        </button>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Input
              placeholder="Nueva categoría…"
              value={nueva}
              onChange={(e) => setNueva((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === "Enter") agregar(); }}
              className="flex-1"
            />
            <Button disabled={pending || !nueva.trim()} onClick={agregar}>
              Agregar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
