"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { RECEIPT_METHOD_LABELS } from "@/lib/sales";
import { ReceiptMethod, CurrencyCode } from "@/lib/types";
import { addReceipt } from "../actions";

export type ReceiptCuenta = { id: string; nombre: string; moneda: CurrencyCode };

export function ReceiptDialog({
  docId,
  saldo,
  currency,
  trigger,
  cuentas = [],
}: {
  docId: string;
  saldo: number;
  currency: CurrencyCode;
  trigger: React.ReactNode;
  cuentas?: ReceiptCuenta[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Registrar cobro">
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await addReceipt(docId, formData);
            setPending(false);
            if (result?.error) {
              setError(result.error);
              return;
            }
            setError(null);
            setOpen(false);
          }}
        >
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}
          <p className="text-[12px] text-[var(--muted)]">Saldo pendiente: {formatMoney(saldo, currency)}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="amount">Monto</Label>
              <Input id="amount" name="amount" type="number" step="0.01" min="0.01" required defaultValue={saldo || ""} />
            </div>
            <div>
              <Label htmlFor="receipt_date">Fecha</Label>
              <Input id="receipt_date" name="receipt_date" type="date" required defaultValue={new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="method">Medio</Label>
              <Select id="method" name="method" defaultValue="TRANSFERENCIA">
                {(Object.keys(RECEIPT_METHOD_LABELS) as ReceiptMethod[]).map((m) => (
                  <option key={m} value={m}>
                    {RECEIPT_METHOD_LABELS[m]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="reference">Referencia</Label>
              <Input id="reference" name="reference" placeholder="N° de transferencia / cheque" />
            </div>
          </div>
          {cuentas.length > 0 ? (
            <div>
              <Label htmlFor="cuenta_id">Ingresa a la cuenta</Label>
              <Select id="cuenta_id" name="cuenta_id" defaultValue="">
                <option value="">— No asentar en tesorería —</option>
                {cuentas
                  .filter((c) => c.moneda === currency)
                  .map((c) => (
                    <option key={c.id} value={c.id}>{c.nombre}</option>
                  ))}
              </Select>
              <p className="text-[11px] text-[var(--muted)] mt-1">
                Si elegís una cuenta, el cobro suma al saldo de tesorería.
              </p>
            </div>
          ) : null}
          <div>
            <Label htmlFor="notes">Nota</Label>
            <Textarea id="notes" name="notes" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Guardando…" : "Registrar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
