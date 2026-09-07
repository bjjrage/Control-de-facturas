"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label, Select } from "@/components/ui/input";
import { formatNumber } from "@/lib/format";
import type { ProjectCertificateItem } from "@/lib/types";
import { bulkSetCertificatePresente } from "../certificado-actions";

type MatchMode = "orden" | "codigo";

function parseGrid(text: string): string[][] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => line.split("\t"));
}

/** "1.234,56" | "1,234.56" | "1234.56" -> number */
function parseNumber(raw: string): number | null {
  const s = raw.trim().replace(/\s/g, "").replace(/["']/g, "");
  if (!s) return null;
  let n: number;
  if (s.includes(",") && s.includes(".")) {
    // el último separador es el decimal
    n = s.lastIndexOf(",") > s.lastIndexOf(".")
      ? Number(s.replace(/\./g, "").replace(",", "."))
      : Number(s.replace(/,/g, ""));
  } else if (s.includes(",")) {
    n = Number(s.replace(",", "."));
  } else {
    n = Number(s);
  }
  return Number.isFinite(n) ? n : null;
}

export function PasteAvanceDialog({
  certificateId,
  items,
}: {
  certificateId: string;
  items: ProjectCertificateItem[];
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [col, setCol] = useState(0);
  const [skipHeader, setSkipHeader] = useState(false);
  const [mode, setMode] = useState<MatchMode>("orden");
  const [codeCol, setCodeCol] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.sort_order - b.sort_order),
    [items]
  );

  const grid = useMemo(() => parseGrid(text), [text]);
  const nCols = grid.reduce((mx, r) => Math.max(mx, r.length), 0);
  const dataRows = skipHeader ? grid.slice(1) : grid;

  // Vista previa: cada línea del certificado con su valor nuevo.
  const preview = useMemo(() => {
    if (dataRows.length === 0) return [];
    if (mode === "codigo") {
      const byCode = new Map<string, number>();
      for (const r of dataRows) {
        const code = (r[codeCol] ?? "").trim();
        const val = parseNumber(r[col] ?? "");
        if (code && val != null) byCode.set(code.toLowerCase(), val);
      }
      return sortedItems.map((it) => ({
        item: it,
        nuevo: byCode.get((it.codigo ?? "").trim().toLowerCase()) ?? null,
      }));
    }
    return sortedItems.map((it, i) => ({
      item: it,
      nuevo: dataRows[i] ? parseNumber(dataRows[i][col] ?? "") : null,
    }));
  }, [dataRows, mode, sortedItems, col, codeCol]);

  const matched = preview.filter((p) => p.nuevo != null).length;
  const rowMismatch = mode === "orden" && dataRows.length > 0 && dataRows.length !== sortedItems.length;

  async function apply() {
    setPending(true);
    setError(null);
    const values = preview
      .filter((p) => p.nuevo != null)
      .map((p) => ({ itemId: p.item.id, qty_presente: p.nuevo as number }));
    const res = await bulkSetCertificatePresente(certificateId, values);
    setPending(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setText("");
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">Pegar avance del mes</Button>
      </DialogTrigger>
      <DialogContent title="Pegar avance del mes desde Excel" className="max-w-3xl">
        <div className="space-y-3">
          <p className="text-[12px] text-[var(--muted)]">
            En tu Excel (hoja de medición o ACTA), seleccioná la columna <strong>&quot;presente&quot;</strong> —
            junto con la columna de código o rubro si querés emparejar por código— copiá (Ctrl+C) y pegá acá.
          </p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={"Pegá acá…\n0\n174,10\n21,40\n..."}
            rows={7}
            className="w-full rounded border border-[var(--border)] bg-[var(--panel-2)] p-2 text-[12px] font-mono"
          />

          {grid.length > 0 ? (
            <div className="flex flex-wrap items-end gap-3 text-[12px]">
              {nCols > 1 ? (
                <div>
                  <Label htmlFor="pa_col">Columna con la cantidad del mes</Label>
                  <Select id="pa_col" value={col} onChange={(e) => setCol(Number(e.target.value))} className="h-8">
                    {Array.from({ length: nCols }, (_, i) => (
                      <option key={i} value={i}>
                        Columna {i + 1}
                        {grid[0]?.[i] ? ` — "${grid[0][i].slice(0, 20)}"` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              <div>
                <Label htmlFor="pa_mode">Emparejar</Label>
                <Select
                  id="pa_mode"
                  value={mode}
                  onChange={(e) => setMode(e.target.value as MatchMode)}
                  className="h-8"
                >
                  <option value="orden">Por orden de fila</option>
                  <option value="codigo">Por código de rubro</option>
                </Select>
              </div>

              {mode === "codigo" && nCols > 1 ? (
                <div>
                  <Label htmlFor="pa_codecol">Columna con el código</Label>
                  <Select
                    id="pa_codecol"
                    value={codeCol}
                    onChange={(e) => setCodeCol(Number(e.target.value))}
                    className="h-8"
                  >
                    {Array.from({ length: nCols }, (_, i) => (
                      <option key={i} value={i}>
                        Columna {i + 1}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}

              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={skipHeader}
                  onChange={(e) => setSkipHeader(e.target.checked)}
                />
                La primera fila es encabezado
              </label>
            </div>
          ) : null}

          {rowMismatch ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              Pegaste {dataRows.length} filas y el certificado tiene {sortedItems.length} rubros. Revisá que
              coincidan (o probá emparejar por código).
            </div>
          ) : null}

          {error ? (
            <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)]">
              {error}
            </div>
          ) : null}

          {preview.length > 0 && text.trim() ? (
            <div className="max-h-72 overflow-y-auto rounded border border-[var(--border)]">
              <table className="text-[12px]">
                <thead>
                  <tr>
                    <th>Rubro</th>
                    <th className="num">Presente actual</th>
                    <th className="num">Presente nuevo</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map(({ item, nuevo }) => (
                    <tr key={item.id}>
                      <td>
                        <span className="font-mono text-[var(--muted)]">{item.codigo}</span>{" "}
                        {item.descripcion}
                      </td>
                      <td className="num text-[var(--muted)]">{formatNumber(item.qty_presente)}</td>
                      <td className={`num ${nuevo == null ? "text-[var(--muted)]" : "font-medium"}`}>
                        {nuevo == null ? "— sin dato —" : formatNumber(nuevo)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="flex items-center justify-between pt-1">
            <span className="text-[12px] text-[var(--muted)]">
              {text.trim() ? `${matched} de ${sortedItems.length} rubros con dato` : ""}
            </span>
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button disabled={pending || matched === 0} onClick={apply}>
                {pending ? "Aplicando…" : `Aplicar a ${matched} rubros`}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
