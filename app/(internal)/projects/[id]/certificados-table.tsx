"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatMoney, formatNumber, formatDate } from "@/lib/format";
import type {
  Project,
  ProjectCertificate,
  ProjectCertificateItem,
  ProjectCertificateStatus,
  ProjectCertificateStaff,
} from "@/lib/types";
import { CertificateStaffSection } from "./certificate-staff-section";
import { PasteAvanceDialog } from "./paste-avance-dialog";
import {
  updateCertificateItem,
  updateCertificateDeductions,
  submitCertificate,
  verifyCertificate,
  approveCertificate,
  markCertificateInvoiced,
  revertCertificate,
  deleteCertificate,
  resyncCertificateFromExecution,
} from "../certificado-actions";

const STATUS_LABEL: Record<ProjectCertificateStatus, string> = {
  BORRADOR: "Borrador",
  ELABORADO: "Elaborado",
  VERIFICADO: "Verificado",
  APROBADO: "Aprobado",
  FACTURADO: "Facturado",
};
const FROZEN: ProjectCertificateStatus[] = ["ELABORADO", "VERIFICADO", "APROBADO", "FACTURADO"];

function pct(part: number, whole: number): string {
  if (!(whole > 0)) return "—";
  return `${((part / whole) * 100).toFixed(2)}%`;
}

