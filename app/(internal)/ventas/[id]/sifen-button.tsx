"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { emitirFE, emitirNC, consultarFE } from "../sifen-actions";
import type { SalesDocType } from "@/lib/types";

interface Props {
  docId:   string;
  docType: SalesDocType;
  cdc:     string | null;
  kudeUrl: string | null;
  xmlUrl:  string | null;
}

export function SifenButton({ docId, docType, cdc: initialCdc, kudeUrl: initialKude, xmlUrl: initialXml }: Props) {
  const [cdc,     setCdc]     = useState(initialCdc);
  const [kudeUrl, setKudeUrl] = useState(initialKude);
  const [xmlUrl,  setXmlUrl]  = useState(initialXml);
  const [error,   setError]   = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function emitir() {
    setError(null);
    startTransition(async () => {
      const res = docType === "NOTA_CREDITO" ? await emitirNC(docId) : await emitirFE(docId);
      if (res.error) setError(res.error);
      else if (res.cdc) setCdc(res.cdc);
    });
  }

  function consultar() {
    setError(null);
    startTransition(async () => {
      const res = await consultarFE(docId);
      if (res.error) setError(res.error);
      else {
        if (res.cdc)     setCdc(res.cdc);
        if (res.kudeUrl) setKudeUrl(res.kudeUrl);
      }
    });
  }

  // Ya emitida — mostramos estado + links
  if (cdc) {
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--ok)] font-semibold">✓ FE emitida</span>
          <span className="text-[11px] text-[var(--muted)] font-mono">{cdc.slice(0, 12)}…</span>
          <button
            onClick={consultar}
            disabled={pending}
            className="text-[11px] text-action"
            title="Actualizar estado desde Goekua"
          >
            {pending ? "…" : "↻"}
          </button>
        </div>
        <div className="flex gap-2">
          {kudeUrl && (
            <a
              href={kudeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-action"
            >
              Ver KUDE
            </a>
          )}
          {xmlUrl && (
            <a
              href={xmlUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-action"
            >
              XML
            </a>
          )}
        </div>
        {error && (
          <span className="text-[11px] text-[var(--error)]">{error}</span>
        )}
      </div>
    );
  }

  // Pendiente de emitir
  return (
    <div className="flex flex-col items-end gap-1">
      <Button onClick={emitir} disabled={pending} variant="secondary">
        {pending ? "Emitiendo FE…" : "Emitir FE"}
      </Button>
      {error && (
        <span className="text-[11px] text-[var(--error)] max-w-[260px] text-right leading-tight">
          {error}
        </span>
      )}
    </div>
  );
}
