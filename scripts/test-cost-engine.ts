/**
 * TEST SUITE: COST ENGINE V1 (GATE 5B)
 * Verifica:
 * 1. Ponderación por jerarquía de fuentes (Factura > Cotización)
 * 2. Decaimiento temporal exponencial
 * 3. Atenuación de volumen
 * 4. Detección de volatilidad y dispersión percentil (P25, Mediana, P75)
 * 5. Benchmark de 5 insumos críticos de construcción en Paraguay:
 *    - Cemento Portland (Bolsa 50kg)
 *    - Varilla Conformada 10mm (Acero)
 *    - Arena Lavada (m3)
 *    - Gasoil Común / Diésel (Litro)
 *    - Hora Motoniveladora (Equipo)
 */

import { calculateCostEstimate, calculateTimeDecayWeight, calculateVolumeDampenedWeight } from '../lib/cost-engine/weighting';
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
  console.log('🧪 EJECUTANDO TEST SUITE: COST ENGINE V1 (GATE 5B)');
  console.log('======================================================\n');

  // TEST 1: Decaimiento Temporal Matemático
  console.log('--- TEST 1: Decaimiento Temporal ---');
  const w0 = calculateTimeDecayWeight(0, 90);
  const w90 = calculateTimeDecayWeight(90, 90);
  const w180 = calculateTimeDecayWeight(180, 90);

  assert(w0 === 1.0, 'Peso en t=0 es 1.0');
  assert(Math.abs(w90 - 0.5) < 0.001, 'Peso a los 90 días (1 vida media) es exactamente 0.5');
  assert(Math.abs(w180 - 0.25) < 0.001, 'Peso a los 180 días (2 vidas medias) es exactamente 0.25');

  // TEST 2: Atenuación de Volumen
  console.log('\n--- TEST 2: Atenuación de Volumen ---');
  const v1 = calculateVolumeDampenedWeight(1);
  const v100 = calculateVolumeDampenedWeight(100);
  const v10000 = calculateVolumeDampenedWeight(10000);

  assert(v100 > v1, '100 unidades pesan más que 1 unidad');
  assert(v10000 > v100, '10,000 unidades pesan más que 100 unidades');
  // Logarithmic growth check: v10000 no debe ser 100 veces v100
  const linearRatio = 10000 / 100; // 100x
  const dampedRatio = v10000 / v100;
  assert(dampedRatio < 3.0, `Atenuación logarítmica efectiva (ratio dampening: ${dampedRatio.toFixed(2)}x vs lineal 100x)`);

  // TEST 3: Jerarquía de Fuentes (Factura vs Cotización)
  console.log('\n--- TEST 3: Jerarquía de Fuentes ---');
  const today = '2026-03-01';
  const obsSources: CostObservation[] = [
    {
      id: '1',
      empresaId: 'test-emp',
      fuente: 'FACTURA',
      descripcionItem: 'Cemento Portland',
      categoriaInsumo: 'MATERIAL',
      cantidad: 10,
      unidad: 'BLS',
      precioUnitario: 50000,
      moneda: 'PYG',
      fechaObservacion: today
    },
    {
      id: '2',
      empresaId: 'test-emp',
      fuente: 'COTIZACION',
      descripcionItem: 'Cemento Portland',
      categoriaInsumo: 'MATERIAL',
      cantidad: 10,
      unidad: 'BLS',
      precioUnitario: 70000,
      moneda: 'PYG',
      fechaObservacion: today
    }
  ];
  // Factura weight = 1.0, Cotizacion weight = 0.6. Promedio debería inclinarse fuertemente hacia 50000
  const estimateSources = calculateCostEstimate(obsSources, today);
  // (50000*1.0 + 70000*0.6) / 1.6 = (50000 + 42000) / 1.6 = 92000 / 1.6 = 57500
  assert(estimateSources.recommendedUnitPrice === 57500, `Factura pondera más que Cotización (calculado: ${estimateSources.recommendedUnitPrice}, esperado: 57500)`);

  // TEST 4: Benchmark de 5 Insumos Clave de la Construcción en Paraguay
  console.log('\n--- TEST 4: Benchmark Insumos Críticos Paraguay ---');

  // Insumo 1: Cemento Portland (Bolsa 50kg)
  const cementoObs: CostObservation[] = [
    { id: 'c1', empresaId: 'e', fuente: 'FACTURA', descripcionItem: 'Cemento Portland II F-32', categoriaInsumo: 'MATERIAL', cantidad: 500, unidad: 'BLS', precioUnitario: 52000, moneda: 'PYG', fechaObservacion: '2026-02-15' },
    { id: 'c2', empresaId: 'e', fuente: 'RECEPCION', descripcionItem: 'Cemento Portland II F-32', categoriaInsumo: 'MATERIAL', cantidad: 200, unidad: 'BLS', precioUnitario: 53000, moneda: 'PYG', fechaObservacion: '2026-02-01' },
    { id: 'c3', empresaId: 'e', fuente: 'ORDEN_COMPRA', descripcionItem: 'Cemento Portland II F-32', categoriaInsumo: 'MATERIAL', cantidad: 1000, unidad: 'BLS', precioUnitario: 51500, moneda: 'PYG', fechaObservacion: '2026-01-10' },
    { id: 'c4', empresaId: 'e', fuente: 'COTIZACION', descripcionItem: 'Cemento Portland II F-32', categoriaInsumo: 'MATERIAL', cantidad: 50, unidad: 'BLS', precioUnitario: 55000, moneda: 'PYG', fechaObservacion: '2025-11-01' }
  ];
  const cementoEst = calculateCostEstimate(cementoObs, '2026-03-01');
  console.log(`[Cemento Portland] Precio recomendado: Gs. ${cementoEst.recommendedUnitPrice.toLocaleString('es-PY')} | Rango: [Gs. ${cementoEst.priceRange.p25.toLocaleString('es-PY')} - ${cementoEst.priceRange.p75.toLocaleString('es-PY')}] | Volatilidad: ${cementoEst.volatilityPercentage}% | Confianza: ${cementoEst.confidenceTier}`);
  assert(cementoEst.recommendedUnitPrice >= 51000 && cementoEst.recommendedUnitPrice <= 53000, 'Precio de Cemento dentro del rango real de mercado');
  assert(cementoEst.confidenceTier === 'ALTA', 'Nivel de confianza de Cemento es ALTA');

  // Insumo 2: Varilla Conformada 10mm (Acero / Hierro por kg)
  const aceroObs: CostObservation[] = [
    { id: 'a1', empresaId: 'e', fuente: 'FACTURA', descripcionItem: 'Varilla Conformada AP500 10mm', categoriaInsumo: 'MATERIAL', cantidad: 2500, unidad: 'KG', precioUnitario: 8200, moneda: 'PYG', fechaObservacion: '2026-02-20' },
    { id: 'a2', empresaId: 'e', fuente: 'ORDEN_COMPRA', descripcionItem: 'Varilla Conformada AP500 10mm', categoriaInsumo: 'MATERIAL', cantidad: 5000, unidad: 'KG', precioUnitario: 8050, moneda: 'PYG', fechaObservacion: '2026-01-15' },
    { id: 'a3', empresaId: 'e', fuente: 'FACTURA', descripcionItem: 'Varilla Conformada AP500 10mm', categoriaInsumo: 'MATERIAL', cantidad: 1000, unidad: 'KG', precioUnitario: 8400, moneda: 'PYG', fechaObservacion: '2026-02-28' }
  ];
  const aceroEst = calculateCostEstimate(aceroObs, '2026-03-01');
  console.log(`[Varilla 10mm] Precio recomendado: Gs. ${aceroEst.recommendedUnitPrice.toLocaleString('es-PY')}/kg | Mediana: Gs. ${aceroEst.priceRange.median.toLocaleString('es-PY')} | Tendencia: ${aceroEst.trend}`);
  assert(aceroEst.recommendedUnitPrice >= 8000 && aceroEst.recommendedUnitPrice <= 8500, 'Precio de Acero dentro del parámetro nacional');

  // Insumo 3: Arena Lavada (m3)
  const arenaObs: CostObservation[] = [
    { id: 'ar1', empresaId: 'e', fuente: 'FACTURA', descripcionItem: 'Arena Lavada de Río', categoriaInsumo: 'MATERIAL', cantidad: 30, unidad: 'M3', precioUnitario: 75000, moneda: 'PYG', fechaObservacion: '2026-02-10' },
    { id: 'ar2', empresaId: 'e', fuente: 'RECEPCION', descripcionItem: 'Arena Lavada de Río', categoriaInsumo: 'MATERIAL', cantidad: 60, unidad: 'M3', precioUnitario: 72000, moneda: 'PYG', fechaObservacion: '2026-02-18' }
  ];
  const arenaEst = calculateCostEstimate(arenaObs, '2026-03-01');
  console.log(`[Arena Lavada] Precio recomendado: Gs. ${arenaEst.recommendedUnitPrice.toLocaleString('es-PY')}/m3 | Confianza: ${arenaEst.confidenceTier}`);
  assert(arenaEst.recommendedUnitPrice >= 70000 && arenaEst.recommendedUnitPrice <= 76000, 'Precio de Arena dentro del estándar fluvial paraguayo');

  // Insumo 4: Gasoil Común / Diésel (Litro - Insumo Volátil)
  const gasoilObs: CostObservation[] = [
    { id: 'g1', empresaId: 'e', fuente: 'FACTURA', descripcionItem: 'Diésel Común Tipo III', categoriaInsumo: 'COMBUSTIBLE', cantidad: 1000, unidad: 'LTS', precioUnitario: 7600, moneda: 'PYG', fechaObservacion: '2026-02-27', esVolatil: true },
    { id: 'g2', empresaId: 'e', fuente: 'FACTURA', descripcionItem: 'Diésel Común Tipo III', categoriaInsumo: 'COMBUSTIBLE', cantidad: 800, unidad: 'LTS', precioUnitario: 7350, moneda: 'PYG', fechaObservacion: '2026-01-20', esVolatil: true },
    { id: 'g3', empresaId: 'e', fuente: 'FACTURA', descripcionItem: 'Diésel Común Tipo III', categoriaInsumo: 'COMBUSTIBLE', cantidad: 1200, unidad: 'LTS', precioUnitario: 7100, moneda: 'PYG', fechaObservacion: '2025-11-15', esVolatil: true }
  ];
  const gasoilEst = calculateCostEstimate(gasoilObs, '2026-03-01');
  console.log(`[Gasoil Común] Precio recomendado: Gs. ${gasoilEst.recommendedUnitPrice.toLocaleString('es-PY')}/lt | Decaimiento acelerado (30d) | Tendencia: ${gasoilEst.trend}`);
  // Debido a la vida media de 30 días, la observación de Gs. 7600 de hace 2 días domina ampliamente sobre la de noviembre
  assert(gasoilEst.recommendedUnitPrice > 7450, `El combustible refleja fuertemente el precio reciente por su alta volatilidad (${gasoilEst.recommendedUnitPrice})`);
  assert(gasoilEst.trend === 'RISING', 'Detecta tendencia alcista en combustible');

  // Insumo 5: Hora Motoniveladora (Equipo / Maquinaria)
  const motoObs: CostObservation[] = [
    { id: 'm1', empresaId: 'e', fuente: 'FACTURA', descripcionItem: 'Alquiler Motoniveladora CAT 140M', categoriaInsumo: 'EQUIPO', cantidad: 40, unidad: 'HS', precioUnitario: 380000, moneda: 'PYG', fechaObservacion: '2026-02-05' },
    { id: 'm2', empresaId: 'e', fuente: 'COTIZACION', descripcionItem: 'Alquiler Motoniveladora CAT 140M', categoriaInsumo: 'EQUIPO', cantidad: 80, unidad: 'HS', precioUnitario: 420000, moneda: 'PYG', fechaObservacion: '2026-01-10' }
  ];
  const motoEst = calculateCostEstimate(motoObs, '2026-03-01');
  console.log(`[Hora Motoniveladora] Precio recomendado: Gs. ${motoEst.recommendedUnitPrice.toLocaleString('es-PY')}/h | Rango: [Gs. ${motoEst.priceRange.min.toLocaleString('es-PY')} - ${motoEst.priceRange.max.toLocaleString('es-PY')}]`);
  assert(motoEst.recommendedUnitPrice >= 380000 && motoEst.recommendedUnitPrice <= 410000, 'Precio horario de maquinaria pesada dentro de rango razonable');

  // TEST 5: Detección de Dispersión Extrema (Mercado Volátil)
  console.log('\n--- TEST 5: Detección de Volatilidad ---');
  const volatileObs: CostObservation[] = [
    { id: 'v1', empresaId: 'e', fuente: 'COTIZACION', descripcionItem: 'Cable Cu 10mm2', categoriaInsumo: 'MATERIAL', cantidad: 100, unidad: 'M', precioUnitario: 12000, moneda: 'PYG', fechaObservacion: '2026-02-01' },
    { id: 'v2', empresaId: 'e', fuente: 'COTIZACION', descripcionItem: 'Cable Cu 10mm2', categoriaInsumo: 'MATERIAL', cantidad: 100, unidad: 'M', precioUnitario: 18000, moneda: 'PYG', fechaObservacion: '2026-02-05' },
    { id: 'v3', empresaId: 'e', fuente: 'COTIZACION', descripcionItem: 'Cable Cu 10mm2', categoriaInsumo: 'MATERIAL', cantidad: 100, unidad: 'M', precioUnitario: 24000, moneda: 'PYG', fechaObservacion: '2026-02-10' }
  ];
  const volatileEst = calculateCostEstimate(volatileObs, '2026-03-01');
  console.log(`[Dispersión Alta] Volatilidad CV: ${volatileEst.volatilityPercentage}% | Mercado Volátil: ${volatileEst.isVolatileMarket} | Tendencia: ${volatileEst.trend}`);
  assert(volatileEst.isVolatileMarket === true, 'Detecta correctamente mercado volátil cuando CV > 15%');
  assert(volatileEst.trend === 'VOLATILE', 'Asigna tendencia VOLATILE cuando la dispersión es excesiva');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 5B PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas:', err);
  process.exit(1);
});
