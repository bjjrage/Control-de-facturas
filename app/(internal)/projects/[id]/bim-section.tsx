"use client";

import { useEffect, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { formatNumber, formatMoney } from "@/lib/format";
import { Button } from "@/components/ui/button";
import type { BimModel, BimElement, BimBudgetMatch, BudgetItem } from "@/lib/types";
import {
  getBimData,
  getBimUploadSlot,
  registerBimModel,
  generateMatchSuggestions,
  confirmBimMatch,
  deleteBimModel,
  type ParsedElementInput,
} from "./bim-actions";

const QUANTITY_LABEL: Record<string, string> = {
  length: "Longitud",
  area: "Área",
  volume: "Volumen",
  count: "Cantidad",
  weight: "Peso",
};

export function BimSection({ projectId }: { projectId: string }) {
  const [models, setModels] = useState<BimModel[]>([]);
  const [elements, setElements] = useState<BimElement[]>([]);
  const [matches, setMatches] = useState<BimBudgetMatch[]>([]);
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function refresh() {
    setLoading(true);
    const data = await getBimData(projectId);
    setModels(data.models);
    setElements(data.elements);
    setMatches(data.matches);
    setBudgetItems(data.budgetItems);
    setError(data.error);
    setLoading(false);
    if (data.models.length > 0 && !selectedModelId) setSelectedModelId(data.models[0].id);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    refresh();
  }, [projectId]);

  async function handleUpload(file: File) {
    setError(null);
    setUploadStatus("Leyendo archivo…");
    try {
      const { parseIfcFile } = await import("@/lib/bim/ifc-parser.client");
      const parsed = await parseIfcFile(file, (msg) => setUploadStatus(msg));

      setUploadStatus("Subiendo archivo original a almacenamiento…");
      const { storagePath, error: slotError } = await getBimUploadSlot(projectId, file.name);
      if (slotError) throw new Error(slotError);

      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("bim-models")
        .upload(storagePath, file, { contentType: "application/octet-stream", upsert: false });
      if (uploadError) throw new Error(uploadError.message);

      setUploadStatus(`Guardando ${parsed.elements.length} elementos…`);
      const elementsInput: ParsedElementInput[] = parsed.elements.map((e) => ({
        ifcGuid: e.ifcGuid,
        ifcType: e.ifcType,
        name: e.name,
        buildingStorey: e.buildingStorey,
        material: e.material,
        properties: e.properties,
        quantityType: e.quantityType,
        quantityValue: e.quantityValue,
        quantityUnit: e.quantityUnit,
        quantitySource: e.quantitySource,
        quantityProperty: e.quantityProperty,
      }));
      const result = await registerBimModel(projectId, file.name, storagePath, parsed.schema, elementsInput);
      if (result.error) throw new Error(result.error);

      setUploadStatus(null);
      await refresh();
      if (result.modelId) {
        setSelectedModelId(result.modelId);
        startTransition(async () => {
          await generateMatchSuggestions(projectId, result.modelId!);
          await refresh();
        });
      }
    } catch (e) {
      setUploadStatus(null);
      setError(e instanceof Error ? e.message : "No se pudo procesar el archivo IFC.");
    }
  }

  const currentModel = models.find((m) => m.id === selectedModelId) ?? null;
  const currentElements = elements.filter((e) => e.bim_model_id === selectedModelId);
  const budgetItemById = new Map(budgetItems.map((b) => [b.id, b]));
  const matchesByElement = new Map<string, BimBudgetMatch[]>();
  for (const m of matches) {
    (matchesByElement.get(m.bim_element_id) ?? matchesByElement.set(m.bim_element_id, []).get(m.bim_element_id)!).push(m);
  }

  async function handleConfirm(elementId: string, budgetItemId: string) {
    setError(null);
    const result = await confirmBimMatch(projectId, elementId, budgetItemId);
    if (result.error) setError(result.error);
    await refresh();
  }

  async function handleDeleteModel(modelId: string) {
    if (!confirm("¿Eliminar este modelo IFC y todos sus elementos/matches? Esta acción no se puede deshacer.")) return;
    const result = await deleteBimModel(projectId, modelId);
    if (result.error) setError(result.error);
    if (selectedModelId === modelId) setSelectedModelId(null);
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--muted)]">
        El BIM aporta cantidades; el presupuesto aporta precios. Subí un IFC para extraer sus elementos y
        cantidades, y confirmá manualmente a qué ítem del presupuesto corresponde cada uno. Ningún precio se
        calcula sin tu confirmación.
      </div>

      {error ? (
        <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept=".ifc"
          disabled={!!uploadStatus}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = "";
          }}
          className="text-[13px] file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--panel-2)] file:px-3 file:py-1.5 file:text-[13px] file:cursor-pointer"
        />
        {uploadStatus ? <span className="text-[12px] text-[var(--muted)]">{uploadStatus}</span> : null}
      </div>

      {loading ? (
        <div className="text-[13px] text-[var(--muted)]">Cargando…</div>
      ) : models.length === 0 ? (
        <div className="text-[13px] text-[var(--muted)]">Todavía no se subió ningún modelo IFC para esta obra.</div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {models.map((m) => (
              <button
                key={m.id}
                onClick={() => setSelectedModelId(m.id)}
                className={`rounded-md border px-3 py-1.5 text-[12px] ${
                  m.id === selectedModelId
                    ? "border-[var(--accent)] bg-[var(--accent)]/10"
                    : "border-[var(--border)] bg-[var(--panel-2)]"
                }`}
              >
                {m.file_name} · {m.element_count} elem.{" "}
                {m.status === "ERROR" ? <span className="text-[var(--error)]">(error)</span> : null}
              </button>
            ))}
          </div>

          {currentModel ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-[12px] text-[var(--muted)]">
                  Esquema {currentModel.schema ?? "?"} · {currentElements.length} elementos
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null);
                        const result = await generateMatchSuggestions(projectId, currentModel.id);
                        if (result.error) setError(result.error);
                        await refresh();
                      })
                    }
                  >
                    {pending ? "Calculando…" : "Recalcular sugerencias"}
                  </Button>
                  <Button variant="secondary" onClick={() => handleDeleteModel(currentModel.id)}>
                    Eliminar modelo
                  </Button>
                </div>
              </div>

              {currentModel.error_message ? (
                <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
                  {currentModel.error_message}
                </div>
              ) : null}

              <div className="space-y-2">
                {currentElements.map((el) => {
                  const elMatches = (matchesByElement.get(el.id) ?? []).filter((m) => m.status !== "DESCARTADO");
                  const confirmed = elMatches.find((m) => m.status === "CONFIRMADO");
                  const proposed = elMatches.filter((m) => m.status === "PROPUESTO").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
                  const confirmedItem = confirmed ? budgetItemById.get(confirmed.budget_item_id) : null;

                  return (
                    <div key={el.id} className="rounded border border-[var(--border)] p-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <span className="font-medium">{el.name || el.ifc_type}</span>
                          <span className="text-[11px] text-[var(--muted)] ml-2">
                            {el.ifc_type}
                            {el.building_storey ? ` · ${el.building_storey}` : ""}
                            {el.material ? ` · ${el.material}` : ""}
                          </span>
                        </div>
                        <div className="text-[13px] font-mono">
                          {el.quantity_value != null ? (
                            <>
                              {formatNumber(el.quantity_value, 2)} {el.quantity_unit}
                              <span className="text-[11px] text-[var(--muted)] ml-1">
                                ({QUANTITY_LABEL[el.quantity_type ?? ""] ?? el.quantity_type},{" "}
                                {el.quantity_source === "IFC_QTO" ? "Qto IFC" : "propiedad IFC"})
                              </span>
                            </>
                          ) : (
                            <span className="text-[var(--muted)]">Sin cantidad en el IFC</span>
                          )}
                        </div>
                      </div>

                      {confirmedItem ? (
                        <div className="mt-2 rounded bg-[var(--success-bg,var(--panel-2))] px-2.5 py-1.5 text-[12px] flex items-center justify-between">
                          <span>
                            ✓ {confirmedItem.code} — {confirmedItem.description}
                          </span>
                          {el.quantity_value != null && confirmedItem.unit_price != null ? (
                            <span className="font-mono">
                              {formatNumber(el.quantity_value, 2)} {el.quantity_unit} ×{" "}
                              {formatMoney(confirmedItem.unit_price, "PYG")} ={" "}
                              {formatMoney(el.quantity_value * confirmedItem.unit_price, "PYG")}
                            </span>
                          ) : (
                            <span className="text-[var(--muted)]">PRECIO NO DISPONIBLE</span>
                          )}
                        </div>
                      ) : proposed.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {proposed.map((m) => {
                            const item = budgetItemById.get(m.budget_item_id);
                            if (!item) return null;
                            return (
                              <button
                                key={m.id}
                                onClick={() => handleConfirm(el.id, item.id)}
                                className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-[11px] hover:border-[var(--accent)]"
                                title={`Confirmar match con ${item.code} — ${item.description}`}
                              >
                                [{Math.round((m.score ?? 0) * 100)}%] {item.code} — {item.description}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-2 text-[11px] text-[var(--muted)]">
                          Sin sugerencias compatibles en el presupuesto actual.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
