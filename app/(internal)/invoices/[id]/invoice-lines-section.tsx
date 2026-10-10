"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import {
  addInvoiceItem,
  createInvoiceItemMatch,
  deleteInvoiceItem,
  deleteInvoiceItemMatch,
  updateInvoiceItem,
} from "./actions";

export type InvoiceLineView = {
  id: string;
  product_description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  subtotal: number | null;
  matches: Array<{ id: string; orderItemId: string; orderCode: string; orderProduct: string; quantityMatched: number }>;
};

export type OrderLineView = {
  id: string;
  code: string;
  product: string;
  quantity: number;
  unit: string;
  quantity_invoiced: number;
};

function LineForm({
  initial,
  pending,
  error,
  onSubmit,
  submitLabel,
}: {
  initial: { description: string; quantity: string; unit: string; unit_price: string };
  pending: boolean;
  error: string | null;
  onSubmit: (values: { description: string; quantity: number | null; unit: string | null; unit_price: number | null }) => void;
  submitLabel: string;
}) {
  const formId = useId();
  const [description, setDescription] = useState(initial.description);
  const [quantity, setQuantity] = useState(initial.quantity);
  const [unit, setUnit] = useState(initial.unit);
  const [unitPrice, setUnitPrice] = useState(initial.unit_price);
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          description,
          quantity: quantity.trim() === "" ? null : Number(quantity),
          unit: unit.trim() === "" ? null : unit.trim(),
          unit_price: unitPrice.trim() === "" ? null : Number(unitPrice),
        });
      }}
    >
      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}
      <div>
        <Label htmlFor={`${formId}-description`}>Descripción</Label>
        <Input id={`${formId}-description`} value={description} onChange={(e) => setDescription(e.target.value)} required />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div>
          <Label htmlFor={`${formId}-quantity`}>Cantidad</Label>
          <Input id={`${formId}-quantity`} type="number" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${formId}-unit`}>Unidad</Label>
          <Input id={`${formId}-unit`} value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
        <div>
          <Label htmlFor={`${formId}-unit-price`}>Precio unit.</Label>
          <Input id={`${formId}-unit-price`} type="number" step="any" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
        </div>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending} className="h-8 text-[12px]">
          {pending ? "Guardando…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}

export function InvoiceLinesSection({
  invoiceId,
  canMutate,
  lines,
  orderLines,
  linkedOrderCode,
}: {
  invoiceId: string;
  canMutate: boolean;
  lines: InvoiceLineView[];
  orderLines: OrderLineView[];
  linkedOrderCode: string | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [matchFor, setMatchFor] = useState<string | null>(null);
  const [matchOrderItem, setMatchOrderItem] = useState("");
  const [matchQty, setMatchQty] = useState("");

  async function refresh() {
    router.refresh();
  }

  if (!lines.length) {
    return (
      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-[14px] font-semibold">Líneas y conciliación por ítem</h2>
        </div>
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
          Sin líneas registradas: la conciliación por ítem está pendiente, no confirmada en cero.
          {canMutate ? " Agregá líneas manualmente para conciliar cantidades." : ""}
        </div>
        {canMutate ? (
          <div className="mt-2">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="secondary" className="h-8 text-[12px]">Agregar línea</Button>
              </DialogTrigger>
              <DialogContent title="Agregar línea de factura">
                <LineForm
                  initial={{ description: "", quantity: "", unit: "", unit_price: "" }}
                  pending={pending}
                  error={error}
                  submitLabel="Agregar"
                  onSubmit={async (values) => {
                    setPending(true);
                    const result = await addInvoiceItem(invoiceId, values);
                    setPending(false);
                    if (result.error) {
                      setError(result.error);
                      return;
                    }
                    setError(null);
                    await refresh();
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[14px] font-semibold">Líneas y conciliación por ítem</h2>
      </div>
      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)] mb-2">
          {error}
        </div>
      ) : null}
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th>Descripción</th>
              <th className="num">Cant.</th>
              <th>U.</th>
              <th className="num">P. unit.</th>
              <th>Imputación</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const matchedQty = line.matches.reduce((s, m) => s + Number(m.quantityMatched), 0);
              const unmatched = line.quantity != null && matchedQty < Number(line.quantity);
              return (
                <tr key={line.id}>
                  <td className="font-medium">{line.product_description}</td>
                  <td className="num">{line.quantity != null ? formatNumber(line.quantity, 2) : "—"}</td>
                  <td className="text-[var(--muted)]">{line.unit ?? "—"}</td>
                  <td className="num">{line.unit_price != null ? formatNumber(line.unit_price, 2) : "—"}</td>
                  <td>
                    {line.matches.length === 0 ? (
                      <span className="text-[11px] text-[var(--warn)]">Sin conciliar</span>
                    ) : (
                      <div className="space-y-1">
                        {line.matches.map((m) => (
                          <div key={m.id} className="text-[11px] flex items-center gap-1.5">
                            <span>
                              {formatNumber(m.quantityMatched, 2)} → {m.orderCode} ({m.orderProduct})
                            </span>
                            {canMutate ? (
                              <button
                                type="button"
                                aria-label={`Quitar imputación ${m.id}`}
                                className="text-[var(--error)]"
                                onClick={async () => {
                                  const result = await deleteInvoiceItemMatch(m.id, invoiceId);
                                  if (result.error) setError(result.error);
                                  else {
                                    setError(null);
                                    await refresh();
                                  }
                                }}
                              >
                                ×
                              </button>
                            ) : null}
                          </div>
                        ))}
                        {unmatched ? (
                          <div className="text-[11px] text-[var(--muted)]">
                            Resta {formatNumber(Number(line.quantity) - matchedQty, 2)} sin imputar
                          </div>
                        ) : null}
                      </div>
                    )}
                  </td>
                  <td>
                    {canMutate ? (
                      <div className="flex gap-1 justify-end">
                        {linkedOrderCode && orderLines.length > 0 ? (
                          <Dialog
                            open={matchFor === line.id}
                            onOpenChange={(next) => {
                              setMatchFor(next ? line.id : null);
                              setError(null);
                              if (next) {
                                setMatchOrderItem("");
                                setMatchQty(line.quantity != null ? String(line.quantity) : "");
                              }
                            }}
                          >
                            <DialogTrigger asChild>
                              <Button variant="secondary" className="h-6 px-2 text-[11px]">
                                Imputar
                              </Button>
                            </DialogTrigger>
                            <DialogContent title={`Imputar línea a ${linkedOrderCode}`}>
                              <div className="space-y-2">
                                <div>
                                  <Label htmlFor={`match-order-${line.id}`}>Ítem de OC</Label>
                                  <Select id={`match-order-${line.id}`} value={matchOrderItem} onChange={(e) => setMatchOrderItem(e.target.value)}>
                                    <option value="" disabled>
                                      Elegí un ítem…
                                    </option>
                                    {orderLines.map((o) => (
                                      <option key={o.id} value={o.id}>
                                        {o.code} · {o.product} ({formatNumber(o.quantity, 2)} {o.unit}; facturado{" "}
                                        {formatNumber(o.quantity_invoiced, 2)})
                                      </option>
                                    ))}
                                  </Select>
                                </div>
                                <div>
                                  <Label htmlFor={`match-quantity-${line.id}`}>Cantidad imputada</Label>
                                  <Input
                                    id={`match-quantity-${line.id}`}
                                    type="number"
                                    step="any"
                                    value={matchQty}
                                    onChange={(e) => setMatchQty(e.target.value)}
                                  />
                                </div>
                                <div className="flex justify-end">
                                  <Button
                                    className="h-8 text-[12px]"
                                    disabled={pending || !matchOrderItem}
                                    onClick={async () => {
                                      setPending(true);
                                      const result = await createInvoiceItemMatch({
                                        invoiceId,
                                        invoiceItemId: line.id,
                                        orderItemId: matchOrderItem,
                                        quantity: Number(matchQty),
                                      });
                                      setPending(false);
                                      if (result.error) {
                                        setError(result.error);
                                        return;
                                      }
                                      setError(null);
                                      setMatchFor(null);
                                      await refresh();
                                    }}
                                  >
                                    {pending ? "Imputando…" : "Confirmar imputación"}
                                  </Button>
                                </div>
                              </div>
                            </DialogContent>
                          </Dialog>
                        ) : null}
                        <Dialog>
                          <DialogTrigger asChild>
                            <Button variant="ghost" className="h-6 px-2 text-[11px]">
                              Corregir
                            </Button>
                          </DialogTrigger>
                          <DialogContent title="Corregir línea">
                            <LineForm
                              initial={{
                                description: line.product_description,
                                quantity: line.quantity != null ? String(line.quantity) : "",
                                unit: line.unit ?? "",
                                unit_price: line.unit_price != null ? String(line.unit_price) : "",
                              }}
                              pending={pending}
                              error={error}
                              submitLabel="Guardar corrección"
                              onSubmit={async (values) => {
                                setPending(true);
                                const result = await updateInvoiceItem(line.id, values);
                                setPending(false);
                                if (result.error) {
                                  setError(result.error);
                                  return;
                                }
                                setError(null);
                                await refresh();
                              }}
                            />
                            <p className="text-[11px] text-[var(--muted)] mt-2">
                              La corrección conserva la línea. Se mantienen solo las imputaciones compatibles con los nuevos datos; no se permite dejar imputada una cantidad mayor a la documentada.
                            </p>
                          </DialogContent>
                        </Dialog>
                        <button
                          type="button"
                          aria-label={`Eliminar línea ${line.id}`}
                          className="text-[var(--error)] text-[12px] px-1"
                          onClick={async () => {
                            const result = await deleteInvoiceItem(line.id);
                            if (result.error) setError(result.error);
                            else {
                              setError(null);
                              await refresh();
                            }
                          }}
                        >
                          ×
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
