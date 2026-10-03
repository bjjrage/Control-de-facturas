"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { Provider, CurrencyCode } from "@/lib/types";
import { createClient } from "@/lib/supabase/browser";
import {
  previewDirectPurchaseAction,
  confirmDirectPurchaseAction,
} from "./direct-purchase-actions";
import type { DirectPreview } from "@/lib/rfq/direct-purchase";
import { formatMoney } from "@/lib/format";

import type { NeedOrigin } from "@/lib/procurement/need-origin";
type ItemRow = {
  product: string;
  quantity: string;
  unit: string;
  unit_price: string;
  total_price: string;
  producto_id: string;
  expected_delivery_date: string;
  totalTouched: boolean;
  tax_rate: string;
};

type InventoryProduct = { id: string; nombre: string; unidad: string };

const EMPTY_ROW: ItemRow = {
  product: "",
  quantity: "",
  unit: "",
  unit_price: "",
  total_price: "",
  producto_id: "",
  expected_delivery_date: "",
  totalTouched: false,
  tax_rate: "",
};

function ItemRowComponent({
  row,
  index,
  inventoryProducts,
  onChange,
  onRemove,
  canRemove,
}: {
  row: ItemRow;
  index: number;
  inventoryProducts: InventoryProduct[];
  onChange: (
    idx: number,
    field: keyof ItemRow,
    value: string | boolean,
  ) => void;
  onRemove: (idx: number) => void;
  canRemove: boolean;
}) {
  function recalcTotal(field: "quantity" | "unit_price", value: string) {
    if (row.totalTouched) return;
    const q = field === "quantity" ? Number(value) : Number(row.quantity);
    const p = field === "unit_price" ? Number(value) : Number(row.unit_price);
    if (Number.isFinite(q) && Number.isFinite(p) && q > 0 && p > 0) {
      onChange(index, "total_price", String(Math.round(q * p * 100) / 100));
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
          onChange={(e) => {
            const unit = e.target.value;
            onChange(index, "unit", unit);
            const selected = inventoryProducts.find(
              (product) => product.id === row.producto_id,
            );
            if (selected && selected.unidad.trim() !== unit.trim())
              onChange(index, "producto_id", "");
          }}
          placeholder="un, kg…"
          required
        />
      </td>
      <td className="py-1 pr-2 w-44">
        <Select
          value={row.producto_id}
          onChange={(e) => {
            const selectedId = (e.target as HTMLSelectElement).value;
            onChange(index, "producto_id", selectedId);
            const selected = inventoryProducts.find(
              (product) => product.id === selectedId,
            );
            if (selected && !row.unit.trim())
              onChange(index, "unit", selected.unidad);
          }}
        >
          <option value="">Sin vínculo de inventario</option>
          {inventoryProducts
            .filter(
              (product) =>
                !row.unit.trim() || product.unidad.trim() === row.unit.trim(),
            )
            .map((product) => (
              <option key={product.id} value={product.id}>
                {product.nombre} · {product.unidad}
              </option>
            ))}
        </Select>
      </td>
      <td className="py-1 pr-2 w-36">
        <Input
          type="date"
          value={row.expected_delivery_date}
          onChange={(e) =>
            onChange(index, "expected_delivery_date", e.target.value)
          }
          aria-label="Fecha esperada de entrega"
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
          readOnly
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
  initialItems,
  needOrigin,
  onClosed,
}: {
  providers: Provider[];
  trigger?: React.ReactNode;
  defaultOpen?: boolean;
  projectId?: string;
  needOrigin?: NeedOrigin;
  initialItems?: {
    product: string;
    quantity: number;
    unit: string;
    producto_id: string;
  }[];
  onClosed?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [currency, setCurrency] = useState<CurrencyCode>("PYG");
  const [items, setItems] = useState<ItemRow[]>(
    () =>
      initialItems?.map((i) => ({
        ...EMPTY_ROW,
        ...i,
        quantity: String(i.quantity),
      })) ?? [{ ...EMPTY_ROW }],
  );
  const [preview, setPreview] = useState<DirectPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [inventoryProducts, setInventoryProducts] = useState<
    InventoryProduct[]
  >([]);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    let active = true;
    createClient()
      .from("productos")
      .select("id, nombre, unidad")
      .eq("activo", true)
      .order("nombre")
      .then(({ data }) => {
        if (active) setInventoryProducts((data as InventoryProduct[]) ?? []);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const grandTotal = items.reduce((sum, r) => {
    const v = Number(r.total_price);
    return sum + (Number.isFinite(v) ? v : 0);
  }, 0);

  function updateItem(
    idx: number,
    field: keyof ItemRow,
    value: string | boolean,
  ) {
    setItems((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)),
    );
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
          onClosed?.();
          if (window.location.search.includes("nueva="))
            window.history.replaceState(null, "", "/orders");
        }
      }}
    >
      {trigger ? <DialogTrigger asChild>{trigger}</DialogTrigger> : null}
      <DialogContent title="Nueva orden de compra" className="max-w-4xl">
        <form
          className="space-y-4"
          action={async (formData: FormData) => {
            if(needOrigin) formData.set("need_origin",JSON.stringify(needOrigin));
            // Validate
            for (const r of items) {
              if (!r.product.trim()) {
                setError("Completá la descripción de todos los ítems.");
                return;
              }
              if (!r.quantity || Number(r.quantity) <= 0) {
                setError("Todas las cantidades deben ser mayores a cero.");
                return;
              }
              if (!r.unit.trim()) {
                setError("Completá la unidad de todos los ítems.");
                return;
              }
              if (!r.unit_price || Number(r.unit_price) < 0) {
                setError("El precio unitario no puede ser negativo.");
                return;
              }
              if (!r.total_price || Number(r.total_price) <= 0) {
                setError("El total de cada ítem debe ser mayor a cero.");
                return;
              }
            }
            formData.set("currency", currency);
            formData.set(
              "items",
              JSON.stringify(
                items.map((r) => ({
                  product: r.product.trim(),
                  quantity: Number(r.quantity),
                  unit: r.unit.trim(),
                  unit_price: Number(r.unit_price),
                  tax_rate: Number(r.tax_rate),
                  producto_id: r.producto_id || null,
                  expected_delivery_date: r.expected_delivery_date || null,
                })),
              ),
            );
            if (items.some((r) => r.tax_rate.trim() === "")) {
              setError("Indicá impuesto por ítem, incluso 0");
              return;
            }
            setPending(true);
            const result = await previewDirectPurchaseAction(formData);
            setPending(false);
            if (result?.error) {
              setError(result.error);
              return;
            }
            setError(null);
            setPreview(result.data);
            setConfirmed(false);
          }}
        >
          {preview ? (
            <div className="border rounded p-4 space-y-3">
              <h2>Preview exacto — {preview.snapshot.provider_name}</h2>
              <p>
                Moneda {preview.snapshot.currency} · Impuesto{" "}
                {preview.snapshot.vat_included ? "incluido" : "adicional"}
              </p>
              {preview.snapshot.items.map((i, index) => (
                <p key={index}>
                  {i.product} · {i.quantity} {i.unit} × {i.unit_price} ·
                  impuesto {i.tax_rate}% · total {i.total_price} · entrega{" "}
                  {i.expected_delivery_date ?? "sin fecha"}
                </p>
              ))}
              <p>
                Observaciones:{" "}
                {preview.snapshot.observations ?? "Sin observaciones"}
              </p>
              <p>
                Pago: {preview.snapshot.payment_terms} · Flete:{" "}
                {preview.snapshot.freight} · Total: {preview.snapshot.total}{" "}
                {preview.snapshot.currency}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                Confirmo el preview mostrado
              </label>
              <Button
                type="button"
                disabled={pending || !confirmed}
                onClick={async () => {
                  setPending(true);
                  try {
                    const r = await confirmDirectPurchaseAction(
                      preview.id,
                      preview.hash,
                      confirmed,
                    );
                    if (r.error) setError(r.error);
                    else {
                      setOpen(false);
                      onClosed?.();
                      reset();
                      router.refresh();
                      if (r.id && !projectId) router.push("/orders/" + r.id);
                    }
                  } finally {
                    setPending(false);
                  }
                }}
              >
                Confirmar y crear OC
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPreview(null);
                  setConfirmed(false);
                }}
              >
                Volver a editar
              </Button>
            </div>
          ) : null}
          {projectId ? (
            <input type="hidden" name="project_id" value={projectId} />
          ) : null}

          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          <fieldset disabled={!!preview || pending} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="o_provider">Proveedor</Label>
                <Select
                  id="o_provider"
                  name="provider_id"
                  defaultValue=""
                  required
                >
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
                <Label htmlFor="o_currency">Moneda</Label>
                <Select
                  id="o_currency"
                  name="currency"
                  value={currency}
                  onChange={(e) =>
                    setCurrency(
                      (e.target as HTMLSelectElement).value as CurrencyCode,
                    )
                  }
                >
                  <option value="PYG">PYG — Guaraní</option>
                  <option value="USD">USD — Dólar</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="BRL">BRL — Real</option>
                  <option value="ARS">ARS — Peso arg.</option>
                </Select>
              </div>
            </div>

            <Label>Condiciones de pago</Label>
            <Input name="payment_terms" required />
            <Label>Flete fijo final (misma moneda)</Label>
            <Input name="freight" type="number" min="0" step="0.01" required />
            {items.map((r, i) => (
              <label key={i}>
                Impuesto % — {r.product || "ítem " + (i + 1)}
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.0001"
                  value={r.tax_rate}
                  onChange={(e) => updateItem(i, "tax_rate", e.target.value)}
                  required
                />
              </label>
            ))}
            {/* Items table */}
            <div>
              <Label>Ítems de la orden</Label>
              <div className="mt-1 overflow-x-auto rounded border border-[var(--border)]">
                <table className="w-full text-[12px]">
                  <thead>
                    <tr className="bg-[var(--panel-2)] border-b border-[var(--border)]">
                      <th className="text-left px-2 py-1.5 font-medium">
                        Descripción
                      </th>
                      <th className="text-left px-2 py-1.5 font-medium w-24">
                        Cantidad
                      </th>
                      <th className="text-left px-2 py-1.5 font-medium w-24">
                        Unidad
                      </th>
                      <th className="text-left px-2 py-1.5 font-medium">
                        Producto de inventario (opcional)
                      </th>
                      <th className="text-left px-2 py-1.5 font-medium">
                        Entrega esperada (opcional)
                      </th>
                      <th className="text-left px-2 py-1.5 font-medium w-32">
                        P. Unitario
                      </th>
                      <th className="text-left px-2 py-1.5 font-medium w-32">
                        Total
                      </th>
                      <th className="w-6"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {items.map((row, idx) => (
                      <ItemRowComponent
                        key={idx}
                        row={row}
                        index={idx}
                        inventoryProducts={inventoryProducts}
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
                    Subtotal ingresado: {formatMoney(grandTotal, currency)}{" "}
                    (total final en preview)
                  </div>
                ) : null}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="o_observations">Observaciones</Label>
                <Input
                  id="o_observations"
                  name="observations"
                  placeholder="Opcional"
                />
              </div>
              <label className="flex items-end gap-1.5 pb-2 text-[12px]">
                <input type="checkbox" name="vat_included" /> IVA incluido en
                los precios
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? "Preparando…" : "Preparar preview"}
              </Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
