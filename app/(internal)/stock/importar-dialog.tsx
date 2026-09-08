"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { importarProductos, type FilaImport } from "./stock-actions";

// Campos del sistema → columna del archivo
const CAMPOS = [
  { key: "nombre",               label: "Nombre",               required: true  },
  { key: "unidad",               label: "Unidad",               required: true  },
  { key: "sku",                  label: "SKU / Código",          required: false },
  { key: "categoria_nombre",     label: "Categoría",            required: false },
  { key: "descripcion",          label: "Descripción",          required: false },
  { key: "stock_inicial",        label: "Stock inicial",        required: false },
  { key: "costo_inicial",        label: "Costo inicial",        required: false },
  { key: "stock_minimo",         label: "Stock mínimo",         required: false },
  { key: "contenido_por_unidad", label: "Contenido por unidad", required: false },
  { key: "unidad_base",          label: "Unidad base",          required: false },
] as const;

type CampoKey = (typeof CAMPOS)[number]["key"];
type Mapping = Record<CampoKey, number>; // índice de columna, -1 = no usar
type Step = "upload" | "map" | "done";

function parseCsvRaw(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return { headers: [], rows: [] };
  const delim = lines[0].includes(";") ? ";" : ",";

  function split(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === delim && !inQ) { result.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    result.push(cur.trim());
    return result;
  }

  const headers = split(lines[0]).map((h) => h.replace(/^"|"$/g, "").trim());
  const rows: string[][] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = split(lines[r]).map((c) => c.replace(/^"|"$/g, "").trim());
    if (cols.some((c) => c)) rows.push(cols);
  }
  return { headers, rows };
}

