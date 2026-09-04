"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { formatMoney } from "@/lib/format";
import { importBudgetItems, type ImportedBudgetItem } from "../actions";

type FieldKey = "code" | "description" | "unit" | "quantity" | "unit_price";
type ColumnAssignment = FieldKey | "ignore";

const FIELD_LABELS: Record<FieldKey, string> = {
  code: "Código",
  description: "Descripción",
  unit: "Unidad",
  quantity: "Cantidad",
  unit_price: "Precio unitario",
};

// Variantes de encabezado conocidas para auto-detectar el mapeo. Comparadas
// ya normalizadas (minúsculas, sin acentos).
const HEADER_VARIANTS: Record<FieldKey, string[]> = {
  code: ["codigo", "cod", "item", "nro", "n", "n°"],
  description: ["descripcion", "detalle", "rubro", "concepto", "designacion"],
  unit: ["unidad", "und", "un", "u.m.", "medida"],
  quantity: ["cantidad", "cant", "qty", "metrado", "computo"],
  unit_price: ["precio unitario", "p. unitario", "punit", "precio", "p.u.", "costo unitario"],
};

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim();
}

// Formato paraguayo: los puntos son separador de miles ("1.250.000" = 1250000),
// la coma (si aparece) es el separador decimal.
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

function autoDetectMapping(headers: string[]): Record<number, ColumnAssignment> {
  const mapping: Record<number, ColumnAssignment> = {};
  const used = new Set<FieldKey>();
  headers.forEach((h, idx) => {
    const norm = normalize(h);
    let matched: ColumnAssignment = "ignore";
    for (const [field, variants] of Object.entries(HEADER_VARIANTS) as [FieldKey, string[]][]) {
      if (used.has(field)) continue;
      if (variants.some((v) => norm === v || norm.includes(v))) {
        matched = field;
        used.add(field);
        break;
      }
    }
    mapping[idx] = matched;
  });
  return mapping;
}

type Step = "upload" | "map" | "preview";

type PreviewRow = {
  item: ImportedBudgetItem;
  valid: boolean;
  reason?: string;
};

