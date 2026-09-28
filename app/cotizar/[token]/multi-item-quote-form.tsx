"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import { submitMultiItemQuote } from "./actions";

export interface PortalRfqItem {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
}

export function MultiItemQuoteForm({ token, items }: { token: string; items: PortalRfqItem[] }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [prices, setPrices] = useState<Record<string, string>>({});

  const total = items.reduce((acc, it) => {
    const p = Number(prices[it.id]);
    return Number.isFinite(p) && p > 0 ? acc + p * Number(it.cantidad) : acc;
  }, 0);
  const cotizados = items.filter((it) => Number(prices[it.id]) > 0).length;

  if (done) {
    return (
      <div className="rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-4 text-[13px] text-[var(--ok)]">
        Cotización enviada correctamente. Nos pondremos en contacto con vos.
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      action={async (formData: FormData) => {
        setPending(true);
        const result = await submitMultiItemQuote(token, formData);
        setPending(false);
        if (result?.error) {
          setError(result.error);
          return;
        }
        setError(null);
        setDone(true);
      }}
    >
      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}

      <div>
        <p className="text-[12px] text-[var(--muted)] mb-2">
          Cargá el precio unitario de cada ítem que puedas cotizar. Dejá vacío lo que no cotices. Si preferís, podés
          solo adjuntar la foto o PDF de tu presupuesto y nosotros cargamos los precios.
        </p>
        <div className="rounded border border-[var(--border)] overflow-x-auto">
          <table className="w-full text-left text-[12px]">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]">
                <th className="py-1.5 px-2">Ítem</th>
                <th className="py-1.5 px-2 text-right">Cantidad</th>
                <th className="py-1.5 px-2 text-right">Precio unitario</th>
                <th className="py-1.5 px-2 text-right">Subtotal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {items.map((it) => {
                const p = Number(prices[it.id]);
                const sub = Number.isFinite(p) && p > 0 ? p * Number(it.cantidad) : null;
                return (
                  <tr key={it.id}>
                    <td className="py-1.5 px-2">{it.descripcion}</td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">
                      {formatNumber(Number(it.cantidad), Number.isInteger(Number(it.cantidad)) ? 0 : 2)} {it.unidad}
                    </td>
                    <td className="py-1.5 px-2 text-right">
                      <Input
                        name={`price_${it.id}`}
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={prices[it.id] ?? ""}
                        onChange={(e) => setPrices((prev) => ({ ...prev, [it.id]: e.target.value }))}
                        className="h-8 w-32 text-right ml-auto"
                        placeholder="—"
                      />
                    </td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap">{sub === null ? "—" : formatNumber(sub, 2)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[12px] text-right">
          {cotizados} de {items.length} ítems cotizados · Total: <span className="font-medium">{formatNumber(total, 2)}</span>
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="budget_number">N° de presupuesto</Label>
          <Input id="budget_number" name="budget_number" required />
        </div>
        <div>
          <Label htmlFor="currency">Moneda</Label>
          <Select id="currency" name="currency" defaultValue="PYG" required>
            <option value="PYG">PYG</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="BRL">BRL</option>
            <option value="ARS">ARS</option>
          </Select>
        </div>
        <div>
          <Label>Plazo de entrega</Label>
          <div className="flex gap-2">
            <Input name="delivery_time_value" type="number" min="1" step="1" required className="w-24" placeholder="15" />
            <Select name="delivery_time_unit" defaultValue="dias">
              <option value="dias">días</option>
              <option value="semanas">semanas</option>
              <option value="meses">meses</option>
            </Select>
          </div>
        </div>
        <div>
          <Label>Validez de la oferta</Label>
          <div className="flex gap-2">
            <Input name="offer_validity_value" type="number" min="1" step="1" required className="w-24" placeholder="30" />
            <Select name="offer_validity_unit" defaultValue="dias">
              <option value="dias">días</option>
              <option value="semanas">semanas</option>
              <option value="meses">meses</option>
            </Select>
          </div>
        </div>
      </div>
      <div className="flex gap-4">
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" name="invoice_available" defaultChecked />
          Emite factura
        </label>
        <label className="flex items-center gap-2 text-[12px]">
          <input type="checkbox" name="vat_included" defaultChecked />
          IVA incluido
        </label>
      </div>
      <div>
        <Label htmlFor="observations">Observaciones</Label>
        <Textarea id="observations" name="observations" />
      </div>
      <div>
        <Label htmlFor="attachment">Foto o PDF de tu presupuesto (opcional)</Label>
        <input id="attachment" name="attachment" type="file" accept="application/pdf,image/*" className="block w-full text-[13px]" />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Enviando…" : "Enviar cotización"}
      </Button>
    </form>
  );
}
