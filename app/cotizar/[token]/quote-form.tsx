"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { submitQuote } from "./actions";

export function QuoteForm({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <div className="rounded-lg border border-[var(--ok)]/30 bg-[var(--ok-bg)] p-4 text-[13px] text-[var(--ok)]">
        Cotización enviada correctamente. Nos pondremos en contacto con vos.
      </div>
    );
  }

  return (
    <form
      className="space-y-3"
      action={async (formData: FormData) => {
        setPending(true);
        const result = await submitQuote(token, formData);
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
          <Label htmlFor="unit_price">Precio unitario</Label>
          <Input id="unit_price" name="unit_price" type="number" step="0.0001" min="0.0001" required />
        </div>
        <div>
          <Label htmlFor="total_price">Precio total</Label>
          <Input id="total_price" name="total_price" type="number" step="0.01" min="0.01" required />
        </div>
        <div>
          <Label htmlFor="delivery_time">Plazo de entrega</Label>
          <Input id="delivery_time" name="delivery_time" required />
        </div>
        <div>
          <Label htmlFor="offer_validity">Validez de la oferta</Label>
          <Input id="offer_validity" name="offer_validity" required />
        </div>
      </div>
      <div>
        <Label htmlFor="payment_terms">Condiciones de pago</Label>
        <Input id="payment_terms" name="payment_terms" />
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
        <Label htmlFor="pdf">PDF del presupuesto</Label>
        <input
          id="pdf"
          name="pdf"
          type="file"
          accept="application/pdf"
          required
          className="block w-full text-[13px]"
        />
      </div>
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Enviando…" : "Enviar cotización"}
      </Button>
    </form>
  );
}