export function ImportBudgetDialog({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("upload");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  const [sheetNames, setSheetNames] = useState<string[]>([]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [workbook, setWorkbook] = useState<any>(null);
  const [selectedSheet, setSelectedSheet] = useState("");
  const [rawRows, setRawRows] = useState<unknown[][]>([]);
  const [hasHeaders, setHasHeaders] = useState(true);
  const [mapping, setMapping] = useState<Record<number, ColumnAssignment>>({});

  function reset() {
    setStep("upload");
    setError(null);
    setSheetNames([]);
    setWorkbook(null);
    setSelectedSheet("");
    setRawRows([]);
    setHasHeaders(true);
    setMapping({});
  }

  async function handleFile(file: File) {
    setError(null);
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      setWorkbook(wb);
      setSheetNames(wb.SheetNames);
      const firstSheet = wb.SheetNames[0];
      setSelectedSheet(firstSheet);
      loadSheet(wb, firstSheet, XLSX);
    } catch {
      setError("No se pudo leer el archivo. Verificá que sea un .xlsx o .csv válido.");
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function loadSheet(wb: any, sheetName: string, XLSX: any) {
    const sheet = wb.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" });
    const nonEmpty = rows.filter((r) => r.some((c) => String(c).trim() !== ""));
    setRawRows(nonEmpty);
    if (nonEmpty.length > 0) {
      const headers = (nonEmpty[0] as unknown[]).map((h) => String(h));
      setMapping(autoDetectMapping(headers));
    }
    setStep("map");
  }

  async function handleSheetChange(name: string) {
    setSelectedSheet(name);
    if (!workbook) return;
    const XLSX = await import("xlsx");
    loadSheet(workbook, name, XLSX);
  }

  const headers = useMemo(() => {
    if (rawRows.length === 0) return [];
    return hasHeaders
      ? (rawRows[0] as unknown[]).map((h) => String(h))
      : (rawRows[0] as unknown[]).map((_, i) => `Columna ${i + 1}`);
  }, [rawRows, hasHeaders]);

  const dataRows = useMemo(() => (hasHeaders ? rawRows.slice(1) : rawRows), [rawRows, hasHeaders]);

  const colCount = headers.length;

  function setColumnMapping(colIdx: number, field: ColumnAssignment) {
    setMapping((prev) => {
      const next = { ...prev };
      // Un campo (que no sea "ignore") solo puede estar asignado a una columna.
      if (field !== "ignore") {
        for (const k of Object.keys(next)) {
          if (Number(k) !== colIdx && next[Number(k)] === field) next[Number(k)] = "ignore";
        }
      }
      next[colIdx] = field;
      return next;
    });
  }

  const previewRows: PreviewRow[] = useMemo(() => {
    const codeCol = Object.entries(mapping).find(([, v]) => v === "code")?.[0];
    const descCol = Object.entries(mapping).find(([, v]) => v === "description")?.[0];
    const unitCol = Object.entries(mapping).find(([, v]) => v === "unit")?.[0];
    const qtyCol = Object.entries(mapping).find(([, v]) => v === "quantity")?.[0];
    const priceCol = Object.entries(mapping).find(([, v]) => v === "unit_price")?.[0];

    return dataRows.map((row) => {
      const code = codeCol !== undefined ? String(row[Number(codeCol)] ?? "").trim() : "";
      const description = descCol !== undefined ? String(row[Number(descCol)] ?? "").trim() : "";
      const unitRaw = unitCol !== undefined ? String(row[Number(unitCol)] ?? "").trim() : "";
      const qtyRaw = qtyCol !== undefined ? row[Number(qtyCol)] : "";
      const priceRaw = priceCol !== undefined ? row[Number(priceCol)] : "";

      const qtyStr = String(qtyRaw ?? "").trim();
      const priceStr = String(priceRaw ?? "").trim();
      const quantity = qtyStr ? parsePyNumber(qtyRaw) : null;
      const unit_price = priceStr ? parsePyNumber(priceRaw) : null;

      let valid = true;
      let reason: string | undefined;
      if (!code) { valid = false; reason = "Código vacío"; }
      else if (!description) { valid = false; reason = "Descripción vacía"; }
      else if (qtyStr && quantity === null) { valid = false; reason = "Cantidad no numérica"; }
      else if (priceStr && unit_price === null) { valid = false; reason = "Precio no numérico"; }

      return {
        item: { code, description, unit: unitRaw || null, quantity, unit_price },
        valid,
        reason,
      };
    });
  }, [dataRows, mapping]);

  const validItems = previewRows.filter((r) => r.valid).map((r) => r.item);
  const invalidCount = previewRows.length - validItems.length;
  const previewTotal = validItems.reduce((s, i) => s + (i.quantity ?? 0) * (i.unit_price ?? 0), 0);

  async function confirmImport() {
    setPending(true);
    setError(null);
    const result = await importBudgetItems(projectId, validItems);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    setOpen(false);
    reset();
    router.refresh();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">Importar Excel</Button>
      </DialogTrigger>
      <DialogContent title="Importar presupuesto desde Excel" className="max-w-2xl">
        {error ? (
          <div className="rounded border border-[var(--error)]/30 bg-[var(--error-bg)] px-2.5 py-1.5 text-[12px] text-[var(--error)] mb-3">
            {error}
          </div>
        ) : null}

        {step === "upload" ? (
          <div className="space-y-3">
            <p className="text-[13px] text-[var(--muted)]">
              Subí el archivo .xlsx o .csv con tu cómputo métrico. En el próximo paso vas a poder decirle al
              sistema qué significa cada columna.
            </p>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleFile(file);
              }}
              className="w-full text-[13px] file:mr-3 file:rounded-md file:border file:border-[var(--border)] file:bg-[var(--panel-2)] file:px-3 file:py-1.5 file:text-[13px] file:cursor-pointer"
            />
          </div>
        ) : null}

        {step === "map" ? (
          <div className="space-y-3">
            {sheetNames.length > 1 ? (
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-[var(--muted)]">Hoja:</span>
                <Select
                  value={selectedSheet}
                  onChange={(e) => handleSheetChange(e.target.value)}
                  className="w-auto h-7 text-[12px]"
                >
                  {sheetNames.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </Select>
              </div>
            ) : null}

            <label className="flex items-center gap-2 text-[12px] text-[var(--muted)]">
              <input
                type="checkbox"
                checked={hasHeaders}
                onChange={(e) => setHasHeaders(e.target.checked)}
              />
              La primera fila son encabezados
            </label>

            <div className="overflow-x-auto rounded border border-[var(--border)]">
              <table>
                <thead>
                  <tr>
                    {headers.map((_, idx) => (
                      <th key={idx} className="min-w-[130px]">
                        <Select
                          value={mapping[idx] ?? "ignore"}
                          onChange={(e) => setColumnMapping(idx, e.target.value as ColumnAssignment)}
                          className="h-7 text-[11px]"
                        >
                          <option value="ignore">(ignorar)</option>
                          {(Object.keys(FIELD_LABELS) as FieldKey[]).map((f) => (
                            <option key={f} value={f}>{FIELD_LABELS[f]}</option>
                          ))}
                        </Select>
                      </th>
                    ))}
                  </tr>
                  <tr>
                    {headers.map((h, idx) => (
                      <th key={idx} className="text-[11px] font-normal text-[var(--muted)]">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {dataRows.slice(0, 5).map((row, ridx) => (
                    <tr key={ridx}>
                      {headers.map((_, cidx) => (
                        <td key={cidx} className="text-[12px]">{String(row[cidx] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="secondary" onClick={() => setStep("upload")}>Atrás</Button>
              <Button type="button" onClick={() => setStep("preview")}>Siguiente</Button>
            </div>
          </div>
        ) : null}

        {step === "preview" ? (
          <div className="space-y-3">
            <div className="rounded border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px] flex items-center justify-between">
              <span>
                Se van a importar <strong>{validItems.length}</strong> ítems
                {invalidCount > 0 ? `, se saltean ${invalidCount}` : ""}.
              </span>
              <span className="font-mono">{formatMoney(previewTotal, "PYG")}</span>
            </div>

            <div className="max-h-72 overflow-y-auto rounded border border-[var(--border)]">
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Descripción</th>
                    <th>Unid.</th>
                    <th className="num">Cantidad</th>
                    <th className="num">P. Unit.</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((r, idx) => (
                    <tr
                      key={idx}
                      className={!r.valid ? "bg-[var(--error-bg)]" : undefined}
                    >
                      <td className={!r.valid ? "text-[var(--error)]" : undefined}>{r.item.code || "—"}</td>
                      <td>{r.item.description || (r.reason ?? "—")}</td>
                      <td className="text-[var(--muted)]">{r.item.unit ?? "—"}</td>
                      <td className="num">{r.item.quantity ?? "—"}</td>
                      <td className="num">{r.item.unit_price ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-between">
              <Button type="button" variant="secondary" onClick={() => setStep("map")}>Atrás</Button>
              <Button type="button" onClick={confirmImport} disabled={pending || validItems.length === 0}>
                {pending ? "Importando…" : `Importar ${validItems.length} ítems`}
              </Button>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
