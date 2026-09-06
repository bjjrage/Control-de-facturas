"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Provider, CurrencyCode } from "@/lib/types";
import { createManualOrder } from "./actions";
import { formatMoney } from "@/lib/format";

type ItemRow = {
  product: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total_price: string;
  totalTouched: boolean;
};

const EMPTY_ROW: ItemRow = { product: "", quantity: "", unit: "", unit_price: "", total_price: "", totalTouched: false };

function ItemRowComponent({
  row,
  index,
  currency,
  onChange,
  onRemove,
  canRemove,
}: {
  row: ItemRow;
  index: number;
  currency: CurrencyCode;
  onChange: (idx: number, field: keyof ItemRow, value: string | boolean) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
}) {
  function recalcTotal(field: "quantity" | "unit_price", value: string) {
    if (row.totalTouched) return;
    const q = field === "quantity" ? Number(value) : Number(row.quantity);
    const p = field === "unit_price" ? Number(value) : Number(row.unit_price);
    if (Number.isFinite(q) && Number.isFinite(p) && q > 0 && p > 0) {
      onChange(index, "total_price", String(Math.round(q * p)));
    }
  }

  return (
    <tr>
      <td className="py-1 pr-2">
        <Input
          value={row.product}
          onChange={(e) => onChange(index, "product", e.target.value)}
          placeholder="Descripción del producto o servicio"
          required
        />
      </td>
      <td className="py-1 pr-2 w-24">
        <Input
          type="number"
          step="any"
          value={row.quantity}
          onChange={(e) => {
            onChange(index, "quantity", e.target.value);
            recalcTotal("quantity", e.target.value);
          }}
          placeholder="0"
          required
        />
      </td>
      <td className="py-1 pr-2 w-24">
        <Input
          value={row.unit}
          onChange={(e) => onChange(index, "unit", e.target.value)}
          placeholder="un, kg…"
          required
        />
      </td>
      <td className="py-1 pr-2 w-32">
        <Input
          type="number"
          step="any"
          value={row.unit_price}
          onChange={(e) => {
            onChange(index, "unit_price", e.target.value);
            recalcTotal("unit_price", e.target.value);
          }}
          placeholder="0"
          required
        />
      </td>
      <td className="py-1 pr-2 w-32">
        <Input
          type="number"
          step="any"
          value={row.total_price}
          onChange={(e) => {
            onChange(index, "total_price", e.target.value);
            onChange(index, "totalTouched", true);
          }}
          placeholder="0"
          required
        />
      </td>
      <td className="py-1 w-6 text-center">
        {canRemove ? (
          <button
            type="button"
            onClick={() => onRemove(index)}
            className="text-[var(--muted)] hover:text-[var(--error)] text-[16px] leading-none"
            title="Eliminar ítem"
          >
            ×
          </button>
        ) : null}
      </td>
    </tr>
  );
}

export function OrderDialog({
  providers,
  trigger,
  defaultOpen,
  projectId,
}: {
  providers: Provider[];
  trigger?: React.ReactNode;
  defaultOpen?: boolean;
  projectId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [currency, setCurrency] = useState<CurrencyCode>("PYG");
  const [items, setItems] = useState<ItemRow[]>([{ ...EMPTY_ROW }]);
  const router = useRouter();

  const grandTotal = items.reduce((sum, r) => {
    const v = Number(r.total_price);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);

  function updateItem(idx: number, field: keyof ItemRow, value: string | boolean) {
    setItems((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  }

  function addRow() {
    setItems((prev) => [...prev, { ...EMPTY_ROW }]);
  }

  function removeRow(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function reset() {
    setItems([{ ...EMPTY_ROW }]);
    setCurrency("PYG");
    setError(null);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          reset();
          if (window.location.search.includes("nueva=")) window.history.replaceState(null, "", "/orders");
        }
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent title="Nueva orden de compra" className="max-w-4xl">
        <form
          className="space-y-4"
          action={async (formData: FormData) => {
            // Validate
            for (const r of items) {
              if (!r.product.trim()) { setError("Completá la descripción de todos los ítems."); return; }
              if (!r.quantity || Number(r.quantity) <= 0) { setError("Todas las cantidades deben ser mayores a cero."); return; }
              if (!r.unit.trim()) { setError("Completá la unidad de todos los ítems."); return; }
              if (!r.unit_price || Number(r.unit_price) < 0) { setError("El precio unitario no puede ser negativo."); return; }
              if (!r.total_price || Number(r.total_price) <= 0) { setError("El total de cada ítem debe ser mayor a cero."); return; }
            }
            formData.set("items", JSON.stringify(items.map((r) => ({
              product: r.product.trim(),
              quantity: Number(r.quantity),
              unit: r.unit.trim(),
              unit_price: Number(r.unit_price),
              total_price: Number(r.total_price),
            }))));
            formData.set("currency", currency);
            setPending(true);
            const result = await createManualOrder(formData);
            setPending(false);
            if (result?.error) { setError(result.error); return; }
            setError(null);
            setOpen(false);
            reset();
            if (projectId) { router.refresh(); return; }
            if (result.id) router.push(`/orders/${result.id}`);
          }}
        >
          {projectId ? <input type="hidden" name="project_id" value={projectId} /> : null}

          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="o_provider">Proveedor</Label>
              <Select id="o_provider" name="provider_id" defaultValue="" required>
                <option value="">Elegí un proveedor</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.tax_id ? ` — ${p.tax_id}` : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="o_currency">Moneda</Label>
              <Select
                id="o_currency"
                name="currency"
                value={currency}
                onChange={(e) => setCurrency((e.target as HTMLSelectElement).value as CurrencyCode)}
              >
                <option value="PYG">PYG — Guaraní</option>
                <option value="USD">USD — Dólar</option>
                <option value="EUR">EUR — Euro</option>
                <option value="BRL">BRL — Real</option>
                <option value="ARS">ARS — Peso arg.</option>
              </Select>
            </div>
          </div>

          {/* Items table */}
          <div>
            <Label>Ítems de la orden</Label>
            <div className="mt-1 overflow-x-auto rounded border border-[var(--border)]">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="bg-[var(--panel-2)] border-b border-[var(--border)]">
                    <th className="text-left px-2 py-1.5 font-medium">Descripción</th>
                    <th className="text-left px-2 py-1.5 font-medium w-24">Cantidad</th>
                    <th className="text-left px-2 py-1.5 font-medium w-24">Unidad</th>
                    <th className="text-left px-2 py-1.5 font-medium w-32">P. Unitario</th>
                    <th className="text-left px-2 py-1.5 font-medium w-32">Total</th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {items.map((row, idx) => (
                    <ItemRowComponent
                      key={idx}
                      row={row}
                      index={idx}
                      currency={currency}
                      onChange={updateItem}
                      onRemove={removeRow}
                      canRemove={items.length > 1}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between mt-2">
              <button
                type="button"
                onClick={addRow}
                className="text-[12px] text-[var(--primary)] hover:underline"
              >
                + Agregar ítem
              </button>
              {grandTotal > 0 ? (
                <div className="text-[13px] font-semibold">
                  Total: {formatMoney(grandTotal, currency)}
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="o_observations">Observaciones</Label>
              <Input id="o_observations" name="observations" placeholder="Opcional" />
            </div>
            <label className="flex items-end gap-1.5 pb-2 text-[12px]">
              <input type="checkbox" name="vat_included" /> IVA incluido en los precios
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
