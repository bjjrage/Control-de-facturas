"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/browser";
import { formatNumber, formatMoney, calcLineSubtotal } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { unitsCompatibleForCosting } from "@/lib/bim/matching";
import { findElementByExpressId } from "@/lib/bim/identity";
import type { BimModel, BimElement, BimElementGroup, BimGroupMatch, BudgetItem } from "@/lib/types";
import type { IfcViewerHandle } from "@/lib/bim/ifc-viewer.client";
import {
  getBimData,
  getBimGroupsData,
  getBimUploadSlot,
  getBimModelFileUrl,
  registerBimModel,
  processBimGroups,
  confirmGroupMatch,
  rejectGroupMatch,
  deleteBimModel,
  type ParsedElementInput,
  type ProcessBimGroupsResult,
} from "./bim-actions";
import { ComputoSection } from "./computo-section";

const QUANTITY_LABEL: Record<string, string> = {
  length: "Longitud",
  area: "Área",
  volume: "Volumen",
  count: "Cantidad",
  weight: "Peso",
};

const GROUP_STATUS_LABEL: Record<string, string> = {
  SUGGESTED: "Sugerido",
  REVIEW: "A revisar",
  REVIEW_REQUIRED: "Revisión obligatoria",
  NO_MATCH: "Sin correspondencia",
  CONFIRMED: "Confirmado",
  REJECTED: "Sin asignar",
};

