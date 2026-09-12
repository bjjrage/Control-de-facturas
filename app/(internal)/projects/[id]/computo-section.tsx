"use client";

// Importador de cómputo métrico (Excel/PDF) — mismo pipeline de matching
// semántico que BIM, para proyectos sin modelo IFC. Ver
// supabase/migrations/0075_computo_import.sql y computo-actions.ts.
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/browser";
import { formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { ComputoImport, ComputoItem, ComputoItemMatch, BudgetItem } from "@/lib/types";
import {
  getComputoUploadSlot,
  importComputoExcel,
  importComputoPdf,
  retryComputoMatching,
  getComputoData,
  confirmComputoMatch,
  rejectComputoMatch,
  getComputoExportRows,
} from "./computo-actions";

const STATUS_LABEL: Record<string, string> = {
  SUGGESTED: "Sugerido",
  REVIEW: "A revisar",
  REVIEW_REQUIRED: "Revisión obligatoria",
  NO_MATCH: "Sin correspondencia",
  CONFIRMED: "Confirmado",
  REJECTED: "Sin asignar",
};

// Solo las 3 columnas que este importador necesita — sin precio, sin código:
// el precio siempre viene del catálogo de presupuesto, nunca del cómputo.
const HEADER_VARIANTS: Record<"description" | "quantity" | "unit", string[]> = {
  description: ["descripcion", "detalle", "rubro", "concepto", "designacion", "item"],
  quantity: ["cantidad", "cant", "qty", "metrado", "computo"],
  unit: ["unidad", "und", "un", "u.m.", "medida"],
};

function normalizeHeader(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "").trim();
}

function parsePyNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let s = raw.trim().replace(/\s/g, "");
  if (!s) return null;
  s = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/\./g, "");
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function ComputoSection({ projectId }: { projectId: string }) {
  const [imports, setImports] = useState<ComputoImport[]>([]);
  const [items, setItems] = useState<ComputoItem[]>([]);
  const [matches, setMatches] = useState<ComputoItemMatch[]>([]);
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [changingItemId, setChangingItemId] = useState<string | null>(null);
  const excelInputRef = useRef<HTMLInputElement | null>(null);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    const data = await getComputoData(projectId);
    if (data.error) {
      setError(data.error);
      return;
    }
    setImports(data.imports);
    setItems(data.items);
    setMatches(data.matches);
    setBudgetItems(data.budgetItems);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const matchableBudgetItems = useMemo(() => {
    const parentIds = new Set(budgetItems.map((b) => b.parent_id).filter(Boolean));
    return budgetItems.filter((b) => !parentIds.has(b.id) && b.unit_price != null);
  }, [budgetItems]);

  const budgetItemById = useMemo(() => new Map(budgetItems.map((b) => [b.id, b])), [budgetItems]);

  const latestMatchByItem = useMemo(() => {
    const byItem = new Map<string, ComputoItemMatch[]>();
    for (const m of matches) (byItem.get(m.computo_item_id) ?? byItem.set(m.computo_item_id, []).get(m.computo_item_id)!).push(m);
    const result = new Map<string, ComputoItemMatch>();
    for (const [itemId, list] of byItem) {
      const confirmed = list.find((m) => m.status === "CONFIRMED");
      const rejected = list.find((m) => m.status === "REJECTED");
      const latest = [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      result.set(itemId, confirmed ?? rejected ?? latest);
    }
    return result;
  }, [matches]);

  async function handleExcelFile(file: File) {
    setError(null);
    setUploadStatus("Leyendo Excel…");
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rawRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
      const nonEmpty = rawRows.filter((r) => r.some((c) => String(c).trim() !== ""));
      if (nonEmpty.length < 2) throw new Error("El archivo no tiene filas de datos.");

      const headers = (nonEmpty[0] as unknown[]).map((h) => normalizeHeader(String(h)));
      const colIndex: Partial<Record<"description" | "quantity" | "unit", number>> = {};
      for (const [field, variants] of Object.entries(HEADER_VARIANTS) as ["description" | "quantity" | "unit", string[]][]) {
        const idx = headers.findIndex((h) => variants.some((v) => h === v || h.includes(v)));
        if (idx >= 0) colIndex[field] = idx;
      }
      if (colIndex.description == null) throw new Error("No se detectó una columna de descripción — verificá los encabezados.");

      const rows = nonEmpty.slice(1).map((r) => ({
        description: String(r[colIndex.description!] ?? "").trim(),
        quantity: colIndex.quantity != null ? parsePyNumber(r[colIndex.quantity]) : null,
        unit: colIndex.unit != null ? String(r[colIndex.unit] ?? "").trim() || null : null,
      })).filter((r) => r.description !== "");
      if (rows.length === 0) throw new Error("No se encontraron filas válidas.");

      setUploadStatus(`Importando ${rows.length} filas y consultando el catálogo…`);
      const result = await importComputoExcel(projectId, file.name, rows);
      if (result.error) throw new Error(result.error);
      setUploadStatus(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo importar el Excel.");
      setUploadStatus(null);
    }
  }

  async function handlePdfFile(file: File) {
    setError(null);
    setUploadStatus("Subiendo PDF…");
    try {
      const { storagePath, error: slotError } = await getComputoUploadSlot(projectId, file.name);
      if (slotError) throw new Error(slotError);

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("computo-imports")
        .upload(storagePath, file, { contentType: "application/pdf", upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      setUploadStatus("Leyendo el PDF y consultando el catálogo…");
      const result = await importComputoPdf(projectId, file.name, storagePath);
      if (result.error) throw new Error(result.error);
      setUploadStatus(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo importar el PDF.");
      setUploadStatus(null);
    }
  }

  async function handleRetryMatching(computoImportId: string) {
    setError(null);
    setUploadStatus("Consultando el catálogo…");
    const result = await retryComputoMatching(projectId, computoImportId);
    if (result.error) setError(result.error);
    setUploadStatus(null);
    await refresh();
  }

  async function handleConfirm(itemId: string, budgetItemId: string) {
    const result = await confirmComputoMatch(projectId, itemId, budgetItemId);
    if (result.error) setError(result.error);
    setChangingItemId(null);
    await refresh();
  }

  async function handleReject(itemId: string) {
    const result = await rejectComputoMatch(projectId, itemId);
    if (result.error) setError(result.error);
    await refresh();
  }

  async function handleExport(computoImportId: string, fileName: string) {
    const { rows, error: exportError } = await getComputoExportRows(projectId, computoImportId);
    if (exportError) {
      setError(exportError);
      return;
    }
    if (rows.length === 0) {
      setError("Todavía no hay ítems confirmados para exportar.");
      return;
    }
    const XLSX = await import("xlsx");
    const sheetRows = rows.map((r) => ({
      Rubro: r.code,
      Descripción: r.description,
      Cantidad: r.quantity,
      Unidad: r.unit,
      "Precio unitario": r.unit_price,
      Total: r.total,
    }));
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(wb, sheet, "Cómputo");
    XLSX.writeFile(wb, `${fileName.replace(/\.[^.]+$/, "")}-presupuesto.xlsx`);
  }

  return (
    <div className="space-y-3 rounded border border-[var(--border)] p-3">
      <div className="flex items-center justify-between">
        <div className="text-[13px] font-medium">Cómputo métrico (Excel / PDF)</div>
        <div className="flex gap-2">
          <input
            ref={excelInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleExcelFile(file);
              e.target.value = "";
            }}
          />
          <Button variant="secondary" onClick={() => excelInputRef.current?.click()}>
            Importar Excel
          </Button>
          <input
            ref={pdfInputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handlePdfFile(file);
              e.target.value = "";
            }}
          />
          <Button variant="secondary" onClick={() => pdfInputRef.current?.click()}>
            Importar PDF
          </Button>
        </div>
      </div>
      <div className="text-[11px] text-[var(--muted)]">
        Para proyectos sin modelo BIM: subí el cómputo métrico que ya recibiste (planilla de licitación, informe de
        calculista) y se consulta contra tu catálogo de presupuesto igual que el BIM — vos confirmás cada ítem, el
        precio siempre sale del presupuesto.
      </div>

      {uploadStatus ? <div className="text-[12px] text-[var(--muted)]">{uploadStatus}</div> : null}
      {error ? <div className="rounded bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">{error}</div> : null}

      {imports.map((imp) => {
        const impItems = items.filter((i) => i.computo_import_id === imp.id);
        const summaryCounts = impItems.reduce(
          (acc, item) => {
            const status = latestMatchByItem.get(item.id)?.status ?? "REVIEW";
            acc[status] = (acc[status] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        );

        return (
          <div key={imp.id} className="space-y-2 rounded border border-[var(--border)] p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12px]">
                <span className="font-medium">{imp.file_name}</span>{" "}
                <span className="text-[var(--muted)]">
                  ({imp.source_type} · {impItems.length} ítems)
                </span>
              </div>
              <Button variant="secondary" onClick={() => handleExport(imp.id, imp.file_name)}>
                Exportar a Excel
              </Button>
            </div>

            {imp.status === "BAJA_CONFIANZA" ? (
              <div className="rounded border border-[var(--warn)]/40 bg-[var(--warn-bg)] px-2.5 py-1.5 text-[12px] space-y-1">
                <div className="text-[var(--warn)]">
                  ⚠ No pude leer este PDF con confianza suficiente (
                  {imp.confidence_summary?.sanityIssues?.join("; ") || "estructura de tabla poco clara"}). Revisá las
                  filas extraídas antes de pedir el matching.
                </div>
                <Button onClick={() => handleRetryMatching(imp.id)}>Consultar catálogo de todas formas</Button>
              </div>
            ) : null}

            <div className="text-[11px] text-[var(--muted)] flex flex-wrap gap-x-3">
              {Object.entries(summaryCounts).map(([status, count]) => (
                <span key={status}>
                  {STATUS_LABEL[status] ?? status}: {count}
                </span>
              ))}
            </div>

            <div className="space-y-1.5">
              {impItems.map((item) => {
                const match = latestMatchByItem.get(item.id);
                const status = match?.status ?? "REVIEW";
                const suggestedItem = match?.budget_item_id ? budgetItemById.get(match.budget_item_id) ?? null : null;

                return (
                  <div key={item.id} className="rounded border border-[var(--border)] p-2 text-[12px] space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        {item.description}{" "}
                        <span className="text-[var(--muted)]">
                          — {item.quantity_value ?? "?"} {item.quantity_unit ?? ""}
                        </span>
                      </div>
                      <span
                        className={`rounded px-2 py-0.5 text-[11px] ${
                          status === "CONFIRMED"
                            ? "bg-[var(--accent)]/15 text-[var(--accent)]"
                            : status === "REJECTED"
                              ? "bg-[var(--panel-2)] text-[var(--muted)]"
                              : status === "NO_MATCH"
                                ? "bg-[var(--error-bg)] text-[var(--error)]"
                                : status === "REVIEW_REQUIRED"
                                  ? "bg-[var(--warn-bg)] text-[var(--warn)]"
                                  : "bg-[var(--panel-2)] text-[var(--fg)]"
                        }`}
                      >
                        {STATUS_LABEL[status] ?? status}
                      </span>
                    </div>

                    {status === "SUGGESTED" && suggestedItem ? (
                      <div className="text-[11px] text-[var(--muted)]">
                        {suggestedItem.code} — {suggestedItem.description}
                        {match?.score != null ? ` (${Math.round(match.score * 100)}%)` : ""}
                      </div>
                    ) : status === "REVIEW_REQUIRED" && suggestedItem ? (
                      <div className="text-[11px] text-[var(--muted)]">
                        Sugerencia no auto-confirmable: {suggestedItem.code} — {suggestedItem.description}. {match?.reason}
                      </div>
                    ) : (status === "REVIEW" || status === "REVIEW_REQUIRED" || status === "NO_MATCH") && match?.reason ? (
                      <div className="text-[11px] text-[var(--muted)]">{match.reason}</div>
                    ) : null}

                    {status !== "REJECTED" ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {status === "SUGGESTED" && match?.budget_item_id ? (
                          <Button onClick={() => handleConfirm(item.id, match.budget_item_id!)}>Confirmar</Button>
                        ) : null}
                        {changingItemId === item.id ? (
                          <select
                            className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-[12px]"
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) handleConfirm(item.id, e.target.value);
                            }}
                          >
                            <option value="" disabled>
                              Elegir rubro…
                            </option>
                            {matchableBudgetItems.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.code} — {b.description} ({b.unit})
                              </option>
                            ))}
                          </select>
                        ) : (
                          <Button variant="secondary" onClick={() => setChangingItemId(item.id)}>
                            Cambiar rubro
                          </Button>
                        )}
                        <Button variant="secondary" onClick={() => handleReject(item.id)}>
                          Dejar sin asignar
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
