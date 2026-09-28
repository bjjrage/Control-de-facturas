"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Calculator, Upload, RefreshCw, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  listApuAction,
  getApuImportCatalogsAction,
  importApuMaterialsAction,
  importApuLaborAction,
  importApuEquipmentAction,
  importApuSubcontractsAction,
  deleteBudgetItemMaterialAction,
  deleteBudgetItemLaborAction,
  deleteBudgetItemEquipmentAction,
  deleteBudgetItemSubcontractAction,
  listLaborRatesAction,
  type ApuMaterialRow,
  type ApuLaborRow,
  type ApuEquipmentRow,
  type ApuSubcontractRow,
  type LaborRate,
} from "./apu-actions";
import {
  resolveApuMaterialImportMapping,
  resolveApuLaborImportMapping,
  resolveApuEquipmentImportMapping,
  resolveApuSubcontractImportMapping,
} from "@/lib/procurement/apu-import";
import { matchLaborRate } from "@/lib/procurement/apu-templates";

// Mismo parser PY que import-recipe-dialog.tsx / import-budget-dialog.
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
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

async function parseExcelRows(file: File): Promise<{ headers: string[]; rows: unknown[][] } | null> {
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
  if (raw.length < 2) return null;
  return { headers: (raw[0] as unknown[]).map(normHeader), rows: raw.slice(1) };
}

function money(n: number | null): string {
  if (n === null) return "—";
  return `Gs. ${Math.round(n).toLocaleString("es-PY")}`;
}

interface ApuDialogProps {
  projectId: string;
  budgetItemId: string;
  budgetItemLabel: string;
}