export function BimSection({ projectId }: { projectId: string }) {
  const [models, setModels] = useState<BimModel[]>([]);
  const [elements, setElements] = useState<BimElement[]>([]);
  const [budgetItems, setBudgetItems] = useState<BudgetItem[]>([]);
  const [groups, setGroups] = useState<BimElementGroup[]>([]);
  const [groupMatches, setGroupMatches] = useState<BimGroupMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [focusedGroupId, setFocusedGroupId] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);
  const [viewerStatus, setViewerStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [processingResult, setProcessingResult] = useState<ProcessBimGroupsResult | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [changingGroupId, setChangingGroupId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const viewerHandleRef = useRef<IfcViewerHandle | null>(null);
  const loadedModelIdRef = useRef<string | null>(null);
  const reviewSectionRef = useRef<HTMLDivElement | null>(null);

  async function refresh() {
    setLoading(true);
    const data = await getBimData(projectId);
    setModels(data.models);
    setElements(data.elements);
    setBudgetItems(data.budgetItems);
    setError(data.error);
    setLoading(false);
    if (data.models.length > 0 && !selectedModelId) setSelectedModelId(data.models[0].id);
  }

  async function refreshGroups(modelId: string) {
    const data = await getBimGroupsData(projectId, modelId);
    setGroups(data.groups);
    setGroupMatches(data.matches);
    if (data.error) setError(data.error);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    refresh();
  }, [projectId]);

  useEffect(() => {
    if (!selectedModelId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
    refreshGroups(selectedModelId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedModelId]);

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
            setFocusedGroupId(el?.group_id ?? null);
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
    setProcessingResult(null);
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
        setUploadStatus("Agrupando elementos y consultando al matcher semántico…");
        startTransition(async () => {
          const processResult = await processBimGroups(projectId, result.modelId!);
          setUploadStatus(null);
          setProcessingResult(processResult);
          if (processResult.error) setError(processResult.error);
          await refreshGroups(result.modelId!);
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
  const matchableBudgetItems = useMemo(() => {
    const parentIds = new Set(budgetItems.map((b) => b.parent_id).filter(Boolean));
    return budgetItems.filter((b) => !parentIds.has(b.id) && b.unit_price != null);
  }, [budgetItems]);

  // Un grupo puede tener varias propuestas históricas (ej. tras "Recalcular");
  // nos quedamos con la más reciente que no esté descartada por una decisión
  // humana posterior.
  const latestMatchByGroup = useMemo(() => {
    const byGroup = new Map<string, BimGroupMatch[]>();
    for (const m of groupMatches) (byGroup.get(m.group_id) ?? byGroup.set(m.group_id, []).get(m.group_id)!).push(m);
    const result = new Map<string, BimGroupMatch>();
    for (const [groupId, list] of byGroup) {
      const confirmed = list.find((m) => m.status === "CONFIRMED");
      const rejected = list.find((m) => m.status === "REJECTED");
      const latest = [...list].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))[0];
      result.set(groupId, confirmed ?? rejected ?? latest);
    }
    return result;
  }, [groupMatches]);

  const selectedElement = currentElements.find((e) => e.id === selectedElementId) ?? null;

  const currentGroups = useMemo(() => groups.filter((g) => g.bim_model_id === selectedModelId), [groups, selectedModelId]);
  const elementsByGroup = useMemo(() => {
    const map = new Map<string, BimElement[]>();
    for (const e of currentElements) {
      if (!e.group_id) continue;
      (map.get(e.group_id) ?? map.set(e.group_id, []).get(e.group_id)!).push(e);
    }
    return map;
  }, [currentElements]);

  const visibleElements = focusedGroupId ? elementsByGroup.get(focusedGroupId) ?? [] : currentElements;

  async function handleConfirmGroup(groupId: string, budgetItemId: string) {
    setError(null);
    const result = await confirmGroupMatch(projectId, groupId, budgetItemId);
    if (result.error) setError(result.error);
    setChangingGroupId(null);
    if (selectedModelId) await refreshGroups(selectedModelId);
  }

  async function handleRejectGroup(groupId: string) {
    setError(null);
    const result = await rejectGroupMatch(projectId, groupId);
    if (result.error) setError(result.error);
    if (selectedModelId) await refreshGroups(selectedModelId);
  }

  function focusGroup(groupId: string) {
    setFocusedGroupId((prev) => (prev === groupId ? null : groupId));
    const firstElement = elementsByGroup.get(groupId)?.[0];
    if (firstElement) {
      setSelectedElementId(firstElement.id);
      if (firstElement.express_id != null) viewerHandleRef.current?.fitSelection();
    }
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
    if (selectedModelId === modelId) {
      setSelectedModelId(null);
      setGroups([]);
      setGroupMatches([]);
      setProcessingResult(null);
    }
    await refresh();
  }

  // Presupuesto resultante: agrega por budget_item todos los grupos
  // CONFIRMADOS que apuntan a él. El precio SIEMPRE viene de budget_items —
  // DeepSeek nunca genera precio, solo propuso a qué budget_item corresponde
  // cada grupo.
  const finalBudgetRows = useMemo(() => {
    const byItem = new Map<string, { item: BudgetItem; groups: BimElementGroup[] }>();
    for (const group of currentGroups) {
      const match = latestMatchByGroup.get(group.id);
      if (!match || match.status !== "CONFIRMED" || !match.budget_item_id) continue;
      const item = budgetItemById.get(match.budget_item_id);
      if (!item) continue;
      const entry = byItem.get(item.id) ?? { item, groups: [] };
      entry.groups.push(group);
      byItem.set(item.id, entry);
    }
    return [...byItem.values()].map(({ item, groups: itemGroups }) => {
      const compatibleGroups = itemGroups.filter(
        (g) => g.total_quantity != null && unitsCompatibleForCosting(g.quantity_unit, item.unit)
      );
      const incompatibleCount = itemGroups.length - compatibleGroups.length;
      const totalQuantity =
        compatibleGroups.length > 0 ? compatibleGroups.reduce((s, g) => s + (g.total_quantity ?? 0), 0) : null;
      const total = totalQuantity != null && item.unit_price != null ? calcLineSubtotal(totalQuantity, item.unit_price) : null;
      return { item, totalQuantity, total, groupCount: itemGroups.length, incompatibleCount };
    });
  }, [currentGroups, latestMatchByGroup, budgetItemById]);

  return (
    <div className="space-y-4">
      <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] text-[var(--muted)]">
        El BIM aporta cantidades; el presupuesto aporta precios. Subí un IFC: los elementos técnicamente
        equivalentes se agrupan y se consultan en lote contra el catálogo de costos. Vos confirmás cada grupo —
        ningún precio se calcula sin tu confirmación.
      </div>

      <ComputoSection projectId={projectId} />

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

      {processingResult && !processingResult.error ? (
        <div className="rounded border border-[var(--accent)]/40 bg-[var(--accent)]/5 px-3 py-2.5 space-y-1.5">
          <div className="font-medium text-[13px]">BIM procesado</div>
          <div className="text-[12px] text-[var(--muted)]">
            {processingResult.elementCount} elementos · {processingResult.groupCount} grupos detectados
          </div>
          <div className="text-[12px] flex flex-wrap gap-x-4">
            <span>{processingResult.suggested} matches sugeridos</span>
            <span>{processingResult.review} requieren revisión</span>
            <span>{processingResult.reviewRequired} con conflicto técnico (revisión obligatoria)</span>
            <span>{processingResult.noMatch} sin correspondencia</span>
          </div>
          <Button
            onClick={() => {
              setShowReview(true);
              reviewSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Revisar presupuesto
          </Button>
        </div>
      ) : null}

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
                  setFocusedGroupId(null);
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
                  Esquema {currentModel.schema ?? "?"} · {currentElements.length} elementos · {currentGroups.length} grupos
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        setError(null);
                        const result = await processBimGroups(projectId, currentModel.id);
                        setProcessingResult(result);
                        if (result.error) setError(result.error);
                        await refreshGroups(currentModel.id);
                      })
                    }
                  >
                    {pending ? "Actualizando…" : "Actualizar resumen"}
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
                    <span className="text-[11px] text-[var(--muted)] uppercase tracking-wide">
                      Modelo 3D {focusedGroupId ? "— evidencia del grupo seleccionado" : ""}
                    </span>
                    <div className="flex gap-1">
                      {focusedGroupId ? (
                        <button
                          onClick={() => setFocusedGroupId(null)}
                          className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-0.5 text-[11px]"
                        >
                          Ver todos
                        </button>
                      ) : null}
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

                {/* Inspector: propiedades técnicas del elemento seleccionado (evidencia) */}
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

                      {selectedElement.group_id ? (
                        <button
                          onClick={() => focusGroup(selectedElement.group_id!)}
                          className="text-[11px] text-[var(--accent)] underline"
                        >
                          Ver los {elementsByGroup.get(selectedElement.group_id)?.length ?? 1} elementos de este grupo
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>

              {/* Listado de elementos (selección alternativa al click en 3D; se filtra si hay un grupo enfocado) */}
              <div className="space-y-1.5">
                {visibleElements.map((el) => {
                  const isSelected = el.id === selectedElementId;
                  return (
                    <button
                      key={el.id}
                      onClick={() => setSelectedElementId(el.id)}
                      className={`w-full text-left rounded border px-2.5 py-1.5 text-[12px] flex items-center justify-between ${
                        isSelected ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)]"
                      }`}
                    >
                      <span>
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

      {/* --- Revisión por grupo --- */}
      {currentGroups.length > 0 ? (
        <div ref={reviewSectionRef} className="space-y-2 pt-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Revisión por grupo</div>
            <button onClick={() => setShowReview((v) => !v)} className="text-[11px] text-[var(--accent)] underline">
              {showReview ? "Ocultar" : "Mostrar"}
            </button>
          </div>

          {showReview ? (
            <div className="space-y-2">
              {currentGroups.map((group) => {
                const match = latestMatchByGroup.get(group.id);
                const suggestedItem = match?.budget_item_id ? budgetItemById.get(match.budget_item_id) ?? null : null;
                const total =
                  group.total_quantity != null && suggestedItem?.unit_price != null
                    ? calcLineSubtotal(group.total_quantity, suggestedItem.unit_price)
                    : null;
                const status = match?.status ?? "REVIEW";

                return (
                  <div
                    key={group.id}
                    className={`rounded border p-3 space-y-2 ${
                      focusedGroupId === group.id ? "border-[var(--accent)]" : "border-[var(--border)]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <button onClick={() => focusGroup(group.id)} className="text-left">
                        <div className="font-medium text-[13px]">{group.normalized_name}</div>
                        <div className="text-[11px] text-[var(--muted)]">
                          {group.ifc_type}
                          {group.material ? ` · ${group.material}` : ""} · {group.element_count} elemento
                          {group.element_count !== 1 ? "s" : ""}
                        </div>
                      </button>
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
                                  : status === "REVIEW"
                                    ? "bg-[var(--panel-2)] text-[var(--fg)]"
                                    : "bg-[var(--panel-2)] text-[var(--fg)]"
                        }`}
                      >
                        {GROUP_STATUS_LABEL[status] ?? status}
                      </span>
                    </div>

                    <div className="font-mono text-[12px]">
                      {group.total_quantity != null ? `${formatNumber(group.total_quantity, 2)} ${group.quantity_unit}` : "sin cantidad"}
                    </div>

                    {status === "CONFIRMED" && suggestedItem ? (
                      <div className="rounded bg-[var(--panel-2)] px-2.5 py-1.5 text-[12px] flex items-center justify-between">
                        <span>
                          ✓ {suggestedItem.code} — {suggestedItem.description} — {formatMoney(suggestedItem.unit_price, "PYG")}/
                          {suggestedItem.unit}
                        </span>
                        <span className="font-mono">{total != null ? formatMoney(total, "PYG") : "—"}</span>
                      </div>
                    ) : status === "SUGGESTED" && suggestedItem ? (
                      <div className="rounded border border-[var(--border)] px-2.5 py-1.5 text-[12px] space-y-1">
                        <div className="flex items-center justify-between">
                          <span>
                            {suggestedItem.code} — {suggestedItem.description} — {formatMoney(suggestedItem.unit_price, "PYG")}/
                            {suggestedItem.unit}
                          </span>
                          <span className="font-mono text-[11px]">
                            {match?.score != null ? `${Math.round(match.score * 100)}%` : ""}
                          </span>
                        </div>
                        {total != null ? <div className="font-mono text-[13px]">Total: {formatMoney(total, "PYG")}</div> : null}
                        {match?.reason ? <div className="text-[11px] text-[var(--muted)]">{match.reason}</div> : null}
                      </div>
                    ) : status === "REVIEW_REQUIRED" ? (
                      <div className="rounded border border-[var(--warn)]/40 bg-[var(--warn-bg)] px-2.5 py-1.5 text-[12px] space-y-1">
                        <div className="text-[var(--warn)]">
                          ⚠ Input técnico contradictorio o ambiguo — revisión humana obligatoria, no se puede confirmar automáticamente.
                        </div>
                        {suggestedItem ? (
                          <div className="text-[11px] text-[var(--muted)]">
                            Sugerencia de DeepSeek (no auto-confirmable): {suggestedItem.code} — {suggestedItem.description}
                          </div>
                        ) : null}
                        {match?.reason ? <div className="text-[11px] text-[var(--muted)]">{match.reason}</div> : null}
                      </div>
                    ) : status === "REVIEW" ? (
                      <div className="text-[11px] text-[var(--muted)]">
                        {match?.reason || "Requiere revisión manual: información insuficiente para elegir un rubro con confianza."}
                      </div>
                    ) : status === "NO_MATCH" ? (
                      <div className="text-[11px] text-[var(--muted)]">
                        {match?.reason || "No se encontró un rubro económico equivalente en el catálogo."}
                      </div>
                    ) : null}

                    {status !== "REJECTED" ? (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {status === "SUGGESTED" && match?.budget_item_id ? (
                          <Button onClick={() => handleConfirmGroup(group.id, match.budget_item_id!)}>Confirmar</Button>
                        ) : null}
                        {changingGroupId === group.id ? (
                          <select
                            className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-[12px]"
                            defaultValue=""
                            onChange={(e) => {
                              if (e.target.value) handleConfirmGroup(group.id, e.target.value);
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
                          <Button variant="secondary" onClick={() => setChangingGroupId(group.id)}>
                            Cambiar rubro
                          </Button>
                        )}
                        <Button variant="secondary" onClick={() => handleRejectGroup(group.id)}>
                          Dejar sin asignar
                        </Button>
                      </div>
                    ) : (
                      <button onClick={() => setChangingGroupId(group.id)} className="text-[11px] text-[var(--accent)] underline">
                        Asignar un rubro igualmente
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* --- Presupuesto resultante --- */}
      {finalBudgetRows.length > 0 ? (
        <div className="space-y-1.5 pt-2">
          <div className="text-[11px] text-[var(--muted)] uppercase tracking-wide">Presupuesto resultante (grupos confirmados)</div>
          <div className="overflow-x-auto rounded border border-[var(--border)]">
            <table>
              <thead>
                <tr>
                  <th>Rubro</th>
                  <th className="num">Cantidad BIM</th>
                  <th>Unidad</th>
                  <th className="num">Precio unitario</th>
                  <th className="num">Total</th>
                </tr>
              </thead>
              <tbody>
                {finalBudgetRows.map(({ item, totalQuantity, total, incompatibleCount }) => (
                  <tr key={item.id}>
                    <td>
                      {item.code} — {item.description}
                      {incompatibleCount > 0 ? (
                        <div className="text-[11px] text-[var(--error)]">
                          {incompatibleCount} grupo(s) con unidad incompatible excluido(s)
                        </div>
                      ) : null}
                    </td>
                    <td className="num">{totalQuantity != null ? formatNumber(totalQuantity, 2) : "—"}</td>
                    <td>{item.unit}</td>
                    <td className="num">{formatMoney(item.unit_price, "PYG")}</td>
                    <td className="num font-mono">{total != null ? formatMoney(total, "PYG") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-[var(--muted)]">
            El precio siempre viene de budget_items — DeepSeek nunca genera precio, solo propone a qué rubro
            corresponde cada grupo.
          </p>
        </div>
      ) : null}
    </div>
  );
}