function StatusBadge({ status }: { status: ProjectCertificateStatus }) {
  const tone =
    status === "FACTURADO"
      ? "bg-[var(--primary)]/15 text-[var(--primary)]"
      : status === "APROBADO"
      ? "bg-[var(--primary)]/10 text-[var(--primary)]"
      : status === "BORRADOR"
      ? "bg-[var(--hover)] text-[var(--muted)]"
      : "bg-[var(--hover)] text-[var(--foreground)]";
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${tone}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function CertificadosTable({
  project,
  certificates,
  itemsByCert,
  staffByCert,
  isAdmin,
}: {
  project: Project;
  certificates: ProjectCertificate[];
  itemsByCert: Record<string, ProjectCertificateItem[]>;
  staffByCert: Record<string, ProjectCertificateStaff[]>;
  isAdmin: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(certificates[0]?.id ?? null);

  if (certificates.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-6 text-center text-[13px] text-[var(--muted)]">
        Sin certificados. Generá el primero con el botón de arriba — se arma con los rubros del presupuesto
        y el avance cargado en el período.
      </div>
    );
  }

  const frozen = certificates.filter((c) => FROZEN.includes(c.status));
  const anticipoTotal = (project.contract_amount * project.anticipo_pct) / 100;
  const devolucionAcum = frozen.reduce((s, c) => s + c.devolucion_anticipo, 0);
  const retencionAcum = frozen.reduce((s, c) => s + c.retencion, 0);
  const facturadoAcum = certificates
    .filter((c) => c.status === "FACTURADO")
    .reduce((s, c) => s + c.monto_liquido, 0);
  const certificadoAcum = frozen.reduce((s, c) => s + c.monto_presente, 0);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi
          label="Avance certificado"
          value={pct(certificadoAcum, project.contract_amount)}
          sub={formatMoney(certificadoAcum, "PYG")}
        />
        <Kpi
          label="Saldo de anticipo"
          value={formatMoney(Math.max(0, anticipoTotal - devolucionAcum), "PYG")}
          sub={`de ${formatMoney(anticipoTotal, "PYG")}`}
        />
        <Kpi label="Retención acumulada" value={formatMoney(retencionAcum, "PYG")} />
        <Kpi label="Facturado" value={formatMoney(facturadoAcum, "PYG")} />
      </div>

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] overflow-hidden">
        <table>
          <thead>
            <tr>
              <th className="w-8"></th>
              <th>N°</th>
              <th>Período</th>
              <th className="num">Certificado</th>
              <th className="num">Deducciones</th>
              <th className="num">Líquido a facturar</th>
              <th>Estado</th>
            </tr>
          </thead>
          <tbody>
            {certificates.map((c) => {
              const isOpen = expanded === c.id;
              const deducciones =
                c.devolucion_anticipo + c.retencion + c.penalidad_avance + c.penalidad_presentacion - c.ajustes;
              return (
                <tr key={c.id} className="cursor-pointer" onClick={() => setExpanded(isOpen ? null : c.id)}>
                  <td>{isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
                  <td className="font-medium">{c.numero}</td>
                  <td>
                    {formatDate(c.period_start)} — {formatDate(c.period_end)}
                  </td>
                  <td className="num">{formatMoney(c.monto_presente, "PYG")}</td>
                  <td className="num text-[var(--muted)]">−{formatMoney(deducciones, "PYG")}</td>
                  <td className="num font-medium">{formatMoney(c.monto_liquido, "PYG")}</td>
                  <td>
                    <StatusBadge status={c.status} />
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
          staff={staffByCert[expanded] ?? []}
          isAdmin={isAdmin}
        />
      ) : null}
    </div>
  );
}

function CertificadoDetalle({
  project,
  certificate: c,
  items,
  staff,
  isAdmin,
}: {
  project: Project;
  certificate: ProjectCertificate;
  items: ProjectCertificateItem[];
  staff: ProjectCertificateStaff[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [facturaNumero, setFacturaNumero] = useState("");
  const editableQty = c.status === "BORRADOR";
  const editableDeduc = c.status === "ELABORADO" || c.status === "VERIFICADO";

  function run(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    startTransition(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  }

  async function saveField(fn: () => Promise<{ error: string | null }>) {
    setError(null);
    const res = await fn();
    if (res.error) setError(res.error);
    else router.refresh();
  }

  const deducciones =
    c.devolucion_anticipo + c.retencion + c.penalidad_avance + c.penalidad_presentacion;

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[14px] font-semibold">Certificado N° {c.numero}</div>
          <div className="text-[12px] text-[var(--muted)]">
            {formatDate(c.period_start)} — {formatDate(c.period_end)}
          </div>
        </div>
        <WorkflowBar
          status={c.status}
          pending={pending}
          isAdmin={isAdmin}
          facturaNumero={facturaNumero}
          setFacturaNumero={setFacturaNumero}
          onSubmit={() => run(() => submitCertificate(c.id))}
          onVerify={() => run(() => verifyCertificate(c.id))}
          onApprove={() => run(() => approveCertificate(c.id))}
          onInvoice={() => run(() => markCertificateInvoiced(c.id, facturaNumero))}
          onRevert={() => run(() => revertCertificate(c.id))}
          onResync={() => run(() => resyncCertificateFromExecution(c.id))}
          onDelete={() =>
            window.confirm(`¿Eliminar el certificado N° ${c.numero}?`) && run(() => deleteCertificate(c.id))
          }
        />
      </div>

      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}

      <FirmasRow certificate={c} />

      {/* Liquidación — mismo cálculo que la hoja "resumen" del certificado oficial */}
      <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-3 text-[12px]">
        <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          Liquidación de la factura
        </div>
        <LiqRow label="Monto del certificado del mes" value={c.monto_presente} />
        <LiqRow
          label="Ajuste del mes"
          value={c.ajustes}
          editable={editableDeduc}
          onSave={(v) => saveField(() => updateCertificateDeductions(c.id, { ajustes: v }))}
        />
        <LiqRow
          label={`Devolución de anticipo${
            c.devolucion_anticipo_pct_snap != null ? ` (${c.devolucion_anticipo_pct_snap}%)` : ""
          }`}
          value={-c.devolucion_anticipo}
        />
        <LiqRow
          label={`Retención${c.retencion_pct_snap != null ? ` (${c.retencion_pct_snap}%)` : ""}`}
          value={-c.retencion}
        />
        <LiqRow
          label="Penalidad de avance"
          value={-c.penalidad_avance}
          editable={editableDeduc}
          onSave={(v) => saveField(() => updateCertificateDeductions(c.id, { penalidad_avance: v }))}
        />
        <LiqRow
          label="Penalidad de presentación"
          value={-c.penalidad_presentacion}
          editable={editableDeduc}
          onSave={(v) => saveField(() => updateCertificateDeductions(c.id, { penalidad_presentacion: v }))}
        />
        <div className="mt-1.5 flex items-center justify-between border-t border-[var(--border)] pt-1.5 font-semibold">
          <span>Monto líquido de la factura</span>
          <span>{formatMoney(c.monto_liquido, "PYG")}</span>
        </div>
        {c.status === "BORRADOR" ? (
          <p className="mt-1.5 text-[11px] text-[var(--muted)]">
            La devolución de anticipo y la retención se calculan al elaborar el certificado.
          </p>
        ) : null}
      </div>

      {/* Líneas por rubro */}
      {editableQty ? (
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-[var(--muted)]">
            Cargá la columna &quot;presente&quot; a mano, o pegala desde el Excel de medición →
          </span>
          <PasteAvanceDialog certificateId={c.id} items={items} />
        </div>
      ) : null}
      <div className="overflow-x-auto rounded border border-[var(--border)]">
        <table className="text-[12px]">
          <thead>
            <tr>
              <th>Rubro</th>
              <th className="num">Unidad</th>
              <th className="num">Contractual</th>
              <th className="num">Anterior</th>
              <th className="num">Presente</th>
              <th className="num">Acum.</th>
              <th className="num">%</th>
              <th className="num">Monto presente</th>
              <th className="num">Monto acum.</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>
                  <span className="font-mono text-[var(--muted)]">{it.codigo}</span> {it.descripcion}
                </td>
                <td className="num">{it.unidad ?? "—"}</td>
                <td className="num">{formatNumber(it.qty_contractual)}</td>
                <td className="num">
                  {editableQty ? (
                    <QtyInput
                      value={it.qty_anterior}
                      onSave={(v) => saveField(() => updateCertificateItem(it.id, { qty_anterior: v }))}
                    />
                  ) : (
                    formatNumber(it.qty_anterior)
                  )}
                </td>
                <td className="num">
                  {editableQty ? (
                    <QtyInput
                      value={it.qty_presente}
                      onSave={(v) => saveField(() => updateCertificateItem(it.id, { qty_presente: v }))}
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
                Monto del certificado (c/ IVA {project.iva_pct}%)
              </td>
              <td className="num font-semibold">{formatMoney(c.monto_presente, "PYG")}</td>
              <td className="num font-semibold">{formatMoney(c.monto_acumulado, "PYG")}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <CertificateStaffSection
        certificateId={c.id}
        staff={staff}
        editable={c.status !== "FACTURADO"}
      />

      {editableQty ? (
        <p className="text-[11px] text-[var(--muted)]">
          Editá las cantidades y salí del campo para guardar. Al elaborar, el certificado se congela.
        </p>
      ) : null}
      {deducciones > 0 && c.status === "APROBADO" ? (
        <p className="text-[11px] text-[var(--muted)]">
          Aprobado. Marcá &quot;Facturado&quot; cuando emitas la factura por {formatMoney(c.monto_liquido, "PYG")}.
        </p>
      ) : null}
    </div>
  );
}

function WorkflowBar({
  status,
  pending,
  isAdmin,
  facturaNumero,
  setFacturaNumero,
  onSubmit,
  onVerify,
  onApprove,
  onInvoice,
  onRevert,
  onResync,
  onDelete,
}: {
  status: ProjectCertificateStatus;
  pending: boolean;
  isAdmin: boolean;
  facturaNumero: string;
  setFacturaNumero: (v: string) => void;
  onSubmit: () => void;
  onVerify: () => void;
  onApprove: () => void;
  onInvoice: () => void;
  onRevert: () => void;
  onResync: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "BORRADOR" ? (
        <>
          <Button variant="secondary" disabled={pending} onClick={onResync}>
            Recalcular desde avance
          </Button>
          <Button variant="danger" disabled={pending} onClick={onDelete}>
            Eliminar
          </Button>
          <Button disabled={pending} onClick={onSubmit}>
            Elaborar
          </Button>
        </>
      ) : null}
      {status === "ELABORADO" ? (
        <Button disabled={pending} onClick={onVerify}>
          Marcar verificado
        </Button>
      ) : null}
      {status === "VERIFICADO" ? (
        <Button disabled={pending} onClick={onApprove}>
          Aprobar
        </Button>
      ) : null}
      {status === "APROBADO" ? (
        <>
          <Input
            placeholder="N° de factura"
            value={facturaNumero}
            onChange={(e) => setFacturaNumero(e.target.value)}
            className="h-8 w-36"
          />
          <Button disabled={pending || !facturaNumero.trim()} onClick={onInvoice}>
            Marcar facturado
          </Button>
        </>
      ) : null}
      {status !== "BORRADOR" && isAdmin ? (
        <Button variant="ghost" disabled={pending} onClick={onRevert}>
          Retroceder
        </Button>
      ) : null}
    </div>
  );
}

function FirmasRow({ certificate: c }: { certificate: ProjectCertificate }) {
  const steps: { label: string; at: string | null }[] = [
    { label: "Elaborado", at: c.elaborado_at },
    { label: "Verificado", at: c.verificado_at },
    { label: "Aprobado", at: c.aprobado_at },
    { label: "Facturado", at: c.facturado_at },
  ];
  return (
    <div className="flex flex-wrap gap-3 text-[11px]">
      {steps.map((s) => (
        <div
          key={s.label}
          className={`rounded border px-2 py-1 ${
            s.at
              ? "border-[var(--primary)]/30 text-[var(--foreground)]"
              : "border-[var(--border)] text-[var(--muted)]"
          }`}
        >
          <div className="font-medium">{s.label}</div>
          <div>{s.at ? formatDate(s.at) : "—"}</div>
        </div>
      ))}
    </div>
  );
}

function LiqRow({
  label,
  value,
  editable,
  onSave,
}: {
  label: string;
  value: number;
  editable?: boolean;
  onSave?: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[var(--muted)]">{label}</span>
      {editable && onSave ? (
        <input
          type="number"
          step="any"
          min="0"
          defaultValue={Math.abs(value)}
          onBlur={(e) => {
            const v = Number(e.target.value);
            if (Number.isFinite(v) && v !== Math.abs(value)) onSave(v);
          }}
          className="w-32 rounded border border-[var(--border)] bg-[var(--panel)] px-1.5 py-0.5 text-right"
        />
      ) : (
        <span className={value < 0 ? "text-[var(--muted)]" : ""}>
          {value < 0 ? "−" : ""}
          {formatMoney(Math.abs(value), "PYG")}
        </span>
      )}
    </div>
  );
}

function QtyInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  return (
    <input
      type="number"
      step="any"
      min="0"
      defaultValue={value}
      onBlur={(e) => {
        const v = Number(e.target.value);
        if (Number.isFinite(v) && v >= 0 && v !== value) onSave(v);
      }}
      className="w-24 rounded border border-[var(--border)] bg-[var(--panel-2)] px-1.5 py-0.5 text-right"
    />
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] p-2.5">
      <div className="text-[10px] uppercase tracking-wide text-[var(--muted)]">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold">{value}</div>
      {sub ? <div className="text-[10px] text-[var(--muted)]">{sub}</div> : null}
    </div>
  );
}
