"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { addSubcontractorContract } from "../caterpillar-actions";
import { Subcontractor, BudgetItem } from "@/lib/types";

const NEW_VALUE = "__new__";

export function AddSubcontractorContractDialog({
  projectId,
  subcontractors,
  budgetItems,
}: {
  projectId: string;
  subcontractors: Subcontractor[];
  budgetItems: BudgetItem[];
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string>(subcontractors[0]?.id ?? NEW_VALUE);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const isNew = selected === NEW_VALUE;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Agregar contrato</Button>
      </DialogTrigger>
      <DialogContent title="Nuevo contrato de subcontratista">
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            setError(null);
            const result = await addSubcontractorContract(projectId, formData);
            setPending(false);
            if (result.error) {
              setError(result.error);
              return;
            }
            setOpen(false);
            router.refresh();
          }}
        >
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <div>
            <Label htmlFor="sc_select">Subcontratista</Label>
            <Select id="sc_select" value={selected} onChange={(e) => setSelected(e.target.value)}>
              {subcontractors.map((s) => (
                <option key={s.id} value={s.id}>{s.name}{s.specialty ? ` — ${s.specialty}` : ""}</option>
              ))}
              <option value={NEW_VALUE}>+ Cargar nuevo…</option>
            </Select>
          </div>

          {!isNew ? <input type="hidden" name="subcontractor_id" value={selected} /> : null}

          {isNew ? (
            <div className="grid grid-cols-2 gap-3 rounded border border-[var(--border)] bg-[var(--panel-2)] p-3">
              <div className="col-span-2">
                <Label htmlFor="sc_name">Nombre</Label>
                <Input id="sc_name" name="new_subcontractor_name" required />
              </div>
              <div>
                <Label htmlFor="sc_ruc">RUC</Label>
                <Input id="sc_ruc" name="new_subcontractor_ruc" />
              </div>
              <div>
                <Label htmlFor="sc_specialty">Rubro / especialidad</Label>
                <Input id="sc_specialty" name="new_subcontractor_specialty" placeholder="Electricidad, plomería…" />
              </div>
              <div>
                <Label htmlFor="sc_contact">Contacto</Label>
                <Input id="sc_contact" name="new_subcontractor_contact" />
              </div>
              <div>
                <Label htmlFor="sc_phone">Teléfono</Label>
                <Input id="sc_phone" name="new_subcontractor_phone" />
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sc_budget_item">Rubro del proyecto</Label>
              <Select id="sc_budget_item" name="budget_item_id">
                <option value="">Sin asignar</option>
                {budgetItems.map((i) => (
                  <option key={i.id} value={i.id}>{i.code} — {i.description}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="sc_amount">Monto contratado (Gs)</Label>
              <Input id="sc_amount" name="contracted_amount" type="number" step="any" min="0.01" required />
            </div>
            <div>
              <Label htmlFor="sc_retention">% Retención</Label>
              <Input id="sc_retention" name="retention_pct" type="number" step="any" min="0" max="100" defaultValue="5" />
            </div>
            <div>
              <Label htmlFor="sc_signed">Fecha de firma</Label>
              <Input id="sc_signed" name="signed_date" type="date" />
            </div>
            <div className="col-span-2">
              <Label htmlFor="sc_desc">Descripción</Label>
              <Input id="sc_desc" name="description" />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending}>{pending ? "Creando…" : "Crear contrato"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
