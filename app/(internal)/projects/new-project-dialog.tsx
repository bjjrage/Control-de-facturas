"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createProject } from "./actions";
import { WorkbookImportPreview } from "./workbook-import-preview";

export function NewProjectDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"choice" | "manual" | "workbook">("choice");
  const [error, setError] = useState<string | null>(null);
  const [partialProjectId, setPartialProjectId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen && !partialProjectId) {
      setMode("choice");
      setError(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={mode === "workbook" ? "Importar planilla de obra" : mode === "manual" ? "Crear obra manualmente" : "Nueva obra"} className="max-w-3xl">
        {mode === "choice" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => setMode("workbook")} className="rounded-xl border border-sky-300/25 bg-sky-300/[0.035] p-4 text-left transition hover:border-sky-300/55 hover:bg-sky-300/[0.08]">
              <p className="text-[13px] font-semibold text-sky-100">Importar planilla de obra</p>
              <p className="mt-1 text-[12px] text-[var(--muted)]">Subí tu workbook y mirá qué puede entender el ERP.</p>
            </button>
            <button type="button" onClick={() => setMode("manual")} className="rounded-xl border border-[var(--border)] bg-white/[0.025] p-4 text-left transition hover:border-sky-300/40 hover:bg-sky-300/[0.04]">
              <p className="text-[13px] font-semibold">Crear manualmente</p>
              <p className="mt-1 text-[12px] text-[var(--muted)]">Ingresá los datos de la obra paso a paso.</p>
            </button>
          </div>
        ) : mode === "workbook" ? <WorkbookImportPreview onBack={() => setMode("choice")} /> : <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await createProject(formData);
            setPending(false);
            if (result.error) {
              setError(result.error);
              if (result.projectId) setPartialProjectId(result.projectId);
              return;
            }
            setError(null);
            setPartialProjectId(null);
            setOpen(false);
            router.refresh();
          }}
        >
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
              {partialProjectId ? (
                <Link href={`/projects/${partialProjectId}?tab=presupuesto`} className="ml-2 font-semibold underline">
                  Abrir la obra para reparar la ubicación
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="np_name">Nombre</Label>
              <Input id="np_name" name="name" required />
            </div>
            <div>
              <Label htmlFor="np_code">Código</Label>
              <Input id="np_code" name="code" placeholder="OBR-001" required />
            </div>
            <div>
              <Label htmlFor="np_client">Cliente</Label>
              <Input id="np_client" name="client" />
            </div>
            <div>
              <Label htmlFor="np_location">Ubicación</Label>
              <Input id="np_location" name="location" />
            </div>
            <div>
              <Label htmlFor="np_start">Fecha inicio</Label>
              <Input id="np_start" name="start_date" type="date" />
            </div>
            <div>
              <Label htmlFor="np_end">Fecha fin</Label>
              <Input id="np_end" name="end_date" type="date" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="np_budget">Presupuesto estimado (Gs)</Label>
              <Input id="np_budget" name="budget_total" type="number" step="any" min="0" />
            </div>
          </div>

          <p className="text-[11px] text-[var(--muted)]">
            Se preparará una ubicación canónica de stock para esta obra.
          </p>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setMode("choice")} disabled={Boolean(partialProjectId)}>Volver</Button>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending || Boolean(partialProjectId)}>
              {pending ? "Creando…" : partialProjectId ? "Obra creada" : "Crear proyecto"}
            </Button>
          </div>
        </form>}
      </DialogContent>
    </Dialog>
  );
}
