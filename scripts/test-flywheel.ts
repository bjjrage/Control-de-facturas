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
      fechaObservacion: '2025-10-01'
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
      fechaObservacion: '2025-11-15'
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

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 20 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 20:', err);
  process.exit(1);
});
