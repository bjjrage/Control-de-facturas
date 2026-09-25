"use client";

import { useCallback, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/format";
import {
  detectInitialStockColumnMapping,
  findUniqueExactInventoryMatch,
  INITIAL_STOCK_COLUMNS,
  parseInventoryImportCurrency,
  parseInventoryImportNumber,
  type InitialStockColumnKey,
} from "@/lib/inventory/initial-stock-import";
import { postCanonicalInventoryMovement } from "@/app/(internal)/inventory/actions";
import { validateManualInventoryMovementRequest, type ManualInventoryMovementRequest, type ManualMovementLocationOption, type ManualMovementProductOption } from "@/lib/inventory/manual";
import type { CurrencyCode } from "@/lib/types";

type StoredRow = { request: ManualInventoryMovementRequest; label: string };
type StoredBatch = { version: 1; rows: StoredRow[] };
type ImportRow = {
  sourceRow: number;
  material: string;
  materialId: string;
  quantity: string;
  unit: string;
  location: string;
  locationId: string;
  unitCost: string;
  currency: string;
  exchangeRate: string;
};

const CURRENCIES: CurrencyCode[] = ["PYG", "USD", "EUR", "BRL", "ARS"];
const fieldClass = "h-9 w-full rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px]";

function localToday() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function parseStoredBatch(value: string | null): StoredBatch | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredBatch>;
    if (parsed.version !== 1 || !Array.isArray(parsed.rows) || parsed.rows.length === 0) return null;
    for (const row of parsed.rows) {
      if (!row || typeof row.label !== "string" || !row.request) return null;
      validateManualInventoryMovementRequest(row.request);
    }
    return parsed as StoredBatch;
  } catch {
    return null;
  }
}

