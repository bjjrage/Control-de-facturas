"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileSpreadsheet, Link2, LoaderCircle, Sparkles, TriangleAlert, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { createProjectFromWorkbook } from "./actions";
import { getImportSession, saveImportSessionSnapshot, discardImportSession, type ImportSessionView } from "./import-session-actions";
import { CertificateWorkbookGrid } from "@/components/certificates/CertificateWorkbookGrid";
import type { WorkingSnapshot } from "@/lib/certificates/workbook-store";
import type { ContractRegime } from "@/lib/certificates/import-session-store";
import type { CanonicalImportCandidate } from "@/lib/workbook-interpretation/canonical-import";
import type { DetectedField, WorkbookInterpretationResult } from "@/lib/workbook-interpretation/types";

function formatMoney(value: number | null) {
  return value === null ? "—" : new Intl.NumberFormat("es-PY", { style: "currency", currency: "PYG", maximumFractionDigits: 0 }).format(value);
}

const RELATIONSHIP_LABEL: Record<string, string> = {
  SAME_ITEMS: "mismas partidas",
  CONTRACT_SCALE: "escala contractual",
  SUMMARIZES: "resume",
  HISTORICAL_SERIES: "serie histórica",
  SUPPORTS: "respalda",
};

function weatherByMonth(days: CanonicalImportCandidate["weatherDays"]) {
  const byMonth = new Map<string, { B: number; LL: number; HH: number; O: number }>();
  for (const day of days) {
    const month = day.date.slice(0, 7);
    const counts = byMonth.get(month) ?? { B: 0, LL: 0, HH: 0, O: 0 };
    counts[day.code]++;
    byMonth.set(month, counts);
  }
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function CandidatePreview({ candidate }: { candidate: CanonicalImportCandidate }) {
  return (
    <>
      {candidate.relationships.length ? (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">Relaciones entre hojas</h3>
          <div className="mt-2 space-y-1.5">
            {candidate.relationships.map((relationship, index) => (
              <div key={`${relationship.from}-${relationship.to}-${index}`} className="rounded-lg border border-[var(--border)] bg-white/[0.025] px-3 py-2 text-[12px]">
                <p className="flex flex-wrap items-center gap-1.5"><Link2 size={13} className="text-sky-200" /><strong>{relationship.fromLabel}</strong> → <strong>{relationship.toLabel}</strong><span className="rounded-full bg-sky-400/10 px-2 py-0.5 text-[10px] font-semibold text-sky-200">{RELATIONSHIP_LABEL[relationship.type] ?? relationship.type}{relationship.factor ? ` ×${relationship.factor}` : ""}</span></p>
                {relationship.evidence ? <p className="mt-1 text-[11px] text-[var(--muted)]">{relationship.evidence}</p> : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {candidate.checks.length ? (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">Verificación aritmética</h3>
          <ul className="mt-2 space-y-1 text-[11px]">
            {candidate.checks.map((check) => (
              <li key={check.id} className={`flex gap-1.5 ${check.status === "OK" ? "text-emerald-200" : "text-amber-100"}`}>
                {check.status === "OK" ? <CheckCircle2 size={13} className="mt-0.5 shrink-0" /> : <TriangleAlert size={13} className="mt-0.5 shrink-0" />}
                <span><strong>{check.label}</strong> — {check.detail}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
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

function ResultPreview({ result, candidate }: { result: WorkbookInterpretationResult; candidate: CanonicalImportCandidate | null }) {
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

      {candidate ? <CandidatePreview candidate={candidate} /> : null}

      <section>
        <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">Plan de importación y cobertura</h3>
        <div className="mt-2 space-y-2">
          {result.importPlan.blocks.length ? result.importPlan.blocks.map((block) => {
            const coverage = result.coverage.find((item) => item.blockId === block.id);
            const requiresReview = block.needsReview || Boolean(coverage?.pendingRows.length || coverage?.unmappedRows.length);
            return (
              <div key={block.id} className="rounded-xl border border-[var(--border)] bg-white/[0.025] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><p className="text-[13px] font-semibold">{block.target}</p><p className="mt-0.5 text-[11px] text-[var(--muted)]">{block.sheet} · {block.sourceRange} · datos {block.dataRowStart}–{block.dataRowEnd}</p></div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${requiresReview ? "bg-amber-400/10 text-amber-200" : "bg-emerald-400/10 text-emerald-200"}`}>{requiresReview ? "REQUIERE REVISIÓN" : "LISTO PARA PREVIEW"}</span>
                </div>
                {coverage ? <p className="mt-2 text-[11px] text-[var(--muted)]">Filas fuente: {coverage.sourceRows} · procesadas: {coverage.processedRows} · excluidas: {coverage.excludedRows.length} · pendientes: {coverage.pendingRows.length} · sin mapear: {coverage.unmappedRows.length}</p> : null}
                {block.columnMappings.length ? <p className="mt-1 text-[11px] text-[var(--muted)]">{block.columnMappings.map((mapping) => `${mapping.column} → ${mapping.role}`).join(" · ")}</p> : null}
              </div>
            );
          }) : <p className="rounded-xl border border-dashed border-[var(--border)] p-3 text-[12px] text-[var(--muted)]">No se generaron bloques interpretables.</p>}
        </div>
      </section>

      {result.unknownSections.length ? <section><h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">Secciones sin clasificar</h3><div className="mt-2 space-y-1">{result.unknownSections.map((section, index) => <p key={`${section.sheet}-${section.range}-${index}`} className="rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2 text-[11px] text-amber-100"><strong>UNCERTAIN</strong> · {section.sheet} · {section.range}: {section.reason}</p>)}</div></section> : null}
      {result.warnings.length ? <section><h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">Advertencias</h3><ul className="mt-2 space-y-1 text-[11px] text-amber-100">{result.warnings.map((warning) => <li key={warning} className="flex gap-1.5"><TriangleAlert size={13} className="mt-0.5 shrink-0" />{warning}</li>)}</ul></section> : null}
      <p className="rounded-lg border border-[var(--border)] bg-white/[0.02] px-3 py-2 text-[11px] text-[var(--muted)]">Este resultado es sólo un preview. No se creó ninguna obra ni se guardaron datos.</p>
    </div>
  );
}

const CERTIFICATE_STATUS: Record<CanonicalImportCandidate["certificate"]["status"], { label: string; tone: string }> = {
  SAFE_TO_APPLY: { label: "verificado", tone: "text-emerald-200" },
  APPLY_WITH_WARNINGS: { label: "con observaciones", tone: "text-amber-200" },
  DETECTED_NOT_APPLIED: { label: "no aplicable", tone: "text-amber-200" },
  NOT_DETECTED: { label: "no detectado", tone: "text-[var(--muted)]" },
};

function ResultActions({
  result,
  candidate,
  applyCertificate,
  onApplyCertificate,
  applyStaff,
  onApplyStaff,
  applySchedule,
  onApplySchedule,
  applyWeather,
  onApplyWeather,
  applyExecution,
  onApplyExecution,
  nameOverride,
  codeOverride,
  onNameOverride,
  onCodeOverride,
  onCreate,
  creating,
  error,
  onBack,
}: {
  result: WorkbookInterpretationResult;
  candidate: CanonicalImportCandidate | null;
  applyCertificate: boolean;
  onApplyCertificate: (value: boolean) => void;
  applyStaff: boolean;
  onApplyStaff: (value: boolean) => void;
  applySchedule: boolean;
  onApplySchedule: (value: boolean) => void;
  applyWeather: boolean;
  onApplyWeather: (value: boolean) => void;
  applyExecution: boolean;
  onApplyExecution: (value: boolean) => void;
  nameOverride: string;
  codeOverride: string;
  onNameOverride: (value: string) => void;
  onCodeOverride: (value: string) => void;
  onCreate: () => void;
  creating: boolean;
  error: string | null;
  onBack: () => void;
}) {
  const nameMissing = result.project.name.status === "NOT_FOUND" || result.project.name.value === null;
  const codeMissing = result.project.code.status === "NOT_FOUND" || result.project.code.value === null;
  const certificate = candidate?.certificate;
  const certificateApplicable = certificate?.status === "SAFE_TO_APPLY" || certificate?.status === "APPLY_WITH_WARNINGS";
  return (
    <section className="space-y-3 rounded-xl border border-sky-300/20 bg-sky-300/[0.04] p-3">
      <h3 className="text-[11px] font-bold uppercase tracking-widest text-sky-100">Qué se importa al ERP</h3>
      <div className="space-y-2 text-[12px]">
        <p>
          Presupuesto: <strong>{candidate?.budgetItems.length ?? result.budgetItems.length} partidas</strong>
          {candidate ? <> · total {formatMoney(candidate.budgetTotal)}</> : null}
          {candidate?.scale ? <span className="text-[var(--muted)]"> · cantidades de contrato (×{candidate.scale.factor} sobre {candidate.scale.fromBlock})</span> : null}
        </p>
        {certificate && certificate.status !== "NOT_DETECTED" ? (
          <div className="rounded-lg border border-[var(--border)] bg-white/[0.025] p-2.5">
            <p>
              Certificado{certificate.number !== null ? ` N°${certificate.number}` : ""}: <strong className={CERTIFICATE_STATUS[certificate.status].tone}>{CERTIFICATE_STATUS[certificate.status].label}</strong>
              {certificate.itemCount ? <> · {certificate.itemCount} líneas · {certificate.matchedBudgetItems} vinculadas al presupuesto</> : null}
            </p>
            {certificate.itemCount ? (
              <p className="mt-1 text-[11px] text-[var(--muted)]">
                {certificate.periodStart && certificate.periodEnd ? `Período ${certificate.periodStart} → ${certificate.periodEnd} · ` : ""}
                Contrato {formatMoney(certificate.contractTotal)} · acumulado {formatMoney(certificate.cumulativeTotal)}
                {certificate.cumulativePercent !== null ? ` (${(certificate.cumulativePercent * 100).toFixed(2)}%)` : ""}
              </p>
            ) : null}
            {certificate.status !== "SAFE_TO_APPLY" ? <p className="mt-1 text-[11px] text-amber-100">{certificate.reason}</p> : null}
            {certificate.issues.length ? <ul className="mt-1 space-y-0.5 text-[11px] text-amber-100">{certificate.issues.map((issue) => <li key={issue}>· {issue}</li>)}</ul> : null}
            {certificateApplicable ? (
              <label className="mt-2 flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={applyCertificate} onChange={(event) => onApplyCertificate(event.target.checked)} />
                Importar este certificado {certificate.status === "APPLY_WITH_WARNINGS" ? "a pesar de las observaciones" : ""}
              </label>
            ) : null}
          </div>
        ) : null}
        {candidate?.staff.length ? (
          <div className="rounded-lg border border-[var(--border)] bg-white/[0.025] p-2.5">
            <p>Personal: <strong>{candidate.staff.length} persona(s)</strong> detectadas en el período del certificado.</p>
            <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto text-[11px] text-[var(--muted)]">
              {candidate.staff.map((person) => <li key={`${person.sheet}-${person.row}`}>· {person.name} — {person.role}</li>)}
            </ul>
            <label className="mt-2 flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={applyStaff} onChange={(event) => onApplyStaff(event.target.checked)} />
              Importar personal al certificado
            </label>
          </div>
        ) : null}
        {candidate?.schedulePlans.length ? (
          <div className="rounded-lg border border-[var(--border)] bg-white/[0.025] p-2.5">
            <p>Curva S: <strong>{candidate.schedulePlans.length} versión(es)</strong> de plan programado.</p>
            <ul className="mt-1 space-y-1 text-[11px] text-[var(--muted)]">
              {candidate.schedulePlans.map((plan) => (
                <li key={plan.planVersion}>
                  · <strong className="text-[var(--foreground)]">{plan.planVersion}</strong>: {plan.months.map((m) => `M${m.monthIndex}=${m.programadoPct.toFixed(1)}%`).join(" · ")}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[11px] text-[var(--muted)]">Solo se importa lo programado; el ERP calcula el ejecutado desde sus propios certificados.</p>
            <label className="mt-2 flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={applySchedule} onChange={(event) => onApplySchedule(event.target.checked)} />
              Importar curva de avance programada
            </label>
          </div>
        ) : null}
        {candidate?.weatherDays.length ? (
          <div className="rounded-lg border border-[var(--border)] bg-white/[0.025] p-2.5">
            <p>Días no trabajados: <strong>{candidate.weatherDays.length} día(s)</strong> del Libro de Obra ({candidate.weatherDays[0].date} → {candidate.weatherDays.at(-1)!.date}).</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
              {weatherByMonth(candidate.weatherDays).map(([month, counts]) => (
                <li key={month}>· {month}: B {counts.B} · LL {counts.LL} · HH {counts.HH} · O {counts.O}</li>
              ))}
            </ul>
            <label className="mt-2 flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={applyWeather} onChange={(event) => onApplyWeather(event.target.checked)} />
              Importar Libro de Obra (días no trabajados)
            </label>
          </div>
        ) : null}
        {candidate?.executionEntries.length ? (
          <div className="rounded-lg border border-[var(--border)] bg-white/[0.025] p-2.5">
            <p>
              Avance físico (registro LDO): <strong>{candidate.executionEntries.filter((e) => e.matchedBudgetCode).length} rubro(s)</strong> vinculados
              {candidate.executionEntries.some((e) => !e.matchedBudgetCode) ? <span className="text-amber-100"> · {candidate.executionEntries.filter((e) => !e.matchedBudgetCode).length} sin vínculo (no se importan)</span> : null}.
            </p>
            <p className="mt-1 text-[11px] text-[var(--muted)]">Se carga con fecha de cierre del certificado ({candidate.certificate.periodEnd ?? "—"}).</p>
            <label className="mt-2 flex items-center gap-2 text-[12px]">
              <input type="checkbox" checked={applyExecution} onChange={(event) => onApplyExecution(event.target.checked)} disabled={!applyCertificate} />
              Importar avance físico {!applyCertificate ? "(requiere importar el certificado)" : ""}
            </label>
          </div>
        ) : null}
        {candidate?.domains.length ? (
          <div>
            <p>Detectado, todavía sin importar:</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
              {candidate.domains.map((domain) => (
                <li key={domain.target}>
                  · <strong className="text-[var(--foreground)]">{domain.target}</strong> — {domain.labels.join(" · ")} ({domain.sheets.join(", ")})
                  {domain.warnings.length ? <span className="text-amber-100"> · {domain.warnings.join(" · ")}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {candidate?.foreignBlocks.length ? (
          <div>
            <p>De otra obra (se muestra, no se importa):</p>
            <ul className="mt-1 space-y-0.5 text-[11px] text-[var(--muted)]">
              {candidate.foreignBlocks.map((block) => (
                <li key={`${block.sheet}-${block.label}`}>
                  · <strong className="text-[var(--foreground)]">{block.sheet}</strong> — {block.label}
                  {block.warnings.length ? <span className="text-amber-100"> · {block.warnings[0]}</span> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      {nameMissing || codeMissing ? (
        <div className="rounded-lg border border-amber-300/25 bg-amber-300/[0.04] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-100">Completar dato crítico</p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">El archivo no aportó un identificador suficiente. Completá sólo lo faltante.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {nameMissing ? <div><Label htmlFor="workbook_name_override">Nombre de obra</Label><Input id="workbook_name_override" value={nameOverride} onChange={(event) => onNameOverride(event.target.value)} /></div> : null}
            {codeMissing ? <div><Label htmlFor="workbook_code_override">Código de obra</Label><Input id="workbook_code_override" value={codeOverride} onChange={(event) => onCodeOverride(event.target.value)} /></div> : null}
          </div>
        </div>
      ) : null}
      {error ? <p className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">{error}</p> : null}
      <div className="flex justify-between gap-2 pt-1">
        <Button type="button" variant="secondary" onClick={onBack} disabled={creating}>Volver</Button>
        <Button type="button" onClick={onCreate} disabled={creating || (nameMissing && !nameOverride.trim()) || (codeMissing && !codeOverride.trim())}>
          {creating ? "Creando obra…" : "Crear obra con estos datos"}
        </Button>
      </div>
    </section>
  );
}

const REGIME_OPTIONS: { value: ContractRegime; label: string }[] = [
  { value: "PUBLIC_WORK", label: "Obra pública (certificados, anticipo, retención)" },
  { value: "PRIVATE_WORK", label: "Obra privada" },
  { value: "OTHER", label: "Otro" },
];

/**
 * Fase 4 de "Certificados Excel-first" — obra nueva: el Excel se guarda al
 * instante en una sesión de importación (sin crear ningún project) y la
 * planilla se ve y se edita mientras Luna analiza en segundo plano. La obra
 * se crea recién cuando el usuario confirma. Ver [[excel-first-certificados]],
 * Corrección 1: "no queremos projects basura, placeholders, nombres
 * inventados o obras creadas por un archivo equivocado".
 */
export function WorkbookImportPreview({ onBack }: { onBack: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [session, setSession] = useState<ImportSessionView | null>(null);
  const [regime, setRegime] = useState<ContractRegime | "">("");
  const [applyCertificate, setApplyCertificate] = useState(false);
  const [applyStaff, setApplyStaff] = useState(true);
  const [applySchedule, setApplySchedule] = useState(true);
  const [applyWeather, setApplyWeather] = useState(true);
  const [applyExecution, setApplyExecution] = useState(true);
  const [nameOverride, setNameOverride] = useState("");
  const [codeOverride, setCodeOverride] = useState("");
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ projectId: string; applied?: { project: boolean; budgetItems: number; certificateItems: number; staffItems: number; scheduleVersions: number; weatherDays: number; executionEntries: number }; pending?: { section: string; reason: string }[] } | null>(null);
  const router = useRouter();

  // Recién analizado: aplica la misma lógica que antes tenía analyze() —
  // certificado con observaciones nunca arranca marcado, régimen sugerido
  // pre-tildado (el usuario lo confirma igual). appliedInterpretationRef
  // evita re-aplicar esto en cada respuesta del sondeo, solo la primera vez
  // que una sesión trae interpretación. Se llama desde manejadores de
  // eventos (no directo en un efecto) para no disparar varios setState
  // síncronos en el cuerpo de un efecto.
  const appliedInterpretationRef = useRef<string | null>(null);
  function applySession(next: ImportSessionView) {
    setSession(next);
    if (!next.interpretation || next.id === appliedInterpretationRef.current) return;
    appliedInterpretationRef.current = next.id;
    const result = next.interpretation;
    setApplyCertificate(next.candidate?.certificate.status === "SAFE_TO_APPLY");
    setApplyStaff(true);
    setApplySchedule(true);
    setApplyWeather(true);
    setApplyExecution(true);
    setRegime(next.suggestedRegime ?? "");
    if (result.project.name.value !== null) setNameOverride(String(result.project.name.value));
    if (result.project.code.value !== null) setCodeOverride(String(result.project.code.value));
  }

  // Sondeo mientras Luna analiza — cada 3s hasta ANALYZED o ANALYSIS_FAILED.
  useEffect(() => {
    if (!session || (session.status !== "UPLOADED" && session.status !== "ANALYZING")) return;
    const timer = setInterval(async () => {
      const result = await getImportSession(session.id);
      if (result.session) applySession(result.session);
    }, 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applySession cierra sobre estado que no debe reiniciar el sondeo.
  }, [session?.id, session?.status]);

  async function handleFileSelected(file: File | null) {
    if (!file) return;
    setError(null);
    if (!/\.xlsx$/i.test(file.name)) {
      setError("Formato no válido. Subí un archivo .xlsx.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("El archivo supera el límite de 10 MB.");
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/import-sessions", { method: "POST", body: formData });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.sessionId) throw new Error(payload?.error ?? "No se pudo guardar la planilla.");
      const result = await getImportSession(payload.sessionId as string);
      if (result.error || !result.session) throw new Error(result.error ?? "No se pudo abrir la sesión.");
      applySession(result.session);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo subir la planilla.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSaveSnapshot(snapshot: WorkingSnapshot) {
    if (!session) return { error: "Sesión no encontrada." };
    const result = await saveImportSessionSnapshot(session.id, snapshot);
    if (!result.error) {
      const fresh = await getImportSession(session.id);
      if (fresh.session) applySession(fresh.session);
    }
    return { error: result.error };
  }

  async function handleReanalyze() {
    if (!session) return;
    setError(null);
    const response = await fetch(`/api/import-sessions/${session.id}/analyze`, { method: "POST" });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      setError(payload?.error ?? "No se pudo reanalizar.");
      return;
    }
    setSession({ ...session, status: "ANALYZING" });
  }

  async function handleDiscard() {
    if (!session) return;
    await discardImportSession(session.id);
    setSession(null);
  }

  async function createImportedProject() {
    if (!session?.interpretation || !regime) return;
    setCreating(true);
    setError(null);
    const formData = new FormData();
    formData.set("session_id", session.id);
    formData.set("name_override", nameOverride);
    formData.set("code_override", codeOverride);
    formData.set("contract_regime", regime);
    formData.set("apply_certificate", applyCertificate ? "1" : "0");
    formData.set("apply_staff", applyStaff ? "1" : "0");
    formData.set("apply_schedule", applySchedule ? "1" : "0");
    formData.set("apply_weather", applyWeather ? "1" : "0");
    formData.set("apply_execution", applyExecution ? "1" : "0");
    try {
      const creationResult = await createProjectFromWorkbook(formData);
      if (creationResult.error || !creationResult.projectId) {
        setError(creationResult.error ?? "No se pudo crear la obra.");
        return;
      }
      // Show what actually landed before navigating away — creation can
      // partially succeed (budget in, certificate pending, etc.) and that
      // must not disappear behind an immediate redirect.
      setCreated({ projectId: creationResult.projectId, applied: creationResult.applied, pending: creationResult.pending });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo crear la obra.");
    } finally {
      setCreating(false);
    }
  }

  if (created) return (
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
        <div className="flex items-center gap-2 text-[13px] font-semibold text-emerald-200"><CheckCircle2 size={15} /> Obra creada</div>
        {created.applied ? (
          <p className="mt-2 text-[12px] text-[var(--muted)]">
            Presupuesto: {created.applied.budgetItems} partidas
            {created.applied.certificateItems ? ` · Certificado: ${created.applied.certificateItems} líneas` : " · Certificado: no importado"}
            {created.applied.staffItems ? ` · Personal: ${created.applied.staffItems}` : ""}
            {created.applied.scheduleVersions ? ` · Curva S: ${created.applied.scheduleVersions} versión(es)` : ""}
            {created.applied.weatherDays ? ` · Libro de Obra: ${created.applied.weatherDays} día(s)` : ""}
            {created.applied.executionEntries ? ` · Avance físico: ${created.applied.executionEntries} rubro(s)` : ""}.
          </p>
        ) : null}
      </div>
      {created.pending?.length ? (
        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-[var(--muted)]">Pendiente (no se importó a esta obra)</h3>
          <ul className="mt-2 space-y-1.5 text-[12px]">
            {created.pending.map((item) => (
              <li key={item.section} className="flex gap-1.5 rounded-lg border border-amber-300/15 bg-amber-300/[0.04] px-3 py-2 text-amber-100">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" /><span><strong>{item.section}</strong> — {item.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="flex justify-end"><Button type="button" onClick={() => router.push(`/projects/${created.projectId}`)}>Ir a la obra</Button></div>
    </div>
  );

  if (!session) return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-sky-300/25 bg-sky-300/[0.035] p-4 text-center">
        <FileSpreadsheet className="mx-auto text-sky-200" size={26} />
        <p className="mt-2 text-[14px] font-semibold">Subí la planilla que ya usás</p>
        <p className="mt-1 text-[12px] text-[var(--muted)]">Se guarda al instante y la ves acá mismo. El ERP la analiza en segundo plano mientras tanto — no necesitás esperar ni adaptar headers.</p>
        <label className="mt-4 inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--border)] bg-white/[0.06] px-3.5 py-2 text-[12px] font-medium hover:bg-white/[0.1]">
          <Upload size={14} /> {uploading ? "Subiendo…" : "Elegir planilla"}
          <input className="sr-only" type="file" accept=".xlsx" disabled={uploading} onChange={(event) => void handleFileSelected(event.target.files?.[0] ?? null)} />
        </label>
      </div>
      {error ? <p className="rounded-lg border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">{error}</p> : null}
      <div className="flex justify-start"><Button type="button" variant="secondary" onClick={onBack} disabled={uploading}>Volver</Button></div>
    </div>
  );

  const result = session.interpretation;
  const candidate = session.candidate;
  const analyzing = session.status === "UPLOADED" || session.status === "ANALYZING";

  return (
    <div className="space-y-4">
      {/* La planilla se ve y se edita ya mismo — no hay project todavía. */}
      <CertificateWorkbookGrid
        key={session.id}
        workbookId={session.id}
        fileName={session.originalFileName}
        initialSnapshot={session.workingSnapshot}
        readOnly={false}
        onSave={handleSaveSnapshot}
        heightClassName="h-[50vh] min-h-[320px]"
        toolbar={
          <>
            <span className="flex items-center gap-1.5 truncate">
              <FileSpreadsheet size={13} /> {session.originalFileName}
            </span>
            {analyzing ? (
              <span className="flex items-center gap-1 text-sky-200"><LoaderCircle className="animate-spin" size={12} /> Luna está analizando la planilla…</span>
            ) : session.analysisStale ? (
              <span className="flex items-center gap-1.5 text-amber-200">
                La estructura cambió desde el análisis.
                <button type="button" onClick={() => void handleReanalyze()} className="underline">Reanalizar</button>
              </span>
            ) : session.status === "ANALYSIS_FAILED" ? (
              <span className="flex items-center gap-1.5 text-[var(--error)]">
                {session.analysisError ?? "No se pudo analizar."}
                <button type="button" onClick={() => void handleReanalyze()} className="underline">Reintentar</button>
              </span>
            ) : session.status === "ANALYZED" ? (
              <button type="button" onClick={() => void handleReanalyze()} className="underline text-[var(--muted)]">Reanalizar</button>
            ) : null}
          </>
        }
      />

      {analyzing ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--border)] py-5 text-[13px] text-[var(--muted)]">
          <LoaderCircle className="animate-spin" size={16} /> Podés editar la planilla mientras tanto — el análisis puede tardar hasta 2 minutos en obras grandes.
        </div>
      ) : null}

      {result ? (
        <>
          <ResultPreview result={result} candidate={candidate} />
          <section className="space-y-2 rounded-xl border border-sky-300/20 bg-sky-300/[0.04] p-3">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-sky-100">Régimen contractual</h3>
            <p className="text-[11px] text-[var(--muted)]">Luna solo sugiere; confirmá una vez — después gobierna la visibilidad de Certificados en esta obra.</p>
            <div className="flex flex-wrap gap-2">
              {REGIME_OPTIONS.map((option) => (
                <label key={option.value} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] cursor-pointer ${regime === option.value ? "border-sky-300/60 bg-sky-300/[0.08]" : "border-[var(--border)]"}`}>
                  <input type="radio" name="contract_regime" checked={regime === option.value} onChange={() => setRegime(option.value)} />
                  {option.label}
                </label>
              ))}
            </div>
          </section>
          <ResultActions
            result={result}
            candidate={candidate}
            applyCertificate={applyCertificate}
            onApplyCertificate={setApplyCertificate}
            applyStaff={applyStaff}
            onApplyStaff={setApplyStaff}
            applySchedule={applySchedule}
            onApplySchedule={setApplySchedule}
            applyWeather={applyWeather}
            onApplyWeather={setApplyWeather}
            applyExecution={applyExecution}
            onApplyExecution={setApplyExecution}
            nameOverride={nameOverride}
            codeOverride={codeOverride}
            onNameOverride={setNameOverride}
            onCodeOverride={setCodeOverride}
            onCreate={() => void createImportedProject()}
            creating={creating || !regime}
            error={error ?? (!regime ? "Confirmá el régimen contractual antes de crear la obra." : null)}
            onBack={() => void handleDiscard()}
          />
        </>
      ) : (
        <div className="flex justify-between gap-2">
          <Button type="button" variant="secondary" onClick={() => void handleDiscard()}>Descartar y volver</Button>
        </div>
      )}
      {!analyzing && !result && session.status === "ANALYSIS_FAILED" ? (
        <p className="text-[12px] text-[var(--error)]">{session.analysisError ?? "No se pudo analizar la planilla."} Podés editarla y reanalizar, o descartar la sesión.</p>
      ) : null}
    </div>
  );
}
