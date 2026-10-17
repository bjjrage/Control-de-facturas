"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Provider, type CurrencyCode } from "@/lib/types";
import { createInvoice } from "./actions";
import { extractInvoiceFromPhoto } from "./extract-actions";
import { calculateInvoiceVat, type InvoiceAmounts } from "@/lib/invoice-vat";
import { formatMoney } from "@/lib/format";
import type { ArithmeticValidation } from "@/lib/invoice-arithmetic";
import type { ExtractedInvoiceItem } from "@/lib/invoice-extraction";
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
  const [currency, setCurrency] = useState<CurrencyCode>("PYG");
  const [amount, setAmount] = useState("");
  const [vatRate, setVatRate] = useState("");
  const [vatIncluded, setVatIncluded] = useState(true);
  const [documentAmounts, setDocumentAmounts] = useState<InvoiceAmounts | null>(null);
  const amounts = vatRate === "document"
    ? documentAmounts
    : vatRate === "" ? null : calculateInvoiceVat(Number(amount), Number(vatRate), vatIncluded, currency);
  const [attachedDoc, setAttachedDoc] = useState<AttachedDocument | null>(null);
  const router = useRouter();

  const [providerId, setProviderId] = useState(defaultProviderId ?? "");
  const [lines, setLines] = useState<ExtractedInvoiceItem[]>([]);
  const [arithmetic, setArithmetic] = useState<ArithmeticValidation | null>(null);
  const invoiceNumberRef = useRef<HTMLInputElement>(null);
  const invoiceDateRef = useRef<HTMLInputElement>(null);
  const dueDateRef = useRef<HTMLInputElement>(null);
  const timbradoRef = useRef<HTMLInputElement>(null);
  const orderReferenceRef = useRef<HTMLInputElement>(null);
  const productDescriptionRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const extractionGeneration = useRef(0);
  const [extractionProof, setExtractionProof] = useState("");

  function clearDocumentFields() {
    extractionGeneration.current++;
    setScanning(false);
    setExtractionProof("");
    setScanNotice(null); setLines([]); setArithmetic(null);
    setProviderId(defaultProviderId ?? "");
    setAmount(""); setDocumentAmounts(null); setVatRate(""); setVatIncluded(true);
    for (const ref of [invoiceNumberRef, invoiceDateRef, dueDateRef, timbradoRef, orderReferenceRef, productDescriptionRef]) {
      if (ref.current) ref.current.value = "";
    }
  }

  async function handleFileChange(file: File | null) {
    clearDocumentFields();
    const generation = extractionGeneration.current;
    if (!file || !READABLE_TYPES.includes(file.type)) return;

    setScanning(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const result = await extractInvoiceFromPhoto(fd);
      if (generation !== extractionGeneration.current) return;
      if (result.error || !result.data) {
        setScanNotice(result.error ?? "No se pudo leer la factura. Completá los datos a mano.");
        return;
      }

      const d = result.data;
      setExtractionProof(d.extraction_proof);
      if (d.currency) setCurrency(d.currency);
      if (invoiceNumberRef.current && d.invoice_number) invoiceNumberRef.current.value = d.invoice_number;
      if (invoiceDateRef.current && d.invoice_date) invoiceDateRef.current.value = d.invoice_date;
      if (dueDateRef.current) dueDateRef.current.value = d.due_date ?? "";
      if (d.total !== null) setAmount(String(d.total));
      if (d.subtotal !== null && d.vat !== null && d.total !== null) {
        // Preserve the original amounts, including mixed rates and rounding.
        setDocumentAmounts({ subtotal: d.subtotal, vat: d.vat, total: d.total });
        setVatRate("document");
        setVatIncluded(true);
      } else {
        setDocumentAmounts(null);
        setVatRate("");
      }
      if (timbradoRef.current && d.timbrado) timbradoRef.current.value = d.timbrado;
      if (orderReferenceRef.current) orderReferenceRef.current.value = d.order_reference ?? "";
      if (productDescriptionRef.current) productDescriptionRef.current.value = d.product_description ?? "";
      setLines((d.items ?? []).map((item) => ({ ...item })));
      setArithmetic(d.validation ?? null);

      if (d.provider_id && (!linkOrderId || d.provider_id === defaultProviderId)) {
        setProviderId(d.provider_id);
        setScanNotice("Factura leída. Revisá los datos antes de crear.");
      } else if (linkOrderId && d.provider_tax_id && d.provider_id !== defaultProviderId) {
        setScanNotice("El RUC del emisor no coincide con el proveedor de la OC. No se puede guardar esta factura para esa orden.");
      } else if (linkOrderId && defaultProviderId && !d.provider_tax_id) {
        setScanNotice("Factura leída. Se conserva el proveedor de la OC. El documento no informa RUC; verificá el emisor antes de guardar.");
      } else if (d.provider_name) {
        setScanNotice(
          `Factura leída. No encontré "${d.provider_name}"${d.provider_tax_id ? ` (RUC ${d.provider_tax_id})` : ""} entre los proveedores — elegilo a mano o cargalo primero.`
        );
      } else {
        setScanNotice("Factura leída, pero no se detectó el proveedor. Elegilo a mano.");
      }
    } finally {
      if (generation === extractionGeneration.current) setScanning(false);
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
    clearDocumentFields();
    setScanning(false);
    setAttachedDoc(null);
    setScanNotice(null);
    setLines([]);
    setArithmetic(null);
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
          clearDocumentFields();
          setScanning(false);
          setError(null);
          setAmount("");
          setVatRate("");
          setVatIncluded(true);
          setDocumentAmounts(null);
          setScanNotice(null);
          setAttachedDoc(null);
          setLines([]);
          setArithmetic(null);
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title="Nueva factura" className="flex max-h-[85dvh] w-[calc(100%-2rem)] flex-col overflow-hidden p-0 [&>h2]:mb-0 [&>h2]:shrink-0 [&>h2]:px-5 [&>h2]:py-4">
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending || scanning || !amounts) return;
            const formData = new FormData(event.currentTarget);
            // The file input is remounted by the attachment preview. Keep the
            // actual selected file, and preserve every field on server errors.
            if (attachedDoc?.source === "manual" && attachedDoc.file) formData.set("file", attachedDoc.file);
            setPending(true);
            setError(null);
            try {
            const result = await createInvoice(formData);
            if (result.error) {
              setError(result.error);
              return;
            }
            if (result.warning) alert(result.warning);
            setError(null);
            setOpen(false);
            router.push(`/invoices/${result.id}?${result.autoMatched ? "autoMatched=1" : "created=1"}`);
            } catch {
              setError("No se pudo guardar la factura. Tus datos se conservan; volvé a intentar.");
            } finally {
              setPending(false);
            }
          }}
        >
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-5 pb-4">
          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}
          {linkOrderId ? <input type="hidden" name="link_order_id" value={linkOrderId} /> : null}
          <input type="hidden" name="order_reference" ref={orderReferenceRef} />
          <input type="hidden" name="product_description" ref={productDescriptionRef} />
          <input type="hidden" name="extraction_proof" value={extractionProof} />
          <input type="hidden" name="items_json" value={JSON.stringify(lines)} />
          {arithmetic && arithmetic.status !== "VALIDA" ? (
            <div className="rounded border border-[var(--warn)]/40 bg-[var(--warn-bg)] px-2.5 py-1.5 text-[12px] text-[var(--warn)]">
              Revisión aritmética: {arithmetic.issues[0]}
              {arithmetic.issues.length > 1 ? ` (+${arithmetic.issues.length - 1} más)` : ""} Verificá
              los importes contra el documento antes de crear.
              <label className="mt-1.5 flex items-start gap-2 cursor-pointer">
                <input type="checkbox" name="arithmetic_confirmed" value="on" className="mt-0.5" />
                <span>Verifiqué los importes contra el documento y asumo la discrepancia.</span>
              </label>
            </div>
          ) : null}

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
            <Select id="provider_id" name="provider_id" required value={providerId} onValueChange={setProviderId}>
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
          <fieldset className="rounded-lg border-2 border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-3">
            <legend className="px-1 text-[12px] font-semibold">Importes de la factura</legend>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="invoice_amount">{vatIncluded ? "Importe con IVA incluido" : "Subtotal sin IVA"}</Label>
                <Input id="invoice_amount" name="invoice_amount" type="number" step={currency === "PYG" ? "1" : "0.01"} min={currency === "PYG" ? "1" : "0.01"} required value={amount} readOnly={vatRate === "document"} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="vat_rate">IVA %</Label>
                <Select id="vat_rate" name="vat_rate" required value={vatRate} onValueChange={setVatRate}>
                  <option value="" disabled>Elegí el porcentaje</option>
                  <option value="5">5%</option>
                  <option value="10">10%</option>
                  <option value="0">Exento (0%)</option>
                  {documentAmounts ? <option value="document">Según documento</option> : null}
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" name="vat_included" checked={vatIncluded} disabled={vatRate === "document"} onChange={(e) => setVatIncluded(e.target.checked)} />
              El importe ingresado ya incluye IVA
            </label>
            <input type="hidden" name="subtotal" value={amounts?.subtotal ?? ""} />
            <input type="hidden" name="vat" value={amounts?.vat ?? ""} />
            <input type="hidden" name="total" value={amounts?.total ?? ""} />
            <dl className="grid grid-cols-3 gap-2 border-t border-[var(--border)] pt-2 text-[12px]">
              <div><dt className="text-[var(--muted)]">Subtotal sin IVA</dt><dd>{amounts ? formatMoney(amounts.subtotal, currency) : "—"}</dd></div>
              <div><dt className="text-[var(--muted)]">IVA calculado</dt><dd>{amounts ? formatMoney(amounts.vat, currency) : "—"}</dd></div>
              <div><dt className="text-[var(--muted)]">Total</dt><dd className="font-semibold">{amounts ? formatMoney(amounts.total, currency) : "—"}</dd></div>
            </dl>
          </fieldset>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="currency">Moneda</Label>
              <Select
                id="currency"
                name="currency"
                defaultValue="PYG"
                required
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
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
          {lines.length > 0 ? (
            <div>
              <Label>Líneas detectadas (revisalas antes de crear)</Label>
              <div className="mt-1 space-y-1.5">
                {lines.map((line, i) => (
                  <div key={i} className="grid grid-cols-[1fr_64px_64px_80px_24px] gap-1.5 items-center">
                    <Input
                      aria-label={`Descripción línea ${i + 1}`}
                      value={line.description}
                      onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, description: e.target.value } : l)))}
                    />
                    <Input
                      aria-label={`Cantidad línea ${i + 1}`}
                      type="number"
                      step="0.0001"
                      value={line.quantity ?? ""}
                      onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, quantity: e.target.value === "" ? null : e.target.value } : l)))}
                    />
                    <Input
                      aria-label={`Unidad línea ${i + 1}`}
                      value={line.unit ?? ""}
                      onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, unit: e.target.value || null } : l)))}
                    />
                    <Input
                      aria-label={`Precio línea ${i + 1}`}
                      type="number"
                      step="any"
                      value={line.unit_price ?? ""}
                      onChange={(e) => setLines((prev) => prev.map((l, j) => (j === i ? { ...l, unit_price: e.target.value === "" ? null : Number(e.target.value) } : l)))}
                    />
                    <button
                      type="button"
                      aria-label={`Quitar línea ${i + 1}`}
                      className="text-[var(--error)] text-[14px]"
                      onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-[var(--muted)] mt-1">
                Se guardan con la factura para conciliar cantidades por ítem. Podés corregirlas o quitarlas.
              </p>
            </div>
          ) : null}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--border)] bg-[var(--panel-2)] px-5 py-3">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending || scanning || !amounts}>
              {pending ? "Creando…" : "Crear factura"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