function parseXlsxRaw(buffer: ArrayBuffer): { headers: string[]; rows: string[][] } {
  const wb = XLSX.read(buffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const all = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
  if (all.length < 2) return { headers: [], rows: [] };
  const headers = all[0].map((h) => String(h ?? "").trim());
  const rows = all
    .slice(1)
    .filter((r) => r.some((c) => String(c ?? "").trim()))
    .map((r) => r.map((c) => String(c ?? "").trim()));
  return { headers, rows };
}

function autoDetect(headers: string[]): Mapping {
  const find = (...kw: string[]) => {
    const i = headers.findIndex((h) => {
      const hl = h.toLowerCase();
      return kw.some((k) => hl.includes(k));
    });
    return i;
  };

  return {
    nombre:               find("nombre", "name", "product", "producto"),
    unidad:               find("unidad de compra", "unidad_compra") >= 0
                            ? find("unidad de compra", "unidad_compra")
                            : find("unidad", "unit"),
    sku:                  find("sku", "código", "codigo", "code", "ref", "cod"),
    categoria_nombre:     find("categor"),
    descripcion:          find("descrip", "detalle", "obs", "nota"),
    stock_inicial:        find("stock inicial", "stock_inicial", "inicial", "initial", "existencia"),
    costo_inicial:        find("costo", "precio", "price", "cost"),
    stock_minimo:         find("mínimo", "minimo", "min stock", "min_stock", "alerta"),
    contenido_por_unidad: find("contenido", "content", "peso"),
    unidad_base:          find("unidad base", "unidad_base", "base unit"),
  };
}

function buildFilas(rows: string[][], mapping: Mapping): FilaImport[] {
  const get = (row: string[], key: CampoKey) => {
    const i = mapping[key];
    return i >= 0 && i < row.length ? row[i] : "";
  };
  return rows
    .filter((row) => get(row, "nombre").trim())
    .map((row) => ({
      nombre:               get(row, "nombre").trim(),
      sku:                  get(row, "sku").trim() || undefined,
      categoria_nombre:     get(row, "categoria_nombre").trim() || undefined,
      unidad:               get(row, "unidad").trim() || "unidad",
      contenido_por_unidad: get(row, "contenido_por_unidad")
                              ? parseFloat(get(row, "contenido_por_unidad"))
                              : undefined,
      unidad_base:          get(row, "unidad_base").trim() || undefined,
      descripcion:          get(row, "descripcion").trim() || undefined,
      stock_minimo:         get(row, "stock_minimo")
                              ? parseFloat(get(row, "stock_minimo"))
                              : undefined,
      stock_inicial:        get(row, "stock_inicial")
                              ? parseFloat(get(row, "stock_inicial"))
                              : undefined,
      costo_inicial:        get(row, "costo_inicial")
                              ? parseFloat(get(row, "costo_inicial"))
                              : undefined,
    }));
}

const EMPTY_MAPPING = Object.fromEntries(CAMPOS.map((c) => [c.key, -1])) as Mapping;

export function ImportarDialog() {
  const [open, setOpen]           = useState(false);
  const [step, setStep]           = useState<Step>("upload");
  const [headers, setHeaders]     = useState<string[]>([]);
  const [rows, setRows]           = useState<string[][]>([]);
  const [mapping, setMapping]     = useState<Mapping>(EMPTY_MAPPING);
  const [resultado, setResultado] = useState<{
    creados: number;
    errores: { fila: number; nombre: string; mensaje: string }[];
  } | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router  = useRouter();

  function reset() {
    setStep("upload");
    setHeaders([]);
    setRows([]);
    setMapping(EMPTY_MAPPING);
    setResultado(null);
    setParseError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    const isExcel = /\.(xlsx|xls)$/i.test(file.name);
    const reader = new FileReader();

    reader.onload = (ev) => {
      try {
        const parsed = isExcel
          ? parseXlsxRaw(ev.target!.result as ArrayBuffer)
          : parseCsvRaw(ev.target!.result as string);

        if (!parsed.headers.length || !parsed.rows.length) {
          setParseError(
            "No se encontraron datos. El archivo debe tener encabezados en la primera fila y al menos una fila de datos."
          );
          return;
        }
        setHeaders(parsed.headers);
        setRows(parsed.rows);
        setMapping(autoDetect(parsed.headers));
        setStep("map");
      } catch {
        setParseError("No se pudo leer el archivo. Probá con CSV (UTF-8) o Excel (.xlsx).");
      }
    };

    if (isExcel) reader.readAsArrayBuffer(file);
    else reader.readAsText(file, "UTF-8");
  }

  function importar() {
    const filas = buildFilas(rows, mapping);
    if (!filas.length) return;
    startTransition(async () => {
      const res = await importarProductos(filas);
      setResultado(res);
      setStep("done");
      router.refresh();
    });
  }

  const canImport = mapping.nombre >= 0 && mapping.unidad >= 0;
  const totalFilas = rows.filter((r) => {
    const i = mapping.nombre;
    return i >= 0 && r[i]?.trim();
  }).length;
  const previewRows = rows.slice(0, 5);
  const mappedCampos = CAMPOS.filter((c) => mapping[c.key] >= 0);

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="secondary">Importar</Button>
      </DialogTrigger>
      <DialogContent title="Importar productos" className="max-w-2xl">
        <div className="space-y-4">

          {/* ── STEP: upload ── */}
          {step === "upload" && (
            <>
              <p className="text-[12px] text-[var(--muted)]">
                Subí un archivo CSV o Excel con tus productos. El sistema detecta las columnas
                automáticamente — podés ajustar el mapeo antes de importar. No hace falta ningún
                formato especial: sirve cualquier planilla que ya tengas.
              </p>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.xlsx,.xls"
                onChange={handleFile}
                className="w-full text-[13px] file:mr-3 file:rounded file:border file:border-[var(--border)] file:bg-[var(--panel-2)] file:px-2.5 file:py-1 file:text-[12px] file:text-[var(--foreground)] file:cursor-pointer"
              />
              {parseError && (
                <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">
                  {parseError}
                </div>
              )}
              <div className="rounded border border-dashed border-[var(--border)] px-4 py-5 text-center text-[12px] text-[var(--muted)] space-y-1">
                <div>Formatos: <b>CSV</b> (separador <code>,</code> o <code>;</code>) · <b>Excel</b> (.xlsx, .xls)</div>
                <div>La primera fila debe tener los nombres de las columnas.</div>
              </div>
            </>
          )}

          {/* ── STEP: map ── */}
          {step === "map" && (
            <>
              <div className="flex items-center justify-between text-[12px] text-[var(--muted)]">
                <span>
                  <b>{rows.length}</b> filas · <b>{headers.length}</b> columnas detectadas
                </span>
                <button onClick={reset} className="text-action">
                  ← Cambiar archivo
                </button>
              </div>

              {/* Mapping */}
              <div className="rounded border border-[var(--border)] overflow-hidden">
                <table className="text-[12px] w-full">
                  <thead>
                    <tr className="border-b border-[var(--border)] bg-[var(--panel-2)]">
                      <th className="text-left px-3 py-2 font-medium text-[var(--muted)] w-1/2">
                        Campo del sistema
                      </th>
                      <th className="text-left px-3 py-2 font-medium text-[var(--muted)]">
                        Columna del archivo
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {CAMPOS.map(({ key, label, required }) => (
                      <tr key={key} className="border-b border-[var(--border)] last:border-0">
                        <td className="px-3 py-1.5 font-medium">
                          {label}
                          {required && <span className="text-[var(--error)] ml-0.5">*</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          <select
                            value={mapping[key]}
                            onChange={(e) =>
                              setMapping((m) => ({ ...m, [key]: parseInt(e.target.value) }))
                            }
                            className="w-full rounded border border-[var(--border)] bg-[var(--panel-2)] px-2 py-1 text-[12px] text-[var(--foreground)]"
                          >
                            <option value={-1}>— No usar —</option>
                            {headers.map((h, i) => (
                              <option key={i} value={i}>
                                {h || `Columna ${i + 1}`}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Preview */}
              {mappedCampos.length > 0 && previewRows.length > 0 && (
                <div>
                  <div className="text-[11px] text-[var(--muted)] mb-1">
                    Vista previa — primeras {previewRows.length} filas con el mapeo actual:
                  </div>
                  <div className="overflow-x-auto rounded border border-[var(--border)]">
                    <table className="text-[11px]">
                      <thead>
                        <tr>
                          {mappedCampos.map((c) => (
                            <th key={c.key}>{c.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {previewRows.map((row, ri) => (
                          <tr key={ri}>
                            {mappedCampos.map((c) => (
                              <td key={c.key} className="max-w-[130px] truncate">
                                {row[mapping[c.key]] || (
                                  <span className="text-[var(--muted)]">—</span>
                                )}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {!canImport && (
                <p className="text-[11px] text-[var(--warn)]">
                  Asigná al menos las columnas <b>Nombre</b> y <b>Unidad</b> para continuar.
                </p>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={() => setOpen(false)}>
                  Cancelar
                </Button>
                <Button onClick={importar} disabled={pending || !canImport}>
                  {pending
                    ? "Importando…"
                    : `Importar ${totalFilas} producto${totalFilas !== 1 ? "s" : ""}`}
                </Button>
              </div>
            </>
          )}

          {/* ── STEP: done ── */}
          {step === "done" && resultado && (
            <div className="space-y-3">
              <div
                className={`rounded border px-3 py-2 text-[13px] ${
                  resultado.creados > 0
                    ? "border-[var(--ok)]/30 bg-[var(--ok-bg)] text-[var(--ok)]"
                    : "border-[var(--border)] text-[var(--muted)]"
                }`}
              >
                {resultado.creados}{" "}
                {resultado.creados === 1 ? "producto creado" : "productos creados"} correctamente.
              </div>
              {resultado.errores.length > 0 && (
                <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)] space-y-1">
                  <div className="font-medium">{resultado.errores.length} con error:</div>
                  {resultado.errores.map((e) => (
                    <div key={e.fila}>
                      Fila {e.fila} — {e.nombre}: {e.mensaje}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={reset}>
                  Importar otro archivo
                </Button>
                <Button onClick={() => { setOpen(false); reset(); }}>Cerrar</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
