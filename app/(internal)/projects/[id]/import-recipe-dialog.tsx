"use client";

import { useMemo, useState } from "react";
import { Upload, RefreshCw, CheckCircle2, AlertTriangle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { importProductionRecipe } from "../production-recipe-actions";

// Mismo patrón que import-budget-dialog (parse PY + detección de columnas).
function parsePyNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/gs\.?/gi, "").replace(/\s/g, "");
  if (s.includes(",")) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else {
    s = s.replace(/\./g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normHeader(h: unknown): string {
  return String(h ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

const COL_VARIANTS: Record<string, string[]> = {
  recetaCodigo: ["receta", "recetacodigo", "recipe", "recipecode", "codigo"],
  unidadProduccion: ["unidadproduccion", "unidad", "productionunit", "unidadprod"],
  partidaCodigo: ["partidacodigo", "codigopartida", "cod", "codigo", "item", "code"],
  cantidad: ["cantidad", "cant", "qty", "quantity", "cantidadporunidad"],
  unidad: ["u", "unid", "umedida", "unit"],
};

interface BudgetLite {
  id: string;
  code: string;
  description: string;
  unit: string | null;
}

interface Props {
  projectId: string;
  budgetItems: BudgetLite[];
  onImported: () => void;
  onClose: () => void;
}

interface ParsedRow {
  idx: number;
  recetaCodigo: string;
  unidadProduccion: string;
  partidaCodigo: string;
  cantidad: number | null;
  unidad: string;
  manualItemId: string;
}

export function ImportRecipeDialog({ projectId, budgetItems, onImported, onClose }: Props) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [recipeCode, setRecipeCode] = useState("");
  const [recipeName, setRecipeName] = useState("");
  const [prodUnit, setProdUnit] = useState("");
  const [contractQty, setContractQty] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const byCode = useMemo(() => {
    const m = new Map<string, BudgetLite[]>();
    for (const b of budgetItems) {
      const k = String(b.code ?? "").trim();
      if (!k) continue;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(b);
    }
    return m;
  }, [budgetItems]);

  function matchStatus(r: ParsedRow): { kind: "ok" | "manual" | "error"; reason?: string; itemId?: string } {
    if (r.manualItemId) {
      const found = budgetItems.find((b) => b.id === r.manualItemId);
      if (!found) return { kind: "error", reason: "Selección manual inválida." };
      return { kind: "manual", itemId: found.id };
    }
    if (!r.partidaCodigo) return { kind: "error", reason: "Código de partida vacío." };
    if (r.cantidad === null || r.cantidad <= 0)
      return { kind: "error", reason: `Cantidad inválida para ${r.partidaCodigo}.` };
    const found = byCode.get(r.partidaCodigo);
    if (!found) {
      return {
        kind: "error",
        reason: `Código ${r.partidaCodigo} no existe en el presupuesto (mapeá manual o corregí el Excel).`,
      };
    }
    if (found.length > 1) {
      return { kind: "error", reason: `Código ${r.partidaCodigo} ambiguo (duplicado): elegí manual.` };
    }
    return { kind: "ok", itemId: found[0].id };
  }

  const preview = useMemo(() => rows.map((r) => ({ row: r, st: matchStatus(r) })), [rows, byCode, budgetItems]);
  const okCount = preview.filter((p) => p.st.kind !== "error").length;
  const errCount = preview.length - okCount;

  async function handleFile(file: File | null) {
    if (!file) return;
    setLoadError(null);
    setSaveError(null);
    setFileName(file.name);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
      if (raw.length < 2) {
        setLoadError("El archivo no tiene filas de datos.");
        setRows([]);
        return;
      }
      const headers = (raw[0] as unknown[]).map(normHeader);
      const colIdx: Record<string, number> = {};
      for (const [field, variants] of Object.entries(COL_VARIANTS)) {
        const i = headers.findIndex((h) => variants.includes(h));
        if (i >= 0) colIdx[field] = i;
      }
      if (colIdx.partidaCodigo === undefined || colIdx.cantidad === undefined) {
        setLoadError("No se detectaron columnas de partida/cantidad (PARTIDA_CODIGO, CANTIDAD).");
        setRows([]);
        return;
      }
      const parsed: ParsedRow[] = [];
      for (let i = 1; i < raw.length; i++) {
        const r = raw[i] as unknown[];
        const get = (f: string) => (colIdx[f] === undefined ? "" : r[colIdx[f]]);
        const partidaCodigo = String(get("partidaCodigo") ?? "").trim();
        const cantidad = parsePyNumber(get("cantidad"));
        if (!partidaCodigo && cantidad === null) continue; // fila vacía
        parsed.push({
          idx: i,
          recetaCodigo: String(get("recetaCodigo") ?? "").trim(),
          unidadProduccion: String(get("unidadProduccion") ?? "").trim(),
          partidaCodigo,
          cantidad,
          unidad: String(get("unidad") ?? "").trim(),
          manualItemId: "",
        });
      }
      setRows(parsed);
      const first = parsed[0];
      if (first) {
        if (!recipeCode && first.recetaCodigo) setRecipeCode(first.recetaCodigo);
        if (!prodUnit && first.unidadProduccion) setProdUnit(first.unidadProduccion);
        if (!recipeName && first.recetaCodigo) setRecipeName(first.recetaCodigo);
      }
    } catch {
      setLoadError("No se pudo leer el archivo. Verificá que sea un .xlsx o .csv válido.");
      setRows([]);
    }
  }

  async function handleConfirm() {
    setSaveError(null);
    if (!recipeCode.trim() || !recipeName.trim() || !prodUnit.trim()) {
      setSaveError("Completá código, nombre y unidad de producción de la receta.");
      return;
    }
    if (errCount > 0 || okCount === 0) {
      setSaveError("Corregí las filas con error (mapeo manual o Excel) antes de confirmar.");
      return;
    }
    setSaving(true);
    const res = await importProductionRecipe({
      projectId,
      code: recipeCode.trim(),
      name: recipeName.trim(),
      productionUnit: prodUnit.trim(),
      contractTotalQuantity: contractQty.trim() ? Number(contractQty) : null,
      sourceFileName: fileName || null,
      rows: preview.map((p) => {
        // P0: el id (manual o auto) viaja explícito; el server lo valida y
        // prevalece sobre el código (el fix manual ya no se pierde).
        const explicitId =
          p.st.kind === "manual" && p.st.itemId
            ? p.st.itemId
            : (byCode.get(p.row.partidaCodigo)?.[0]?.id as string);
        const item = budgetItems.find((b) => b.id === explicitId)!;
        return {
          recipeCode: recipeCode.trim(),
          recipeName: recipeName.trim(),
          productionUnit: prodUnit.trim(),
          itemCode: p.row.partidaCodigo,
          quantityPerUnit: p.row.cantidad as number,
          unit: p.row.unidad || item.unit || "unid",
          budgetItemId: explicitId,
        };
      }),
    });
    setSaving(false);
    if (res.error || !res.data) {
      setSaveError(
        res.error + (res.rowErrors?.length ? ` Filas: ${res.rowErrors.map((e) => `${e.row} (${e.reason})`).join(" · ")}` : "")
      );
      return;
    }
    onImported();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" data-testid="importar-receta-dialog">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-[var(--foreground)]">Importar receta desde Excel</h4>
          <button type="button" onClick={onClose} className="p-1 text-[var(--muted)] hover:text-[var(--foreground)]" title="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          Columnas esperadas: RECETA | UNIDAD_PRODUCCION | PARTIDA_CODIGO | PARTIDA | CANTIDAD | UNIDAD.
          El mapeo es por código exacto; lo ambiguo se elige manual. Nada se crea sin confirmar.
        </p>

        <label className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] p-3 text-xs cursor-pointer hover:bg-[var(--panel-2)]">
          <Upload className="h-4 w-4 text-[var(--muted)]" />
          <span className="text-[var(--muted)]">{fileName || "Elegir archivo .xlsx / .csv"}</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            data-testid="importar-receta-archivo"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {loadError && (
          <div className="flex items-center gap-2 text-xs text-red-500">
            <AlertTriangle className="h-4 w-4" /> {loadError}
          </div>
        )}

        {rows.length > 0 && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>
                <label className="block text-[11px] text-[var(--muted)]">Código receta</label>
                <Input value={recipeCode} onChange={(e) => setRecipeCode(e.target.value)} className="h-8 text-xs" data-testid="receta-codigo" />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--muted)]">Nombre</label>
                <Input value={recipeName} onChange={(e) => setRecipeName(e.target.value)} className="h-8 text-xs" data-testid="receta-nombre" />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--muted)]">Unidad prod.</label>
                <Input value={prodUnit} onChange={(e) => setProdUnit(e.target.value)} className="h-8 text-xs" data-testid="receta-unidad" placeholder="km" />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--muted)]">Tramo contractual (opcional)</label>
                <Input value={contractQty} onChange={(e) => setContractQty(e.target.value)} className="h-8 text-xs" placeholder="10" type="number" />
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]">
                    <th className="py-1.5 px-2">Fila</th>
                    <th className="py-1.5 px-2">Código Excel</th>
                    <th className="py-1.5 px-2 text-right">Cant./unidad</th>
                    <th className="py-1.5 px-2">Mapeo a partida</th>
                    <th className="py-1.5 px-2">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {preview.map((p) => (
                    <tr key={p.row.idx}>
                      <td className="py-1.5 px-2 font-mono">{p.row.idx}</td>
                      <td className="py-1.5 px-2 font-mono">{p.row.partidaCodigo || "—"}</td>
                      <td className="py-1.5 px-2 text-right">
                        {p.row.cantidad ?? "—"} {p.row.unidad}
                      </td>
                      <td className="py-1.5 px-2">
                        {p.st.kind === "ok" ? (
                          <span className="text-emerald-700 dark:text-emerald-300">
                            {budgetItems.find((b) => b.id === p.st.itemId)?.description}
                          </span>
                        ) : (
                          <select
                            value={p.row.manualItemId}
                            onChange={(e) =>
                              setRows(rows.map((r) => (r.idx === p.row.idx ? { ...r, manualItemId: e.target.value } : r)))
                            }
                            className="h-7 max-w-56 rounded border border-[var(--border)] bg-[var(--panel)] px-1 text-[11px]"
                            data-testid={`mapeo-manual-${p.row.idx}`}
                          >
                            <option value="">Elegir partida…</option>
                            {budgetItems.map((b) => (
                              <option key={b.id} value={b.id}>
                                {b.code} · {b.description}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        {p.st.kind === "error" ? (
                          <span className="text-red-500" title={p.st.reason}>Error</span>
                        ) : (
                          <span className="text-emerald-700 dark:text-emerald-300">
                            {p.st.kind === "manual" ? "Manual" : "OK"}
                          </span>
                        )}
                        {p.st.kind === "error" && p.st.reason && (
                          <span className="block text-[10px] text-[var(--muted)]">{p.st.reason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-[11px] text-[var(--muted)]">
              {okCount} filas válidas · {errCount} con error
            </div>
          </>
        )}

        {saveError && (
          <div className="flex items-start gap-2 text-xs text-red-500">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> <span>{saveError}</span>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} className="h-8 text-xs">
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={saving || rows.length === 0}
            data-testid="confirmar-importacion-receta"
            className="h-8 text-xs gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {saving ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            Confirmar importación
          </Button>
        </div>
      </div>
    </div>
  );
}
