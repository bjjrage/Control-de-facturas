"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { AttachmentLink } from "./attachment-link";
import { enterQuotePricesManually } from "./actions";

export interface ManualQuoteItem {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
}

export function ManualQuoteDialog({
  rfqProviderId,
  providerName,
  items,
  attachments,
  trigger,
}: {
  rfqProviderId: string;
  providerName: string;
  items: ManualQuoteItem[];
  attachments: { id: string; bucket: string; path: string; file_name: string | null }[];
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={`Cargar precios de ${providerName}`} className="max-w-3xl">
        <form
          className="space-y-3 text-[12px]"
          action={async (formData: FormData) => {
            setPending(true);
            const res = await enterQuotePricesManually(rfqProviderId, formData);
            setPending(false);
            if (res.error) return setError(res.error);
            setError(null);
            setOpen(false);
            router.refresh();
          }}
        >
          <p className="text-[var(--muted)]">
            Tipeá los precios mirando el presupuesto que mandó el proveedor. Queda registrado que los cargó alguien del
            equipo, no el proveedor.
          </p>
          {attachments.length > 0 ? (
            <div className="rounded border border-[var(--border)] p-2">
              <div className="text-[11px] text-[var(--muted)] mb-1">Adjuntos del proveedor</div>
              <ul className="space-y-0.5">
                {attachments.map((a) => (
                  <li key={a.id}>
                    <AttachmentLink bucket={a.bucket} path={a.path} fileName={a.file_name ?? "Adjunto"} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-amber-500">Este proveedor todavía no subió ningún adjunto.</p>
          )}

          <div className="rounded border border-[var(--border)] overflow-x-auto max-h-80 overflow-y-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]">
                  <th className="py-1.5 px-2">Ítem</th>
                  <th className="py-1.5 px-2 text-right">Cantidad</th>
                  <th className="py-1.5 px-2 text-right">Precio unitario</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-1.5 px-2">{it.descripcion}</td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">
                      {formatNumber(it.cantidad, Number.isInteger(it.cantidad) ? 0 : 2)} {it.unidad}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <Input name={`price_${it.id}`} type="number" min="0" step="any" className="h-7 w-32 text-right ml-auto" placeholder="—" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <Label htmlFor="mq-budget">N° de presupuesto</Label>
              <Input id="mq-budget" name="budget_number" placeholder="S/N" className="h-8" />
            </div>
            <div>
              <Label htmlFor="mq-currency">Moneda</Label>
              <Select id="mq-currency" name="currency" defaultValue="PYG">
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="BRL">BRL</option>
                <option value="ARS">ARS</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="mq-delivery">Plazo de entrega</Label>
              <Input id="mq-delivery" name="delivery_time" placeholder="15 dias" className="h-8" />
            </div>
            <div>
              <Label htmlFor="mq-validity">Validez</Label>
              <Input id="mq-validity" name="offer_validity" placeholder="30 dias" className="h-8" />
            </div>
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input type="checkbox" name="invoice_available" defaultChecked />
              Emite factura
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="vat_included" defaultChecked />
              IVA incluido
            </label>
          </div>

          {error ? <p className="text-[var(--error)]">{error}</p> : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="h-8 text-xs">
              Cancelar
            </Button>
            <Button type="submit" disabled={pending} className="h-8 text-xs">
              {pending ? "Guardando…" : "Guardar precios"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
