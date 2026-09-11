/**
 * ERP EXECUTION FLYWHEEL (GATE 20)
 * El Doble Bucle de Retroalimentación Continua:
 * 
 * BUCLE 1 (Privado / Cost Engine):
 * Cada compra real, remisión de pañol o factura imputada a una obra en ejecución
 * alimenta inmediatamente la tabla `cost_observations` del tenant, actualizando
 * el Costo Presente Ponderado (CPP) para futuras licitaciones.
 * 
 * BUCLE 2 (Público / Inteligencia de Mercado):
 * Cada resultado oficial de apertura o adjudicación publicado en la DNCP
 * alimenta la tabla `procurement_bids` y actualiza la huella contextual
 * de los competidores (`competitor-intelligence`).
 */

import { CostObservation } from '../cost-engine/types';
import { calculateCostEstimate } from '../cost-engine/weighting';

export interface FlywheelExecutionPurchaseEvent {
  empresaId: string;
  projectId: string;
  invoiceId?: string;
  itemDescription: string;
  category: 'MATERIAL' | 'MANO_OBRA' | 'EQUIPO' | 'SUBCONTRATO' | 'COMBUSTIBLE' | 'OTRO';
  quantity: number;
  unit: string;
  unitPricePyg: number;
  purchaseDate: string;
}

export interface FlywheelTenderAwardEvent {
  tenderId: string;
  winnerRuc: string;
  winnerName: string;
  winningAmountPyg: number;
  referenceBudgetPyg: number;
  buyerName: string;
  category: string;
  awardDate: string;
}

export interface FlywheelCalibrationEffect {
  itemDescription: string;
  previousRecommendedPricePyg: number;
  newRecommendedPricePyg: number;
  priceDeltaPct: number;
  newConfidenceTier: string;
  totalObservations: number;
}

/**
 * Simula el impacto del bucle de ejecución:
 * Al comprar insumos en una obra, la estimación del Cost Engine se calibra en tiempo real.
 */
export function processFlywheelExecutionPurchase(
  existingObservations: CostObservation[],
  event: FlywheelExecutionPurchaseEvent,
  asOfDate: string = event.purchaseDate
): {
  updatedObservations: CostObservation[];
  effect: FlywheelCalibrationEffect;
} {
  const previousEstimate = calculateCostEstimate(
    existingObservations.filter(o => o.descripcionItem.toLowerCase().includes(event.itemDescription.toLowerCase())),
    asOfDate
  );

  const newObs: CostObservation = {
    id: `obs-flywheel-${Date.now()}`,
    empresaId: event.empresaId,
    projectId: event.projectId,
    fuente: 'FACTURA', // Compra real ejecutada en obra
    descripcionItem: event.itemDescription,
    categoriaInsumo: event.category,
    cantidad: event.quantity,
    unidad: event.unit,
    precioUnitario: event.unitPricePyg,
    moneda: 'PYG',
    fechaObservacion: event.purchaseDate,
    esVolatil: event.category === 'COMBUSTIBLE'
  };

  const updatedObservations = [...existingObservations, newObs];
  const newEstimate = calculateCostEstimate(
    updatedObservations.filter(o => o.descripcionItem.toLowerCase().includes(event.itemDescription.toLowerCase())),
    asOfDate
  );

  const deltaPct = previousEstimate.recommendedUnitPrice > 0
    ? Number((((newEstimate.recommendedUnitPrice - previousEstimate.recommendedUnitPrice) / previousEstimate.recommendedUnitPrice) * 100).toFixed(2))
    : 0;

  return {
    updatedObservations,
    effect: {
      itemDescription: event.itemDescription,
      previousRecommendedPricePyg: previousEstimate.recommendedUnitPrice,
      newRecommendedPricePyg: newEstimate.recommendedUnitPrice,
      priceDeltaPct: deltaPct,
      newConfidenceTier: newEstimate.confidenceTier,
      totalObservations: newEstimate.sampleSize
    }
  };
}

export interface CostObservationRecordResult {
  recorded: boolean;
  reason?: string;
  observationId?: string;
}

/**
 * Registra observaciones de costo real en base de datos desde una factura vinculada a una orden de compra o proyecto.
 * 
 * INVARIANTES:
 * 1. UNKNOWN != DEFAULT: Si faltan cantidad, unidad, fecha o descripción, NO se inventan valores (no qty=1, no unit='UN', no date=today).
 * 2. RECHAZO OBSERVABLE: Si la evidencia es insuficiente o inválida, se retorna { recorded: false, reason: '...' }.
 * 3. CONTRATO CANÓNICO DE MONEDA: `precio_unitario` en `cost_observations` siempre almacena el precio normalizado en PYG.
 *    Para compras en USD, se exige `exchangeRate` verificado y se almacena `precio_unitario = Math.round(unitPrice * exchangeRate)`.
 *    Jamás se mezclan valores crudos en USD con PYG en la misma columna sin conversión.
 */
