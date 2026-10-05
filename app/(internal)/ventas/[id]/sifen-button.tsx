"use client";

import { Select } from "@/components/ui/select";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { emitirFE, emitirNC, consultarFE } from "../sifen-actions";
import type { SalesDocType, SalesDocStatus } from "@/lib/types";
import { canIssueSalesFiscalDocument } from "@/lib/sales";
import { GOEKUA_NC_MOTIVES, GOEKUA_RECONCILIATION_REQUIRED, isFiscalCdc } from "@/lib/goekua";

interface Props {
  docId:   string;
  docType: SalesDocType;
  status: SalesDocStatus;
  cdc:     string | null;
  kudeUrl: string | null;
  xmlUrl:  string | null;
  providerId?: string | null;
  creditNoteItems?: { id: string; description: string }[];
  sourceInvoiceItems?: { id: string; description: string }[];
}

export function SifenButton({ docId, docType, status, cdc: initialCdc, kudeUrl: initialKude, xmlUrl: initialXml, providerId: initialId = null, creditNoteItems = [], sourceInvoiceItems = [] }: Props) {
  const [providerId, setProviderId] = useState(initialId);
  const [motive, setMotive] = useState("");
  const [sourceIds, setSourceIds] = useState<Record<string, string>>({});
  const [cdc,     setCdc]     = useState(initialCdc);
  const [kudeUrl, setKudeUrl] = useState(initialKude);
  const [xmlUrl,  setXmlUrl]  = useState(initialXml);
  const [error,   setError]   = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canIssueSalesFiscalDocument(docType, status)) return null;

  function emitir() {
    setError(null);
    startTransition(async () => {
      const res = docType === "NOTA_CREDITO" ? await emitirNC(docId, { emissionMotive: Number(motive), sourceItemIds: creditNoteItems.map(i => sourceIds[i.id] ?? "") }) : await emitirFE(docId);
      if (res.error) setError(res.error);
      else {
        if (res.goekuaDocumentId) setProviderId(res.goekuaDocumentId);
        if (res.cdc) setCdc(res.cdc);
        if (res.kudeUrl) setKudeUrl(res.kudeUrl);
        if (res.xmlUrl) setXmlUrl(res.xmlUrl);
      }
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
  if (isFiscalCdc(cdc)) {
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

  if (providerId != null || cdc) {
    return <div role="status" className="max-w-sm text-[12px] text-[var(--warn)]">
      {providerId != null ? GOEKUA_RECONCILIATION_REQUIRED : "CDC histórico no válido; requiere conciliación."}
      {providerId != null ? <div className="font-mono">ID Goekua: {providerId}</div> : null}
    </div>;
  }

  // Explicit human choice, with no preselected motive or inferred source item.
  return (
    <div className="flex flex-col items-end gap-1">
      {docType === "NOTA_CREDITO" ? <>
        <label className="text-[12px]">Motivo fiscal de NC
          <Select aria-label="Motivo fiscal de NC" value={motive} onChange={e => setMotive(e.target.value)} disabled={pending}>
            <option value="">Seleccionar motivo</option>
            {Object.entries(GOEKUA_NC_MOTIVES).map(([value, label]) => <option key={value} value={value}>{value} — {label}</option>)}
          </Select>
        </label>
        {creditNoteItems.map(item => <label key={item.id} className="text-[12px]">{item.description}: ítem de factura origen
          <Select aria-label={`Ítem de origen para ${item.description}`} value={sourceIds[item.id] ?? ""} onChange={e => setSourceIds(prev => ({ ...prev, [item.id]: e.target.value }))} disabled={pending}>
            <option value="">Seleccionar ítem</option>
            {sourceInvoiceItems.map(source => <option key={source.id} value={source.id}>{source.description}</option>)}
          </Select>
        </label>)}
      </> : null}
      <Button onClick={emitir} disabled={pending || (docType === "NOTA_CREDITO" && (!motive || !creditNoteItems.length || creditNoteItems.some(i => !sourceIds[i.id])))} variant="secondary">
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
