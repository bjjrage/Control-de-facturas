"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatNumber } from "@/lib/format";

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
  UPLOADED: "neutral",
  PROCESSING: "neutral",
  NEEDS_REVIEW: "warn",
  READY: "warn",
  CONFIRMED: "ok",
  VOIDED: "error",
};

const STATUS_LABEL: Record<SubmissionStatus, string> = {
  UPLOADED: "Subida",
  PROCESSING: "Procesando",
  NEEDS_REVIEW: "Requiere revisión",
  READY: "Lista para confirmar",
  CONFIRMED: "Confirmada",
  VOIDED: "Anulada",
};

const LINE_STATE_TONE: Record<LineState, "ok" | "warn" | "error"> = {
  PROPOSED: "warn",
  CONFIRMED: "ok",
  REJECTED: "error",
};

// Rendiciones del pañol de ESTA obra — el depositero sube evidencia por el
// portal externo (/warehouse/[token]); acá el usuario interno solo LEE:
// estado, líneas propuestas por el sistema, y cuáles quedaron confirmadas.
// No hay acción de "actuar como depositero" en este shell autenticado.
export function PanolObraSection({ submissions }: { submissions: PanolSubmissionRow[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  if (submissions.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-[13px] text-[var(--muted)]">
        Esta obra todavía no tiene rendiciones de pañol. El depositero las sube desde su portal externo.
      </div>
    );
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
      <table>
        <thead>
          <tr>
            <th>Período</th>
            <th>Ubicación</th>
            <th>Estado</th>
            <th className="num">Líneas</th>
            <th className="num">Evidencia</th>
          </tr>
        </thead>
        <tbody>
          {submissions.map((s) => {
            const open = expanded.has(s.id);
            const confirmed = s.lines.filter((l) => l.state === "CONFIRMED").length;
            const proposed = s.lines.filter((l) => l.state === "PROPOSED").length;
            const rejected = s.lines.filter((l) => l.state === "REJECTED").length;
            return [
              <tr key={s.id} className="cursor-pointer hover:bg-[var(--hover)]" onClick={() => toggle(s.id)}>
                <td className="font-medium">
                  <span className="inline-flex items-center gap-1">
                    {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    {formatDate(s.period_start)} – {formatDate(s.period_end)}
                  </span>
                </td>
                <td className="text-[var(--muted)]">{s.location_name}</td>
                <td>
                  <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                </td>
                <td className="num text-[12px]">
                  {proposed > 0 ? <span className="text-[var(--warn)]">{proposed} propuestas</span> : null}
                  {proposed > 0 && (confirmed > 0 || rejected > 0) ? " · " : ""}
                  {confirmed > 0 ? <span className="text-[var(--ok)]">{confirmed} confirmadas</span> : null}
                  {confirmed > 0 && rejected > 0 ? " · " : ""}
                  {rejected > 0 ? <span className="text-[var(--error)]">{rejected} rechazadas</span> : null}
                  {s.lines.length === 0 ? "—" : ""}
                </td>
                <td className="num text-[12px] text-[var(--muted)]">
                  <span className="inline-flex items-center gap-1 justify-end">
                    <Paperclip size={11} /> {s.evidenceCount}
                  </span>
                </td>
              </tr>,
              open
                ? s.lines.map((l) => (
                    <tr key={l.id} className="bg-[var(--panel-2)]">
                      <td colSpan={2} className="pl-7 text-[12px] text-[var(--muted)]">
                        {l.producto ?? l.raw_description}
                      </td>
                      <td className="text-[12px]">
                        <Badge tone={LINE_STATE_TONE[l.state]}>{l.state}</Badge>
                      </td>
                      <td className="num text-[12px] text-[var(--muted)]" colSpan={2}>
                        {l.quantity != null ? `${formatNumber(l.quantity, 2)} ${l.unit ?? ""}` : ""}
                        {l.uncertainty_reason ? (
                          <span className="text-[var(--warn)] ml-2">({l.uncertainty_reason})</span>
                        ) : null}
                      </td>
                    </tr>
                  ))
                : [],
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
