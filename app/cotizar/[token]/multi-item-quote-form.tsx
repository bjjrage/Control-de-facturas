"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
  const router = useRouter();
  const submitting = useRef(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [analysisMessage, setAnalysisMessage] = useState("");
  const field = (name: string) => ({
    value: values[name] ?? "",
    onChange: (event: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: event.target.value })),
  });
  return (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (submitting.current || done) return;
        const fd = new FormData(event.currentTarget);
        submitting.current = true;
        setPending(true);
        setError(null);
        try {
          const res = internal
            ? await submitInternalQuoteAction(token, fd)
            : await submitMultiItemQuote(token, fd);
          if (res.error) setError(res.error);
          else {
            const analysis = "data" in res ? res.data?.analysis : "analysis" in res ? res.analysis : null;
            setAnalysisMessage(analysis?.status === "UNAVAILABLE"
              ? "La oferta quedó registrada. El análisis del documento no pudo completarse; Administración podrá reintentarlo."
              : analysis?.status === "REVIEW_REQUIRED"
                ? "Documento analizado y contrastado. Hay diferencias o datos pendientes de revisión por Administración."
                : analysis?.status === "PREPARED"
                  ? "Documento analizado y contrastado. Pendiente de revisión y autorización humanas."
                  : "Pendiente de análisis y revisión por Administración.");
            setDone(true);
            if (internal) router.refresh();
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : "No se pudo enviar");
        } finally {
          submitting.current = false;
          setPending(false);
        }
      }}
    >
      <p>
        Cargá tu oferta y adjuntá el presupuesto original. Al enviarla, el sistema
        analiza el documento y lo contrasta con la oferta para revisión de Administración.
        Cada envío conserva el historial. Para no cotizar una línea, dejá el precio vacío y disponibilidad 0.
      </p>
      <Label htmlFor={`quote-file-${token}`}>Documento original (PDF, foto, Excel o CSV)</Label>
      <Input id={`quote-file-${token}`} name="attachment" type="file" accept="application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" required />
      {done && (
        <p role="status">
          Versión enviada. {analysisMessage} Podés enviar una corrección como versión nueva.
          <Button type="button" variant="secondary" onClick={() => setDone(false)}>Preparar una corrección</Button>
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
                    {...field(`price_${i.id}`)}
                    type="number"
                    step="0.0001"
                    min="0.0001"
                  />
                </td>
                <td>
                  <Input
                    aria-label={`Disponibilidad ${i.descripcion}`}
                    name={`available_${i.id}`}
                    {...field(`available_${i.id}`)}
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
                    {...field(`tax_${i.id}`)}
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
                    {...field(`lead_${i.id}`)}
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
          <Input aria-label="Número de presupuesto" name="budget_number" {...field("budget_number")} required />
        </div>
        <div>
          <Label>Moneda</Label>
          <Select aria-label="Moneda" name="currency" required {...field("currency")}>
            <option value="">Elegí moneda</option>
            {["PYG", "USD", "EUR", "BRL", "ARS"].map((c) => (
              <option key={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Válida hasta</Label>
          <Input aria-label="Válida hasta" name="valid_until" {...field("valid_until")} type="date" required />
        </div>
        <div>
          <Label>Flete fijo (misma moneda)</Label>
          <Input aria-label="Flete fijo" name="freight" {...field("freight")} type="number" min="0" step="0.01" required />
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
      <Textarea aria-label="Condiciones de pago" name="payment_terms" {...field("payment_terms")} required />
      <Label>Observaciones</Label>
      <Textarea aria-label="Observaciones" name="observations" {...field("observations")} />
      <Button disabled={pending || done}>
        {pending ? "Procesando…" : "Confirmar y enviar"}
      </Button>
    </form>
  );
}
