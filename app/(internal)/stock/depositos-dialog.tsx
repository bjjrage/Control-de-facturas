"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Deposito } from "@/lib/types";
import { crearDeposito, renombrarDeposito, eliminarDeposito } from "./stock-actions";

export function DepositosDialog({
  depositos,
  trigger,
}: {
  depositos: Deposito[];
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [nuevo, setNuevo] = useState("");
  const [editId, setEditId] = useState<string | null>(null);
  const [editNombre, setEditNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

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
    const nombre = nuevo.trim();
    if (!nombre) return;
    run(async () => {
      const res = await crearDeposito(nombre);
      if (!res.error) setNuevo("");
      return res;
    });
  }

  function guardarEdit(id: string) {
    const nombre = editNombre.trim();
    if (!nombre) return;
    run(async () => {
      const res = await renombrarDeposito(id, nombre);
      if (!res.error) setEditId(null);
      return res;
    });
  }

  function borrar(d: Deposito) {
    if (d.es_principal) {
      setError("El depósito principal no se puede eliminar.");
      return;
    }
    if (!confirm(`Eliminar "${d.nombre}"?`)) return;
    run(() => eliminarDeposito(d.id));
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setError(null); setEditId(null); setNuevo(""); } }}>
      <DialogTrigger asChild>
        {trigger ?? <Button variant="secondary">Gestionar depósitos</Button>}
      </DialogTrigger>
      <DialogContent title="Depósitos de stock">
        <div className="space-y-3">
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <ul className="divide-y divide-[var(--border)] rounded border border-[var(--border)]">
            {depositos.map((d) => {
              const editing = editId === d.id;
              return (
                <li key={d.id} className="flex items-center gap-2 px-2.5 py-1.5">
                  {editing ? (
                    <>
                      <Input
                        value={editNombre}
                        onChange={(e) => setEditNombre((e.target as HTMLInputElement).value)}
                        autoFocus
                        className="h-7 flex-1"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") guardarEdit(d.id);
                          if (e.key === "Escape") setEditId(null);
                        }}
                      />
                      <button
                        className="text-[12px] text-action"
                        disabled={pending}
                        onClick={() => guardarEdit(d.id)}
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
                      <span className="text-[13px] flex-1">
                        {d.nombre}
                        {d.es_principal ? (
                          <span className="ml-1.5 text-[10px] text-[var(--muted)] border border-[var(--border)] rounded px-1">
                            principal
                          </span>
                        ) : null}
                        {!d.activo ? (
                          <span className="ml-1.5 text-[10px] text-[var(--muted)] border border-[var(--border)] rounded px-1">
                            inactivo
                          </span>
                        ) : null}
                      </span>
                      <button
                        className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]"
                        onClick={() => { setEditId(d.id); setEditNombre(d.nombre); }}
                      >
                        Renombrar
                      </button>
                      {!d.es_principal ? (
                        <button
                          className="text-[12px] text-[var(--muted)] hover:text-[var(--error)]"
                          disabled={pending}
                          onClick={() => borrar(d)}
                        >
                          Eliminar
                        </button>
                      ) : null}
                    </>
                  )}
                </li>
              );
            })}
            {depositos.length === 0 ? (
              <li className="px-3 py-3 text-[12px] text-[var(--muted)]">
                Sin depósitos. Se creará uno automáticamente al registrar el primer movimiento.
              </li>
            ) : null}
          </ul>

          <div className="flex items-center gap-2 pt-1">
            <Input
              placeholder="Nuevo depósito…"
              value={nuevo}
              onChange={(e) => setNuevo((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === "Enter") agregar(); }}
              className="flex-1"
            />
            <Button disabled={pending || !nuevo.trim()} onClick={agregar}>
              Agregar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
