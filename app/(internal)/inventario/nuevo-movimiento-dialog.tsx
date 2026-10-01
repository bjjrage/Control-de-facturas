"use client";

import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { postCanonicalInventoryMovement } from "@/app/(internal)/inventory/actions";
import {
  isManualInventoryMovementType,
  parsePersistedManualInventoryAttempt,
  type ManualInventoryMovementRequest,
  type ManualInventoryMovementType,
  type ManualMovementBalanceOption,
  type ManualMovementLocationOption,
  type ManualMovementProductOption,
} from "@/lib/inventory/manual";
import { formatNumber } from "@/lib/format";
import type { CurrencyCode } from "@/lib/types";

const CURRENCIES: { code: CurrencyCode; label: string }[] = [
  { code: "PYG", label: "Guaraníes (PYG)" },
  { code: "USD", label: "Dólares (USD)" },
  { code: "EUR", label: "Euros (EUR)" },
  { code: "BRL", label: "Reales (BRL)" },
  { code: "ARS", label: "Pesos argentinos (ARS)" },
];

const fieldClass = "w-full h-9 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-2.5 text-[13px] disabled:opacity-60";
const labelClass = "mb-1 block text-[12px] text-[var(--muted)]";
const ATTEMPT_STORAGE_CHANGED = "inventory-manual-attempt-storage-changed";
const STORAGE_UNAVAILABLE = "__inventory_attempt_storage_unavailable__";

function locationLabel(location: ManualMovementLocationOption) {
  const typeLabel = location.locationType === "CENTRAL"
    ? "Depósito central"
    : location.locationType === "PROJECT"
      ? location.projectName ?? "Obra"
      : "Auxiliar";
  const displayName = location.name.replace(/paño[l]?/gi, "Depósito").replace(/pano[l]?/gi, "Depósito");
  return `${typeLabel} · ${displayName}`;
}

