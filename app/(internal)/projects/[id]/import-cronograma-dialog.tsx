"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { applyScheduleImport } from "../actions";
import {
  buildScheduleUpdates,
  interpretScheduleSheet,
  resolveSchedulePredecessors,
  type ScheduleInterpretation,
} from "@/lib/schedule/schedule-import";
import type { BudgetItem } from "@/lib/types";

type Step = "upload" | "preview" | "done";

export function ImportCronogramaDialog({ projectId, budgetItems }: { projectId: string; budgetItems: BudgetItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [interpretation, setInterpretation] = useState<ScheduleInterpretation | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const erpItems = useMemo(
    () => budgetItems.map((i) => ({ id: i.id, code: i.code, description: i.description })),
    [budgetItems]
  );

  const predecessors = useMemo(
    () => (interpretation ? resolveSchedulePredecessors(interpretation.rows, erpItems) : new Map()),
    [interpretation, erpItems]
  );

  const updates = useMemo(
    () => (interpretation ? buildScheduleUpdates(interpretation.rows, predecessors) : []),
    [interpretation, predecessors]
  );

  function reset() {
    setStep("upload");
    setFileName("");
    setError(null);
    setInterpretation(null);
    setResult(null);
  }

  async function handleFile(file: File) {
    setError(null);
    setResult(null);
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setError("Formato no válido. Subí un archivo .xlsx, .xls o .csv.");
      return;
    }
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
      const interpreted = interpretScheduleSheet(rows, erpItems);
      if (interpreted.stats.detected === 0) {
        setError("No se detectaron filas de cronograma en la primera hoja.");
        return;
      }
      setFileName(file.name);
      setInterpretation(interpreted);
      setStep("preview");
    } catch {
      setError("No se pudo leer el archivo. Verificá que sea un Excel válido.");
    }
  }

  function confirmImport() {
    if (!interpretation || updates.length === 0) return;
    startTransition(async () => {
      const res = await applyScheduleImport(projectId, updates);
      if (res.failed.length > 0 && res.applied === 0) {
        setError(`No se aplicó ningún cambio. ${res.failed[0].error}`);
        return;
      }
      setResult(
        res.failed.length === 0
          ? `${res.applied} partida(s) programadas. El Gantt ya muestra sus fechas.`
          : `${res.applied} partida(s) programadas, ${res.failed.length} con error (${res.failed[0].error}).`
      );
      setStep("done");
      router.refresh();
    });
  }

  const stats = interpretation?.stats;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" className="h-9 px-3 text-[12px]">Importar cronograma</Button>
      </DialogTrigger>
      <DialogContent title="Importar cronograma" className="max-w-6xl">
        <div className="space-y-3">
          {step === "upload" ? (
            <>
              <p className="text-[12px] text-[var(--muted)]">
                Subí el XLSX de cronograma (partida, descripción, inicio, fin, duración, predecesora o nombres
                equivalentes). Solo se actualizan fechas y predecesoras: cantidades, precios y avance no se tocan.
              </p>
              {error ? <p role="alert" className="rounded border border-[var(--border)] px-3 py-2 text-[12px]">{error}</p> : null}
              <label className="flex cursor-pointer items-center justify-center rounded-lg border border-dashed border-[var(--border)] px-4 py-8 text-[12px] text-[var(--muted)]">
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="sr-only"
                  onChange={(event) => { const f = event.target.files?.[0]; if (f) void handleFile(f); }}
                />
                Elegir archivo .xlsx / .csv
              </label>
            </>
          ) : null}

          {step === "preview" && interpretation ? (
            <>
              <p className="text-[12px] text-[var(--muted)]">
                <span className="font-semibold text-[var(--foreground)]">{fileName}</span>
                {" — "}Partidas detectadas: <b>{stats?.detected}</b>
                {" · "}Matcheadas: <b>{stats?.matched}</b>
                {" · "}Sin vincular: <b>{stats?.unlinked}</b>
                {" · "}A programar: <b>{updates.length}</b>
              </p>
              {error ? <p role="alert" className="rounded border border-[var(--border)] px-3 py-2 text-[12px]">{error}</p> : null}
              <div className="max-h-[50vh] overflow-auto rounded-lg border border-[var(--border)]">
                <table className="w-full min-w-[900px] text-left text-[12px]">
                  <thead className="sticky top-0 bg-[var(--panel)]">
                    <tr>
                      <th className="px-3 py-2">Documento</th>
                      <th className="px-3 py-2">Partida ERP</th>
                      <th className="px-3 py-2">Inicio</th>
                      <th className="px-3 py-2">Fin</th>
                      <th className="px-3 py-2 text-right">Duración</th>
                      <th className="px-3 py-2">Predecesora</th>
                    </tr>
                  </thead>
                  <tbody>
                    {interpretation.rows.map((row, idx) => {
                      const pred = predecessors.get(idx);
                      return (
                        <tr key={`${row.sourceRow}-${idx}`} className="border-t border-[var(--border)]">
                          <td className="px-3 py-2">
                            <div className="font-mono">{row.docCode || "—"}</div>
                            <div className="max-w-[260px] truncate text-[var(--muted)]">{row.docDescription || "—"}</div>
                            {row.warnings.map((w) => (
                              <div key={w} className="text-[11px] text-[var(--warn)]">{w}</div>
                            ))}
                          </td>
                          <td className="px-3 py-2">
                            {row.match ? (
                              <>
                                <div className="font-mono">{row.match.code}</div>
                                <div className="max-w-[220px] truncate text-[var(--muted)]">
                                  {row.match.description} · {row.match.method}
                                </div>
                              </>
                            ) : (
                              <span className="rounded bg-[var(--hover)] px-1.5 py-0.5 text-[11px] font-semibold">SIN VINCULAR</span>
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono">{row.start ?? "—"}</td>
                          <td className="px-3 py-2 font-mono">{row.end ?? "—"}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{row.durationDays == null ? "—" : `${row.durationDays} días`}</td>
                          <td className="px-3 py-2 font-mono">
                            {row.predecessorRef ? `${row.predecessorRef}${row.depType ? ` (${row.depType})` : ""}${pred ? "" : " ⚠"}` : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] text-[var(--muted)]">
                El Gantt actual dibuja fechas; las predecesoras se guardan (FS por defecto si el archivo no trae tipo)
                pero todavía no se dibujan como flechas.
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => setStep("upload")}>Elegir otro archivo</Button>
                <Button type="button" disabled={isPending || updates.length === 0} onClick={confirmImport}>
                  {isPending ? "Guardando…" : `Confirmar (${updates.length})`}
                </Button>
              </div>
            </>
          ) : null}

          {step === "done" ? (
            <>
              {result ? <p role="status" className="rounded border border-[var(--border)] px-3 py-2 text-[12px]">{result}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => { setOpen(false); }}>Cerrar</Button>
              </div>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