export function ApuDialog({ projectId, budgetItemId, budgetItemLabel }: ApuDialogProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [materials, setMaterials] = useState<ApuMaterialRow[]>([]);
  const [labor, setLabor] = useState<ApuLaborRow[]>([]);
  const [equipment, setEquipment] = useState<ApuEquipmentRow[]>([]);
  const [subcontracts, setSubcontracts] = useState<ApuSubcontractRow[]>([]);
  const [rates, setRates] = useState<LaborRate[]>([]);
  const [catalogs, setCatalogs] = useState<{
    budgetItems: { id: string; code: string; unit: string | null }[];
    products: { id: string; sku: string }[];
  } | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      listApuAction({ projectId, budgetItemId }),
      getApuImportCatalogsAction(projectId),
      listLaborRatesAction(),
    ]).then(([apuRes, catRes, ratesRes]) => {
      if (cancelled) return;
      if (apuRes.error) setLoadError(apuRes.error);
      else if (apuRes.data) {
        setMaterials(apuRes.data.materials);
        setLabor(apuRes.data.labor);
        setEquipment(apuRes.data.equipment);
        setSubcontracts(apuRes.data.subcontracts);
      }
      if (ratesRes.data) setRates(ratesRes.data);
      if (catRes.data) setCatalogs(catRes.data);
      else if (catRes.error) setLoadError((prev) => prev ?? catRes.error);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [open, projectId, budgetItemId]);

  function refresh() {
    listApuAction({ projectId, budgetItemId }).then((res) => {
      if (res.data) {
        setMaterials(res.data.materials);
        setLabor(res.data.labor);
        setEquipment(res.data.equipment);
        setSubcontracts(res.data.subcontracts);
      }
    });
    router.refresh();
  }

  async function handleDeleteSubcontract(id: string) {
    if (!window.confirm("¿Quitar este subcontrato del APU de la partida?")) return;
    const res = await deleteBudgetItemSubcontractAction({ projectId, id });
    if (!res.error) refresh();
  }

  // Si el rol coincide con una categoría de jornal, el costo sale de ahí
  // (el Excel puede traer el costo vacío en ese caso).
  function withRateCost<T extends { rol: string; costoHora: number | null }>(r: T): T {
    const rate = matchLaborRate(r.rol, rates);
    return rate ? { ...r, costoHora: rate.costo_hora } : r;
  }

  async function handleDeleteMaterial(id: string) {
    if (!window.confirm("¿Quitar este material del APU de la partida?")) return;
    const res = await deleteBudgetItemMaterialAction({ projectId, id });
    if (!res.error) refresh();
  }
  async function handleDeleteLabor(id: string) {
    if (!window.confirm("¿Quitar esta mano de obra del APU de la partida?")) return;
    const res = await deleteBudgetItemLaborAction({ projectId, id });
    if (!res.error) refresh();
  }
  async function handleDeleteEquipment(id: string) {
    if (!window.confirm("¿Quitar este equipo del APU de la partida?")) return;
    const res = await deleteBudgetItemEquipmentAction({ projectId, id });
    if (!res.error) refresh();
  }

  // Costo unitario APU: materiales (ley "nunca Gs. 0 fingido") + mano de obra + equipo.
  const materialsMissingCost = materials.filter((m) => m.costo_promedio === null);
  const costoMaterial =
    materialsMissingCost.length > 0
      ? null
      : materials.reduce(
          (acc, m) => acc + m.cantidad_por_unidad_ejecutada * (1 + m.desperdicio_pct / 100) * (m.costo_promedio ?? 0),
          0
        );
  const costoManoObra = labor.reduce((acc, l) => acc + l.horas_por_unidad_ejecutada * l.costo_hora, 0);
  const costoEquipo = equipment.reduce((acc, e) => acc + e.horas_por_unidad_ejecutada * e.costo_hora, 0);
  const costoSubcontrato = subcontracts.reduce((acc, s) => acc + s.precio_por_unidad, 0);
  const costoTotal = costoMaterial === null ? null : costoMaterial + costoManoObra + costoEquipo + costoSubcontrato;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" title="APU / BOM de la partida" className="h-6 w-6 p-0">
          <Calculator size={13} />
        </Button>
      </DialogTrigger>
      <DialogContent title={`APU — ${budgetItemLabel}`} className="max-w-4xl">
        <div className="space-y-5">
          {loading && <div className="text-xs text-[var(--muted)]">Cargando…</div>}
          {loadError && (
            <div className="flex items-center gap-2 text-xs text-red-500">
              <AlertTriangle className="h-4 w-4" /> {loadError}
            </div>
          )}

          {!loading && catalogs && (
            <>
              <ApuSection
                title="Materiales"
                helpText="Columnas: PARTIDA_CODIGO | PRODUCTO_CODIGO | CANTIDAD | DESPERDICIO_PCT (opcional)."
                colVariants={{
                  itemCode: ["partidacodigo", "codigopartida", "partida", "codigo", "item", "code"],
                  productSku: ["productocodigo", "codigoproducto", "sku", "codigo", "producto"],
                  quantity: ["cantidad", "cant", "qty", "quantity", "cantidadporunidad"],
                  extra: ["desperdicio", "desperdiciopct", "waste"],
                }}
                budgetItems={catalogs.budgetItems}
                buildRow={(get) => ({
                  itemCode: String(get("itemCode") ?? "").trim(),
                  productSku: String(get("productSku") ?? "").trim(),
                  quantityPerUnit: parsePyNumber(get("quantity")),
                  desperdicioPct: parsePyNumber(get("extra")),
                })}
                resolve={(rows) =>
                  resolveApuMaterialImportMapping(
                    rows.map((r) => ({
                      itemCode: r.itemCode,
                      productSku: r.productSku,
                      quantityPerUnit: r.quantityPerUnit ?? 0,
                      desperdicioPct: r.desperdicioPct ?? 0,
                    })),
                    catalogs.budgetItems,
                    catalogs.products
                  )
                }
                describeRow={(r) => `${r.itemCode || "—"} · ${r.productSku || "—"} · ${r.quantityPerUnit ?? "—"}`}
                onConfirm={async (rows) => {
                  const res = await importApuMaterialsAction({
                    projectId,
                    rows: rows.map((r) => ({
                      itemCode: r.itemCode,
                      productSku: r.productSku,
                      quantityPerUnit: r.quantityPerUnit ?? 0,
                      desperdicioPct: r.desperdicioPct ?? 0,
                    })),
                  });
                  if (res.errores.length === 0) refresh();
                  return res.errores;
                }}
              >
                {materials.length === 0 ? (
                  <p className="text-[11px] text-[var(--muted)]">Sin materiales cargados.</p>
                ) : (
                  <RowTable
                    columns={["Producto", "Cant./unidad", "Desperdicio", "Costo prom.", ""]}
                    rows={materials.map((m) => [
                      `${m.producto_nombre}${m.producto_sku ? ` (${m.producto_sku})` : ""}`,
                      `${m.cantidad_por_unidad_ejecutada} ${m.unidad_medida}`,
                      `${m.desperdicio_pct}%`,
                      m.costo_promedio === null ? (
                        <span className="text-amber-500">Sin costo</span>
                      ) : (
                        money(m.costo_promedio)
                      ),
                      <button key="del" onClick={() => handleDeleteMaterial(m.id)} className="text-[var(--muted)] hover:text-[var(--error)]">
                        <Trash2 size={13} />
                      </button>,
                    ])}
                  />
                )}
              </ApuSection>

              <ApuSection
                title="Mano de obra"
                helpText="Columnas: PARTIDA_CODIGO | ROL | HORAS | COSTO_HORA. Si el rol coincide con una categoría de Jornales, el costo sale de ahí."
                colVariants={{
                  itemCode: ["partidacodigo", "codigopartida", "partida", "codigo", "item", "code"],
                  label: ["rol", "role", "cargo"],
                  quantity: ["horas", "horasporunidad", "hours"],
                  extra: ["costohora", "costo", "cost"],
                }}
                budgetItems={catalogs.budgetItems}
                buildRow={(get) => ({
                  itemCode: String(get("itemCode") ?? "").trim(),
                  rol: String(get("label") ?? "").trim(),
                  horasPorUnidad: parsePyNumber(get("quantity")),
                  costoHora: parsePyNumber(get("extra")),
                })}
                resolve={(rows) =>
                  resolveApuLaborImportMapping(
                    rows.map((r) =>
                      withRateCost({
                        itemCode: r.itemCode,
                        rol: r.rol,
                        horasPorUnidad: r.horasPorUnidad ?? 0,
                        costoHora: r.costoHora ?? null,
                      })
                    ),
                    catalogs.budgetItems
                  )
                }
                describeRow={(r) => `${r.itemCode || "—"} · ${r.rol || "—"} · ${r.horasPorUnidad ?? "—"}h`}
                onConfirm={async (rows) => {
                  const res = await importApuLaborAction({
                    projectId,
                    rows: rows.map((r) => ({
                      itemCode: r.itemCode,
                      rol: r.rol,
                      horasPorUnidad: r.horasPorUnidad ?? 0,
                      costoHora: r.costoHora ?? null,
                    })),
                  });
                  if (res.errores.length === 0) refresh();
                  return res.errores;
                }}
              >
                {labor.length === 0 ? (
                  <p className="text-[11px] text-[var(--muted)]">Sin mano de obra cargada.</p>
                ) : (
                  <RowTable
                    columns={["Rol", "Categoría", "Horas/unidad", "Costo/hora", ""]}
                    rows={labor.map((l) => [
                      l.rol,
                      l.categoria ?? <span className="text-[var(--muted)]">Costo propio</span>,
                      String(l.horas_por_unidad_ejecutada),
                      money(l.costo_hora),
                      <button key="del" onClick={() => handleDeleteLabor(l.id)} className="text-[var(--muted)] hover:text-[var(--error)]">
                        <Trash2 size={13} />
                      </button>,
                    ])}
                  />
                )}
              </ApuSection>

              <ApuSection
                title="Equipo"
                helpText="Columnas: PARTIDA_CODIGO | TIPO_EQUIPO | HORAS | COSTO_HORA."
                colVariants={{
                  itemCode: ["partidacodigo", "codigopartida", "partida", "codigo", "item", "code"],
                  label: ["tipoequipo", "equipo", "equipment"],
                  quantity: ["horas", "horasporunidad", "hours"],
                  extra: ["costohora", "costo", "cost"],
                }}
                budgetItems={catalogs.budgetItems}
                buildRow={(get) => ({
                  itemCode: String(get("itemCode") ?? "").trim(),
                  tipoEquipo: String(get("label") ?? "").trim(),
                  horasPorUnidad: parsePyNumber(get("quantity")),
                  costoHora: parsePyNumber(get("extra")),
                })}
                resolve={(rows) =>
                  resolveApuEquipmentImportMapping(
                    rows.map((r) => ({
                      itemCode: r.itemCode,
                      tipoEquipo: r.tipoEquipo,
                      horasPorUnidad: r.horasPorUnidad ?? 0,
                      costoHora: r.costoHora ?? null,
                    })),
                    catalogs.budgetItems
                  )
                }
                describeRow={(r) => `${r.itemCode || "—"} · ${r.tipoEquipo || "—"} · ${r.horasPorUnidad ?? "—"}h`}
                onConfirm={async (rows) => {
                  const res = await importApuEquipmentAction({
                    projectId,
                    rows: rows.map((r) => ({
                      itemCode: r.itemCode,
                      tipoEquipo: r.tipoEquipo,
                      horasPorUnidad: r.horasPorUnidad ?? 0,
                      costoHora: r.costoHora ?? null,
                    })),
                  });
                  if (res.errores.length === 0) refresh();
                  return res.errores;
                }}
              >
                {equipment.length === 0 ? (
                  <p className="text-[11px] text-[var(--muted)]">Sin equipo cargado.</p>
                ) : (
                  <RowTable
                    columns={["Tipo de equipo", "Horas/unidad", "Costo/hora", ""]}
                    rows={equipment.map((e) => [
                      e.tipo_equipo,
                      String(e.horas_por_unidad_ejecutada),
                      money(e.costo_hora),
                      <button key="del" onClick={() => handleDeleteEquipment(e.id)} className="text-[var(--muted)] hover:text-[var(--error)]">
                        <Trash2 size={13} />
                      </button>,
                    ])}
                  />
                )}
              </ApuSection>

              <ApuSection
                title="Subcontrato"
                helpText="Columnas: PARTIDA_CODIGO | DESCRIPCION | PRECIO_UNIDAD (precio por unidad de partida). Puede convivir con mano de obra propia."
                colVariants={{
                  itemCode: ["partidacodigo", "codigopartida", "partida", "codigo", "item", "code"],
                  label: ["descripcion", "subcontrato", "concepto"],
                  extra: ["preciounidad", "precioporunidad", "precio", "price"],
                }}
                budgetItems={catalogs.budgetItems}
                buildRow={(get) => ({
                  itemCode: String(get("itemCode") ?? "").trim(),
                  descripcion: String(get("label") ?? "").trim(),
                  precioPorUnidad: parsePyNumber(get("extra")),
                })}
                resolve={(rows) =>
                  resolveApuSubcontractImportMapping(
                    rows.map((r) => ({
                      itemCode: r.itemCode,
                      descripcion: r.descripcion,
                      precioPorUnidad: r.precioPorUnidad ?? NaN,
                    })),
                    catalogs.budgetItems
                  )
                }
                describeRow={(r) => `${r.itemCode || "—"} · ${r.descripcion || "—"} · ${money(r.precioPorUnidad)}`}
                onConfirm={async (rows) => {
                  const res = await importApuSubcontractsAction({
                    projectId,
                    rows: rows.map((r) => ({
                      itemCode: r.itemCode,
                      descripcion: r.descripcion,
                      precioPorUnidad: r.precioPorUnidad ?? NaN,
                    })),
                  });
                  if (res.errores.length === 0) refresh();
                  return res.errores;
                }}
              >
                {subcontracts.length === 0 ? (
                  <p className="text-[11px] text-[var(--muted)]">Sin subcontrato cargado.</p>
                ) : (
                  <RowTable
                    columns={["Descripción", "Precio/unidad", ""]}
                    rows={subcontracts.map((s) => [
                      s.descripcion,
                      money(s.precio_por_unidad),
                      <button key="del" onClick={() => handleDeleteSubcontract(s.id)} className="text-[var(--muted)] hover:text-[var(--error)]">
                        <Trash2 size={13} />
                      </button>,
                    ])}
                  />
                )}
              </ApuSection>

              <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 text-xs space-y-1">
                <div className="flex justify-between"><span className="text-[var(--muted)]">Materiales</span><span>{materialsMissingCost.length > 0 ? <span className="text-amber-500">Costo no disponible ({materialsMissingCost.length})</span> : money(costoMaterial)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--muted)]">Mano de obra</span><span>{money(costoManoObra)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--muted)]">Equipo</span><span>{money(costoEquipo)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--muted)]">Subcontrato</span><span>{money(costoSubcontrato)}</span></div>
                <div className="flex justify-between font-semibold pt-1 border-t border-[var(--border)]">
                  <span>Costo unitario APU</span>
                  <span>{costoTotal === null ? <span className="text-amber-500">Costo no disponible</span> : money(costoTotal)}</span>
                </div>
                {materialsMissingCost.length > 0 && (
                  <p className="text-[10px] text-amber-500 pt-1">
                    Falta costo promedio de: {materialsMissingCost.map((m) => m.producto_nombre).join(", ")}. No se suma como Gs. 0 —
                    cargá stock con costo para ese producto.
                  </p>
                )}
              </div>
            </>
          )}

          <div className="flex justify-end">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)} className="h-8 text-xs">
              Cerrar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function RowTable({ columns, rows }: { columns: string[]; rows: (string | React.ReactNode)[][] }) {
  return (
    <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
      <table className="w-full text-left text-[11px]">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]">
            {columns.map((c, i) => (
              <th key={i} className="py-1.5 px-2">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className="py-1.5 px-2">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ApuSectionProps<TRow extends { itemCode: string }> {
  title: string;
  helpText: string;
  colVariants: Record<string, string[]>;
  budgetItems: { id: string; code: string; unit: string | null }[];
  buildRow: (get: (field: string) => unknown) => TRow;
  resolve: (rows: TRow[]) => { mapped: unknown[]; errors: { row: number; reason: string }[] };
  describeRow: (row: TRow) => string;
  onConfirm: (rows: TRow[]) => Promise<{ row: number; reason: string }[]>;
  children: React.ReactNode;
}

function ApuSection<TRow extends { itemCode: string }>({
  title,
  helpText,
  colVariants,
  buildRow,
  resolve,
  describeRow,
  onConfirm,
  children,
}: ApuSectionProps<TRow>) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<TRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErrors, setSaveErrors] = useState<{ row: number; reason: string }[]>([]);
  const [expanded, setExpanded] = useState(false);

  const { errors: previewErrors } = useMemo(() => (rows.length > 0 ? resolve(rows) : { mapped: [], errors: [] }), [rows, resolve]);
  const errorRows = new Set(previewErrors.map((e) => e.row));

  async function handleFile(file: File | null) {
    if (!file) return;
    setLoadError(null);
    setSaveErrors([]);
    setFileName(file.name);
    setExpanded(true);
    try {
      const parsed = await parseExcelRows(file);
      if (!parsed) {
        setLoadError("El archivo no tiene filas de datos.");
        setRows([]);
        return;
      }
      const colIdx: Record<string, number> = {};
      for (const [field, variants] of Object.entries(colVariants)) {
        const i = parsed.headers.findIndex((h) => variants.includes(h));
        if (i >= 0) colIdx[field] = i;
      }
      const out: TRow[] = [];
      for (const r of parsed.rows) {
        const get = (f: string) => (colIdx[f] === undefined ? "" : r[colIdx[f]]);
        const built = buildRow(get);
        if (!built.itemCode) continue;
        out.push(built);
      }
      if (out.length === 0) {
        setLoadError("No se detectaron filas con código de partida.");
      }
      setRows(out);
    } catch {
      setLoadError("No se pudo leer el archivo. Verificá que sea un .xlsx o .csv válido.");
      setRows([]);
    }
  }

  async function handleConfirm() {
    if (previewErrors.length > 0) {
      setSaveErrors([{ row: 0, reason: "Corregí las filas con error antes de confirmar." }]);
      return;
    }
    setSaving(true);
    const errores = await onConfirm(rows);
    setSaving(false);
    setSaveErrors(errores);
    if (errores.length === 0) {
      setRows([]);
      setFileName("");
      setExpanded(false);
    }
  }

  return (
    <div className="space-y-2">
      <h5 className="text-[12px] font-semibold text-[var(--foreground)]">{title}</h5>
      {children}
      <label className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] p-2.5 text-[11px] cursor-pointer hover:bg-[var(--panel-2)]">
        <Upload className="h-3.5 w-3.5 text-[var(--muted)]" />
        <span className="text-[var(--muted)]">{fileName || "Importar desde Excel/CSV"}</span>
        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
      </label>
      <p className="text-[10px] text-[var(--muted)]">{helpText}</p>

      {loadError && (
        <div className="flex items-center gap-2 text-[11px] text-red-500">
          <AlertTriangle className="h-3.5 w-3.5" /> {loadError}
        </div>
      )}

      {expanded && rows.length > 0 && (
        <>
          <RowTable
            columns={["Fila", "Datos", "Estado"]}
            rows={rows.map((r, i) => [
              String(i + 1),
              describeRow(r),
              errorRows.has(i + 1) ? (
                <span className="text-red-500">Error</span>
              ) : (
                <span className="text-emerald-500">OK</span>
              ),
            ])}
          />
          <div className="text-[10px] text-[var(--muted)]">
            {rows.length - previewErrors.length} filas válidas · {previewErrors.length} con error
          </div>
          {previewErrors.length > 0 && (
            <ul className="text-[10px] text-red-500 list-disc pl-4">
              {previewErrors.slice(0, 5).map((e, i) => (
                <li key={i}>Fila {e.row}: {e.reason}</li>
              ))}
            </ul>
          )}
          {saveErrors.length > 0 && (
            <ul className="text-[10px] text-red-500 list-disc pl-4">
              {saveErrors.map((e, i) => (
                <li key={i}>{e.row > 0 ? `Fila ${e.row}: ` : ""}{e.reason}</li>
              ))}
            </ul>
          )}
          <div className="flex justify-end">
            <Button
              type="button"
              onClick={handleConfirm}
              disabled={saving || previewErrors.length > 0}
              className="h-7 text-[11px] gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              {saving ? <RefreshCw className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Confirmar importación
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