export function NuevoMovimientoDialog({
  attemptStorageKey,
  locations,
  products,
  balances,
  optionsError,
}: {
  attemptStorageKey: string;
  locations: ManualMovementLocationOption[];
  products: ManualMovementProductOption[];
  balances: ManualMovementBalanceOption[];
  optionsError: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [movementType, setMovementType] = useState<ManualInventoryMovementType>("TRANSFER");
  const [productId, setProductId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [fromLocationId, setFromLocationId] = useState("");
  const [toLocationId, setToLocationId] = useState("");
  const [adjustmentLocationId, setAdjustmentLocationId] = useState("");
  const [adjustmentDirection, setAdjustmentDirection] = useState<"INCREASE" | "DECREASE">("INCREASE");
  const [costCurrency, setCostCurrency] = useState<CurrencyCode>("PYG");
  const [unitCost, setUnitCost] = useState("");
  const [exchangeRate, setExchangeRate] = useState("");
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [attemptLocked, setAttemptLocked] = useState(false);
  const [recoveryDismissed, setRecoveryDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completedId, setCompletedId] = useState<string | null>(null);
  const attempt = useRef<{ request: ManualInventoryMovementRequest } | null>(null);
  const subscribeToAttemptStorage = useCallback((onStoreChange: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === attemptStorageKey || event.key === null) onStoreChange();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(ATTEMPT_STORAGE_CHANGED, onStoreChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(ATTEMPT_STORAGE_CHANGED, onStoreChange);
    };
  }, [attemptStorageKey]);
  const getAttemptStorageSnapshot = useCallback(() => {
    try {
      return localStorage.getItem(attemptStorageKey);
    } catch {
      return STORAGE_UNAVAILABLE;
    }
  }, [attemptStorageKey]);
  const storedAttempt = useSyncExternalStore(subscribeToAttemptStorage, getAttemptStorageSnapshot, () => null);
  const persistedRequest = useMemo(() => {
    if (!storedAttempt || storedAttempt === STORAGE_UNAVAILABLE) return null;
    try {
      return parsePersistedManualInventoryAttempt(JSON.parse(storedAttempt));
    } catch {
      return null;
    }
  }, [storedAttempt]);
  const recoveredAttempt = persistedRequest !== null;
  const storageRecoveryError = storedAttempt === STORAGE_UNAVAILABLE
    ? "No se pudo leer el almacenamiento local. No inicies otro movimiento; habilitá el almacenamiento y solicitá revisión antes de continuar."
    : storedAttempt && !persistedRequest
      ? "Hay un intento de movimiento guardado pero no se puede validar. No inicies otro movimiento; solicitá revisión antes de continuar."
      : null;
  const forceRecoveryOpen = (recoveredAttempt || storageRecoveryError !== null) && !recoveryDismissed;

  const selectedProduct = products.find((product) => product.id === productId) ?? null;
  const amount = Number(quantity);
  const isAdjustment = movementType === "ADJUSTMENT";
  const isAdjustmentIncrease = isAdjustment && adjustmentDirection === "INCREASE";
  const selectedAdjustmentLocation = locations.find((location) => location.id === adjustmentLocationId) ?? null;
  const adjustmentBuckets = balances.filter((balance) =>
    balance.productId === productId
    && balance.locationId === adjustmentLocationId
    && balance.costStatus === "COMPUTABLE"
    && balance.costCurrency !== null
    && balance.quantity > 0,
  );
  const adjustmentCurrencies = [...new Set(adjustmentBuckets
    .map((balance) => balance.costCurrency)
    .filter((currency): currency is string => currency !== null))];
  const effectiveCostCurrency = !isAdjustmentIncrease && adjustmentCurrencies.length > 0
    ? adjustmentCurrencies.includes(costCurrency) ? costCurrency : adjustmentCurrencies[0] as CurrencyCode
    : costCurrency;
  const selectedAdjustmentBucket = adjustmentBuckets.find((balance) => balance.costCurrency === effectiveCostCurrency) ?? null;
  const sourceLocationId = isAdjustment
    ? adjustmentDirection === "DECREASE" ? adjustmentLocationId : ""
    : fromLocationId;
  const sourceBalance = balances
    .filter((balance) =>
      balance.productId === productId
      && balance.locationId === sourceLocationId
      && balance.costStatus === "COMPUTABLE"
      && balance.costCurrency !== null,
    )
    .reduce((sum, balance) => sum + balance.quantity, 0);
  const locked = pending || attemptLocked || completedId !== null;

  function reset() {
    setMovementType("TRANSFER");
    setProductId("");
    setQuantity("");
    setFromLocationId("");
    setToLocationId("");
    setAdjustmentLocationId("");
    setAdjustmentDirection("INCREASE");
    setCostCurrency("PYG");
    setUnitCost("");
    setExchangeRate("");
    setReason("");
    setPending(false);
    setAttemptLocked(false);
    setError(null);
    setCompletedId(null);
    attempt.current = null;
    try {
      localStorage.removeItem(attemptStorageKey);
      window.dispatchEvent(new Event(ATTEMPT_STORAGE_CHANGED));
    } catch {
      // A stale record is safe: the same key resolves to the already-posted movement.
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) setRecoveryDismissed(false);
    else if (recoveredAttempt || storageRecoveryError) setRecoveryDismissed(true);
    if (!nextOpen && completedId) reset();
  }

  function makeRequest(): ManualInventoryMovementRequest {
    if (!selectedProduct) throw new Error("Seleccioná un producto.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Ingresá una cantidad mayor a cero.");

    const idempotencyKey = crypto.randomUUID();
    if (!isManualInventoryMovementType(movementType)) throw new Error("El tipo de movimiento no es válido.");

    if (movementType === "ADJUSTMENT") {
      if (!selectedAdjustmentLocation) throw new Error("Seleccioná la ubicación del ajuste.");
      return {
        idempotencyKey,
        productoId: selectedProduct.id,
        quantity: isAdjustmentIncrease ? amount : -amount,
        movementType,
        fromLocationId: isAdjustmentIncrease ? null : adjustmentLocationId,
        toLocationId: isAdjustmentIncrease ? adjustmentLocationId : null,
        costCurrency: effectiveCostCurrency,
        ...(isAdjustmentIncrease ? {
          unitCost: Number(unitCost),
          ...(effectiveCostCurrency !== "PYG" ? { exchangeRateToCompany: Number(exchangeRate) } : {}),
        } : {}),
        reason: reason.trim(),
      };
    }

    return {
      idempotencyKey,
      productoId: selectedProduct.id,
      quantity: amount,
      movementType,
      fromLocationId,
      toLocationId,
      reason: reason.trim() || null,
    };
  }

  function persistAttempt(request: ManualInventoryMovementRequest): boolean {
    const serialized = JSON.stringify({ version: 1, request });
    try {
      localStorage.setItem(attemptStorageKey, serialized);
      return true;
    } catch {
      try {
        return localStorage.getItem(attemptStorageKey) === serialized;
      } catch {
        return false;
      }
    }
  }

  function clearPersistedAttempt() {
    try {
      localStorage.removeItem(attemptStorageKey);
      window.dispatchEvent(new Event(ATTEMPT_STORAGE_CHANGED));
    } catch {
      // Retrying a stale key remains idempotent and will return the committed movement.
    }
  }

  async function submitRequest(request: ManualInventoryMovementRequest) {
    if (pending || completedId) return;
    setError(null);
    if (!persistAttempt(request)) {
      attempt.current = null;
      setAttemptLocked(false);
      setError("No se pudo guardar la clave de idempotencia en este navegador; el movimiento no se envió. Habilitá el almacenamiento local y volvé a intentar.");
      return;
    }
    attempt.current = { request };
    setAttemptLocked(true);
    setPending(true);
    try {
      const result = await postCanonicalInventoryMovement(request);
      if (result.error) {
        if (!result.retryable) {
          attempt.current = null;
          setAttemptLocked(false);
          clearPersistedAttempt();
        }
        setError(result.error);
        return;
      }
      if (!result.id) {
        setError("No se recibió confirmación del movimiento. Reintentá sin cambiar los datos para conservar la idempotencia.");
        return;
      }
      attempt.current = null;
      setAttemptLocked(false);
      clearPersistedAttempt();
      setCompletedId(result.id);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error
        ? `${submitError.message} Si hubo un error de conexión, reintentá sin cambiar los datos.`
        : "No se pudo confirmar el movimiento. Reintentá sin cambiar los datos para conservar la idempotencia.");
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || completedId || recoveredAttempt || storageRecoveryError) return;
    try {
      const request = attempt.current?.request ?? makeRequest();
      await submitRequest(request);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Los datos del movimiento no son válidos.");
    }
  }

  const canOpen = !optionsError && locations.length > 0 && products.length > 0;

  return (
    <>
      <Dialog open={open || forceRecoveryOpen} onOpenChange={handleOpenChange}>
        <DialogTrigger asChild>
          <Button className="h-9 px-3 text-[12px]" disabled={!canOpen}>Nuevo movimiento</Button>
        </DialogTrigger>
        <DialogContent title="Nuevo movimiento de inventario" className="max-w-xl">
          {completedId ? (
            <div className="space-y-4">
              <div className="rounded-md border border-[var(--success)]/30 bg-[var(--success-bg)] px-3 py-3 text-[13px]">
                Movimiento registrado en el inventario canónico.
                <div className="mt-1 break-all font-mono text-[11px] text-[var(--muted)]">{completedId}</div>
              </div>
              <div className="flex justify-end">
                <Button type="button" onClick={() => handleOpenChange(false)}>Cerrar</Button>
              </div>
            </div>
          ) : storageRecoveryError ? (
            <div className="space-y-4">
              <div role="alert" className="rounded-md border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-3 text-[13px] text-[var(--error)]">
                {storageRecoveryError}
              </div>
              <div className="flex justify-end">
                <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)}>Cerrar</Button>
              </div>
            </div>
          ) : recoveredAttempt && persistedRequest ? (
            <div className="space-y-4">
              <div className="rounded-md border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-3 text-[13px]">
                <p className="font-medium">Movimiento pendiente de confirmación</p>
                <p className="mt-1 text-[12px] text-[var(--muted)]">
                  {persistedRequest.movementType} · {Math.abs(persistedRequest.quantity)} · producto {persistedRequest.productoId}
                </p>
                <p className="mt-2 text-[12px]">Reintentar consulta la misma clave y los mismos datos; no crea una segunda operación.</p>
              </div>
              {error ? <p role="alert" className="text-[12px] text-[var(--error)]">{error}</p> : null}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)} disabled={pending}>Cerrar</Button>
                <Button type="button" onClick={() => void submitRequest(persistedRequest)} disabled={pending}>
                  {pending ? "Consultando…" : "Consultar / reintentar"}
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelClass} htmlFor="manual-movement-type">Tipo</label>
                  <select
                    id="manual-movement-type"
                    className={fieldClass}
                    value={movementType}
                    disabled={locked}
                    onChange={(event) => setMovementType(event.target.value as ManualInventoryMovementType)}
                  >
                    <option value="TRANSFER">Transferencia</option>
                    <option value="RETURN">Devolución</option>
                    <option value="ADJUSTMENT">Ajuste autorizado</option>
                  </select>
                </div>
                <div>
                  <label className={labelClass} htmlFor="manual-movement-product">Producto</label>
                  <select
                    id="manual-movement-product"
                    className={fieldClass}
                    value={productId}
                    disabled={locked}
                    required
                    onChange={(event) => setProductId(event.target.value)}
                  >
                    <option value="">Seleccionar producto…</option>
                    {products.map((product) => (
                      <option key={product.id} value={product.id}>{product.name} · {product.unit}</option>
                    ))}
                  </select>
                </div>
              </div>

              {isAdjustment ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass} htmlFor="manual-adjustment-direction">Tipo de ajuste</label>
                      <select
                        id="manual-adjustment-direction"
                        className={fieldClass}
                        value={adjustmentDirection}
                        disabled={locked}
                        onChange={(event) => setAdjustmentDirection(event.target.value as "INCREASE" | "DECREASE")}
                      >
                        <option value="INCREASE">Entrada por ajuste</option>
                        <option value="DECREASE">Salida por ajuste</option>
                      </select>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="manual-adjustment-location">Ubicación</label>
                      <select
                        id="manual-adjustment-location"
                        className={fieldClass}
                        value={adjustmentLocationId}
                        disabled={locked}
                        required
                        onChange={(event) => setAdjustmentLocationId(event.target.value)}
                      >
                        <option value="">Seleccionar ubicación…</option>
                        {locations.map((location) => (
                          <option key={location.id} value={location.id}>{locationLabel(location)}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass} htmlFor="manual-adjustment-quantity">Cantidad {selectedProduct ? `(${selectedProduct.unit})` : ""}</label>
                      <input
                        id="manual-adjustment-quantity"
                        className={fieldClass}
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={quantity}
                        disabled={locked}
                        required
                        onChange={(event) => setQuantity(event.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="manual-adjustment-currency">Moneda de costo</label>
                      <select
                        id="manual-adjustment-currency"
                        className={fieldClass}
                        value={effectiveCostCurrency}
                        disabled={locked}
                        onChange={(event) => {
                          setCostCurrency(event.target.value as CurrencyCode);
                          setUnitCost("");
                          setExchangeRate("");
                        }}
                      >
                        {isAdjustmentIncrease
                          ? CURRENCIES.map((currency) => (
                            <option key={currency.code} value={currency.code}>{currency.label}</option>
                          ))
                          : adjustmentCurrencies.map((currency) => (
                            <option key={currency} value={currency}>
                              {CURRENCIES.find((option) => option.code === currency)?.label ?? currency}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>

                  {isAdjustmentIncrease ? (
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={labelClass} htmlFor="manual-adjustment-unit-cost">Costo unitario *</label>
                        <input
                          id="manual-adjustment-unit-cost"
                          className={fieldClass}
                          type="number"
                          min="0"
                          step="0.000001"
                          value={unitCost}
                          disabled={locked}
                          required
                          onChange={(event) => setUnitCost(event.target.value)}
                        />
                      </div>
                      {costCurrency !== "PYG" ? (
                        <div>
                          <label className={labelClass} htmlFor="manual-adjustment-fx">Tipo de cambio a PYG *</label>
                          <input
                            id="manual-adjustment-fx"
                            className={fieldClass}
                            type="number"
                            min="0.00000001"
                            step="0.00000001"
                            value={exchangeRate}
                            disabled={locked}
                            required
                            onChange={(event) => setExchangeRate(event.target.value)}
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-1 rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[12px]">
                      {selectedAdjustmentBucket ? (
                        <>
                          <p>Saldo computable: {formatNumber(selectedAdjustmentBucket.quantity, 4)} {selectedProduct?.unit} · costo promedio {formatNumber((selectedAdjustmentBucket.totalCost ?? 0) / selectedAdjustmentBucket.quantity, 6)} {effectiveCostCurrency}</p>
                          {amount > selectedAdjustmentBucket.quantity ? (
                            <p className="text-[var(--error)]">La cantidad supera el saldo disponible en esa moneda.</p>
                          ) : null}
                        </>
                      ) : (
                        <p className="text-[var(--muted)]">Elegí una moneda con saldo computable en esta ubicación.</p>
                      )}
                    </div>
                  )}

                  <div>
                    <label className={labelClass} htmlFor="manual-adjustment-reason">Motivo del ajuste *</label>
                    <textarea
                      id="manual-adjustment-reason"
                      className={`${fieldClass} h-20 py-2`}
                      maxLength={500}
                      value={reason}
                      disabled={locked}
                      required
                      onChange={(event) => setReason(event.target.value)}
                      placeholder="Conteo físico, rotura, diferencia documentada…"
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass} htmlFor="manual-movement-from">Origen</label>
                      <select
                        id="manual-movement-from"
                        className={fieldClass}
                        value={fromLocationId}
                        disabled={locked}
                        required
                        onChange={(event) => setFromLocationId(event.target.value)}
                      >
                        <option value="">Seleccionar origen…</option>
                        {locations.map((location) => (
                          <option key={location.id} value={location.id}>{locationLabel(location)}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className={labelClass} htmlFor="manual-movement-to">Destino</label>
                      <select
                        id="manual-movement-to"
                        className={fieldClass}
                        value={toLocationId}
                        disabled={locked}
                        required
                        onChange={(event) => setToLocationId(event.target.value)}
                      >
                        <option value="">Seleccionar destino…</option>
                        {locations.map((location) => (
                          <option key={location.id} value={location.id} disabled={location.id === fromLocationId}>
                            {locationLabel(location)}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={labelClass} htmlFor="manual-movement-quantity">Cantidad {selectedProduct ? `(${selectedProduct.unit})` : ""}</label>
                      <input
                        id="manual-movement-quantity"
                        className={fieldClass}
                        type="number"
                        min="0.0001"
                        step="0.0001"
                        value={quantity}
                        disabled={locked}
                        required
                        onChange={(event) => setQuantity(event.target.value)}
                      />
                    </div>
                    <div className="flex items-end pb-2 text-[11px] text-[var(--muted)]">
                      Stock computable de origen: {formatNumber(sourceBalance, 4)} {selectedProduct?.unit ?? ""}
                    </div>
                  </div>
                  <p className="rounded-md border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2 text-[11px] text-[var(--muted)]">
                    {movementType === "TRANSFER"
                      ? "La transferencia conserva la cantidad y el costo existente; no agrega costo nuevo."
                      : "La devolución registra el traslado físico y conserva el costo existente del origen."}
                  </p>
                </>
              )}

              {isAdjustment ? (
                <p className="rounded-md border border-[var(--warn)]/30 bg-[var(--warn-bg)] px-3 py-2 text-[11px] text-[var(--muted)]">
                  Usá ajustes solo para diferencias físicas documentadas; las compras van por Recepción y el consumo de obra por su rendición canónica.
                </p>
              ) : null}

              <div>
                <label className={labelClass} htmlFor="manual-movement-notes">Nota {isAdjustment ? "(el motivo es obligatorio)" : "(opcional)"}</label>
                {!isAdjustment ? (
                  <textarea
                    id="manual-movement-notes"
                    className={`${fieldClass} h-16 py-2`}
                    maxLength={500}
                    value={reason}
                    disabled={locked}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Referencia o explicación del movimiento"
                  />
                ) : <p className="text-[11px] text-[var(--muted)]">El motivo queda guardado en el movimiento canónico.</p>}
              </div>

              {error ? (
                <div role="alert" className="rounded-md border border-[var(--error)]/30 bg-[var(--error-bg)] px-3 py-2 text-[12px] text-[var(--error)]">
                  {error}
                  {attemptLocked ? <span className="mt-1 block">El reintento conservará exactamente la misma clave y los mismos datos.</span> : null}
                </div>
              ) : null}

              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="secondary" onClick={() => handleOpenChange(false)} disabled={pending}>
                  Cerrar
                </Button>
                <Button type="submit" disabled={pending || completedId !== null || (isAdjustment && adjustmentDirection === "DECREASE" && (!selectedAdjustmentBucket || amount > selectedAdjustmentBucket.quantity)) || (!isAdjustment && sourceLocationId !== "" && amount > sourceBalance)}>
                  {pending ? "Registrando…" : attemptLocked ? "Reintentar el mismo movimiento" : "Registrar movimiento"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
      {optionsError ? <span className="text-[11px] text-[var(--error)]">{optionsError}</span> : null}
      {!optionsError && (!locations.length || !products.length) ? (
        <span className="text-[11px] text-[var(--muted)]">Se necesitan productos activos y ubicaciones disponibles para registrar movimientos.</span>
      ) : null}
    </>
  );
}
