"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { approveCertificate, rejectCertificate } from "../caterpillar-actions";
import { SubcontractorContract, SubcontractorCertificate } from "@/lib/types";
import { formatDate, formatMoney } from "@/lib/format";

const STATUS_TONE: Record<string, string> = {
  PENDIENTE: "bg-[var(--warn-bg)] text-[var(--warn)]",
  APROBADO: "bg-[var(--ok-bg)] text-[var(--ok)]",
  RECHAZADO: "bg-[var(--error-bg)] text-[var(--error)]",
  PAGADO: "bg-[var(--ok-bg)] text-[var(--ok)]",
};

function CertificateRow({ cert }: { cert: SubcontractorCertificate }) {
  const [reviewing, setReviewing] = useState(false);
  const [approvedPct, setApprovedPct] = useState(String(cert.claimed_pct));
  const [approvedAmount, setApprovedAmount] = useState(String(cert.claimed_amount));
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const riskColor = cert.ai_flags?.risk_level === "high"
    ? "text-[var(--error)]"
    : cert.ai_flags?.risk_level === "medium"
    ? "text-[var(--warn)]"
    : "text-[var(--muted)]";

  return (
    <div className="rounded border border-[var(--border)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium text-[13px]">Certificado #{cert.certificate_number}</span>
          <span className="text-[12px] text-[var(--muted)] ml-2">{formatDate(cert.submitted_at)}</span>
        </div>
        <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_TONE[cert.status]}`}>
          {cert.status}
        </span>
      </div>
      <div className="text-[12px] text-[var(--muted)]">
        Reclamado: {cert.claimed_pct}% · {formatMoney(cert.claimed_amount, "PYG")}
        {cert.period_start && cert.period_end ? ` · ${formatDate(cert.period_start)} — ${formatDate(cert.period_end)}` : ""}
      </div>
      {cert.notes ? <div className="text-[12px] text-[var(--muted)]">Notas: {cert.notes}</div> : null}

      {cert.ai_flags ? (
        <div className={`rounded border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-1.5 text-[11px] ${riskColor}`}>
          <strong>IA ({cert.ai_flags.risk_level}):</strong> {cert.ai_flags.summary}
          {cert.ai_flags.flags.length > 0 ? (
            <ul className="list-disc list-inside mt-1">
              {cert.ai_flags.flags.map((f, i) => <li key={i}>{f}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {cert.status === "APROBADO" || cert.status === "PAGADO" ? (
        <div className="text-[12px] text-[var(--ok)]">
          Aprobado: {cert.approved_pct}% · {formatMoney(cert.approved_amount ?? 0, "PYG")} · Retención {formatMoney(cert.retention_amount, "PYG")} · Neto a pagar {formatMoney(cert.net_payable, "PYG")}
        </div>
      ) : null}

      {cert.status === "PENDIENTE" ? (
        reviewing ? (
          <div className="space-y-2 border-t border-[var(--border)] pt-2">
            {error ? <div className="text-[11px] text-[var(--error)]">{error}</div> : null}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-[var(--muted)]">% aprobado</label>
                <Input value={approvedPct} onChange={(e) => setApprovedPct(e.target.value)} type="number" step="any" />
              </div>
              <div>
                <label className="text-[11px] text-[var(--muted)]">Monto aprobado</label>
                <Input value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} type="number" step="any" />
              </div>
            </div>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas (opcional)" />
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  setError(null);
                  const result = await rejectCertificate(cert.id, notes || null);
                  setPending(false);
                  if (result.error) { setError(result.error); return; }
                  router.refresh();
                }}
              >
                Rechazar
              </Button>
              <Button
                type="button"
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  setError(null);
                  const result = await approveCertificate(cert.id, Number(approvedPct), Number(approvedAmount), notes || null);
                  setPending(false);
                  if (result.error) { setError(result.error); return; }
                  router.refresh();
                }}
              >
                {pending ? "Guardando…" : "Aprobar"}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => setReviewing(true)}>Revisar</Button>
        )
      ) : null}
    </div>
  );
}

export function ContractCertificatesDialog({
  contract,
  certificates,
  appUrl,
}: {
  contract: SubcontractorContract;
  certificates: SubcontractorCertificate[];
  appUrl: string;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const portalUrl = `${appUrl}/certificados/${contract.public_token}`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Ver certificados ({certificates.length})</Button>
      </DialogTrigger>
      <DialogContent title="Certificados del contrato" className="max-w-xl">
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
            Mandale este link al subcontratista — es permanente, lo puede usar cuantas veces necesite para cargar certificados nuevos.
          </p>

          <div className="space-y-2 max-h-96 overflow-y-auto">
            {certificates.length === 0 ? (
              <p className="text-[12px] text-[var(--muted)] text-center py-6">Sin certificados todavía.</p>
            ) : (
              certificates.map((c) => <CertificateRow key={c.id} cert={c} />)
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
