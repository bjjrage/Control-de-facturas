"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { createRfq } from "./actions";

// Administrative purchase requests retain the pre-RFQ2 form. Cost discovery
// continues through its own project entry point and must never use this form.
const TYPES = {
  RFQ: {
    label: "RFQ",
    description: "Pido precio a varios proveedores y elijo la mejor oferta",
    submit: "Crear RFQ",
  },
  COT: {
    label: "Cotización",
    description: "Ya sé a quién le compro — documento la cotización de un solo proveedor",
    submit: "Crear cotización",
  },
};

export function AdministrativeRfqDialog({ trigger, defaultOpen, projectId }: {
  trigger: React.ReactNode;
  defaultOpen?: boolean;
  projectId?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [quoteType, setQuoteType] = useState<keyof typeof TYPES>("RFQ");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const submitting = useRef(false);

  return (
    <Dialog open={open} onOpenChange={(next) => {
      if (submitting.current) return;
      setOpen(next);
      if (!next) {
        const url = new URL(window.location.href);
        url.searchParams.delete("nueva");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    }}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Nueva cotización">
        <form className="space-y-3" onSubmit={async (event) => {
          event.preventDefault();
          if (submitting.current || createdId) return;
          const fd = new FormData(event.currentTarget);
          submitting.current = true;
          setPending(true);
          setError(null);
          try {
            const result = await createRfq(fd);
            if (result.error) {
              setError(result.error);
              if (result.id) { setCreatedId(result.id); router.refresh(); }
              return;
            }
            setOpen(false);
            router.refresh();
            router.push(`/rfqs/${result.id}`);
          } catch (e) {
            setError(e instanceof Error ? e.message : "No se pudo crear la solicitud.");
          } finally {
            submitting.current = false;
            setPending(false);
          }
        }}>
          <div className="grid grid-cols-2 gap-2">
            {(["RFQ", "COT"] as const).map((type) => (
              <button key={type} type="button" onClick={() => setQuoteType(type)}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${quoteType === type
                  ? "border-[var(--primary)] bg-[var(--primary-bg)]"
                  : "border-[var(--border)] hover:border-[var(--primary)]/40"}`}>
                <div className="text-[13px] font-semibold mb-0.5">{TYPES[type].label}</div>
                <div className="text-[11px] text-[var(--muted)] leading-snug">{TYPES[type].description}</div>
              </button>
            ))}
          </div>
          <p className="text-[12px] text-[var(--muted)]">Solicitud de compra. La selección de ofertas y las órdenes requieren autorización humana.</p>
          <input type="hidden" name="purpose" value="PROCUREMENT" />
          <input type="hidden" name="quote_type" value={quoteType} />
          {projectId && <input type="hidden" name="project_id" value={projectId} />}
          {error && <p role="alert" className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">{error}</p>}
          {createdId && <p role="status">La solicitud ya existe. <Link className="underline" href={`/rfqs/${createdId}`}>Abrir solicitud y completar sus archivos</Link></p>}
          <div className="grid grid-cols-[2fr_1fr_1fr] gap-3">
            <div><Label htmlFor="admin-rfq-product">Producto</Label><Input id="admin-rfq-product" name="product" required /></div>
            <div><Label htmlFor="admin-rfq-quantity">Cantidad</Label><Input id="admin-rfq-quantity" name="quantity" type="number" step="0.0001" min="0.0001" required /></div>
            <div><Label htmlFor="admin-rfq-unit">Unidad</Label><Input id="admin-rfq-unit" name="unit" placeholder="kg, un, m²" required /></div>
          </div>
          <div><Label htmlFor="admin-rfq-specifications">Especificaciones</Label><Textarea id="admin-rfq-specifications" name="specifications" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor="admin-rfq-date">Fecha requerida</Label><Input id="admin-rfq-date" name="required_date" type="date" /></div>
            <div><Label htmlFor="admin-rfq-reference">Referencia interna</Label><Input id="admin-rfq-reference" name="internal_reference" /></div>
          </div>
          <div><Label htmlFor="admin-rfq-observations">Observaciones</Label><Textarea id="admin-rfq-observations" name="observations" /></div>
          <div><Label htmlFor="admin-rfq-files">Archivos de referencia (PDF, imágenes)</Label><input id="admin-rfq-files" name="attachments" type="file" accept="application/pdf,image/png,image/jpeg" multiple className="block w-full text-[13px]" /></div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" disabled={pending} onClick={() => setOpen(false)}>Cancelar</Button>
            <Button type="submit" disabled={pending || !!createdId}>{pending ? "Creando…" : TYPES[quoteType].submit}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