export function CargaInicialStockDialog({
  attemptStorageKey,
  products,
  locations,
  optionsError,
}: {
  attemptStorageKey: string;
  products: ManualMovementProductOption[];
  locations: ManualMovementLocationOption[];
  optionsError: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"manual" | "file">("manual");
  const [materialId, setMaterialId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [locationId, setLocationId] = useState("");
  const [unitCost, setUnitCost] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode | "">("PYG");
  const [effectiveDate, setEffectiveDate] = useState(localToday);
  const [note, setNote] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [sourceRows, setSourceRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<InitialStockColumnKey, number>>({
    material: -1, quantity: -1, unit: -1, location: -1, unitCost: -1, currency: -1, exchangeRate: -1,
  });
  const [rowEdits, setRowEdits] = useState<Record<number, Partial<ImportRow>>>({});
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const subscribe = useCallback((onStoreChange: () => void) => {
    const onStorage = (event: StorageEvent) => { if (event.key === attemptStorageKey || event.key === null) onStoreChange(); };
    const onLocal = () => onStoreChange();
    window.addEventListener("storage", onStorage);
    window.addEventListener("inventory-initial-stock-attempt", onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("inventory-initial-stock-attempt", onLocal);
    };
  }, [attemptStorageKey]);
  const getSnapshot = useCallback(() => {
    try { return localStorage.getItem(attemptStorageKey); } catch { return "__unavailable__"; }
  }, [attemptStorageKey]);
  const rawAttempt = useSyncExternalStore(subscribe, getSnapshot, () => null);
  const storedBatch = useMemo(() => rawAttempt === "__unavailable__" ? null : parseStoredBatch(rawAttempt), [rawAttempt]);
  const storageUnavailable = rawAttempt === "__unavailable__";
  const selectedMaterial = products.find((product) => product.id === materialId) ?? null;
  const selectedLocation = locations.find((location) => location.id === locationId) ?? null;

  const importRows = useMemo(() => sourceRows.map((row, index): ImportRow => {
    const valueAt = (key: InitialStockColumnKey) => {
      const column = mapping[key];
      return column >= 0 && column < row.length ? String(row[column] ?? "").trim() : "";
    };
    const material = valueAt("material");
    const location = valueAt("location");
    const autoMaterial = findUniqueExactInventoryMatch(material, products.map((product) => ({ id: product.id, name: product.name })));
    const autoLocation = findUniqueExactInventoryMatch(location, locations.map((candidate) => ({
      id: candidate.id,
      name: [candidate.name, candidate.projectName ?? ""].filter(Boolean).join(" "),
    })));
    const base: ImportRow = {
      sourceRow: index + 2,
      material,
      materialId: autoMaterial?.id ?? "",
      quantity: valueAt("quantity"),
      unit: valueAt("unit"),
      location,
      locationId: autoLocation?.id ?? "",
      unitCost: valueAt("unitCost"),
      currency: valueAt("currency"),
      exchangeRate: valueAt("exchangeRate"),
    };
    return {
      ...base,
      ...rowEdits[index],
      materialId: rowEdits[index]?.materialId ?? autoMaterial?.id ?? "",
      locationId: rowEdits[index]?.locationId ?? autoLocation?.id ?? "",
    };
  }), [sourceRows, mapping, products, locations, rowEdits]);

  function storeAndDispatch(batch: StoredBatch) {
    if (rawAttempt !== null) {
      setMessage("Ya existe un intento guardado. Reanúdalo o revisá el navegador antes de iniciar otra carga.");
      return false;
    }
    const serialized = JSON.stringify(batch);
    try {
      localStorage.setItem(attemptStorageKey, serialized);
      if (localStorage.getItem(attemptStorageKey) !== serialized) throw new Error("Otro intento de carga se guardó en este navegador.");
      window.dispatchEvent(new Event("inventory-initial-stock-attempt"));
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar el intento localmente; no se envió ningún movimiento.");
      return false;
    }
  }

  async function runBatch(batch: StoredBatch) {
    if (pending) return;
    setPending(true);
    setMessage(null);
    let completed = 0;
    try {
      for (const row of batch.rows) {
        const result = await postCanonicalInventoryMovement(row.request);
        if (result.error || !result.id) {
          setMessage(`La carga quedó parcial: ${completed} de ${batch.rows.length} movimientos confirmados. Fila ${row.label}: ${result.error ?? "sin confirmación"}. Reintentá usando la misma clave para no duplicar lo ya registrado.`);
          return;
        }
        completed++;
      }
      localStorage.removeItem(attemptStorageKey);
      window.dispatchEvent(new Event("inventory-initial-stock-attempt"));
      setMessage(`${completed} movimiento(s) de carga inicial registrados en el inventario canónico.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error
        ? `No se pudo confirmar la carga luego de ${completed} movimiento(s). Reintentá con el mismo intento guardado. ${error.message}`
        : "No se pudo confirmar la carga. Reintentá con el mismo intento guardado.");
    } finally {
      setPending(false);
    }
  }

  function makeRequest(args: {
    product: ManualMovementProductOption;
    locationId: string;
    quantity: number;
    unitCost: number;
    currency: CurrencyCode;
    exchangeRate?: number;
    sourceLabel: string;
  }): ManualInventoryMovementRequest {
    const request: ManualInventoryMovementRequest = {
      idempotencyKey: crypto.randomUUID(),
      productoId: args.product.id,
      quantity: args.quantity,
      movementType: "ADJUSTMENT",
      toLocationId: args.locationId,
      costCurrency: args.currency,
      unitCost: args.unitCost,
      ...(args.currency !== "PYG" ? { exchangeRateToCompany: args.exchangeRate } : {}),
      initialStockDate: effectiveDate,
      reason: `Carga inicial de stock${note.trim() ? ` — ${note.trim()}` : ""} · ${args.sourceLabel}`.slice(0, 500),
    };
    validateManualInventoryMovementRequest(request);
    return request;
  }

  async function handleManualSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (storageUnavailable || storedBatch || optionsError || !selectedMaterial || !selectedLocation || !currency) return;
    const quantityValue = parseInventoryImportNumber(quantity);
    const unitCostValue = parseInventoryImportNumber(unitCost);
    const exchangeRateValue = currency !== "PYG" ? parseInventoryImportNumber(exchangeRate) : undefined;
    if (!effectiveDate || quantityValue == null || quantityValue <= 0 || unitCostValue == null || unitCostValue < 0 || (currency !== "PYG" && (exchangeRateValue == null || exchangeRateValue <= 0))) {
      setMessage("Completá una fecha, cantidad mayor que cero y costo unitario válido.");
      return;
    }
    try {
      const batch: StoredBatch = { version: 1, rows: [{
        request: makeRequest({ product: selectedMaterial, locationId, quantity: quantityValue, unitCost: unitCostValue, currency, exchangeRate: exchangeRateValue ?? undefined, sourceLabel: "carga manual" }),
        label: selectedMaterial.name,
      }] };
      if (storeAndDispatch(batch)) await runBatch(batch);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Los datos de carga inicial no son válidos.");
    }
  }

  async function handleFile(file: File | undefined) {
    setFileError(null);
    setMessage(null);
    setHeaders([]);
    setSourceRows([]);
    setRowEdits({});
    if (!file) return;
    setFileName(file.name);
    try {
      if (file.size > 15 * 1024 * 1024) throw new Error("El archivo supera el límite de 15 MB.");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
      const sheetName = workbook.SheetNames[0];
      if (!sheetName) throw new Error("El archivo no contiene hojas para importar.");
      const values = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: "" });
      if (values.length < 2) throw new Error("La primera hoja debe tener encabezados y al menos una fila.");
      const nextHeaders = values[0].map((value) => String(value ?? "").trim());
      const nextRows = values.slice(1)
        .filter((row) => row.some((value) => String(value ?? "").trim()))
        .map((row) => row.map((value) => String(value ?? "").trim()));
      if (!nextRows.length) throw new Error("No se encontraron filas con datos.");
      setHeaders(nextHeaders);
      setSourceRows(nextRows);
      setMapping(detectInitialStockColumnMapping(nextHeaders));
    } catch (error) {
      setFileError(error instanceof Error ? error.message : "No se pudo leer el archivo.");
    }
  }

  const columnMappingErrors = INITIAL_STOCK_COLUMNS
    .filter(({ key, required }) => required && mapping[key] < 0)
    .map(({ label }) => `Falta asignar la columna ${label}.`);
  const rowErrors = importRows.map((row) => {
    const productId = row.materialId;
    const targetLocationId = row.locationId;
    const product = products.find((candidate) => candidate.id === productId);
    const quantityValue = parseInventoryImportNumber(row.quantity);
    const costValue = parseInventoryImportNumber(row.unitCost);
    const parsedCurrency = parseInventoryImportCurrency(row.currency);
    const exchangeRateValue = parseInventoryImportNumber(row.exchangeRate);
    const errors: string[] = [];
    if (!product) errors.push("vinculá un material existente");
    if (!locations.some((candidate) => candidate.id === targetLocationId)) errors.push("vinculá una ubicación activa");
    if (quantityValue == null || quantityValue <= 0) errors.push("cantidad inválida");
    if (costValue == null || costValue < 0) errors.push("costo inválido");
    if (!parsedCurrency) errors.push("moneda sin correspondencia");
    if (parsedCurrency && parsedCurrency !== "PYG" && (exchangeRateValue == null || exchangeRateValue <= 0)) errors.push("falta tipo de cambio a PYG");
    if (row.unit && product && row.unit.trim().toLocaleLowerCase("es") !== product.unit.trim().toLocaleLowerCase("es")) {
      errors.push(`unidad ${row.unit} distinta de ${product.unit}`);
    }
    return errors;
  });

  async function confirmImport() {
    if (storageUnavailable || storedBatch || optionsError || columnMappingErrors.length || !effectiveDate || rowErrors.some((errors) => errors.length)) return;
    try {
      const rows: StoredRow[] = importRows.map((row) => {
        const productId = row.materialId;
        const targetLocationId = row.locationId;
        const product = products.find((candidate) => candidate.id === productId)!;
        const currencyCode = parseInventoryImportCurrency(row.currency)!;
        return {
          request: makeRequest({
            product,
            locationId: targetLocationId,
            quantity: parseInventoryImportNumber(row.quantity)!,
            unitCost: parseInventoryImportNumber(row.unitCost)!,
            currency: currencyCode,
            exchangeRate: currencyCode === "PYG" ? undefined : parseInventoryImportNumber(row.exchangeRate)!,
            sourceLabel: `archivo ${fileName}, fila ${row.sourceRow}`,
          }),
          label: `${row.sourceRow} · ${product.name}`,
        };
      });
      const batch: StoredBatch = { version: 1, rows };
      if (storeAndDispatch(batch)) await runBatch(batch);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo preparar la carga.");
    }
  }

  function changeColumn(key: InitialStockColumnKey, value: number) {
    setMapping((current) => ({ ...current, [key]: value }));
    setRowEdits({});
  }

  const optionsBlocked = storageUnavailable || optionsError !== null || products.length === 0 || locations.length === 0;
  const invalidStoredAttempt = rawAttempt !== null && rawAttempt !== "__unavailable__" && !storedBatch;
  const initialTotalsByCurrency = importRows.reduce<Record<string, number>>((totals, row) => {
    const currencyCode = parseInventoryImportCurrency(row.currency);
    const amount = parseInventoryImportNumber(row.quantity);
    const cost = parseInventoryImportNumber(row.unitCost);
    if (currencyCode && amount != null && cost != null) totals[currencyCode] = (totals[currencyCode] ?? 0) + amount * cost;
    return totals;
  }, {});

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary" className="h-9 px-3 text-[12px]">{storedBatch ? "Reanudar carga inicial" : "Carga inicial de stock"}</Button>
      </DialogTrigger>
      <DialogContent title="Carga inicial de stock" className="max-w-5xl">
        <div className="space-y-4">
          {storedBatch ? (
            <div className="space-y-3 rounded-lg border border-[var(--warn)]/30 bg-[var(--warn-bg)] p-3 text-[12px]">
              <p className="font-medium">Hay un intento de carga pendiente guardado en este navegador.</p>
              <p>Al reintentar, los movimientos ya confirmados se reconocerán por su misma clave de idempotencia.</p>
              <div className="max-h-36 overflow-y-auto space-y-1">
                {storedBatch.rows.map((row) => <div key={row.request.idempotencyKey}>{row.label} · {row.request.quantity} {products.find((p) => p.id === row.request.productoId)?.unit ?? ""}</div>)}
              </div>
              {message ? <p role="alert">{message}</p> : null}
              <Button type="button" onClick={() => void runBatch(storedBatch)} disabled={pending}>{pending ? "Reintentando…" : "Reintentar carga guardada"}</Button>
            </div>
          ) : storageUnavailable || invalidStoredAttempt ? (
            <p role="alert" className="text-[12px] text-[var(--error)]">No se pudo leer el almacenamiento local. No cargues otra vez hasta revisar el intento anterior.</p>
          ) : (
            <>
              <div className="flex gap-2">
                <Button type="button" variant={mode === "manual" ? "primary" : "secondary"} onClick={() => setMode("manual")}>Carga manual</Button>
                <Button type="button" variant={mode === "file" ? "primary" : "secondary"} onClick={() => setMode("file")}>Importar Excel / CSV</Button>
              </div>
              {optionsError ? <p role="alert" className="text-[12px] text-[var(--error)]">{optionsError}</p> : null}
              {products.length === 0 ? <p className="text-[12px] text-[var(--muted)]">Primero creá materiales en <Link href="/stock" className="underline">Materiales</Link>.</p> : null}
              {locations.length === 0 ? <p className="text-[12px] text-[var(--muted)]">Primero creá una ubicación en <b>Ubicaciones</b>.</p> : null}
              <label className="block text-[12px] text-[var(--muted)]">
                Fecha efectiva de la carga
                <input className={`${fieldClass} mt-1 max-w-xs`} type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} required />
              </label>
              <label className="block text-[12px] text-[var(--muted)]">
                Motivo / nota
                <input className={`${fieldClass} mt-1`} value={note} onChange={(event) => setNote(event.target.value)} maxLength={400} placeholder="Conteo de apertura, saldo al iniciar el sistema…" />
              </label>

              {mode === "manual" ? (
                <form onSubmit={handleManualSubmit} className="space-y-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="text-[12px] text-[var(--muted)]">Material
                      <select className={`${fieldClass} mt-1`} value={materialId} onChange={(event) => setMaterialId(event.target.value)} required>
                        <option value="">Seleccionar material</option>
                        {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
                      </select>
                    </label>
                    <label className="text-[12px] text-[var(--muted)]">Ubicación
                      <select className={`${fieldClass} mt-1`} value={locationId} onChange={(event) => setLocationId(event.target.value)} required>
                        <option value="">Seleccionar ubicación</option>
                        {locations.map((location) => <option key={location.id} value={location.id}>{location.projectName ? `${location.projectName} · ${location.name}` : location.name}</option>)}
                      </select>
                    </label>
                    <label className="text-[12px] text-[var(--muted)]">Cantidad {selectedMaterial ? `(${selectedMaterial.unit})` : ""}
                      <input className={`${fieldClass} mt-1`} type="number" min="0.0001" step="0.0001" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
                    </label>
                    <label className="text-[12px] text-[var(--muted)]">Costo unitario
                      <input className={`${fieldClass} mt-1`} type="number" min="0" step="0.000001" value={unitCost} onChange={(event) => setUnitCost(event.target.value)} required />
                    </label>
                    <label className="text-[12px] text-[var(--muted)]">Moneda
                      <select className={`${fieldClass} mt-1`} value={currency} onChange={(event) => setCurrency(event.target.value as CurrencyCode | "")} required>
                        <option value="">Seleccionar</option>
                        {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
                      </select>
                    </label>
                    {currency && currency !== "PYG" ? (
                      <label className="text-[12px] text-[var(--muted)]">Tipo de cambio a PYG
                        <input className={`${fieldClass} mt-1`} type="number" min="0.00000001" step="0.00000001" value={exchangeRate} onChange={(event) => setExchangeRate(event.target.value)} required />
                      </label>
                    ) : null}
                    <div className="flex items-end text-[11px] text-[var(--muted)]">Se registra como ajuste de entrada canónico (INITIAL_STOCK); nunca se edita el saldo directamente.</div>
                  </div>
                  {message ? <p role="alert" className="text-[12px] text-[var(--error)]">{message}</p> : null}
                  <div className="flex justify-end"><Button type="submit" disabled={pending || optionsBlocked || !!storedBatch}>{pending ? "Registrando…" : "Registrar carga inicial"}</Button></div>
                </form>
              ) : (
                <div className="space-y-3">
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={(event) => void handleFile(event.target.files?.[0])} className="w-full text-[13px]" />
                  <p className="text-[11px] text-[var(--muted)]">Elegí las columnas, vinculá cada material y ubicación y revisá todas las filas antes de confirmar. Los nombres sin coincidencia exacta quedan sin asignar.</p>
                  {fileError ? <p role="alert" className="text-[12px] text-[var(--error)]">{fileError}</p> : null}
                  {headers.length > 0 ? (
                    <>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {INITIAL_STOCK_COLUMNS.map(({ key, label, required }) => (
                          <label key={key} className="text-[11px] text-[var(--muted)]">{label}{required ? " *" : ""}
                            <select className={`${fieldClass} mt-1`} value={mapping[key]} onChange={(event) => changeColumn(key, Number(event.target.value))}>
                              <option value={-1}>No usar</option>
                              {headers.map((header, index) => <option key={`${index}-${header}`} value={index}>{header || `Columna ${index + 1}`}</option>)}
                            </select>
                          </label>
                        ))}
                      </div>
                      {columnMappingErrors.length > 0 ? <p className="text-[11px] text-[var(--warn)]">{columnMappingErrors.join(" ")}</p> : null}
                      <div className="max-h-[45vh] overflow-auto rounded-lg border border-[var(--border)]">
                        <table className="min-w-[900px] text-[11px]">
                          <thead><tr><th>Fila / material del archivo</th><th>Material vinculado</th><th>Cantidad</th><th>Unidad</th><th>Ubicación del archivo</th><th>Ubicación vinculada</th><th>Costo unitario</th><th>Moneda</th><th>Tipo cambio PYG</th><th>Revisión</th></tr></thead>
                          <tbody>{importRows.map((row, index) => {
                            const productId = row.materialId;
                            const targetLocationId = row.locationId;
                            const product = products.find((candidate) => candidate.id === productId);
                            return (
                              <tr key={row.sourceRow}>
                                <td>{row.sourceRow} · {row.material || "—"}</td>
                                <td><select aria-label={`Material fila ${row.sourceRow}`} className={fieldClass} value={productId} onChange={(event) => setRowEdits((current) => ({ ...current, [index]: { ...current[index], materialId: event.target.value } }))}><option value="">Sin vínculo</option>{products.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></td>
                                <td><input aria-label={`Cantidad fila ${row.sourceRow}`} className={fieldClass} type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={(event) => setRowEdits((current) => ({ ...current, [index]: { ...current[index], quantity: event.target.value } }))} /></td>
                                <td><input aria-label={`Unidad fila ${row.sourceRow}`} className={fieldClass} value={row.unit || product?.unit || ""} onChange={(event) => setRowEdits((current) => ({ ...current, [index]: { ...current[index], unit: event.target.value } }))} /></td>
                                <td>{row.location || "—"}</td>
                                <td><select aria-label={`Ubicación fila ${row.sourceRow}`} className={fieldClass} value={targetLocationId} onChange={(event) => setRowEdits((current) => ({ ...current, [index]: { ...current[index], locationId: event.target.value } }))}><option value="">Sin vínculo</option>{locations.map((option) => <option key={option.id} value={option.id}>{option.projectName ? `${option.projectName} · ${option.name}` : option.name}</option>)}</select></td>
                                <td><input aria-label={`Costo unitario fila ${row.sourceRow}`} className={fieldClass} type="number" min="0" step="0.000001" value={row.unitCost} onChange={(event) => setRowEdits((current) => ({ ...current, [index]: { ...current[index], unitCost: event.target.value } }))} /></td>
                                <td><select aria-label={`Moneda fila ${row.sourceRow}`} className={fieldClass} value={parseInventoryImportCurrency(row.currency) ?? ""} onChange={(event) => setRowEdits((current) => ({ ...current, [index]: { ...current[index], currency: event.target.value } }))}><option value="">Sin asignar</option>{CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}</select></td>
                                <td>{parseInventoryImportCurrency(row.currency) !== "PYG" ? <input aria-label={`Tipo de cambio fila ${row.sourceRow}`} className={fieldClass} type="number" min="0.00000001" step="0.00000001" value={row.exchangeRate} onChange={(event) => setRowEdits((current) => ({ ...current, [index]: { ...current[index], exchangeRate: event.target.value } }))} /> : "—"}</td>
                                <td className={rowErrors[index].length ? "text-[var(--error)]" : "text-[var(--ok)]"}>{rowErrors[index].length ? rowErrors[index].join("; ") : "Lista"}</td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      </div>
                      {importRows.length > 0 ? <p className="text-[11px] text-[var(--muted)]">Vista previa: {importRows.length} filas · Total por moneda: {Object.entries(initialTotalsByCurrency).map(([code, total]) => formatMoney(total, code as CurrencyCode)).join(" · ") || "pendiente de completar"}. No se aceptan filas ambiguas.</p> : null}
                    </>
                  ) : null}
                  {message ? <p role="alert" className="text-[12px] text-[var(--error)]">{message}</p> : null}
                  <div className="flex justify-end"><Button type="button" onClick={() => void confirmImport()} disabled={pending || optionsBlocked || sourceRows.length === 0 || columnMappingErrors.length > 0 || rowErrors.some((errors) => errors.length > 0) || !effectiveDate}>{pending ? "Registrando…" : `Confirmar ${importRows.length} movimiento(s)`}</Button></div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
