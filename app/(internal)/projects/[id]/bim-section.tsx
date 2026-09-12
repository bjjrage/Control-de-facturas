"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { formatNumber, formatMoney, calcLineSubtotal } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { aggregateElementsForBudgetItem, unitsCompatibleForCosting } from "@/lib/bim/matching";
import { findElementByExpressId } from "@/lib/bim/identity";
import type { BimModel, BimElement, BimBudgetMatch, BudgetItem } from "@/lib/types";
import type { IfcViewerHandle } from "@/lib/bim/ifc-viewer.client";
import {
  getBimData,
  getBimUploadSlot,
  getBimModelFileUrl,
  registerBimModel,
  generateMatchSuggestions,
  confirmBimMatch,
  applyBimQuantityToBudgetItem,
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
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [viewerStatus, setViewerStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerHandleRef = useRef<IfcViewerHandle | null>(null);
  const loadedModelIdRef = useRef<string | null>(null);

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

  // Carga (o recarga) el viewer 3D cuando cambia el modelo seleccionado. Solo
  // recrea el viewer si el modelo cargado cambió (loadedModelIdRef) — si el
  // efecto vuelve a correr porque cambió `elements` (ej. tras confirmar un
  // match), reusa el viewer ya creado y solo refresca el closure de
  // selección con la lista de elementos actual.
  useEffect(() => {
    let cancelled = false;
    async function loadViewer() {
      if (!selectedModelId || !viewerContainerRef.current) return;
      if (loadedModelIdRef.current === selectedModelId) return;

      viewerHandleRef.current?.dispose();
      viewerHandleRef.current = null;
      loadedModelIdRef.current = null;
      setViewerStatus("Cargando visor 3D…");
      try {
        const { createIfcViewer } = await import("@/lib/bim/ifc-viewer.client");
        const { url, error: urlError } = await getBimModelFileUrl(projectId, selectedModelId);
        if (urlError || !url) throw new Error(urlError ?? "No se pudo obtener el archivo.");
        const res = await fetch(url);
        const buffer = new Uint8Array(await res.arrayBuffer());
        if (cancelled || !viewerContainerRef.current) return;

        const handle = createIfcViewer(viewerContainerRef.current, {
          onSelect: (expressId) => {
            if (expressId == null) {
              setSelectedElementId(null);
              return;
            }
            const el = selectedModelId ? findElementByExpressId(elements, selectedModelId, expressId) : null;
            setSelectedElementId(el?.id ?? null);
          },
        });
        await handle.loadFromBuffer(buffer);
        if (cancelled) {
          handle.dispose();
          return;
        }
        viewerHandleRef.current = handle;
        loadedModelIdRef.current = selectedModelId;
        setViewerStatus(null);
      } catch (e) {
        if (!cancelled) setViewerStatus(e instanceof Error ? e.message : "No se pudo cargar el visor 3D.");
      }
    }
    loadViewer();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId, elements]);

  // Selección desde el listado -> resaltar en el viewer.
  useEffect(() => {
    if (!selectedElementId) {
      viewerHandleRef.current?.selectByExpressId(null);
      return;
    }
    const el = elements.find((e) => e.id === selectedElementId);
    if (el?.express_id != null) viewerHandleRef.current?.selectByExpressId(el.express_id);
  }, [selectedElementId, elements]);

  useEffect(() => {
    return () => {
      viewerHandleRef.current?.dispose();
    };
  }, []);

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
        expressId: e.expressId,
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
  const currentElements = useMemo(
    () => elements.filter((e) => e.bim_model_id === selectedModelId),
    [elements, selectedModelId]
  );
  const budgetItemById = useMemo(() => new Map(budgetItems.map((b) => [b.id, b])), [budgetItems]);
  const matchesByElement = useMemo(() => {
    const map = new Map<string, BimBudgetMatch[]>();
    for (const m of matches) (map.get(m.bim_element_id) ?? map.set(m.bim_element_id, []).get(m.bim_element_id)!).push(m);
    return map;
  }, [matches]);

  const selectedElement = currentElements.find((e) => e.id === selectedElementId) ?? null;
  const selectedElMatches = selectedElement ? (matchesByElement.get(selectedElement.id) ?? []).filter((m) => m.status !== "DESCARTADO") : [];
  const confirmedMatch = selectedElMatches.find((m) => m.status === "CONFIRMADO") ?? null;
  const proposedMatches = selectedElMatches.filter((m) => m.status === "PROPUESTO").sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const confirmedItem = confirmedMatch ? budgetItemById.get(confirmedMatch.budget_item_id) ?? null : null;

  // Rubros con al menos un match confirmado -> agregación de cantidad BIM.
  const aggregationRows = useMemo(() => {
    const confirmedByBudgetItem = new Map<string, string[]>();
    for (const m of matches) {
      if (m.status !== "CONFIRMADO") continue;
      (confirmedByBudgetItem.get(m.budget_item_id) ?? confirmedByBudgetItem.set(m.budget_item_id, []).get(m.budget_item_id)!).push(
        m.bim_element_id
      );
    }
    const elementById = new Map(elements.map((e) => [e.id, e]));
    return [...confirmedByBudgetItem.entries()]
      .map(([budgetItemId, elIds]) => {
        const item = budgetItemById.get(budgetItemId);
        if (!item) return null;
        const els = elIds.map((id) => elementById.get(id)).filter((e): e is BimElement => !!e);
        const agg = aggregateElementsForBudgetItem(els, item);
        return { item, elementCount: els.length, ...agg };
      })
      .filter((r): r is NonNullable<typeof r> => !!r);
  }, [matches, elements, budgetItemById]);

  async function handleConfirm(elementId: string, budgetItemId: string) {
    setError(null);
    const result = await confirmBimMatch(projectId, elementId, budgetItemId);
    if (result.error) setError(result.error);
    await refresh();
  }

  async function handleApplyQuantity(budgetItemId: string) {
    setError(null);
    const result = await applyBimQuantityToBudgetItem(projectId, budgetItemId);
    if (result.error) setError(result.error);
    else if (result.warning) setError(result.warning);
    await refresh();
  }

  async function handleDeleteModel(modelId: string) {
    if (!confirm("¿Eliminar este modelo IFC y todos sus elementos/matches? Esta acción no se puede deshacer.")) return;
    if (loadedModelIdRef.current === modelId) {
      viewerHandleRef.current?.dispose();
      viewerHandleRef.current = null;
      loadedModelIdRef.current = null;
    }
    const result = await deleteBimModel(projectId, modelId);
    if (result.error) setError(result.error);
    if (selectedModelId === modelId) setSelectedModelId(null);
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--muted)]">
        El BIM aporta cantidades; el presupuesto aporta precios. Subí un IFC, seleccioná un elemento (en el
        visor o en la lista) y confirmá manualmente a qué ítem del presupuesto corresponde. Ningún precio se
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
                onClick={() => {
                  setSelectedElementId(null);
                  setSelectedModelId(m.id);
                }}
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
            <>
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

              {/* Área central: visor 3D + inspector del elemento seleccionado */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Modelo 3D</span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => viewerHandleRef.current?.fitAll()}
                        className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px]"
                      >
                        Fit all
                      </button>
                      <button
                        onClick={() => viewerHandleRef.current?.fitSelection()}
                        disabled={!selectedElementId}
                        className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px] disabled:opacity-40"
                      >
                        Fit selection
                      </button>
                    </div>
                  </div>
                  <div className="relative rounded border border-[var(--border)] bg-[#f4f4f5] h-[480px] overflow-hidden">
                    <div ref={viewerContainerRef} className="absolute inset-0" />
                    {viewerStatus ? (
                      <div className="absolute inset-0 flex items-center justify-center bg-white/70 text-[12px] text-[var(--muted)]">
                        {viewerStatus}
                      </div>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-[var(--muted)]">
                    Click en un elemento para seleccionarlo · arrastrar para orbitar · rueda para zoom.
                  </p>
                </div>

                {/* Inspector: propiedades + flujo económico del elemento seleccionado */}
                <div className="rounded border border-[var(--border)] p-3 space-y-3 max-h-[480px] overflow-y-auto">
                  {!selectedElement ? (
                    <div className="text-[12px] text-[var(--muted)]">
                      Seleccioná un elemento en el visor o en la lista de abajo para ver sus propiedades.
                    </div>
                  ) : (
                    <>
                      <div>
                        <div className="font-medium">{selectedElement.name || selectedElement.ifc_type}</div>
                        <dl className="text-[12px] text-[var(--muted)] mt-1 space-y-0.5">
                          <div>
                            <dt className="inline">IFC Type: </dt>
                            <dd className="inline text-[var(--fg)]">{selectedElement.ifc_type}</dd>
                          </div>
                          <div>
                            <dt className="inline">GUID: </dt>
                            <dd className="inline font-mono text-[11px] text-[var(--fg)]">{selectedElement.ifc_guid}</dd>
                          </div>
                          <div>
                            <dt className="inline">Nivel: </dt>
                            <dd className="inline text-[var(--fg)]">{selectedElement.building_storey ?? "—"}</dd>
                          </div>
                          <div>
                            <dt className="inline">Material: </dt>
                            <dd className="inline text-[var(--fg)]">{selectedElement.material ?? "—"}</dd>
                          </div>
                        </dl>
                      </div>

                      <div className="rounded bg-[var(--panel-2)] px-2.5 py-2 text-[12px]">
                        {selectedElement.quantity_value != null ? (
                          <>
                            <div className="font-mono text-[14px]">
                              {formatNumber(selectedElement.quantity_value, 2)} {selectedElement.quantity_unit}
                            </div>
                            <div className="text-[11px] text-[var(--muted)] mt-0.5">
                              {QUANTITY_LABEL[selectedElement.quantity_type ?? ""] ?? selectedElement.quantity_type} ·{" "}
                              {selectedElement.quantity_source === "IFC_QTO" ? "Quantity Set IFC" : "Propiedad IFC"}
                              {selectedElement.quantity_property ? ` · ${selectedElement.quantity_property}` : ""}
                            </div>
                          </>
                        ) : Array.isArray(selectedElement.properties?._quantity_ambiguous) ? (
                          <div className="text-[var(--error)]">
                            Cantidad ambigua — hay más de un Quantity Set candidato con valores distintos, requiere
                            revisión manual:
                            <ul className="list-disc list-inside mt-1 font-mono text-[11px]">
                              {(selectedElement.properties._quantity_ambiguous as string[]).map((c) => (
                                <li key={c}>{c}</li>
                              ))}
                            </ul>
                          </div>
                        ) : typeof selectedElement.properties?._quantity_unit_unresolved === "string" ? (
                          <div className="text-[var(--error)]">
                            Unidad de proyecto no reconocida — no se puede convertir de forma segura a m/m²/m³:
                            <div className="font-mono text-[11px] mt-1">
                              {selectedElement.properties._quantity_unit_unresolved as string}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[var(--muted)]">Sin cantidad extraída del IFC</span>
                        )}
                      </div>

                      <div className="border-t border-[var(--border)] pt-2">
                        <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide mb-1.5">
                          Rubro económico
                        </div>
                        {confirmedItem ? (
                          <div className="space-y-1.5">
                            <div className="text-[12px]">
                              ✓ {confirmedItem.code} — {confirmedItem.description}
                            </div>
                            {selectedElement.quantity_value != null && confirmedItem.unit_price != null ? (
                              unitsCompatibleForCosting(selectedElement.quantity_unit, confirmedItem.unit) ? (
                                <div className="font-mono text-[13px]">
                                  {formatNumber(selectedElement.quantity_value, 2)} {selectedElement.quantity_unit} ×{" "}
                                  {formatMoney(confirmedItem.unit_price, "PYG")} ={" "}
                                  <strong>
                                    {formatMoney(calcLineSubtotal(selectedElement.quantity_value, confirmedItem.unit_price), "PYG")}
                                  </strong>
                                </div>
                              ) : (
                                <div className="text-[11px] text-[var(--error)]">
                                  Unidad BIM ({selectedElement.quantity_unit ?? "sin unidad"}) incompatible con la
                                  unidad del rubro ({confirmedItem.unit ?? "sin unidad"}) — no se calcula total.
                                </div>
                              )
                            ) : (
                              <div className="text-[12px] text-[var(--muted)]">PRECIO NO DISPONIBLE</div>
                            )}
                          </div>
                        ) : proposedMatches.length > 0 ? (
                          <div className="space-y-1.5">
                            {proposedMatches.map((m) => {
                              const item = budgetItemById.get(m.budget_item_id);
                              if (!item) return null;
                              return (
                                <button
                                  key={m.id}
                                  onClick={() => handleConfirm(selectedElement.id, item.id)}
                                  className="block w-full text-left rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1.5 text-[11px] hover:border-[var(--accent)]"
                                >
                                  <span className="font-mono">{Math.round((m.score ?? 0) * 100)}%</span> — {item.code} —{" "}
                                  {item.description}
                                  {item.unit_price != null ? ` — ${formatMoney(item.unit_price, "PYG")}/${item.unit ?? ""}` : ""}
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="text-[11px] text-[var(--muted)]">Sin sugerencias compatibles.</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Listado de elementos (selección alternativa al click en 3D) */}
              <div className="space-y-1.5">
                {currentElements.map((el) => {
                  const isSelected = el.id === selectedElementId;
                  const elMatches = (matchesByElement.get(el.id) ?? []).filter((m) => m.status !== "DESCARTADO");
                  const hasConfirmed = elMatches.some((m) => m.status === "CONFIRMADO");
                  return (
                    <button
                      key={el.id}
                      onClick={() => setSelectedElementId(el.id)}
                      className={`w-full text-left rounded border px-2.5 py-1.5 text-[12px] flex items-center justify-between ${
                        isSelected ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)]"
                      }`}
                    >
                      <span>
                        {hasConfirmed ? "✓ " : ""}
                        {el.name || el.ifc_type}
                        <span className="text-[11px] text-[var(--muted)] ml-2">
                          {el.ifc_type}
                          {el.building_storey ? ` · ${el.building_storey}` : ""}
                        </span>
                      </span>
                      <span className="font-mono text-[11px]">
                        {el.quantity_value != null ? `${formatNumber(el.quantity_value, 2)} ${el.quantity_unit}` : "—"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>
      )}

      {aggregationRows.length > 0 ? (
        <div className="space-y-1.5">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">
            Rubros con elementos BIM confirmados
          </div>
          <div className="overflow-x-auto rounded border border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Rubro</th>
                  <th className="num">Elementos</th>
                  <th className="num">Cant. presupuesto</th>
                  <th className="num">Cant. BIM</th>
                  <th className="num">Diferencia</th>
                  <th className="num">P. Unit.</th>
                  <th className="num">Total (cant. BIM)</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {aggregationRows.map(({ item, elementCount, totalQuantity, incompatible, unit }) => {
                  const diff = totalQuantity != null && item.quantity != null ? totalQuantity - item.quantity : null;
                  const total =
                    totalQuantity != null && item.unit_price != null ? calcLineSubtotal(totalQuantity, item.unit_price) : null;
                  return (
                    <tr key={item.id}>
                      <td>
                        {item.code} — {item.description}
                        {incompatible.length > 0 ? (
                          <div className="text-[11px] text-[var(--error)]">
                            {incompatible.length} elemento(s) con unidad incompatible excluido(s)
                          </div>
                        ) : null}
                      </td>
                      <td className="num">{elementCount}</td>
                      <td className="num">{item.quantity != null ? `${formatNumber(item.quantity, 2)} ${unit ?? ""}` : "—"}</td>
                      <td className="num">{totalQuantity != null ? `${formatNumber(totalQuantity, 2)} ${unit ?? ""}` : "—"}</td>
                      <td className={`num ${diff != null && Math.abs(diff) > 0.01 ? "text-[var(--error)]" : ""}`}>
                        {diff != null ? `${diff > 0 ? "+" : ""}${formatNumber(diff, 2)}` : "—"}
                      </td>
                      <td className="num">{item.unit_price != null ? formatMoney(item.unit_price, "PYG") : "PRECIO NO DISPONIBLE"}</td>
                      <td className="num font-mono">{total != null ? formatMoney(total, "PYG") : "—"}</td>
                      <td>
                        {totalQuantity != null ? (
                          <button
                            onClick={() => handleApplyQuantity(item.id)}
                            className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-[11px] hover:border-[var(--accent)]"
                          >
                            Actualizar cant. presupuesto
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            &quot;Actualizar cant. presupuesto&quot; sobrescribe la cantidad del rubro con la suma BIM — es una acción
            explícita, nunca automática.
          </p>
        </div>
      ) : null}
    </div>
  );
}
