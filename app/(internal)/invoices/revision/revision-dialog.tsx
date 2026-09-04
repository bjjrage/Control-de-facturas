"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { InvoiceJob, Provider } from "@/lib/types";
import { resolveInvoiceJob } from "./actions";

export function RevisionDialog({
  job,
  providers,
  trigger,
}: {
  job: InvoiceJob;
  providers: Provider[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const d = job.extracted;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={`Completar — ${job.file_name}`}>
        {(job.outcome === "duplicate" || job.message?.startsWith("Ya existe")) ? (
          <div className="space-y-4">
            <div className="rounded border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-2.5 text-[13px] text-[var(--warn)]">
              {job.message}
            </div>
            <div className="flex justify-end">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cerrar</Button>
            </div>
          </div>
        ) : (
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await resolveInvoiceJob(job.id, formData);
            setPending(false);
            if (result?.error) {
              setError(result.error);
              return;
            }
            setError(null);
            setOpen(false);
          }}
        >
          {job.message ? <p className="text-[12px] text-[var(--muted)]">{job.message}</p> : null}
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <div>
            <Label htmlFor="r_provider">Proveedor</Label>
            <Select id="r_provider" name="provider_id" defaultValue={job.provider_id ?? ""} required>
              <option value="">Elegí un proveedor</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.tax_id ? ` — ${p.tax_id}` : ""}
                </option>
              ))}
            </Select>
            {d?.provider_name && !job.provider_id ? (
              <p className="text-[11px] text-[var(--muted)] mt-1">
                La factura dice &quot;{d.provider_name}&quot;{d.provider_tax_id ? ` (RUC ${d.provider_tax_id})` : ""}.
              </p>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="r_number">N° de factura</Label>
              <Input id="r_number" name="invoice_number" defaultValue={d?.invoice_number ?? ""} required />
            </div>
            <div>
              <Label htmlFor="r_date">Fecha</Label>
              <Input
                id="r_date"
                name="invoice_date"
                type="date"
                defaultValue={d?.invoice_date ?? job.batch_date}
                required
              />
            </div>
            <div>
              <Label htmlFor="r_subtotal">Subtotal</Label>
              <Input id="r_subtotal" name="subtotal" type="number" defaultValue={d?.subtotal ?? ""} />
            </div>
            <div>
              <Label htmlFor="r_vat">IVA</Label>
              <Input id="r_vat" name="vat" type="number" defaultValue={d?.vat ?? ""} />
            </div>
            <div>
              <Label htmlFor="r_total">Total</Label>
              <Input id="r_total" name="total" type="number" defaultValue={d?.total ?? ""} required />
            </div>
            <div>
              <Label htmlFor="r_currency">Moneda</Label>
              <Select id="r_currency" name="currency" defaultValue="PYG">
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="BRL">BRL</option>
                <option value="ARS">ARS</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="r_timbrado">Timbrado</Label>
            <Input id="r_timbrado" name="timbrado" defaultValue={d?.timbrado ?? ""} />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear factura"}
            </Button>
          </div>
        </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
