"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Provider } from "@/lib/types";
import { createInvoice } from "./actions";
import { extractInvoiceFromPhoto } from "./extract-actions";
import { ScanButton } from "@/components/scanner/scan-button";
import type { ReceivedDocument } from "@/components/scanner/scan-modal";
import { Upload, Eye, RefreshCw, CheckCircle2, FileText } from "lucide-react";

const READABLE_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

interface AttachedDocument {
  source: "scanner" | "manual";
  sessionId?: string;
  fileName: string;
  pageCount?: number;
  fileSizeBytes?: number;
  signedUrl?: string;
  previewUrl?: string;
  storagePath?: string;
  file?: File;
}

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
  const [currency, setCurrency] = useState("PYG");
  const [attachedDoc, setAttachedDoc] = useState<AttachedDocument | null>(null);
  const router = useRouter();

  const providerRef = useRef<HTMLSelectElement>(null);
  const invoiceNumberRef = useRef<HTMLInputElement>(null);
  const invoiceDateRef = useRef<HTMLInputElement>(null);
  const dueDateRef = useRef<HTMLInputElement>(null);
  const subtotalRef = useRef<HTMLInputElement>(null);
  const vatRef = useRef<HTMLInputElement>(null);
  const totalRef = useRef<HTMLInputElement>(null);
  const timbradoRef = useRef<HTMLInputElement>(null);
  const orderReferenceRef = useRef<HTMLInputElement>(null);
  const productDescriptionRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      if (orderReferenceRef.current) orderReferenceRef.current.value = d.order_reference ?? "";
      if (productDescriptionRef.current) productDescriptionRef.current.value = d.product_description ?? "";

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

  function handleManualFile(file: File | null) {
    if (!file) return;
    const previewUrl = URL.createObjectURL(file);
    setAttachedDoc({
      source: "manual",
      fileName: file.name,
      fileSizeBytes: file.size,
      previewUrl,
      file,
    });
    handleFileChange(file);
  }

  function handleScannerDocument(doc: ReceivedDocument) {
    try {
      const dt = new DataTransfer();
      dt.items.add(doc.file);
      if (fileInputRef.current) {
        fileInputRef.current.files = dt.files;
      }
    } catch {
      // Fallback para navegadores antiguos
    }

    setAttachedDoc({
      source: "scanner",
      sessionId: doc.sessionId,
      fileName: doc.fileName,
      pageCount: doc.pageCount,
      fileSizeBytes: doc.fileSizeBytes,
      signedUrl: doc.signedUrl,
      previewUrl: doc.signedUrl,
      storagePath: doc.storagePath,
      file: doc.file,
    });
    handleFileChange(doc.file);
  }

  function handleReplaceDocument() {
    setAttachedDoc(null);
    setScanNotice(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function handlePreviewDocument() {
    if (!attachedDoc) return;
    const url = attachedDoc.signedUrl || attachedDoc.previewUrl;
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setScanNotice(null);
          setAttachedDoc(null);
        }
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
            router.push(`/invoices/${result.id}?${result.autoMatched ? "autoMatched=1" : "created=1"}`);
          }}
        >
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}
          {linkOrderId ? <input type="hidden" name="link_order_id" value={linkOrderId} /> : null}
          <input type="hidden" name="order_reference" ref={orderReferenceRef} />
          <input type="hidden" name="product_description" ref={productDescriptionRef} />

          <div>
            <Label htmlFor="file">Documento / Comprobante</Label>
            {!attachedDoc ? (
              <div className="mt-1.5 space-y-1.5">
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    className="h-8 text-[12px] gap-1.5 font-medium"
                  >
                    <Upload className="w-3.5 h-3.5 text-[var(--muted)]" />
                    Subir archivo
                  </Button>
                  <ScanButton
                    contextType="invoice"
                    metadata={{ source: "invoice-dialog" }}
                    onDocumentReceived={handleScannerDocument}
                    className="h-8 text-[12px] gap-1.5 font-medium"
                  />
                </div>
                <input
                  ref={fileInputRef}
                  id="file"
                  name="file"
                  type="file"
                  accept="image/*,application/pdf"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => handleManualFile(e.target.files?.[0] ?? null)}
                />
                <p className="text-[11px] text-[var(--muted)]">
                  {scanning
                    ? "Leyendo factura…"
                    : scanNotice ?? "Subí un archivo (PDF, JPG, PNG) o escanealo en vivo con tu celular."}
                </p>
              </div>
            ) : (
              <div className="mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-8 h-8 rounded-full border flex items-center justify-center shrink-0 ${
                        attachedDoc.source === "scanner"
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-500"
                          : "bg-blue-500/10 border-blue-500/30 text-blue-500"
                      }`}
                    >
                      {attachedDoc.source === "scanner" ? (
                        <CheckCircle2 className="w-4 h-4" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <div
                        className={`text-[11px] font-semibold ${
                          attachedDoc.source === "scanner"
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-blue-600 dark:text-blue-400"
                        }`}
                      >
                        {attachedDoc.source === "scanner"
                          ? "✓ Documento recibido desde Control Scanner"
                          : "Archivo adjunto"}
                      </div>
                      <p className="text-[13px] font-medium text-[var(--foreground)] truncate max-w-[220px]">
                        {attachedDoc.fileName}
                      </p>
                      <p className="text-[11px] text-[var(--muted)]">
                        {attachedDoc.pageCount
                          ? `${attachedDoc.pageCount} ${attachedDoc.pageCount === 1 ? "página" : "páginas"} · `
                          : ""}
                        {Math.round((attachedDoc.fileSizeBytes || 0) / 1024)} KB
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handlePreviewDocument}
                      className="h-7 text-[11px] px-2 gap-1 font-medium text-[var(--foreground)]"
                    >
                      <Eye className="w-3.5 h-3.5" /> Previsualizar
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleReplaceDocument}
                      className="h-7 text-[11px] px-2 gap-1 text-[var(--muted)] hover:text-[var(--error)]"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Reemplazar
                    </Button>
                  </div>
                </div>

                {/* Input oculto para preservar el archivo cuando es subida manual */}
                <input
                  ref={fileInputRef}
                  id="file"
                  name="file"
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                />

                {/* Identificador de sesión validado server-side contra scan_sessions */}
                {attachedDoc.source === "scanner" && attachedDoc.sessionId ? (
                  <input type="hidden" name="scanner_session_id" value={attachedDoc.sessionId} />
                ) : null}

                <p className="text-[11px] text-[var(--muted)] mt-2 pt-1 border-t border-[var(--border)]/50">
                  {scanning
                    ? "Leyendo factura…"
                    : scanNotice ?? "Documento listo para asociar a la factura."}
                </p>
              </div>
            )}
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
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="invoice_number">N° de factura</Label>
              <Input id="invoice_number" name="invoice_number" required ref={invoiceNumberRef} />
            </div>
            <div>
              <Label htmlFor="invoice_date">Fecha</Label>
              <Input id="invoice_date" name="invoice_date" type="date" required ref={invoiceDateRef} />
            </div>
            <div>
              <Label htmlFor="due_date">Vencimiento</Label>
              <Input id="due_date" name="due_date" type="date" ref={dueDateRef} />
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
              <Select
                id="currency"
                name="currency"
                defaultValue="PYG"
                required
                onChange={(e) => setCurrency(e.target.value)}
              >
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
          {currency !== "PYG" ? (
            <div>
              <Label htmlFor="exchange_rate">
                Tipo de cambio (1 {currency} = ? PYG)
              </Label>
              <Input
                id="exchange_rate"
                name="exchange_rate"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="Ej: 7900"
                required
              />
              <p className="text-[11px] text-[var(--muted)] mt-1">
                Necesario para registrar el costo en el motor de precios.
              </p>
            </div>
          ) : null}
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