export async function recordCostObservationFromInvoice(
  supabase: any,
  params: {
    empresaId: string;
    invoiceId: string;
    providerId: string;
    orderId?: string;
    projectId?: string;
    itemDescription?: string;
    quantity?: number;
    unit?: string;
    unitPrice?: number;
    currency?: string;
    exchangeRate?: number | null;
    invoiceDate?: string;
  }
): Promise<CostObservationRecordResult> {
  try {
    let description = params.itemDescription?.trim() || null;
    let qty = params.quantity && params.quantity > 0 ? Number(params.quantity) : null;
    let unit = params.unit?.trim() || null;
    let unitPrice = params.unitPrice && params.unitPrice > 0 ? Number(params.unitPrice) : null;
    let projectId = params.projectId || null;
    let currency = (params.currency || "PYG").toUpperCase().trim();
    let exchangeRate = params.exchangeRate && params.exchangeRate > 0 ? Number(params.exchangeRate) : null;
    let invoiceDate = params.invoiceDate?.trim() || null;

    // Si tenemos orderId pero faltan datos de producto, consultar la orden
    if (params.orderId && (!description || !unitPrice || !qty || !unit || !projectId)) {
      const { data: order } = await supabase
        .from("authorized_orders")
        .select("product, quantity, unit, unit_price, project_id, total_price, currency")
        .eq("id", params.orderId)
        .maybeSingle();

      if (order) {
        description = description || order.product?.trim() || null;
        qty = qty ?? (order.quantity && Number(order.quantity) > 0 ? Number(order.quantity) : null);
        unit = unit || order.unit?.trim() || null;
        unitPrice = unitPrice ?? (order.unit_price && Number(order.unit_price) > 0 ? Number(order.unit_price) : null);
        projectId = projectId || order.project_id || null;
        if (!params.currency && order.currency) {
          currency = order.currency.toUpperCase().trim();
        }
      }
    }

    // Regla P0: UNKNOWN != DEFAULT - Validación estricta de evidencia
    if (!description) {
      return { recorded: false, reason: 'MISSING_ITEM_DESCRIPTION' };
    }
    if (!unitPrice || unitPrice <= 0) {
      return { recorded: false, reason: 'MISSING_OR_INVALID_UNIT_PRICE' };
    }
    if (!qty || qty <= 0) {
      return { recorded: false, reason: 'MISSING_OR_INVALID_QUANTITY' };
    }
    if (!unit) {
      return { recorded: false, reason: 'MISSING_UNIT' };
    }
    if (!invoiceDate) {
      return { recorded: false, reason: 'MISSING_INVOICE_DATE' };
    }

    // Regla P0: Moneda canónica normalizada
    let tipoCambio: number = 1.0;
    let precioUnitarioNormalizadoPyg: number;

    if (currency === "USD") {
      if (!exchangeRate || exchangeRate <= 0) {
        console.warn(`[Flywheel] Omitiendo observación para factura USD ${params.invoiceId}: falta tipo de cambio verificado (evita contaminar CPP).`);
        return { recorded: false, reason: 'MISSING_EXCHANGE_RATE_FOR_USD' };
      }
      tipoCambio = exchangeRate;
      precioUnitarioNormalizadoPyg = Math.round(unitPrice * tipoCambio);
    } else if (currency === "PYG") {
      tipoCambio = 1.0;
      precioUnitarioNormalizadoPyg = Math.round(unitPrice);
    } else {
      return { recorded: false, reason: `UNSUPPORTED_CURRENCY_${currency}` };
    }

    // Clasificar categoría automáticamente
    const descLower = description.toLowerCase();
    let categoria: 'MATERIAL' | 'MANO_OBRA' | 'EQUIPO' | 'SUBCONTRATO' | 'COMBUSTIBLE' | 'OTRO' = 'MATERIAL';
    if (descLower.includes('gasoil') || descLower.includes('diesel') || descLower.includes('combustible')) {
      categoria = 'COMBUSTIBLE';
    } else if (descLower.includes('alquiler') || descLower.includes('motoniveladora') || descLower.includes('retroexcavadora') || descLower.includes('pala')) {
      categoria = 'EQUIPO';
    } else if (descLower.includes('subcontrat') || descLower.includes('servicio de')) {
      categoria = 'SUBCONTRATO';
    } else if (descLower.includes('oficial') || descLower.includes('ayudante') || descLower.includes('jornal')) {
      categoria = 'MANO_OBRA';
    }

    // Evitar duplicados a nivel de ítem/línea dentro del mismo documento (idempotencia granular)
    const { data: existingObs } = await supabase
      .from("cost_observations")
      .select("id")
      .eq("empresa_id", params.empresaId)
      .eq("documento_id", params.invoiceId)
      .eq("descripcion_item", description)
      .maybeSingle();

    if (existingObs) {
      return { recorded: false, reason: 'DUPLICATE_ITEM_OBSERVATION', observationId: existingObs.id };
    }

    const insertQuery = supabase
      .from("cost_observations")
      .insert({
        empresa_id: params.empresaId,
        project_id: projectId || null,
        proveedor_id: params.providerId || null,
        fuente: "FACTURA",
        documento_id: params.invoiceId,
        descripcion_item: description,
        categoria_insumo: categoria,
        cantidad: qty,
        unidad: unit,
        precio_unitario: precioUnitarioNormalizadoPyg,
        moneda: 'PYG', // Contrato canónico: la base de observaciones opera en PYG normalizado
        moneda_original: currency,
        precio_unitario_original: unitPrice,
        tipo_cambio: tipoCambio,
        fecha_observacion: invoiceDate,
        es_volatil: categoria === 'COMBUSTIBLE'
      });

    let insertedData: any = null;
    let insertError: any = null;

    if (typeof insertQuery.select === 'function') {
      const res = await insertQuery.select('id').maybeSingle();
      insertedData = res.data;
      insertError = res.error;
    } else {
      const res = await insertQuery;
      insertError = res?.error;
    }

    if (insertError) {
      console.error("[Flywheel] Failed to insert cost observation:", insertError);
      return { recorded: false, reason: `DB_INSERT_ERROR: ${insertError.message}` };
    }

    return {
      recorded: true,
      observationId: insertedData?.id
    };
  } catch (err: any) {
    console.error("[Flywheel] Error recording cost observation from invoice:", err);
    return { recorded: false, reason: `EXCEPTION: ${err.message || String(err)}` };
  }
}
