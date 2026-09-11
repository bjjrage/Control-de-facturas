/**
 * TEST SUITE: ERP EXECUTION FLYWHEEL (GATE 20)
 * Verifica que cada compra imputada en una obra ejecutada:
 * 1. Alimenta la base de observaciones de costo en tiempo real.
 * 2. Recalibra el Costo Presente Ponderado (CPP).
 * 3. Eleva el nivel de certeza estadística de la empresa para la próxima licitación.
 */

import { processFlywheelExecutionPurchase, FlywheelExecutionPurchaseEvent } from '../lib/procurement/flywheel';
import { CostObservation } from '../lib/cost-engine/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: ERP EXECUTION FLYWHEEL (GATE 20)');
  console.log('======================================================\n');

  // Estado inicial del motor: 2 cotizaciones históricas de Cemento Portland
  const initialObservations: CostObservation[] = [
    {
      id: 'init-1',
      empresaId: 'emp-1',
      fuente: 'COTIZACION',
      descripcionItem: 'Cemento Portland II F-32',
      categoriaInsumo: 'MATERIAL',
      cantidad: 50,
      unidad: 'BLS',
      precioUnitario: 56000,
      moneda: 'PYG',
      fechaObservacion: '2025-10-01',
      estadoEvidencia: 'VALIDA'
    },
    {
      id: 'init-2',
      empresaId: 'emp-1',
      fuente: 'COTIZACION',
      descripcionItem: 'Cemento Portland II F-32',
      categoriaInsumo: 'MATERIAL',
      cantidad: 100,
      unidad: 'BLS',
      precioUnitario: 55000,
      moneda: 'PYG',
      fechaObservacion: '2025-11-15',
      estadoEvidencia: 'VALIDA'
    }
  ];

  console.log('--- TEST 1: Impacto de Compra Real en Obra Nueva ---');
  // Se adjudicó una obra y el pañol compró 2,000 bolsas a precio mayorista real (Gs. 51.500) con Factura
  const purchaseEvent: FlywheelExecutionPurchaseEvent = {
    empresaId: 'emp-1',
    projectId: 'proj-san-lorenzo',
    invoiceId: 'inv-fac-9988',
    itemDescription: 'Cemento Portland II F-32',
    category: 'MATERIAL',
    quantity: 2000,
    unit: 'BLS',
    unitPricePyg: 51500,
    purchaseDate: '2026-03-01'
  };

  const { updatedObservations, effect } = processFlywheelExecutionPurchase(
    initialObservations,
    purchaseEvent,
    '2026-03-01'
  );

  console.log(`Efecto Flywheel en Cemento Portland:`);
  console.log(`   Precio Estimado Anterior: Gs. ${effect.previousRecommendedPricePyg.toLocaleString('es-PY')}`);
  console.log(`   Nuevo Precio Calibrado:   Gs. ${effect.newRecommendedPricePyg.toLocaleString('es-PY')} (Variación: ${effect.priceDeltaPct}%)`);
  console.log(`   Nuevo Nivel de Confianza: ${effect.newConfidenceTier} (Observaciones: ${effect.totalObservations})`);

  assert(effect.totalObservations === 3, 'Se incorporó la nueva observación transaccional');
  assert(effect.newRecommendedPricePyg < effect.previousRecommendedPricePyg, 'El precio estimado baja y se vuelve más competitivo gracias a la compra mayorista de obra');
  assert(effect.newRecommendedPricePyg >= 51500 && effect.newRecommendedPricePyg <= 53000, 'El precio gravita con fuerza hacia la factura reciente');
  assert(effect.newConfidenceTier === 'MEDIA' || effect.newConfidenceTier === 'ALTA', 'La certeza estadística aumenta al tener facturas reales de obra');

  console.log('\n--- TEST 2: Validación de Moneda y Tipo de Cambio en Facturas ---');
  const { recordCostObservationFromInvoice } = await import('../lib/procurement/flywheel');

  const insertedRows: any[] = [];
  const mockSupabase = {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null })
            })
          })
        })
      }),
      insert: async (row: any) => {
        insertedRows.push(row);
        return { error: null };
      }
    })
  };

  // Caso 2A: Factura USD sin tipo de cambio -> Debe abortar (fail-closed)
  const res2A = await recordCostObservationFromInvoice(mockSupabase, {
    empresaId: 'emp-1',
    invoiceId: 'inv-usd-no-rate',
    providerId: 'prov-1',
    itemDescription: 'Generador Eléctrico 50kVA',
    quantity: 1,
    unit: 'UN',
    invoiceDate: '2026-03-01',
    unitPrice: 12000,
    currency: 'USD',
    exchangeRate: null
  });
  assert(res2A.recorded === false, 'Factura USD sin exchangeRate falla cerrado (recorded = false)');
  assert(res2A.reason === 'MISSING_EXCHANGE_RATE_FOR_USD', 'Razón observable es MISSING_EXCHANGE_RATE_FOR_USD');
  assert(insertedRows.length === 0, 'No se insertó fila sin exchangeRate verificado');

  // Caso 2B: Factura USD con tipo de cambio verificado -> Debe insertar con tipo de cambio real y precio unitario en PYG
  const res2B = await recordCostObservationFromInvoice(mockSupabase, {
    empresaId: 'emp-1',
    invoiceId: 'inv-usd-with-rate',
    providerId: 'prov-1',
    itemDescription: 'Generador Eléctrico 50kVA',
    quantity: 1,
    unit: 'UN',
    invoiceDate: '2026-03-01',
    unitPrice: 12000,
    currency: 'USD',
    exchangeRate: 7550.0
  });
  assert(res2B.recorded === true, 'Factura USD con exchangeRate verificado se registra con éxito');
  assert(insertedRows.length === 1, 'Factura USD con exchangeRate verificado se registra');
  assert(insertedRows[0].tipo_cambio === 7550.0, 'tipo_cambio preserva la tasa real de 7.550 Gs/USD');
  assert(insertedRows[0].moneda === 'PYG', 'moneda se normaliza canónicamente a PYG en tabla de observaciones');
  assert(insertedRows[0].precio_unitario === 12000 * 7550, 'precio_unitario se almacena convertido a PYG (12.000 * 7.550 = 90.600.000 Gs.)');

  console.log('\n--- TEST 3: Invariante UNKNOWN != DEFAULT (Sin cantidad/unidad/fecha inventadas) ---');
  // Sin cantidad válida
  const resNoQty = await recordCostObservationFromInvoice(mockSupabase, {
    empresaId: 'emp-1',
    invoiceId: 'inv-no-qty',
    providerId: 'prov-1',
    itemDescription: 'Arena Lavada',
    unit: 'M3',
    invoiceDate: '2026-03-01',
    unitPrice: 90000
  });
  assert(resNoQty.recorded === false && resNoQty.reason === 'MISSING_OR_INVALID_QUANTITY', 'Rechazo observable por falta de cantidad (no asume 1)');

  // Sin unidad
  const resNoUnit = await recordCostObservationFromInvoice(mockSupabase, {
    empresaId: 'emp-1',
    invoiceId: 'inv-no-unit',
    providerId: 'prov-1',
    itemDescription: 'Arena Lavada',
    quantity: 5,
    invoiceDate: '2026-03-01',
    unitPrice: 90000
  });
  assert(resNoUnit.recorded === false && resNoUnit.reason === 'MISSING_UNIT', 'Rechazo observable por falta de unidad (no asume UN)');

  // Sin fecha
  const resNoDate = await recordCostObservationFromInvoice(mockSupabase, {
    empresaId: 'emp-1',
    invoiceId: 'inv-no-date',
    providerId: 'prov-1',
    itemDescription: 'Arena Lavada',
    quantity: 5,
    unit: 'M3',
    unitPrice: 90000
  });
  assert(resNoDate.recorded === false && resNoDate.reason === 'MISSING_INVOICE_DATE', 'Rechazo observable por falta de fecha (no asume today)');

  console.log('\n--- TEST 4: E2E Regression - No Doble Conversión de Moneda en Cost Engine ---');
  // Factura de USD 100 @ 7.500 Gs/USD
  const resUsd100 = await recordCostObservationFromInvoice(mockSupabase, {
    empresaId: 'emp-1',
    invoiceId: 'inv-usd-100-test',
    providerId: 'prov-1',
    itemDescription: 'Válvula Esférica 2 pulg',
    quantity: 1,
    unit: 'UN',
    invoiceDate: '2026-03-05',
    unitPrice: 100, // USD 100
    currency: 'USD',
    exchangeRate: 7500.0 // 7.500 Gs/USD
  });
  assert(resUsd100.recorded === true, 'Factura USD 100 se registró');
  
  // Buscar la fila persistida correspondiente
  const persistedUsdRow = insertedRows.find((r: any) => r.documento_id === 'inv-usd-100-test');
  assert(persistedUsdRow !== undefined, 'Fila persistida encontrada en la base de datos');
  assert(persistedUsdRow.precio_unitario === 750000, 'precio_unitario persistido es exactamente 750.000 PYG (100 * 7.500)');
  assert(persistedUsdRow.tipo_cambio === 7500.0, 'tipo_cambio registrado es 7.500 (provenance)');

  // Simular la lectura y mapeo del Cost Engine tal como se hace en persistirEvaluacionComercial y getCostEstimate
  const mappedObsForEngine = {
    id: 'test-obs-usd',
    empresaId: persistedUsdRow.empresa_id,
    fuente: persistedUsdRow.fuente,
    documentoId: persistedUsdRow.documento_id,
    descripcionItem: persistedUsdRow.descripcion_item,
    categoriaInsumo: persistedUsdRow.categoria_insumo,
    cantidad: Number(persistedUsdRow.cantidad),
    unidad: persistedUsdRow.unidad,
    // Invariante: precio_unitario ya está en PYG canónico, NO se multiplica de nuevo por tipo_cambio
    precioUnitario: Number(persistedUsdRow.precio_unitario),
    moneda: persistedUsdRow.moneda,
    tipoCambio: Number(persistedUsdRow.tipo_cambio || 1.0),
    fechaObservacion: persistedUsdRow.fecha_observacion,
    esVolatil: persistedUsdRow.es_volatil,
    estadoEvidencia: 'VALIDA' as const
  };

  const { calculateCostEstimate } = await import('../lib/cost-engine/weighting');
  const engineEstimate = calculateCostEstimate([mappedObsForEngine], '2026-03-05');
  
  console.log(`   Precio unitario recibido por Cost Engine: Gs. ${engineEstimate.recommendedUnitPrice.toLocaleString('es-PY')}`);
  assert(
    engineEstimate.recommendedUnitPrice === 750000,
    `Cost Engine recibe exactamente Gs. 750.000 (sin doble multiplicación a Gs. 5.625.000.000)`
  );
  assert(
    engineEstimate.recommendedUnitPrice !== 5625000000,
    `Protegido contra error catastrófico de 5.625.000.000 Gs.`
  );

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 20 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 20:', err);
  process.exit(1);
});
