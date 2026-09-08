"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ExecutionLinkDialog({
  appUrl,
  token,
  projectCode,
}: {
  appUrl: string;
  token: string;
  projectCode?: string;
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
        <Button variant="secondary">QR para el capataz</Button>
      </DialogTrigger>
      <DialogContent title="QR de avance para la obra">
        <div className="space-y-3">
          <div className="flex justify-center rounded-lg border border-[var(--border)] bg-white p-4">
            {qrDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrDataUrl} alt="QR del parte de avance" className="h-52 w-52" />
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

          <p className="text-[11px] text-[var(--muted)]">
            Mandale el QR al capataz o residente (o imprimílo y pegalo en el obrador). Lo escanea una vez,
            entra directo a cargar el parte de avance con fotos — sin login — y puede{" "}
            <span className="text-[var(--foreground)]">agregarlo a la pantalla de inicio</span> para tenerlo
            a mano. Es el mismo QR siempre.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
