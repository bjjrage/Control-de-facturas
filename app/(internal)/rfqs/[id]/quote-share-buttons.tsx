"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { CopyLinkButton } from "./copy-link-button";
import { Button, buttonClassName } from "@/components/ui/button";
import { QrCode, MessageCircle, Download } from "lucide-react";

/**
 * Link del portal de cotización para un proveedor: copiar, QR y WhatsApp.
 * No se envía nada solo: WhatsApp abre el chat con el mensaje armado y la
 * persona decide mandarlo.
 */
export function QuoteShareButtons({
  url,
  providerName,
  phone,
  rfqCode,
}: {
  url: string;
  providerName: string;
  phone: string | null;
  rfqCode: string;
}) {
  const [open, setOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: "M" })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [open, url]);

  const message = `Hola ${providerName}, te pedimos cotización (${rfqCode}). Podés cargar los precios o subir tu presupuesto acá: ${url}`;
  const digits = (phone ?? "").replace(/\D/g, "");
  const waUrl = `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <CopyLinkButton url={url} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button type="button" variant="secondary" size="sm"><QrCode size={14} aria-hidden="true" /> QR</Button>
        </DialogTrigger>
        <DialogContent title={`QR de cotización — ${providerName}`}>
          <div className="space-y-3">
            <div className="flex justify-center rounded-lg border border-[var(--border)] bg-white p-4">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrDataUrl} alt="QR del portal de cotización" className="h-52 w-52" />
              ) : (
                <div className="h-52 w-52 animate-pulse rounded bg-[var(--hover)]" />
              )}
            </div>
            {qrDataUrl ? (
              <a
                href={qrDataUrl}
                download={`cotizacion-${rfqCode}-${providerName.replace(/[^\w-]/g, "")}.png`}
                className={buttonClassName({variant: "secondary", className: "w-full"})}
              >
                <Download size={15} aria-hidden="true" /> Descargar QR
              </a>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonClassName({variant: "secondary", size: "sm", className: "hover:border-emerald-400/60 hover:text-emerald-200"})}
        title={digits ? `Abrir WhatsApp con ${phone}` : "El proveedor no tiene teléfono: elegís el contacto en WhatsApp"}
      >
        <MessageCircle size={14} aria-hidden="true" /> WhatsApp
      </a>
    </span>
  );
}
