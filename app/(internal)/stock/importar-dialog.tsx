"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { CategoriaProducto } from "@/lib/types";
import { importarProductos, type FilaImport } from "./stock-actions";

// Columnas del CSV — también se genera la plantilla con este orden
const COLUMNAS = [
  "Nombre",
  "SKU",
  "Categoría",
  "Unidad",
  "Contenido por unidad",
  "Unidad base",
  "Descripción",
  "Stock mínimo",
  "Stock inicial",
  "Costo inicial",
] as const;

type FilaRaw = {
  nombre: string;
  sku: string;
  categoria_nombre: string;
  unidad: string;
  contenido_por_unidad: string;
  unidad_base: string;
  descripcion: string;
  stock_minimo: string;
  stock_inicial: string;
  costo_inicial: string;
  _ok: boolean;
  _error: string;
};

function parseCsv(text: string): FilaRaw[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Auto-detect delimiter: ; o ,
  const firstLine = lines[0];
  const delim = firstLine.includes(";") ? ";" : ",";

  function splitLine(line: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === delim && !inQuote) {
        result.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    result.push(cur.trim());
    return result;
  }

  const headers = splitLine(lines[0]).map((h) => h.toLowerCase().replace(/[^a-záéíóúüñ ]/gi, "").trim());

  const idx = (name: string) => headers.findIndex((h) => h.includes(name.toLowerCase()));
  const iNombre    = Math.max(idx("nombre"), 0);
  const iSku       = idx("sku");
  const iCat       = idx("categor");
  const iUnidad    = idx("unidad de compra") !== -1 ? idx("unidad de compra") : idx("unidad");
  const iContenido = idx("contenido");
  const iUnidadB   = idx("unidad base");
  const iDesc      = idx("descrip");
  const iMinimo    = idx("mínimo") !== -1 ? idx("mínimo") : idx("minimo");
  const iInicial   = idx("stock inicial") !== -1 ? idx("stock inicial") : idx("inicial");
  const iCosto     = idx("costo");

  const get = (cols: string[], i: number) => (i >= 0 && i < cols.length ? cols[i] : "");

  const rows: FilaRaw[] = [];
  for (let r = 1; r < lines.length; r++) {
    const cols = splitLine(lines[r]);
    const nombre = get(cols, iNombre).replace(/^"|"$/g, "");
    if (!nombre) continue;

    const unidad = get(cols, iUnidad).replace(/^"|"$/g, "");
    const error = !nombre ? "Nombre requerido" : !unidad ? "Unidad requerida" : "";

    rows.push({
      nombre,
      sku: get(cols, iSku).replace(/^"|"$/g, ""),
      categoria_nombre: get(cols, iCat).replace(/^"|"$/g, ""),
      unidad,
      contenido_por_unidad: get(cols, iContenido).replace(/^"|"$/g, ""),
      unidad_base: get(cols, iUnidadB).replace(/^"|"$/g, ""),
      descripcion: get(cols, iDesc).replace(/^"|"$/g, ""),
      stock_minimo: get(cols, iMinimo).replace(/^"|"$/g, ""),
      stock_inicial: get(cols, iInicial).replace(/^"|"$/g, ""),
      costo_inicial: get(cols, iCosto).replace(/^"|"$/g, ""),
      _ok: !error,
      _error: error,
    });
  }
  return rows;
}

function filaToImport(f: FilaRaw): FilaImport {
  return {
    nombre: f.nombre,
    sku: f.sku || undefined,
    categoria_nombre: f.categoria_nombre || undefined,
    unidad: f.unidad,
    contenido_por_unidad: f.contenido_por_unidad ? parseFloat(f.contenido_por_unidad) : undefined,
    unidad_base: f.unidad_base || undefined,
    descripcion: f.descripcion || undefined,
    stock_minimo: f.stock_minimo ? parseFloat(f.stock_minimo) : undefined,
    stock_inicial: f.stock_inicial ? parseFloat(f.stock_inicial) : undefined,
    costo_inicial: f.costo_inicial ? parseFloat(f.costo_inicial) : undefined,
  };
}

function generarPlantilla(categorias: CategoriaProducto[]): string {
  const header = COLUMNAS.join(";");
  const ejCat = categorias[0]?.nombre ?? "Áridos y agregados";
  const ejemplos = [
    `Arena gruesa;ARE-GRU;${ejCat};m³;;;;;18;135000`,
    `Cemento Portland 50kg;CEM-50KG;${ejCat};bolsa;50;kg;;20;120;47500`,
    `Hierro 10mm barra 12m;HIE-10-12;${ejCat};unidad;;;;5;40;92000`,
  ];
  return [header, ...ejemplos].join("\n");
}

