"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { CopyLinkButton } from "./copy-link-button";

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
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <CopyLinkButton url={url} />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <button type="button" className="text-[12px] text-[var(--primary)] underline hover:no-underline">
            QR
          </button>
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
                className="flex w-full items-center justify-center h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--hover)] text-[13px] font-medium"
              >
                Descargar QR
              </a>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <a
        href={waUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[12px] text-[var(--primary)] underline hover:no-underline"
        title={digits ? `Abrir WhatsApp con ${phone}` : "El proveedor no tiene teléfono: elegís el contacto en WhatsApp"}
      >
        WhatsApp
      </a>
    </span>
  );
}
