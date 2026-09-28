"use client";

import { useEffect, useState } from "react";
import { Upload, RefreshCw, CheckCircle2, AlertTriangle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  listApuTemplatesAction,
  deleteApuTemplateAction,
  importApuTemplateMaterialsAction,
  importApuTemplateLaborAction,
  importApuTemplateEquipmentAction,
  importApuTemplateSubcontractsAction,
  type ApuTemplateSummary,
} from "./apu-templates-actions";

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

interface ImportBlockProps {
  title: string;
  helpText: string;
  colVariants: Record<string, string[]>;
  onImport: (rows: Record<string, unknown>[]) => Promise<{ creados: number; errores: { row: number; reason: string }[] }>;
  onDone: () => void;
}

function ImportBlock({ title, helpText, colVariants, onImport, onDone }: ImportBlockProps) {
  const [fileName, setFileName] = useState("");
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ creados: number; errores: { row: number; reason: string }[] } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function handleFile(file: File | null) {
    if (!file) return;
    setLoadError(null);
    setResult(null);
    setFileName(file.name);
    setSaving(true);
    try {
      const parsed = await parseExcelRows(file);
      if (!parsed) {
        setLoadError("El archivo no tiene filas de datos.");
        setSaving(false);
        return;
      }
      const colIdx: Record<string, number> = {};
      for (const [field, variants] of Object.entries(colVariants)) {
        const i = parsed.headers.findIndex((h) => variants.includes(h));
        if (i >= 0) colIdx[field] = i;
      }
      const rows = parsed.rows.map((r) => {
        const obj: Record<string, unknown> = {};
        for (const field of Object.keys(colVariants)) {
          obj[field] = colIdx[field] === undefined ? "" : r[colIdx[field]];
        }
        return obj;
      });
      const res = await onImport(rows);
      setResult(res);
      setSaving(false);
      if (res.creados > 0) onDone();
    } catch {
      setLoadError("No se pudo leer el archivo. Verificá que sea un .xlsx o .csv válido.");
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1.5">
      <h5 className="text-[12px] font-semibold text-[var(--foreground)]">{title}</h5>
      <label className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--border)] p-2.5 text-[11px] cursor-pointer hover:bg-[var(--panel-2)]">
        <Upload className="h-3.5 w-3.5 text-[var(--muted)]" />
        <span className="text-[var(--muted)]">{fileName || "Importar desde Excel/CSV"}</span>
        <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleFile(e.target.files?.[0] ?? null)} />
      </label>
      <p className="text-[10px] text-[var(--muted)]">{helpText}</p>
      {saving && (
        <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <RefreshCw className="h-3.5 w-3.5 animate-spin" /> Importando…
        </div>
      )}
      {loadError && (
        <div className="flex items-center gap-2 text-[11px] text-red-500">
          <AlertTriangle className="h-3.5 w-3.5" /> {loadError}
        </div>
      )}
      {result && (
        <div className="text-[11px] space-y-1">
          {result.creados > 0 && (
            <div className="flex items-center gap-2 text-emerald-500">
              <CheckCircle2 className="h-3.5 w-3.5" /> {result.creados} filas cargadas.
            </div>
          )}
          {result.errores.length > 0 && (
            <ul className="text-red-500 list-disc pl-4">
              {result.errores.slice(0, 8).map((e, i) => (
                <li key={i}>{e.row > 0 ? `Fila ${e.row}: ` : ""}{e.reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function ApuTemplatesSection() {
  const [templates, setTemplates] = useState<ApuTemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);

  function refresh() {
    setLoading(true);
    listApuTemplatesAction().then((res) => {
      if (res.data) setTemplates(res.data);
      setLoading(false);
    });
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleDelete(id: string, nombre: string) {
    if (!window.confirm(`¿Borrar la plantilla "${nombre}"? Esto no afecta las obras donde ya se aplicó.`)) return;
    const res = await deleteApuTemplateAction(id);
    if (!res.error) refresh();
  }

  return (
    <div className="space-y-3">
      <h2 className="text-[15px] font-semibold">Plantillas de APU</h2>
      <p className="text-[13px] text-[var(--muted)]">
        Cargá UNA VEZ la receta de materiales/mano de obra/equipo que ya usa tu empresa por tipo de trabajo
        (ej. &quot;Mampostería de elevación con ladrillo común&quot;). Después, en cualquier obra, se aplica sola a
        toda partida cuya descripción coincida — sin volver a cargar nada a mano.
      </p>

      <div className="grid gap-4 sm:grid-cols-2 rounded-lg border border-[var(--border)] p-3">
        <ImportBlock
          title="Materiales"
          helpText="Columnas: NOMBRE_PLANTILLA | PRODUCTO_CODIGO | CANTIDAD | DESPERDICIO_PCT (opcional)."
          colVariants={{
            templateNombre: ["nombreplantilla", "plantilla", "nombre", "item", "partida"],
            productSku: ["productocodigo", "codigoproducto", "sku", "codigo", "producto"],
            quantity: ["cantidad", "cant", "qty", "quantity"],
            extra: ["desperdicio", "desperdiciopct", "waste"],
          }}
          onImport={(rows) =>
            importApuTemplateMaterialsAction({
              rows: rows.map((r) => ({
                templateNombre: String(r.templateNombre ?? "").trim(),
                productSku: String(r.productSku ?? "").trim(),
                quantityPerUnit: parsePyNumber(r.quantity) ?? 0,
                desperdicioPct: parsePyNumber(r.extra) ?? 0,
              })),
            })
          }
          onDone={refresh}
        />
        <ImportBlock
          title="Mano de obra"
          helpText="Columnas: NOMBRE_PLANTILLA | ROL | HORAS | COSTO_HORA."
          colVariants={{
            templateNombre: ["nombreplantilla", "plantilla", "nombre", "item", "partida"],
            label: ["rol", "role", "cargo"],
            quantity: ["horas", "hours"],
            extra: ["costohora", "costo", "cost"],
          }}
          onImport={(rows) =>
            importApuTemplateLaborAction({
              rows: rows.map((r) => ({
                templateNombre: String(r.templateNombre ?? "").trim(),
                rol: String(r.label ?? "").trim(),
                horasPorUnidad: parsePyNumber(r.quantity) ?? 0,
                costoHora: parsePyNumber(r.extra),
              })),
            })
          }
          onDone={refresh}
        />
        <ImportBlock
          title="Equipo"
          helpText="Columnas: NOMBRE_PLANTILLA | TIPO_EQUIPO | HORAS | COSTO_HORA."
          colVariants={{
            templateNombre: ["nombreplantilla", "plantilla", "nombre", "item", "partida"],
            label: ["tipoequipo", "equipo", "equipment"],
            quantity: ["horas", "hours"],
            extra: ["costohora", "costo", "cost"],
          }}
          onImport={(rows) =>
            importApuTemplateEquipmentAction({
              rows: rows.map((r) => ({
                templateNombre: String(r.templateNombre ?? "").trim(),
                tipoEquipo: String(r.label ?? "").trim(),
                horasPorUnidad: parsePyNumber(r.quantity) ?? 0,
                costoHora: parsePyNumber(r.extra),
              })),
            })
          }
          onDone={refresh}
        />
        <ImportBlock
          title="Subcontrato"
          helpText="Columnas: NOMBRE_PLANTILLA | DESCRIPCION | PRECIO_UNIDAD (precio por unidad de partida)."
          colVariants={{
            templateNombre: ["nombreplantilla", "plantilla", "nombre", "item", "partida"],
            label: ["descripcion", "subcontrato", "concepto"],
            extra: ["preciounidad", "precioporunidad", "precio", "price"],
          }}
          onImport={(rows) =>
            importApuTemplateSubcontractsAction({
              rows: rows.map((r) => ({
                templateNombre: String(r.templateNombre ?? "").trim(),
                descripcion: String(r.label ?? "").trim(),
                precioPorUnidad: parsePyNumber(r.extra) ?? NaN,
              })),
            })
          }
          onDone={refresh}
        />
      </div>

      <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-left text-[12px]">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--panel-2)] text-[var(--muted)]">
              <th className="py-1.5 px-2">Plantilla</th>
              <th className="py-1.5 px-2 text-right">Materiales</th>
              <th className="py-1.5 px-2 text-right">Mano de obra</th>
              <th className="py-1.5 px-2 text-right">Equipo</th>
              <th className="py-1.5 px-2 text-right">Subcontrato</th>
              <th className="py-1.5 px-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            {loading ? (
              <tr><td colSpan={6} className="py-3 px-2 text-[var(--muted)]">Cargando…</td></tr>
            ) : templates.length === 0 ? (
              <tr><td colSpan={6} className="py-3 px-2 text-[var(--muted)]">Sin plantillas cargadas todavía.</td></tr>
            ) : (
              templates.map((t) => (
                <tr key={t.id}>
                  <td className="py-1.5 px-2">{t.nombre}</td>
                  <td className="py-1.5 px-2 text-right">{t.materialesCount}</td>
                  <td className="py-1.5 px-2 text-right">{t.laborCount}</td>
                  <td className="py-1.5 px-2 text-right">{t.equipoCount}</td>
                  <td className="py-1.5 px-2 text-right">{t.subcontratoCount}</td>
                  <td className="py-1.5 px-2 text-right">
                    <button onClick={() => handleDelete(t.id, t.nombre)} className="text-[var(--muted)] hover:text-[var(--error)]">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
