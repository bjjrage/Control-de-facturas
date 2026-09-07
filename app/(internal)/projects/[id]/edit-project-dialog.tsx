"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Project } from "@/lib/types";
import { updateProject } from "../actions";

export function EditProjectDialog({
  project,
  trigger,
  showContract = false,
}: {
  project: Project;
  trigger: React.ReactNode;
  showContract?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [contractOpen, setContractOpen] = useState(
    showContract && (!!project.comitente || project.contract_amount > 0)
  );
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Editar proyecto">
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await updateProject(project.id, formData);
            setPending(false);
            if (result.error) {
              setError(result.error);
              return;
            }
            setError(null);
            setOpen(false);
            router.refresh();
          }}
        >
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ep_name">Nombre</Label>
              <Input id="ep_name" name="name" defaultValue={project.name} required />
            </div>
            <div>
              <Label>Código</Label>
              <Input value={project.code} disabled />
            </div>
            <div>
              <Label htmlFor="ep_client">Cliente</Label>
              <Input id="ep_client" name="client" defaultValue={project.client ?? ""} />
            </div>
            <div>
              <Label htmlFor="ep_location">Ubicación</Label>
              <Input id="ep_location" name="location" defaultValue={project.location ?? ""} />
            </div>
            <div>
              <Label htmlFor="ep_start">Fecha inicio</Label>
              <Input id="ep_start" name="start_date" type="date" defaultValue={project.start_date ?? ""} />
            </div>
            <div>
              <Label htmlFor="ep_end">Fecha fin</Label>
              <Input id="ep_end" name="end_date" type="date" defaultValue={project.end_date ?? ""} />
            </div>
            <div className="col-span-2">
              <Label htmlFor="ep_budget">Presupuesto estimado (Gs)</Label>
              <Input id="ep_budget" name="budget_total" type="number" step="any" min="0" defaultValue={project.budget_total} />
            </div>
          </div>

          {showContract ? (
            <div className="rounded border border-[var(--border)] bg-[var(--panel-2)]">
              <button
                type="button"
                onClick={() => setContractOpen((v) => !v)}
                className="w-full flex items-center justify-between px-3 py-2 text-[12px] font-medium text-[var(--muted)]"
              >
                <span>Datos de contrato (obra pública / certificados)</span>
                <span>{contractOpen ? "−" : "+"}</span>
              </button>
              {contractOpen ? (
                <div className="grid grid-cols-2 gap-3 px-3 pb-3">
                  <div className="col-span-2">
                    <Label htmlFor="ep_comitente">Comitente</Label>
                    <Input id="ep_comitente" name="comitente" defaultValue={project.comitente ?? ""} placeholder="FPTI-PY, MOPC…" />
                  </div>
                  <div>
                    <Label htmlFor="ep_contract_number">N° de contrato</Label>
                    <Input id="ep_contract_number" name="contract_number" defaultValue={project.contract_number ?? ""} />
                  </div>
                  <div>
                    <Label htmlFor="ep_contract_amount">Monto del contrato c/ IVA (Gs)</Label>
                    <Input id="ep_contract_amount" name="contract_amount" type="number" step="any" min="0" defaultValue={project.contract_amount} />
                  </div>
                  <div>
                    <Label htmlFor="ep_plazo">Plazo (días)</Label>
                    <Input id="ep_plazo" name="plazo_dias" type="number" min="0" defaultValue={project.plazo_dias ?? ""} />
                  </div>
                  <div>
                    <Label htmlFor="ep_ois">Orden de inicio</Label>
                    <Input id="ep_ois" name="orden_inicio_date" type="date" defaultValue={project.orden_inicio_date ?? ""} />
                  </div>
                  <div>
                    <Label htmlFor="ep_fisc_nombre">Fiscalización / SAT</Label>
                    <Input id="ep_fisc_nombre" name="fiscalizacion_nombre" defaultValue={project.fiscalizacion_nombre ?? ""} />
                  </div>
                  <div>
                    <Label htmlFor="ep_fisc_contrato">N° contrato fiscalización</Label>
                    <Input id="ep_fisc_contrato" name="fiscalizacion_contrato" defaultValue={project.fiscalizacion_contrato ?? ""} />
                  </div>
                  <div>
                    <Label htmlFor="ep_anticipo">% Anticipo</Label>
                    <Input id="ep_anticipo" name="anticipo_pct" type="number" step="any" min="0" max="100" defaultValue={project.anticipo_pct} />
                  </div>
                  <div>
                    <Label htmlFor="ep_devol">% Devolución de anticipo</Label>
                    <Input id="ep_devol" name="devolucion_anticipo_pct" type="number" step="any" min="0" max="100" defaultValue={project.devolucion_anticipo_pct} />
                  </div>
                  <div>
                    <Label htmlFor="ep_reten">% Retención</Label>
                    <Input id="ep_reten" name="retencion_pct" type="number" step="any" min="0" max="100" defaultValue={project.retencion_pct} />
                  </div>
                  <div>
                    <Label htmlFor="ep_iva">% IVA</Label>
                    <Input id="ep_iva" name="iva_pct" type="number" step="any" min="0" max="100" defaultValue={project.iva_pct} />
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Guardar cambios"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
