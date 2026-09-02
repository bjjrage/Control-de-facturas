"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Provider } from "@/lib/types";
import { createInvoice } from "./actions";
import { extractInvoiceFromPhoto } from "./extract-actions";

const READABLE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export function InvoiceDialog({
  providers,
  trigger,
  linkOrderId,
  defaultProviderId,
}: {
  providers: Provider[];
  trigger: React.ReactNode;
  /** Si se pasa, la factura creada se vincula directo a esa OC. */
  linkOrderId?: string;
  defaultProviderId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState<string | null>(null);
  const router = useRouter();

  const providerRef = useRef<HTMLSelectElement>(null);
  const invoiceNumberRef = useRef<HTMLInputElement>(null);
  const invoiceDateRef = useRef<HTMLInputElement>(null);
  const subtotalRef = useRef<HTMLInputElement>(null);
  const vatRef = useRef<HTMLInputElement>(null);
  const totalRef = useRef<HTMLInputElement>(null);
  const timbradoRef = useRef<HTMLInputElement>(null);

  async function handleFileChange(file: File | null) {
    setScanNotice(null);
    if (!file || !READABLE_TYPES.includes(file.type)) return;

    setScanning(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const result = await extractInvoiceFromPhoto(fd);
      if (result.error || !result.data) {
        setScanNotice(result.error ?? "No se pudo leer la factura. Completá los datos a mano.");
        return;
      }

      const d = result.data;
      if (invoiceNumberRef.current && d.invoice_number) invoiceNumberRef.current.value = d.invoice_number;
      if (invoiceDateRef.current && d.invoice_date) invoiceDateRef.current.value = d.invoice_date;
      if (subtotalRef.current && d.subtotal !== null) subtotalRef.current.value = String(d.subtotal);
      if (vatRef.current && d.vat !== null) vatRef.current.value = String(d.vat);
      if (totalRef.current && d.total !== null) totalRef.current.value = String(d.total);
      if (timbradoRef.current && d.timbrado) timbradoRef.current.value = d.timbrado;

      if (d.provider_id && providerRef.current) {
        providerRef.current.value = d.provider_id;
        setScanNotice("Factura leída. Revisá los datos antes de crear.");
      } else if (d.provider_name) {
        setScanNotice(
          `Factura leída. No encontré "${d.provider_name}"${d.provider_tax_id ? ` (RUC ${d.provider_tax_id})` : ""} entre los proveedores — elegilo a mano o cargalo primero.`
        );
      } else {
        setScanNotice("Factura leída, pero no se detectó el proveedor. Elegilo a mano.");
      }
    } finally {
      setScanning(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setScanNotice(null);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Nueva factura">
        <form
          className="space-y-3"
          action={async (formData: FormData) => {
            setPending(true);
            const result = await createInvoice(formData);
            setPending(false);
            if (result.error) {
              setError(result.error);
              return;
            }
            setError(null);
            setOpen(false);
            router.push(`/invoices/${result.id}${result.autoMatched ? "?autoMatched=1" : ""}`);
          }}
        >
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}
          {linkOrderId ? <input type="hidden" name="link_order_id" value={linkOrderId} /> : null}

          <div>
            <Label htmlFor="file">Foto o PDF de la factura</Label>
            <input
              id="file"
              name="file"
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="block w-full text-[13px]"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            />
            <p className="text-[11px] text-[var(--muted)] mt-1">
              {scanning
                ? "Leyendo factura…"
                : scanNotice ?? "Sacale una foto (JPG/PNG) o subí el PDF electrónico y se completan los campos solos."}
            </p>
          </div>

          <div>
            <Label htmlFor="provider_id">Proveedor</Label>
            <Select id="provider_id" name="provider_id" required defaultValue={defaultProviderId ?? ""} ref={providerRef}>
              <option value="" disabled>
                Elegí un proveedor
              </option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="invoice_number">N° de factura</Label>
              <Input id="invoice_number" name="invoice_number" required ref={invoiceNumberRef} />
            </div>
            <div>
              <Label htmlFor="invoice_date">Fecha</Label>
              <Input id="invoice_date" name="invoice_date" type="date" required ref={invoiceDateRef} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="subtotal">Subtotal</Label>
              <Input id="subtotal" name="subtotal" type="number" step="0.01" ref={subtotalRef} />
            </div>
            <div>
              <Label htmlFor="vat">IVA</Label>
              <Input id="vat" name="vat" type="number" step="0.01" ref={vatRef} />
            </div>
            <div>
              <Label htmlFor="total">Total</Label>
              <Input id="total" name="total" type="number" step="0.01" min="0.01" required ref={totalRef} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
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
              <Label htmlFor="timbrado">Timbrado</Label>
              <Input id="timbrado" name="timbrado" ref={timbradoRef} />
            </div>
          </div>
          <div>
            <Label htmlFor="observations">Observaciones</Label>
            <Textarea id="observations" name="observations" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || scanning}>
              {pending ? "Creando…" : "Crear factura"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
