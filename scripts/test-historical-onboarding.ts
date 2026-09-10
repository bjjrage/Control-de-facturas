/**
 * TEST SUITE: COST COLD START / HISTORICAL ONBOARDING (GATE 6)
 * Simula el onboarding de una nueva empresa constructora cargando 3 obras históricas
 * en formato Excel (Buffer), calibrando el motor de costos en segundos.
 */

import * as XLSX from 'xlsx';
import { parseHistoricalSpreadsheet, inferInputCategory } from '../lib/cost-engine/onboarding';
import { calculateCostEstimate } from '../lib/cost-engine/weighting';
import { CostObservation } from '../lib/cost-engine/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

function createMockExcelBuffer(rows: any[]): Buffer {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Presupuesto');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: COST COLD START / ONBOARDING (GATE 6)');
  console.log('======================================================\n');

  // TEST 1: Inferencia de Categorías de Insumos Paraguayos
  console.log('--- TEST 1: Inferencia Semántica de Insumos ---');
  assert(inferInputCategory('Gasoil común para maquinaria') === 'COMBUSTIBLE', 'Identifica COMBUSTIBLE correctamente');
  assert(inferInputCategory('Motoniveladora Caterpillar 140M') === 'EQUIPO', 'Identifica EQUIPO correctamente');
  assert(inferInputCategory('Oficial armador de estructuras') === 'MANO_OBRA', 'Identifica MANO_OBRA correctamente');
  assert(inferInputCategory('Cemento Portland CPC 40') === 'MATERIAL', 'Identifica MATERIAL correctamente');
  assert(inferInputCategory('Subcontrato de instalación eléctrica') === 'SUBCONTRATO', 'Identifica SUBCONTRATO correctamente');

  // TEST 2: Onboarding de 3 Obras Históricas de un Cliente Nuevo
  console.log('\n--- TEST 2: Simulación de Onboarding (3 Obras Históricas) ---');

  const obra1Rows = [
    { 'Concepto / Ítem': 'Cemento Portland II F-32', 'Ud': 'BLS', 'Cómputo': '1500', 'Precio Unitario Gs': '51.000', 'Fecha': '2025-06-15' },
    { 'Concepto / Ítem': 'Varilla Conformada AP500 12mm', 'Ud': 'KG', 'Cómputo': '8500', 'Precio Unitario Gs': '8.100', 'Fecha': '2025-06-18' },
    { 'Concepto / Ítem': 'Arena Lavada', 'Ud': 'M3', 'Cómputo': '120', 'Precio Unitario Gs': '70.000', 'Fecha': '2025-06-20' },
    { 'Concepto / Ítem': 'Gasoil Tipo III', 'Ud': 'LTS', 'Cómputo': '2500', 'Precio Unitario Gs': '7.200', 'Fecha': '2025-06-25' }
  ];

  const obra2Rows = [
    { 'Descripcion del Item': 'Cemento Portland II F-32', 'Unidad': 'BLS', 'Cantidad': '800', 'Costo Unitario': '52.500', 'Fecha': '2025-09-10' },
    { 'Descripcion del Item': 'Varilla Conformada AP500 12mm', 'Unidad': 'KG', 'Cantidad': '4000', 'Costo Unitario': '8.300', 'Fecha': '2025-09-12' },
    { 'Descripcion del Item': 'Alquiler Retroexcavadora CAT', 'Unidad': 'HS', 'Cantidad': '150', 'Costo Unitario': '320.000', 'Fecha': '2025-09-15' },
    { 'Descripcion del Item': 'Oficial Albañil', 'Unidad': 'DIA', 'Cantidad': '60', 'Costo Unitario': '140.000', 'Fecha': '2025-09-20' }
  ];

  const obra3Rows = [
    { 'Detalle de Insumo': 'Cemento Portland II F-32', 'Unid': 'BLS', 'Cant': '1200', 'P.Unitario': '53.000', 'Fecha': '2025-12-05' },
    { 'Detalle de Insumo': 'Arena Lavada de Río', 'Unid': 'M3', 'Cant': '80', 'P.Unitario': '74.000', 'Fecha': '2025-12-10' },
    { 'Detalle de Insumo': 'Gasoil Tipo III', 'Unid': 'LTS', 'Cant': '1800', 'P.Unitario': '7.450', 'Fecha': '2025-12-15' }
  ];

  const buf1 = createMockExcelBuffer(obra1Rows);
  const buf2 = createMockExcelBuffer(obra2Rows);
  const buf3 = createMockExcelBuffer(obra3Rows);

  const res1 = parseHistoricalSpreadsheet(buf1, { empresaId: 'emp-nueva', projectName: 'Obra 1 - Edificio Asunción' });
  const res2 = parseHistoricalSpreadsheet(buf2, { empresaId: 'emp-nueva', projectName: 'Obra 2 - Vial Luque' });
  const res3 = parseHistoricalSpreadsheet(buf3, { empresaId: 'emp-nueva', projectName: 'Obra 3 - Pavimentación Capiatá' });

  assert(res1.validObservations === 4, `Obra 1 procesó 4/4 observaciones (Header detection OK)`);
  assert(res2.validObservations === 4, `Obra 2 procesó 4/4 observaciones con nombres de columna alternativos`);
  assert(res3.validObservations === 3, `Obra 3 procesó 3/3 observaciones con abreviaturas`);

  // TEST 3: Calibración Instantánea del Motor de Costos
  console.log('\n--- TEST 3: Calibración Inmediata del Motor con Datos Ingeridos ---');
  const allObservations: CostObservation[] = [
    ...res1.observations,
    ...res2.observations,
    ...res3.observations
  ].map((obs, idx) => ({ ...obs, id: `obs-${idx}` }));

  // Filtrar observaciones para "Cemento Portland"
  const cementoObs = allObservations.filter(o => o.descripcionItem.includes('Cemento'));
  assert(cementoObs.length === 3, 'Se recopilaron 3 observaciones históricas de Cemento de las 3 obras');

  const cementoEstimate = calculateCostEstimate(cementoObs, '2026-01-01');
  console.log(`[Calibración Cemento] Precio estimado: Gs. ${cementoEstimate.recommendedUnitPrice.toLocaleString('es-PY')} | Rango: [Gs. ${cementoEstimate.priceRange.min.toLocaleString('es-PY')} - ${cementoEstimate.priceRange.max.toLocaleString('es-PY')}] | Muestra: ${cementoEstimate.sampleSize} obras | Confianza: ${cementoEstimate.confidenceTier}`);

  assert(cementoEstimate.recommendedUnitPrice >= 51000 && cementoEstimate.recommendedUnitPrice <= 53000, 'Motor calibrado con precisión para Cemento');
  assert(cementoEstimate.confidenceTier === 'MEDIA', 'Nivel de confianza pasa inmediatamente de INSUFICIENTE a MEDIA tras onboarding');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 6 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 6:', err);
  process.exit(1);
});
