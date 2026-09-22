"use client";

import { useState } from "react";
import { FileSpreadsheet, LoaderCircle, Sparkles, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DetectedField, WorkbookInterpretationResult } from "@/lib/workbook-interpretation/types";

type FileMetadata = { name: string; size: number; sheets: string[] };

function formatBytes(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function Value({ label, field, money = false }: { label: string; field: DetectedField; money?: boolean }) {
  const value = field.value === null
    ? "No encontrado"
    : money && typeof field.value === "number"
      ? new Intl.NumberFormat("es-PY", { style: "currency", currency: "PYG", maximumFractionDigits: 0 }).format(field.value)
      : String(field.value);
  const tone = field.status === "FOUND" ? "text-emerald-300" : field.status === "UNCERTAIN" ? "text-amber-300" : "text-[var(--muted)]";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-white/[0.025] p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)]">{label}</span>
        <span className={`text-[10px] font-semibold ${tone}`}>{field.status}</span>
      </div>
      <p className="mt-1 truncate text-[13px] font-medium">{value}</p>
      {field.source ? <p className="mt-1 text-[10px] text-[var(--muted)]">{field.source.sheet}{field.source.range ? ` · ${field.source.range}` : field.source.row ? ` · fila ${field.source.row}` : ""}</p> : null}
    </div>
  );
}

function ResultPreview({ result }: { result: WorkbookInterpretationResult }) {
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-3">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-200"><Sparkles size={15} /> Qué entendió el ERP</div>
        <p className="mt-1 text-[12px] text-[var(--muted)]">{result.workbookSummary.summary}</p>
      </div>

      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">Datos generales detectados</h3>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Value label="Obra / proyecto" field={result.project.name} />
          <Value label="Código / referencia" field={result.project.code} />
          <Value label="Cliente / comitente" field={result.project.client} />
          <Value label="Contratista" field={result.project.contractor} />
          <Value label="Ubicación" field={result.project.location} />
          <Value label="Contrato" field={result.project.contractNumber} />
          <Value label="Fecha de inicio" field={result.project.startDate} />
          <Value label="Fecha de fin" field={result.project.endDate} />
          <Value label="Monto total" field={result.project.totalAmount} money />
        </div>
      </section>

      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">Contenido detectado</h3>
        <div className="mt-2 space-y-2">
          {result.detectedSections.length ? result.detectedSections.map((section, index) => (
            <div key={`${section.sheet}-${section.range}-${index}`} className="rounded-xl border border-[var(--border)] bg-white/[0.025] p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><p className="text-[13px] font-semibold">{section.title}</p><p className="mt-0.5 text-[11px] text-[var(--muted)]">{section.sheet} · {section.range} · {section.rowCount} filas</p></div>
                <span className="rounded-full bg-sky-400/10 px-2 py-1 text-[10px] font-semibold text-sky-200">{section.type} · {Math.round(section.confidence * 100)}%</span>
              </div>
              {section.columns.length ? <p className="mt-2 text-[11px] text-[var(--muted)]">Columnas: {section.columns.join(" · ")}</p> : null}
              {section.warnings.length ? <p className="mt-2 text-[11px] text-amber-200">{section.warnings.join(" · ")}</p> : null}
            </div>
          )) : <p className="rounded-xl border border-dashed border-[var(--border)] p-3 text-[12px] text-[var(--muted)]">No se detectaron bloques con confianza suficiente.</p>}
        </div>
      </section>

      {result.unknownSections.length ? <section><h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">Secciones sin clasificar</h3><div className="mt-2 space-y-1">{result.unknownSections.map((section, index) => <p key={`${section.sheet}-${section.range}-${index}`} className="rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2 text-[11px] text-amber-100"><strong>UNCERTAIN</strong> · {section.sheet} · {section.range}: {section.reason}</p>)}</div></section> : null}
      {result.warnings.length ? <section><h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">Advertencias</h3><ul className="mt-2 space-y-1 text-[11px] text-amber-100">{result.warnings.map((warning) => <li key={warning} className="flex gap-1.5"><TriangleAlert size={13} className="mt-0.5 shrink-0" />{warning}</li>)}</ul></section> : null}
      <p className="rounded-lg border border-[var(--border)] bg-white/[0.02] px-3 py-2 text-[11px] text-[var(--muted)]">Este resultado es sólo un preview. No se creó ninguna obra ni se guardaron datos.</p>
    </div>
  );
}

export function WorkbookImportPreview({ onBack }: { onBack: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [metadata, setMetadata] = useState<FileMetadata | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<WorkbookInterpretationResult | null>(null);

  async function inspectFile(selected: File | null) {
    setFile(selected);
    setMetadata(null);
    setResult(null);
    setError(null);
    if (!selected) return;
    if (!/\.(xlsx|xls|csv)$/i.test(selected.name)) {
      setError("Formato no válido. Subí un archivo .xlsx, .xls o .csv.");
      return;
    }
    if (selected.size > 10 * 1024 * 1024) {
      setError("El archivo supera el límite de 10 MB.");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await selected.arrayBuffer(), { type: "array" });
      if (!workbook.SheetNames.length) throw new Error();
      setMetadata({ name: selected.name, size: selected.size, sheets: workbook.SheetNames });
    } catch {
      setError("No se pudo abrir el archivo. Verificá que no esté dañado o protegido.");
    }
  }

  async function analyze() {
    if (!file || !metadata) return;
    setAnalyzing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/workbook-interpretation", { method: "POST", body: formData });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.result) throw new Error(payload?.error ?? "No se pudo analizar la planilla.");
      setResult(payload.result as WorkbookInterpretationResult);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo analizar la planilla.");
    } finally {
      setAnalyzing(false);
    }
  }

  if (result) return <ResultPreview result={result} />;
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-sky-300/25 bg-sky-300/[0.035] p-4 text-center">
        <FileSpreadsheet className="mx-auto text-sky-200" size={26} />
        <p className="mt-2 text-[14px] font-semibold">Subí la planilla que ya usás</p>
        <p className="mt-1 text-[12px] text-[var(--muted)]">El ERP intentará entender su estructura. No necesitás adaptar headers ni crear una obra antes.</p>
        <label className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white/[0.06] px-3.5 py-2 text-[12px] font-medium hover:bg-white/[0.1]">
          <Upload size={14} /> Elegir planilla
          <input className="sr-only" type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void inspectFile(event.target.files?.[0] ?? null)} />
        </label>
      </div>
      {error ? <p className="rounded-lg border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">{error}</p> : null}
      {metadata ? <div className="rounded-xl border border-[var(--border)] bg-white/[0.025] p-3"><p className="text-[13px] font-semibold">{metadata.name}</p><p className="mt-0.5 text-[11px] text-[var(--muted)]">{formatBytes(metadata.size)} · {metadata.sheets.length} {metadata.sheets.length === 1 ? "hoja" : "hojas"}</p><div className="mt-2 flex flex-wrap gap-1.5">{metadata.sheets.map((sheet) => <span key={sheet} className="rounded-full border border-[var(--border)] px-2 py-1 text-[10px] text-[var(--muted)]">{sheet}</span>)}</div></div> : null}
      {analyzing ? <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-5 text-[13px] text-[var(--muted)]"><LoaderCircle className="animate-spin" size={16} /> Analizando la estructura de la planilla…</div> : null}
      <div className="flex justify-between gap-2"><Button type="button" variant="secondary" onClick={onBack} disabled={analyzing}>Volver</Button><Button type="button" onClick={() => void analyze()} disabled={!metadata || analyzing}>{analyzing ? "Analizando…" : "Analizar planilla"}</Button></div>
    </div>
  );
}
