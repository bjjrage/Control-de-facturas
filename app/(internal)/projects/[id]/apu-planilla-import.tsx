"use client";

import { useState } from "react";
import { Upload, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, formatNumber } from "@/lib/format";
import type { ApuImportPreview, ApuPreviewRecipe } from "@/lib/apu-import/types";
import { importApuPlanillaAction, type ApuPlanillaImportResult } from "./apu-templates-actions";

const TIPO_LABEL: Record<string, string> = {
  MATERIAL: "Material",
  MANO_DE_OBRA: "Mano de obra",
  EQUIPO: "Equipo",
  SUBCONTRATO: "Subcontrato",
};

type Stage = "idle" | "analyzing" | "preview" | "saving" | "done";

export function ApuPlanillaImport({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ApuImportPreview | null>(null);
  const [createMissing, setCreateMissing] = useState(true);
  const [hoursPerWorkday, setHoursPerWorkday] = useState("8");
  const [result, setResult] = useState<ApuPlanillaImportResult | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    setError(null);
    setResult(null);
    setPreview(null);
    setStage("analyzing");
    try {
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/apu-import", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as { preview?: ApuImportPreview; error?: string };
      if (!res.ok || !json.preview) {
        setError(json.error ?? "No se pudo analizar la planilla.");
        setStage("idle");
        return;
      }
      setPreview(json.preview);
      setStage("preview");
    } catch {
      setError("No se pudo analizar la planilla. Revisá tu conexión y probá de nuevo.");
      setStage("idle");
    }
  }

  async function confirm() {
    if (!preview) return;
    setStage("saving");
    const res = await importApuPlanillaAction({
      createMissingProducts: createMissing,
      hoursPerWorkday: Number(hoursPerWorkday) || undefined,
      recipes: preview.recipes.map((r) => ({
        name: r.name,
        code: r.code,
        unit: r.unit,
        lines: r.lines.map((l) => ({
          tipo: l.tipo,
          descripcion: l.descripcion,
          unidad: l.unidad,
          cantidad: l.cantidad,
          precio: l.precio,
          desperdicioPct: l.desperdicioPct,
        })),
      })),
    });
    setResult(res);
    setStage("done");
    if (res.plantillas > 0) onDone();
  }

  const hasWorkdayLines =
    preview?.recipes.some((r) => r.lines.some((l) => (l.tipo === "MANO_DE_OBRA" || l.tipo === "EQUIPO") && l.unidad && /^(jornal|jornales|jor|dia|dias|día|días)$/i.test(l.unidad.trim()))) ?? false;

  function reset() {
    setStage("idle");
    setPreview(null);
    setResult(null);
    setError(null);
  }

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
      <div>
        <h3 className="text-[13px] font-semibold">Importar planilla de APU</h3>
        <p className="text-[12px] text-[var(--muted)]">
          Subí la planilla tal cual la tiene la empresa, con el formato que sea. Luna la lee entera (todas las hojas) e identifica las
          partidas y sus insumos. Antes de guardar vas a ver qué entendió y qué filas quedaron dudosas.
        </p>
      </div>

      {stage === "idle" || stage === "analyzing" ? (
        <label className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] p-3 text-[12px] cursor-pointer hover:bg-[var(--panel-2)]">
          {stage === "analyzing" ? <RefreshCw className="h-4 w-4 animate-spin text-[var(--muted)]" /> : <Upload className="h-4 w-4 text-[var(--muted)]" />}
          <span className="text-[var(--muted)]">
            {stage === "analyzing" ? "Luna está leyendo la planilla… puede tardar un par de minutos." : "Elegir planilla (.xlsx, .xls o .csv)"}
          </span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            className="hidden"
            disabled={stage === "analyzing"}
            onChange={(e) => {
              handleFile(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </label>
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 text-[12px] text-[var(--error)]">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {error}
        </div>
      ) : null}

      {preview && (stage === "preview" || stage === "saving") ? (
        <div className="space-y-3">
          <div className="text-[12px]">
            <span className="font-medium">{preview.fileName}</span>: {preview.stats.recipes} partidas, {preview.stats.lines} insumos
            reconocidos en {preview.stats.apuSheets} de {preview.stats.sheets} hojas.
          </div>

          {preview.warnings.map((w, i) => (
            <p key={i} className="text-[12px] text-amber-500">
              {w}
            </p>
          ))}

          {preview.questions.length > 0 ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2.5 text-[12px] space-y-1">
              <div className="font-medium">Luna tiene dudas sobre la planilla:</div>
              <ul className="list-disc pl-4">
                {preview.questions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
              <p className="text-[var(--muted)]">Si alguna afecta los números, corregila en la planilla y volvé a subirla.</p>
            </div>
          ) : null}

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {preview.recipes.map((r, i) => (
              <RecipePreview key={`${r.sheet}-${r.name}-${i}`} recipe={r} />
            ))}
            {preview.recipes.length === 0 ? <p className="text-[12px] text-[var(--muted)]">No se reconoció ninguna partida con insumos.</p> : null}
          </div>

          {preview.unresolved.length > 0 ? (
            <details className="rounded-lg border border-[var(--border)] p-2.5 text-[12px]">
              <summary className="cursor-pointer font-medium text-amber-500">
                {preview.unresolved.length} filas sin resolver (no se van a importar)
              </summary>
              <ul className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {preview.unresolved.slice(0, 200).map((u, i) => (
                  <li key={i}>
                    <span className="text-[var(--muted)]">
                      {u.sheet} · fila {u.row}:
                    </span>{" "}
                    {u.reason} <span className="text-[var(--muted)]">{u.text}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {hasWorkdayLines ? (
            <label className="flex items-center gap-2 text-[12px]">
              Hay mano de obra en jornales. Una jornada equivale a
              <input
                type="number"
                min="1"
                max="24"
                step="any"
                value={hoursPerWorkday}
                onChange={(e) => setHoursPerWorkday(e.target.value)}
                className="h-7 w-16 rounded border border-[var(--border)] bg-[var(--panel-2)] px-2"
              />
              horas.
            </label>
          ) : null}

          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={createMissing} onChange={(e) => setCreateMissing(e.target.checked)} />
            Crear en el catálogo los materiales que todavía no existan
          </label>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={reset} disabled={stage === "saving"}>
              Cancelar
            </Button>
            <Button type="button" onClick={confirm} disabled={stage === "saving" || preview.recipes.length === 0}>
              {stage === "saving" ? "Guardando…" : `Importar ${preview.stats.recipes} partidas`}
            </Button>
          </div>
        </div>
      ) : null}

      {result && stage === "done" ? (
        <div className="space-y-2 text-[12px]">
          {result.error ? (
            <div className="flex items-start gap-2 text-[var(--error)]">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /> {result.error}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-emerald-500">
              <CheckCircle2 className="h-4 w-4" /> {result.plantillas} plantillas y {result.lineas} insumos guardados
              {result.productosCreados > 0 ? `; ${result.productosCreados} materiales nuevos en el catálogo` : ""}
              {result.preciosGuardados > 0 ? `; ${result.preciosGuardados} precios de materiales guardados como referencia` : ""}.
            </div>
          )}
          {result.errores.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-amber-500">{result.errores.length} insumos no se guardaron</summary>
              <ul className="mt-1 list-disc pl-4 max-h-40 overflow-y-auto">
                {result.errores.slice(0, 100).map((e, i) => (
                  <li key={i}>
                    {e.receta} — {e.insumo}: {e.motivo}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <Button type="button" variant="secondary" onClick={reset}>
            Importar otra planilla
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function RecipePreview({ recipe }: { recipe: ApuPreviewRecipe }) {
  return (
    <details className="rounded-lg border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1.5 text-[12px]">
      <summary className="cursor-pointer flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{recipe.name}</span>
        {recipe.code ? <span className="text-[var(--muted)]">{recipe.code}</span> : null}
        <span className="text-[var(--muted)]">
          {recipe.lines.length} insumos{recipe.unit ? ` · por ${recipe.unit}` : ""}
        </span>
        {recipe.totalMismatch ? (
          <span className="text-amber-500">
            el total de la planilla ({formatMoney(recipe.declaredTotal ?? 0, "PYG")}) no coincide con la suma ({formatMoney(recipe.computedTotal ?? 0, "PYG")})
          </span>
        ) : null}
      </summary>
      <table className="mt-1.5 w-full text-left">
        <thead>
          <tr className="text-[var(--muted)]">
            <th className="py-0.5 pr-2">Tipo</th>
            <th className="py-0.5 pr-2">Insumo</th>
            <th className="py-0.5 pr-2">Unidad</th>
            <th className="py-0.5 pr-2 text-right">Cantidad</th>
            <th className="py-0.5 text-right">Precio</th>
          </tr>
        </thead>
        <tbody>
          {recipe.lines.map((l) => (
            <tr key={l.row}>
              <td className="py-0.5 pr-2">{TIPO_LABEL[l.tipo]}</td>
              <td className="py-0.5 pr-2">{l.descripcion}</td>
              <td className="py-0.5 pr-2">{l.unidad ?? "—"}</td>
              <td className="py-0.5 pr-2 text-right">{formatNumber(l.cantidad, 4)}</td>
              <td className="py-0.5 text-right">{l.precio == null ? "—" : formatMoney(l.precio, "PYG")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
