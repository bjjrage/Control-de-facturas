"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { submitMultiItemQuote } from "./actions";
import { submitInternalQuoteAction } from "@/app/(internal)/rfqs/[id]/workflow-actions";
export interface PortalRfqItem {
  id: string;
  descripcion: string;
  cantidad: number;
  unidad: string;
}
export function MultiItemQuoteForm({
  token,
  items,
  internal = false,
}: {
  token: string;
  items: PortalRfqItem[];
  internal?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  return (
    <form
      className="space-y-4"
      action={async (fd) => {
        setPending(true);
        setError(null);
        try {
          const res = internal
            ? await submitInternalQuoteAction(token, fd)
            : await submitMultiItemQuote(token, fd);
          if (res.error) setError(res.error);
          else setDone(true);
        } catch {
          setError("No se pudo enviar");
        } finally {
          setPending(false);
        }
      }}
    >
      <p>
        Completá tu oferta y adjuntá el presupuesto original. Cada envío crea
        una versión nueva y conserva el historial. Para no cotizar una línea,
        dejá el precio vacío y disponibilidad 0.
      </p>
      {done && (
        <p role="status">
          Versión enviada. Podés enviar una corrección como versión nueva.
        </p>
      )}
      {error && (
        <p role="alert" className="text-red-600">
          {error}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th>Ítem / solicitado</th>
              <th>Precio unitario</th>
              <th>Disponible</th>
              <th>Impuesto %</th>
              <th>Entrega (días)</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.descripcion}
                  <br />
                  {i.cantidad} {i.unidad}
                </td>
                <td>
                  <Input
                    aria-label={`Precio ${i.descripcion}`}
                    name={`price_${i.id}`}
                    type="number"
                    step="0.0001"
                    min="0.0001"
                  />
                </td>
                <td>
                  <Input
                    aria-label={`Disponibilidad ${i.descripcion}`}
                    name={`available_${i.id}`}
                    type="number"
                    step="0.0001"
                    min="0"
                    required
                  />
                </td>
                <td>
                  <Input
                    aria-label={`Impuesto ${i.descripcion}`}
                    name={`tax_${i.id}`}
                    type="number"
                    step="0.0001"
                    min="0"
                    max="100"
                    required
                  />
                </td>
                <td>
                  <Input
                    aria-label={`Entrega ${i.descripcion}`}
                    name={`lead_${i.id}`}
                    type="number"
                    step="1"
                    min="0"
                    max="3650"
                    required
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Número de presupuesto</Label>
          <Input name="budget_number" required />
        </div>
        <div>
          <Label>Moneda</Label>
          <Select name="currency" required defaultValue="">
            <option value="">Elegí moneda</option>
            {["PYG", "USD", "EUR", "BRL", "ARS"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Válida hasta</Label>
          <Input name="valid_until" type="date" required />
        </div>
        <div>
          <Label>Flete fijo (misma moneda)</Label>
          <Input name="freight" type="number" min="0" step="0.01" required />
        </div>
      </div>
      <label className="block">
        <input type="checkbox" name="vat_included" /> Los precios incluyen el
        impuesto indicado
      </label>
      <label className="block">
        <input type="checkbox" name="invoice_available" /> Emite factura
      </label>
      <Label>Condiciones de pago</Label>
      <Textarea name="payment_terms" required />
      <Label>Observaciones</Label>
      <Textarea name="observations" />
      <Label>Documento original (PDF, foto, Excel o CSV)</Label>
      <Input
        name="attachment"
        type="file"
        accept="application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
        required
      />
      <Button disabled={pending}>
        {pending ? "Enviando…" : "Enviar nueva versión"}
      </Button>
    </form>
  );
}
