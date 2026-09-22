"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/lib/format";
import { createWarehousePortalLink, ensureProjectInventoryLocation } from "@/app/(internal)/inventory/actions";
import { PortalLinkActions } from "../portal-link-actions";

export type SubmissionStatus = "UPLOADED" | "PROCESSING" | "NEEDS_REVIEW" | "READY" | "CONFIRMED" | "VOIDED";
export type LineState = "PROPOSED" | "CONFIRMED" | "REJECTED";

export type PanolLineRow = {
  id: string;
  raw_description: string;
  producto: string | null;
  quantity: number | null;
  unit: string | null;
  state: LineState;
  uncertainty_reason: string | null;
};

export type PanolSubmissionRow = {
  id: string;
  location_name: string;
  period_start: string;
  period_end: string;
  status: SubmissionStatus;
  evidenceCount: number;
  lines: PanolLineRow[];
};

const STATUS_TONE: Record<SubmissionStatus, "ok" | "warn" | "error" | "neutral"> = {
  UPLOADED: "neutral", PROCESSING: "neutral", NEEDS_REVIEW: "warn", READY: "warn", CONFIRMED: "ok", VOIDED: "error",
};
const STATUS_LABEL: Record<SubmissionStatus, string> = {
  UPLOADED: "Subida", PROCESSING: "Procesando", NEEDS_REVIEW: "Requiere revisión", READY: "Lista para confirmar", CONFIRMED: "Confirmada", VOIDED: "Anulada",
};
const LINE_STATE_TONE: Record<LineState, "ok" | "warn" | "error"> = { PROPOSED: "warn", CONFIRMED: "ok", REJECTED: "error" };

export function PanolObraSection({
  projectId,
  submissions,
}: {
  projectId: string;
  submissions: PanolSubmissionRow[];
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  async function createLink() {
    setPending(true);
    setError(null);
    setUrl(null);
    try {
      const location = await ensureProjectInventoryLocation(projectId);
      if (location.error || !location.id) {
        setError(location.error ?? "No se pudo resolver la ubicación de la obra.");
        return;
      }
      const result = await createWarehousePortalLink(location.id);
      if (result.error || !result.url) {
        setError(result.error ?? "No se pudo crear el enlace.");
        return;
      }
      setUrl(result.url);
    } catch {
      setError("No se pudo crear el enlace. Intentá nuevamente.");
    } finally {
      setPending(false);
    }
  }

  function toggle(id: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Paño de obra</h2>
            {submissions.length === 0 ? <p className="mt-1 text-[13px] text-[var(--muted)]">No hay rendiciones todavía.</p> : null}
          </div>
          <Button type="button" onClick={createLink} disabled={pending}>
            {pending ? "Creando enlace…" : "Crear enlace de pañol"}
          </Button>
        </div>
        {error ? <p role="alert" className="mt-3 text-xs text-[var(--error)]">{error}</p> : null}
        {url ? <div className="mt-3"><PortalLinkActions url={url} label="Rendición de pañol" /></div> : null}
      </section>

      {submissions.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel)]">
          <table>
            <thead><tr><th>Período</th><th>Ubicación</th><th>Estado</th><th className="num">Líneas</th><th className="num">Evidencia</th></tr></thead>
            <tbody>
              {submissions.map((submission) => {
                const open = expanded.has(submission.id);
                const confirmed = submission.lines.filter((line) => line.state === "CONFIRMED").length;
                const proposed = submission.lines.filter((line) => line.state === "PROPOSED").length;
                const rejected = submission.lines.filter((line) => line.state === "REJECTED").length;
                return [
                  <tr key={submission.id} className="cursor-pointer hover:bg-[var(--hover)]" onClick={() => toggle(submission.id)}>
                    <td className="font-medium"><span className="inline-flex items-center gap-1">{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{formatDate(submission.period_start)} – {formatDate(submission.period_end)}</span></td>
                    <td className="text-[var(--muted)]">{submission.location_name}</td>
                    <td><Badge tone={STATUS_TONE[submission.status]}>{STATUS_LABEL[submission.status]}</Badge></td>
                    <td className="num text-[12px]">
                      {proposed > 0 ? <span className="text-[var(--warn)]">{proposed} propuestas</span> : null}
                      {proposed > 0 && (confirmed > 0 || rejected > 0) ? " · " : ""}
                      {confirmed > 0 ? <span className="text-[var(--ok)]">{confirmed} confirmadas</span> : null}
                      {confirmed > 0 && rejected > 0 ? " · " : ""}
                      {rejected > 0 ? <span className="text-[var(--error)]">{rejected} rechazadas</span> : null}
                      {submission.lines.length === 0 ? "—" : ""}
                    </td>
                    <td className="num text-[12px] text-[var(--muted)]"><span className="inline-flex items-center justify-end gap-1"><Paperclip size={11} /> {submission.evidenceCount}</span></td>
                  </tr>,
                  ...(open ? submission.lines.map((line) => (
                    <tr key={line.id} className="bg-[var(--panel-2)]">
                      <td colSpan={2} className="pl-7 text-[12px] text-[var(--muted)]">{line.producto ?? line.raw_description}</td>
                      <td className="text-[12px]"><Badge tone={LINE_STATE_TONE[line.state]}>{line.state}</Badge></td>
                      <td className="num text-[12px] text-[var(--muted)]" colSpan={2}>
                        {line.quantity != null ? `${formatNumber(line.quantity, 2)} ${line.unit ?? ""}` : ""}
                        {line.uncertainty_reason ? <span className="ml-2 text-[var(--warn)]">({line.uncertainty_reason})</span> : null}
                      </td>
                    </tr>
                  )) : []),
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