export function ImportarDialog({ categorias }: { categorias: CategoriaProducto[] }) {
  const [open, setOpen] = useState(false);
  const [filas, setFilas] = useState<FilaRaw[]>([]);
  const [resultado, setResultado] = useState<{ creados: number; errores: { fila: number; nombre: string; mensaje: string }[] } | null>(null);
  const [pending, startTransition] = useTransition();
  const [parseError, setParseError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  function reset() {
    setFilas([]);
    setResultado(null);
    setParseError(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setParseError(null);
    setResultado(null);

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      try {
        const rows = parseCsv(text);
        if (rows.length === 0) {
          setParseError("No se encontraron filas. Verificá que el archivo tenga encabezados y al menos una fila de datos.");
          setFilas([]);
        } else {
          setFilas(rows);
        }
      } catch {
        setParseError("No se pudo leer el archivo. Asegurate de que sea CSV (UTF-8).");
      }
    };
    reader.readAsText(file, "UTF-8");
  }

  function descargarPlantilla() {
    const csv = generarPlantilla(categorias);
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "plantilla-stock.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const validas = filas.filter((f) => f._ok);
  const invalidas = filas.filter((f) => !f._ok);

  function importar() {
    if (validas.length === 0) return;
    startTransition(async () => {
      const res = await importarProductos(validas.map(filaToImport));
      setResultado(res);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset(); }}>
      <DialogTrigger asChild>
        <Button variant="secondary">Importar CSV</Button>
      </DialogTrigger>
      <DialogContent title="Importar productos desde CSV" className="max-w-2xl">
        <div className="space-y-4">

          {resultado ? (
            <div className="space-y-3">
              <div className={`rounded border px-3 py-2 text-[13px] ${resultado.creados > 0 ? "border-[var(--ok)]/30 bg-[var(--ok-bg)] text-[var(--ok)]" : "border-[var(--border)] text-[var(--muted)]"}`}>
                {resultado.creados} {resultado.creados === 1 ? "producto creado" : "productos creados"} correctamente.
              </div>
              {resultado.errores.length > 0 ? (
                <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)] space-y-1">
                  <div className="font-medium">{resultado.errores.length} con error:</div>
                  {resultado.errores.map((e) => (
                    <div key={e.fila}>Fila {e.fila} — {e.nombre}: {e.mensaje}</div>
                  ))}
                </div>
              ) : null}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={reset}>Importar otro</Button>
                <Button onClick={() => { setOpen(false); reset(); }}>Cerrar</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3">
                <div className="text-[12px] text-[var(--muted)]">
                  Archivo CSV con encabezados. Separador: <code className="font-mono">,</code> o <code className="font-mono">;</code>. Codificación: UTF-8.
                </div>
                <button
                  onClick={descargarPlantilla}
                  className="text-[12px] text-action whitespace-nowrap shrink-0"
                >
                  Descargar plantilla
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.txt"
                  onChange={handleFile}
                  className="flex-1 text-[13px] file:mr-3 file:rounded file:border file:border-[var(--border)] file:bg-[var(--panel-2)] file:px-2.5 file:py-1 file:text-[12px] file:text-[var(--foreground)] file:cursor-pointer"
                />
                {filas.length > 0 ? (
                  <button onClick={reset} className="text-[12px] text-[var(--muted)] hover:text-[var(--foreground)]">
                    Limpiar
                  </button>
                ) : null}
              </div>

              {parseError ? (
                <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">
                  {parseError}
                </div>
              ) : null}

              {filas.length > 0 ? (
                <>
                  <div className="text-[12px] text-[var(--muted)]">
                    {filas.length} {filas.length === 1 ? "fila" : "filas"} detectadas —{" "}
                    <span className="text-[var(--ok)]">{validas.length} válidas</span>
                    {invalidas.length > 0 ? (
                      <>, <span className="text-[var(--error)]">{invalidas.length} con error</span></>
                    ) : null}
                  </div>

                  <div className="max-h-64 overflow-auto rounded border border-[var(--border)]">
                    <table className="text-[12px]">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Nombre</th>
                          <th>SKU</th>
                          <th>Categoría</th>
                          <th>Unidad</th>
                          <th className="num">Stock inicial</th>
                          <th className="num">Costo inicial</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filas.map((f, i) => (
                          <tr key={i} className={!f._ok ? "opacity-50" : ""}>
                            <td className="text-[var(--muted)]">{i + 2}</td>
                            <td className="font-medium">{f.nombre || <span className="text-[var(--error)]">—</span>}</td>
                            <td className="text-[var(--muted)] font-mono">{f.sku || "—"}</td>
                            <td className="text-[var(--muted)]">{f.categoria_nombre || "—"}</td>
                            <td>{f.unidad || <span className="text-[var(--error)]">—</span>}</td>
                            <td className="num text-[var(--muted)]">{f.stock_inicial || "—"}</td>
                            <td className="num text-[var(--muted)]">{f.costo_inicial || "—"}</td>
                            <td>
                              {!f._ok ? (
                                <span className="text-[var(--error)] text-[11px]">{f._error}</span>
                              ) : (
                                <span className="text-[var(--ok)] text-[11px]">✓</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {invalidas.length > 0 ? (
                    <div className="text-[11px] text-[var(--muted)]">
                      Las filas con error se omitirán en la importación.
                    </div>
                  ) : null}

                  <div className="flex justify-end gap-2 pt-1">
                    <Button variant="secondary" onClick={() => setOpen(false)}>Cancelar</Button>
                    <Button onClick={importar} disabled={pending || validas.length === 0}>
                      {pending ? "Importando…" : `Importar ${validas.length} ${validas.length === 1 ? "producto" : "productos"}`}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="rounded border border-dashed border-[var(--border)] px-4 py-6 text-center text-[12px] text-[var(--muted)]">
                  <div className="mb-2 text-[28px]">📄</div>
                  Seleccioná un archivo CSV para ver la vista previa antes de importar.
                  <div className="mt-2">
                    <button onClick={descargarPlantilla} className="text-action">
                      Descargar plantilla de ejemplo
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
