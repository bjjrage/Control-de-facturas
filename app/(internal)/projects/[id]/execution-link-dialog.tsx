"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function ExecutionLinkDialog({ appUrl, token }: { appUrl: string; token: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const portalUrl = `${appUrl}/avance/${token}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Link para el capataz</Button>
      </DialogTrigger>
      <DialogContent title="Link de avance para la obra">
        <div className="space-y-3">
          <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-2.5 flex items-center gap-2">
            <span className="text-[11px] text-[var(--muted)] flex-1 truncate">{portalUrl}</span>
            <Button
              variant="secondary"
              className="h-6 px-2 text-[11px]"
              onClick={() => {
                navigator.clipboard.writeText(portalUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? "¡Copiado!" : "Copiar link"}
            </Button>
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            Mandaselo por WhatsApp al capataz o residente a cargo — sin login, entra directo a cargar el parte
            de avance de esta obra (con fotos) cuantas veces necesite. Es el mismo link siempre, no hace falta
            generar uno nuevo cada día.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
