"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Provider } from "@/lib/types";
import { createManualOrder } from "./actions";

export function OrderDialog({ providers, trigger }: { providers: Provider[]; trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const qtyRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const totalRef = useRef<HTMLInputElement>(null);
  const [totalTouched, setTotalTouched] = useState(false);

  function recalcTotal() {
    if (totalTouched || !totalRef.current) return;
    const q = Number(qtyRef.current?.value);
    const p = Number(priceRef.current?.value);
    if (Number.isFinite(q) && Number.isFinite(p) && q > 0 && p > 0) {
      totalRef.current.value = String(Math.round(q * p * 100) / 100);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setError(null);
          setTotalTouched(false);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Nueva orden de compra">
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await createManualOrder(formData);
            setPending(false);
            if (result?.error) {
              setError(result.error);
              return;
            }
            setError(null);
            setOpen(false);
            if (result.id) router.push(`/orders/${result.id}`);
          }}
        >
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <div>
            <Label htmlFor="o_provider">Proveedor</Label>
            <Select id="o_provider" name="provider_id" defaultValue="" required>
              <option value="">Elegí un proveedor</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.tax_id ? ` — ${p.tax_id}` : ""}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="o_product">Producto / servicio</Label>
            <Input id="o_product" name="product" required />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="o_qty">Cantidad</Label>
              <Input id="o_qty" name="quantity" type="number" step="any" ref={qtyRef} onChange={recalcTotal} required />
            </div>
            <div>
              <Label htmlFor="o_unit">Unidad</Label>
              <Input id="o_unit" name="unit" placeholder="un, kg, m²" required />
            </div>
            <div>
              <Label htmlFor="o_currency">Moneda</Label>
              <Select id="o_currency" name="currency" defaultValue="PYG">
                <option value="PYG">PYG</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="BRL">BRL</option>
                <option value="ARS">ARS</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="o_unit_price">Precio unitario</Label>
              <Input
                id="o_unit_price"
                name="unit_price"
                type="number"
                step="any"
                ref={priceRef}
                onChange={recalcTotal}
                required
              />
            </div>
            <div>
              <Label htmlFor="o_total">Total</Label>
              <Input
                id="o_total"
                name="total_price"
                type="number"
                step="any"
                ref={totalRef}
                onChange={() => setTotalTouched(true)}
                required
              />
            </div>
            <label className="flex items-end gap-1.5 pb-2 text-[12px]">
              <input type="checkbox" name="vat_included" /> IVA incluido
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Creando…" : "Crear orden"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
