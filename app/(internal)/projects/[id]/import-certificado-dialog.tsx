"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import type { CertificateBudgetItem, CertificateWorkbookRow } from "@/lib/certificates/workbook-import";
import { importCertificateWorkbook } from "../certificado-actions";

type PreviewRow = CertificateWorkbookRow & { budgetItemId: string | null; match: "MATCHED" | "NEEDS_REVIEW" };
type Preview = {
  plan: unknown;
  certificate: { number: number; periodStart: string; periodEnd: string; sheet: string; planNeedsReview: boolean; warnings: string[] };
  rows: PreviewRow[];
  budgetItems: CertificateBudgetItem[];
  previousQuantityByBudgetItem: Record<string, number>;
  nextNumber: number;
  predecessorStatus: string | null;
  sequenceValid: boolean;
  existingImport: { id: string; number: number } | null;
};

function money(value: number) {
  return new Intl.NumberFormat("es-PY", { style: "currency", currency: "PYG", maximumFractionDigits: 0 }).format(value);
}

function number(value: number) {
  return new Intl.NumberFormat("es-PY", { maximumFractionDigits: 4 }).format(value);
}

export function ImportCertificadoDialog({
  projectId,
  onImported,
}: {
  projectId: string;
  onImported: (certificateId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [mappings, setMappings] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmDiscrepancies, setConfirmDiscrepancies] = useState(false);
  const [dragging, setDragging] = useState(false);
  const router = useRouter();

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setPreview(null);
    setMappings({});
    setError(null);
    setConfirmDiscrepancies(false);
  }

  async function analyzeFile(selected = file) {
    if (!selected) {
      setError("Elegí el archivo XLSX del certificado.");
      return;
    }
    if (!/\.xlsx$/i.test(selected.name)) {
      setError("Por ahora se acepta únicamente un archivo .xlsx.");
      return;
    }
    setAnalyzing(true);
    setError(null);
    setPreview(null);
    try {
      const body = new FormData();
      body.set("target", "project-certificate");
      body.set("project_id", projectId);
      body.set("file", selected);
      const response = await fetch("/api/workbook-interpretation", { method: "POST", body });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.rows) throw new Error(payload?.error ?? "No se pudo analizar el certificado.");
      const result = payload as Preview;
      setPreview(result);
      setMappings(Object.fromEntries(result.rows.map((row) => [row.sourceRow, row.budgetItemId ?? ""])));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo analizar el certificado.");
    } finally {
      setAnalyzing(false);
    }
  }

  const budgetById = useMemo(() => new Map((preview?.budgetItems ?? []).map((item) => [item.id, item])), [preview?.budgetItems]);
  const selectedIds = preview?.rows.map((row) => mappings[row.sourceRow]).filter(Boolean) ?? [];
  const duplicateIds = new Set(selectedIds.filter((id, index) => selectedIds.indexOf(id) !== index));
  const linkedCount = preview?.rows.filter((row) => Boolean(mappings[row.sourceRow])).length ?? 0;
  const currentTotal = preview?.rows.reduce((sum, row) => sum + Math.round(row.quantityCurrent * row.unitPrice), 0) ?? 0;

  const mismatches = preview?.rows.flatMap((row) => {
    const selectedId = mappings[row.sourceRow];
    const budgetItem = selectedId ? budgetById.get(selectedId) : null;
    if (!budgetItem) return [];
    const issues: string[] = [];
    if (budgetItem.quantity !== null && Number(budgetItem.quantity) !== row.quantityContractual) issues.push(`cantidad contractual distinta al presupuesto (fila ${row.sourceRow})`);
    if (budgetItem.unit_price !== null && Number(budgetItem.unit_price) !== row.unitPrice) issues.push(`precio unitario distinto al presupuesto (fila ${row.sourceRow})`);
    if (row.amountCurrent !== null && Math.round(row.quantityCurrent * row.unitPrice) !== row.amountCurrent) issues.push(`monto presente del XLSX difiere del recálculo (fila ${row.sourceRow})`);
    if (row.quantityCumulative !== row.quantityPrevious + row.quantityCurrent) issues.push(`acumulado del XLSX no coincide con anterior + presente (fila ${row.sourceRow})`);
    return issues;
  }) ?? [];
  const previousMismatches = preview?.rows.filter((row) => {
    const id = mappings[row.sourceRow];
    return id && Number(preview.previousQuantityByBudgetItem[id] ?? 0) !== row.quantityPrevious;
  }) ?? [];
  const needsAcknowledgement = Boolean(preview?.certificate.planNeedsReview || mismatches.length);
  const canImport = Boolean(
    file && preview && !analyzing && !pending && (
      preview.existingImport
      || (linkedCount === preview.rows.length && duplicateIds.size === 0
        && preview.sequenceValid && previousMismatches.length === 0
        && (!needsAcknowledgement || confirmDiscrepancies))
    ),
  );

  async function confirmImport() {
    if (!file || !preview || !canImport) return;
    setPending(true);
    setError(null);
    const formData = new FormData();
    formData.set("file", file);
    formData.set("plan_json", JSON.stringify(preview.plan));
    formData.set("mappings_json", JSON.stringify(preview.rows.map((row) => ({ sourceRow: row.sourceRow, budgetItemId: mappings[row.sourceRow] }))));
    if (confirmDiscrepancies) formData.set("confirm_discrepancies", "on");
    try {
      const result = await importCertificateWorkbook(projectId, formData);
      if (result.error || !result.id) {
        setError(result.error ?? "No se pudo importar el certificado.");
        return;
      }
      setOpen(false);
      onImported(result.id);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) selectFile(null);
    }}>
      <DialogTrigger asChild>
        <Button variant="secondary">Importar certificado</Button>
      </DialogTrigger>
      <DialogContent title="Importar certificado de avance" className="max-w-5xl">
        <div className="space-y-4">
          <p className="text-[12px] text-[var(--muted)]">Importá un certificado XLSX en esta obra existente. El análisis no crea ni modifica datos; primero revisás el vínculo con el presupuesto.</p>

          <div
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              selectFile(event.dataTransfer.files[0] ?? null);
            }}
            className={`rounded-xl border border-dashed p-4 text-center ${dragging ? "border-[var(--primary)] bg-[var(--primary)]/10" : "border-[var(--border)] bg-white/[0.02]"}`}
          >
            <Upload className="mx-auto mb-2 text-[var(--muted)]" size={20} />
            <Label htmlFor="certificate_xlsx" className="cursor-pointer text-[12px] font-medium">Arrastrá el XLSX acá o seleccioná el archivo</Label>
            <Input id="certificate_xlsx" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => selectFile(event.target.files?.[0] ?? null)} />
            {file ? <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-[var(--muted)]"><FileSpreadsheet size={14} />{file.name}</p> : null}
            {file && !preview ? <div className="mt-3"><Button type="button" onClick={() => void analyzeFile()} disabled={analyzing}>{analyzing ? "Analizando XLSX…" : "Analizar y mostrar preview"}</Button></div> : null}
          </div>

          {error ? <p role="alert" className="rounded-lg border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">{error}</p> : null}

          {preview ? (
            <div className="space-y-3">
              <div className="grid gap-2 rounded-xl border border-[var(--border)] bg-white/[0.025] p-3 text-[12px] sm:grid-cols-4">
                <p>Certificado: <strong>#{preview.certificate.number}</strong>{preview.existingImport ? ` · ya importado #${preview.existingImport.number}` : ""}</p>
                <p>Período: <strong>{preview.certificate.periodStart} — {preview.certificate.periodEnd}</strong></p>
                <p>Hoja: <strong>{preview.certificate.sheet}</strong></p>
                <p>Secuencia: <strong className={preview.sequenceValid ? "text-emerald-300" : "text-amber-300"}>{preview.sequenceValid ? `válida · próximo #${preview.nextNumber}` : `bloqueada · se espera #${preview.nextNumber}`}</strong></p>
              </div>

              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--muted)]">
                <span>Detectadas: <strong>{preview.rows.length}</strong></span>
                <span>Vinculadas: <strong>{linkedCount}</strong></span>
                <span>Sin vincular: <strong>{preview.rows.length - linkedCount}</strong></span>
                <span>Monto presente recalculado: <strong>{money(currentTotal)}</strong></span>
              </div>

              {preview.certificate.warnings.length ? <div className="rounded-lg border border-amber-300/20 bg-amber-300/[0.05] p-2 text-[11px] text-amber-100">{preview.certificate.warnings.join(" · ")}</div> : null}

              <div className="max-h-[38vh] overflow-auto rounded-xl border border-[var(--border)]">
                <table className="min-w-[1050px]">
                  <thead><tr><th>Partida XLSX</th><th>Vincular con presupuesto</th><th className="num">Anterior</th><th className="num">Presente</th><th className="num">P. unitario</th><th className="num">Monto presente</th><th className="num">Estado</th></tr></thead>
                  <tbody>
                    {preview.rows.map((row) => {
                      const selectedId = mappings[row.sourceRow] ?? "";
                      const budget = selectedId ? budgetById.get(selectedId) : null;
                      const previousMismatch = Boolean(selectedId && Number(preview.previousQuantityByBudgetItem[selectedId] ?? 0) !== row.quantityPrevious);
                      return (
                        <tr key={`${row.sourceRow}-${row.code ?? "line"}`}>
                          <td><div className="font-medium">{row.code ? `${row.code} · ` : ""}{row.description}</div><div className="text-[10px] text-[var(--muted)]">Fila {row.sourceRow} · {row.unit ?? "sin unidad"} · contractual {number(row.quantityContractual)}</div></td>
                          <td>
                            <select
                              aria-label={`Partida de presupuesto para ${row.code ?? row.description}`}
                              value={selectedId}
                              onChange={(event) => setMappings((current) => ({ ...current, [row.sourceRow]: event.target.value }))}
                              className="w-full min-w-64 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2 py-1.5 text-[11px]"
                            >
                              <option value="">Seleccionar partida…</option>
                              {preview.budgetItems.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.description} ({item.unit ?? "sin unidad"})</option>)}
                            </select>
                            {budget ? <span className="text-[10px] text-[var(--muted)]">{budget.code} · {budget.description}</span> : null}
                          </td>
                          <td className={`num ${previousMismatch ? "text-amber-300" : ""}`}>{number(row.quantityPrevious)}</td>
                          <td className="num">{number(row.quantityCurrent)}</td>
                          <td className="num">{money(row.unitPrice)}</td>
                          <td className="num">{money(Math.round(row.quantityCurrent * row.unitPrice))}{row.amountCurrent !== null && row.amountCurrent !== Math.round(row.quantityCurrent * row.unitPrice) ? <div className="text-[10px] text-amber-300">XLSX: {money(row.amountCurrent)}</div> : null}</td>
                          <td className="num">{duplicateIds.has(selectedId) ? <span className="text-amber-300">Duplicada</span> : previousMismatch ? <span className="text-amber-300">Anterior difiere</span> : selectedId ? <span className="text-emerald-300">Vinculada</span> : <span className="text-amber-300">Revisar</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {previousMismatches.length ? <p className="rounded-lg border border-amber-300/25 bg-amber-300/[0.05] p-2 text-[11px] text-amber-100">La cantidad anterior del XLSX no coincide con el acumulado canónico de la obra en {previousMismatches.length} partida(s). La importación queda bloqueada hasta resolver la diferencia.</p> : null}
              {!preview.sequenceValid ? <p className="rounded-lg border border-amber-300/25 bg-amber-300/[0.05] p-2 text-[11px] text-amber-100">El certificado del archivo no sigue la secuencia o el certificado anterior todavía no está aprobado/facturado. No se guardará.</p> : null}
              {duplicateIds.size ? <p className="rounded-lg border border-amber-300/25 bg-amber-300/[0.05] p-2 text-[11px] text-amber-100">Una partida del presupuesto está vinculada más de una vez. Cada partida se puede usar una sola vez por certificado.</p> : null}

              {needsAcknowledgement ? (
                <label className="flex items-start gap-2 rounded-lg border border-amber-300/20 bg-amber-300/[0.04] p-2 text-[11px] text-amber-100">
                  <input type="checkbox" checked={confirmDiscrepancies} onChange={(event) => setConfirmDiscrepancies(event.target.checked)} className="mt-0.5" />
                  <span><AlertTriangle size={13} className="mr-1 inline" />Revisé las diferencias. Acepto los valores contractuales/precios del XLSX y que los montos canónicos se recalculen desde cantidades y precio unitario.</span>
                </label>
              ) : null}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setOpen(false)} disabled={pending}>Cancelar</Button>
                <Button type="button" onClick={() => void confirmImport()} disabled={!canImport}>
                  {pending ? "Importando…" : preview.existingImport ? "Abrir certificado existente" : "Confirmar importación · BORRADOR"}
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
