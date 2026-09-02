"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { CurrencyCode } from "@/lib/types";
import { createOrderFromInvoice } from "@/app/(internal)/orders/actions";

export function CreateOrderFromInvoiceDialog({
  invoiceId,
  total,
  currency,
  trigger,
}: {
  invoiceId: string;
  total: number;
  currency: string;
  trigger: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unit, setUnit] = useState("un");
  const router = useRouter();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Crear orden con los datos de esta factura">
        <div className="space-y-3">
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}
          <p className="text-[12px] text-[var(--muted)]">
            Se crea una orden por {formatMoney(total, currency as CurrencyCode)} para este proveedor y la factura
            queda vinculada. Usá esto cuando la compra no pasó por una solicitud de presupuesto.
          </p>
          <div>
            <Label htmlFor="cof_product">Producto / servicio</Label>
            <Input id="cof_product" value={product} onChange={(e) => setProduct(e.target.value)} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="cof_qty">Cantidad</Label>
              <Input
                id="cof_qty"
                type="number"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="cof_unit">Unidad</Label>
              <Input id="cof_unit" value={unit} onChange={(e) => setUnit(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={pending}
              onClick={async () => {
                setPending(true);
                const result = await createOrderFromInvoice(invoiceId, {
                  product,
                  quantity: Number(quantity),
                  unit,
                });
                setPending(false);
                if (result?.error) {
                  setError(result.error);
                  return;
                }
                setOpen(false);
                if (result.id) router.push(`/orders/${result.id}`);
                else router.refresh();
              }}
            >
              {pending ? "Creando…" : "Crear orden"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
