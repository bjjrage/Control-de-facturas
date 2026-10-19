"use client";
import { InfoTooltip } from "@/components/ui/info-tooltip";
import { useRef, useState } from "react";
import { Upload, FileCheck2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { submitMultiItemQuote } from "./actions";
import { PaymentTermsFields } from "./payment-terms-fields";
import { submitInternalQuoteAction } from "@/app/(internal)/rfqs/[id]/workflow-actions";
import styles from "./quote-form.module.css";
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
  onClose,
}: {
  token: string;
  items: PortalRfqItem[];
  internal?: boolean;
  onClose?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const router = useRouter();
  const submitting = useRef(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [analysisMessage, setAnalysisMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const field = (name: string) => ({
    value: values[name] ?? "",
    onChange: (event: { target: { value: string } }) => setValues((v) => ({ ...v, [name]: event.target.value })),
  });
  return (
    <form
      className={internal ? `${styles.form} ${styles.modalForm}` : styles.form}
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
      <div className={styles.body}>
      <section className={styles.section} aria-label="Presupuesto original">
      <h3>1. Documento original<InfoTooltip className="ml-1" label={"1. Documento original"} content={"Al enviar, se analiza el documento y se compara con estos datos."} /></h3>

      <div className={styles.upload}>
        <input ref={fileInput} id={`quote-file-${token}`} name="attachment" type="file" className="sr-only" aria-label="Documento original (PDF, foto, Excel o CSV)" accept="application/pdf,image/png,image/jpeg,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" required
          onInvalid={e => { e.preventDefault(); setError("Adjuntá el presupuesto original antes de enviar la oferta."); }}
          onChange={e => setFileName(e.target.files?.[0]?.name ?? "")} />
        <Button type="button" variant="secondary" onClick={() => fileInput.current?.click()}>
          {fileName ? <FileCheck2 size={16} aria-hidden="true" /> : <Upload size={16} aria-hidden="true" />}
          {fileName ? "Cambiar documento" : "Subir presupuesto"}
        </Button>
        <span className="text-[13px] text-[var(--muted)]" role="status">{fileName || "PDF, imagen, Excel o CSV"}</span>
      </div>
      </section>
      {done && (
        <p role="status" className={styles.success}>
          Versión enviada. {analysisMessage} Podés enviar una corrección como versión nueva.
          <Button type="button" variant="secondary" onClick={() => setDone(false)}>Preparar una corrección</Button>
        </p>
      )}
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <section className={styles.section} aria-label="Precios y entrega">
      <h3>2. Precios y entrega<InfoTooltip className="ml-1" label={"2. Precios y entrega"} content={"Para omitir un ítem: precio vacío y disponibilidad 0."} /></h3>

      <div className={styles.tableScroll}>
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th scope="col">Ítem / solicitado</th>
              <th scope="col">Precio unitario</th>
              <th scope="col">Disponible</th>
              <th scope="col">IVA %</th>
              <th scope="col">Entrega (días)</th>
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
      </section>
      <section className={styles.section} aria-label="Condiciones de la oferta">
      <h3>3. Condiciones de la oferta</h3>
      <div className={styles.grid}>
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
      <PaymentTermsFields />
      </section>
      <details className={styles.details}>
      <summary>Observaciones (opcional)</summary>
      <Textarea aria-label="Observaciones" name="observations" {...field("observations")} />
      </details>
      </div>
      <footer className={styles.footer}>
        <span role="status">{pending ? "Analizando el presupuesto…" : done ? "Presupuesto registrado" : "La adjudicación se realiza después de revisar la oferta."}</span>
        <div>
          {onClose && <Button type="button" variant="secondary" disabled={pending} onClick={onClose}>{done ? "Cerrar" : "Cancelar"}</Button>}
          <Button type="submit" disabled={pending || done}>
            {pending ? "Procesando…" : internal ? "Guardar presupuesto" : "Confirmar y enviar"}
          </Button>
        </div>
      </footer>
    </form>
  );
}
