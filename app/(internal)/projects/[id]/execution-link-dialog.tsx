"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { InfoTooltip } from "@/components/ui/info-tooltip";

export function ExecutionLinkDialog({
  appUrl,
  token,
  projectCode,
  triggerLabel = "QR para Residente",
}: {
  appUrl: string;
  token: string;
  projectCode?: string;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const portalUrl = `${appUrl}/avance/${token}`;

  useEffect(() => {
    if (!open) return;
    QRCode.toDataURL(portalUrl, { width: 640, margin: 2, errorCorrectionLevel: "M" })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(null));
  }, [open, portalUrl]);

  const fileName = `avance-${(projectCode || "obra").replace(/[^\w-]/g, "")}.png`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent title={<span className="inline-flex items-center gap-1.5">QR para residente<InfoTooltip label="QR para residente" content="El residente puede enviar partes y evidencia desde el celular sin iniciar sesión. Los reportes de lluvia son evidencia; las jornadas del Libro requieren decisión administrativa." /></span>}>
        <div className="space-y-3">
          <div className="flex justify-center rounded-lg border border-[var(--border)] bg-white p-4">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR del registro de avance" className="h-52 w-52" />
            ) : (
              <div className="h-52 w-52 animate-pulse rounded bg-[var(--hover)]" />
            )}
          </div>

          <div className="flex gap-2">
            {qrDataUrl ? (
              <a
                href={qrDataUrl}
                download={fileName}
                className="flex-1 inline-flex items-center justify-center h-9 rounded-md border border-[var(--border)] bg-[var(--panel)] hover:bg-[var(--hover)] text-[13px] font-medium"
              >
                Descargar QR
              </a>
            ) : null}
            <Button
              variant="secondary"
              className="flex-1 h-9 text-[13px]"
              onClick={() => {
                navigator.clipboard.writeText(portalUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "¡Link copiado!" : "Copiar link"}
            </Button>
          </div>

          <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-2.5">
            <span className="text-[11px] text-[var(--muted)] break-all">{portalUrl}</span>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  );
}
