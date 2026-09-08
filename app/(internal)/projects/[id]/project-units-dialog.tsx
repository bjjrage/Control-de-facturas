"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProjectUnit } from "@/lib/types";
import { createProjectUnit, deleteProjectUnit } from "../certificado-actions";

export function ProjectUnitsDialog({
  projectId,
  units,
}: {
  projectId: string;
  units: ProjectUnit[];
}) {
  const [open, setOpen] = useState(false);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function add() {
    if (!nombre.trim()) return;
    setError(null);
    startTransition(async () => {
      const res = await createProjectUnit(projectId, nombre.trim());
      if (res.error) { setError(res.error); return; }
      setNombre("");
      router.refresh();
    });
  }

  function remove(unitId: string) {
    startTransition(async () => {
      const res = await deleteProjectUnit(unitId, projectId);
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Unidades ({units.length})</Button>
      </DialogTrigger>
      <DialogContent title="Unidades del proyecto" className="max-w-sm">
        <div className="space-y-3">
          <p className="text-[12px] text-[var(--muted)]">
            Unidades físicas (viviendas, locales, etc.) usadas para certificar por avance proporcional.
          </p>

          {units.length > 0 ? (
            <div className="space-y-1">
              {units.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-2 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1.5">
                  <span className="text-[13px]">{u.nombre}</span>
                  <Button
                    variant="ghost"
                    className="h-6 w-6 p-0 shrink-0"
                    disabled={pending}
                    onClick={() => remove(u.id)}
                  >
                    <Trash2 size={12} className="text-[var(--muted)]" />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-[var(--muted)] text-center py-2">Sin unidades todavía.</p>
          )}

          <div className="flex gap-2">
            <Input
              placeholder="Nombre (ej: Vivienda A)"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
              className="h-8 flex-1"
            />
            <Button onClick={add} disabled={pending || !nombre.trim()} className="h-8 px-3">
              Agregar
            </Button>
          </div>

          {error ? (
            <p className="text-[12px] text-[var(--error)]">{error}</p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
