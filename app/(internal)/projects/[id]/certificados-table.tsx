"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, formatNumber, formatDate } from "@/lib/format";
import type { Project, ProjectCertificate, ProjectCertificateItem } from "@/lib/types";
import {
  updateCertificateItem,
  closeCertificate,
  reopenCertificate,
  deleteCertificate,
  resyncCertificateFromExecution,
} from "../certificado-actions";

function pct(part: number, whole: number): string {
  if (!(whole > 0)) return "—";
  return `${((part / whole) * 100).toFixed(2)}%`;
}

export function CertificadosTable({
  project,
  certificates,
  itemsByCert,
  isAdmin,
}: {
  project: Project;
  certificates: ProjectCertificate[];
  itemsByCert: Record<string, ProjectCertificateItem[]>;
  isAdmin: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(certificates[0]?.id ?? null);
  const contractAmount = project.contract_amount;

  if (certificates.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-center text-[13px] text-[var(--muted)]">
        Sin certificados. Generá el primero con el botón de arriba — se arma con los rubros del presupuesto
        y el avance cargado en el período.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th className="w-8"></th>
              <th>N°</th>
              <th>Período</th>
              <th className="num">Presente</th>
              <th className="num">Acumulado</th>
              <th className="num">Avance acum.</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {certificates.map((c) => {
              const isOpen = expanded === c.id;
              return (
                <tr
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => setExpanded(isOpen ? null : c.id)}
                >
                  <td>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                  <td className="font-medium">{c.numero}</td>
                  <td>
                    {formatDate(c.period_start)} — {formatDate(c.period_end)}
                  </td>
                  <td className="num">{formatMoney(c.monto_presente, "PYG")}</td>
                  <td className="num">{formatMoney(c.monto_acumulado, "PYG")}</td>
                  <td className="num">{pct(c.monto_acumulado, contractAmount)}</td>
                  <td>
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${
                        c.status === "CERRADO"
                          ? "bg-[var(--primary)]/15 text-[var(--primary)]"
                          : "bg-[var(--hover)] text-[var(--muted)]"
                      }`}
                    >
                      {c.status === "CERRADO" ? "Cerrado" : "Borrador"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {expanded ? (
        <CertificadoDetalle
          key={expanded}
          project={project}
          certificate={certificates.find((c) => c.id === expanded)!}
          items={itemsByCert[expanded] ?? []}
          isAdmin={isAdmin}
        />
      ) : null}
    </div>
  );
}

function CertificadoDetalle({
  project,
  certificate,
  items,
  isAdmin,
}: {
  project: Project;
  certificate: ProjectCertificate;
  items: ProjectCertificateItem[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const editable = certificate.status === "BORRADOR";

  const iva = project.iva_pct / 100;
  const montoPresente = certificate.monto_presente;
  const montoAcumulado = certificate.monto_acumulado;
  const montoAnterior = certificate.monto_anterior;

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  async function saveQty(itemId: string, field: "qty_anterior" | "qty_presente", raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) return;
    setError(null);
    const res = await updateCertificateItem(itemId, { [field]: value });
    if (res.error) setError(res.error);
    else router.refresh();
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold">Certificado N° {certificate.numero}</div>
          <div className="text-[12px] text-[var(--muted)]">
            {formatDate(certificate.period_start)} — {formatDate(certificate.period_end)}
            {certificate.closed_at ? ` · cerrado el ${formatDate(certificate.closed_at)}` : ""}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {editable ? (
            <>
              <Button
                variant="secondary"
                disabled={pending}
                onClick={() => run(() => resyncCertificateFromExecution(certificate.id))}
              >
                Recalcular desde avance
              </Button>
              <Button
                variant="danger"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`¿Eliminar el certificado N° ${certificate.numero}?`)) {
                    run(() => deleteCertificate(certificate.id));
                  }
                }}
              >
                Eliminar
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  if (
                    window.confirm(
                      `¿Cerrar el certificado N° ${certificate.numero}? Las líneas quedan congeladas y pasan a ser el "anterior" del próximo.`
                    )
                  ) {
                    run(() => closeCertificate(certificate.id));
                  }
                }}
              >
                Cerrar certificado
              </Button>
            </>
          ) : isAdmin ? (
            <Button
              variant="secondary"
              disabled={pending}
              onClick={() => {
                if (window.confirm(`¿Reabrir el certificado N° ${certificate.numero}?`)) {
                  run(() => reopenCertificate(certificate.id));
                }
              }}
            >
              Reabrir
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Monto anterior" value={formatMoney(montoAnterior, "PYG")} />
        <Kpi label="Monto presente" value={formatMoney(montoPresente, "PYG")} />
        <Kpi label="Monto acumulado" value={formatMoney(montoAcumulado, "PYG")} />
        <Kpi label="Avance acumulado" value={pct(montoAcumulado, project.contract_amount)} />
      </div>

      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="text-[12px]">
          <thead>
            <tr>
              <th>Rubro</th>
              <th className="num">Unidad</th>
              <th className="num">Contractual</th>
              <th className="num">Anterior</th>
              <th className="num">Presente</th>
              <th className="num">Acumulada</th>
              <th className="num">%</th>
              <th className="num">Monto presente</th>
              <th className="num">Monto acumulado</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>
                  <span className="text-[var(--muted)] font-mono">{it.codigo}</span> {it.descripcion}
                </td>
                <td className="num">{it.unidad ?? "—"}</td>
                <td className="num">{formatNumber(it.qty_contractual)}</td>
                <td className="num">
                  {editable ? (
                    <input
                      type="number"
                      step="any"
                      min="0"
                      defaultValue={it.qty_anterior}
                      onBlur={(e) => {
                        if (Number(e.target.value) !== it.qty_anterior) {
                          saveQty(it.id, "qty_anterior", e.target.value);
                        }
                      }}
                      className="w-24 rounded border border-[var(--border)] bg-[var(--panel-2)] px-1.5 py-0.5 text-right"
                    />
                  ) : (
                    formatNumber(it.qty_anterior)
                  )}
                </td>
                <td className="num">
                  {editable ? (
                    <input
                      type="number"
                      step="any"
                      min="0"
                      defaultValue={it.qty_presente}
                      onBlur={(e) => {
                        if (Number(e.target.value) !== it.qty_presente) {
                          saveQty(it.id, "qty_presente", e.target.value);
                        }
                      }}
                      className="w-24 rounded border border-[var(--border)] bg-[var(--panel-2)] px-1.5 py-0.5 text-right"
                    />
                  ) : (
                    formatNumber(it.qty_presente)
                  )}
                </td>
                <td className="num">{formatNumber(it.qty_acumulada)}</td>
                <td className="num">{pct(it.qty_acumulada, it.qty_contractual)}</td>
                <td className="num">{formatMoney(it.monto_presente, "PYG")}</td>
                <td className="num">{formatMoney(it.monto_acumulado, "PYG")}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={7} className="text-right font-semibold">
                Monto del certificado (c/ IVA)
              </td>
              <td className="num font-semibold">{formatMoney(montoPresente, "PYG")}</td>
              <td className="num font-semibold">{formatMoney(montoAcumulado, "PYG")}</td>
            </tr>
            <tr>
              <td colSpan={7} className="text-right text-[var(--muted)]">
                IVA {project.iva_pct}% incluido
              </td>
              <td className="num text-[var(--muted)]">
                {formatMoney(montoPresente - montoPresente / (1 + iva), "PYG")}
              </td>
              <td className="num text-[var(--muted)]">
                {formatMoney(montoAcumulado - montoAcumulado / (1 + iva), "PYG")}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {editable ? (
        <p className="text-[11px] text-[var(--muted)]">
          Editá las cantidades y salí del campo para guardar. Al cerrar, el certificado queda congelado.
        </p>
      ) : null}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold">{value}</div>
    </div>
  );
}
