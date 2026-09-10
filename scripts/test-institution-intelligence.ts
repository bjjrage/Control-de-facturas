/**
 * TEST SUITE: INSTITUTION INTELLIGENCE (GATE 12)
 * Modela y evalúa el comportamiento real de 3 convocantes clave del Estado paraguayo:
 * 1. ANDE (Entidad A: Calificación A - Pagos ágiles, baja cancelación)
 * 2. MOPC (Entidad B/C: Calificación B/C - Gran volumen, demoras de 120-180 días)
 * 3. Municipalidad Pequeña / Gobernación (Entidad D: Calificación D - Demoras > 240 días, alta cancelación)
 */

import { generateInstitutionProfile, HistoricalInstitutionTender } from '../lib/procurement/institution-intelligence';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: INSTITUTION INTELLIGENCE (GATE 12)');
  console.log('======================================================\n');

  // CASO 1: ANDE (Administración Nacional de Electricidad)
  console.log('--- TEST 1: Perfil Institucional ANDE ---');
  const andeTenders: HistoricalInstitutionTender[] = [
    { id: 'ande-1', convocante: 'ANDE', fechaLlamado: '2024-01-10', montoTotalAdjudicado: 4500000000, proveedorAdjudicado: 'CIE S.A.', rucProveedor: '80001111-1', cantidadAdendas: 0, estado: 'ADJUDICADA', diasDemoraPagoPromedio: 45 },
    { id: 'ande-2', convocante: 'ANDE', fechaLlamado: '2024-03-15', montoTotalAdjudicado: 7800000000, proveedorAdjudicado: 'TRANSLEC S.A.', rucProveedor: '80002222-2', cantidadAdendas: 1, estado: 'ADJUDICADA', diasDemoraPagoPromedio: 50 },
    { id: 'ande-3', convocante: 'ANDE', fechaLlamado: '2024-06-20', montoTotalAdjudicado: 3200000000, proveedorAdjudicado: 'CIE S.A.', rucProveedor: '80001111-1', cantidadAdendas: 0, estado: 'ADJUDICADA', diasDemoraPagoPromedio: 40 }
  ];

  const profileAnde = generateInstitutionProfile('ADMINISTRACION NACIONAL DE ELECTRICIDAD', andeTenders, 'ANDE');
  console.log(`[ANDE] Calificación: ${profileAnde.calificacionRiesgo} | Días de Pago: ${profileAnde.diasPromedioPago} | Adendas/Llamado: ${profileAnde.adendasPorLlamadoPromedio} | Top 3 Concentración: ${profileAnde.indiceConcentracionTop3Pct}%`);

  assert(profileAnde.calificacionRiesgo === 'A', 'ANDE calificada como A (Excelente pagador)');
  assert(profileAnde.diasPromedioPago <= 60, 'Días de pago promedio de ANDE <= 60 días');
  assert(profileAnde.tasaCancelacionPct === 0, 'Cero cancelaciones registradas');

  // CASO 2: MOPC (Ministerio de Obras Públicas y Comunicaciones)
  console.log('\n--- TEST 2: Perfil Institucional MOPC ---');
  const mopcTenders: HistoricalInstitutionTender[] = [
    { id: 'mopc-1', convocante: 'MOPC', fechaLlamado: '2023-02-01', montoTotalAdjudicado: 45000000000, proveedorAdjudicado: 'TOCSA S.A.', rucProveedor: '80012345-6', cantidadAdendas: 3, estado: 'ADJUDICADA', diasDemoraPagoPromedio: 150 },
    { id: 'mopc-2', convocante: 'MOPC', fechaLlamado: '2023-05-10', montoTotalAdjudicado: 68000000000, proveedorAdjudicado: 'CONCRET-MIX S.A.', rucProveedor: '80065432-1', cantidadAdendas: 2, estado: 'ADJUDICADA', diasDemoraPagoPromedio: 140 },
    { id: 'mopc-3', convocante: 'MOPC', fechaLlamado: '2023-08-15', montoTotalAdjudicado: 32000000000, proveedorAdjudicado: 'PROGEN S.A.', rucProveedor: '80009735-1', cantidadAdendas: 2, estado: 'ADJUDICADA', diasDemoraPagoPromedio: 160 },
    { id: 'mopc-4', convocante: 'MOPC', fechaLlamado: '2023-11-20', montoTotalAdjudicado: 0, proveedorAdjudicado: '', rucProveedor: '', cantidadAdendas: 4, estado: 'CANCELADA', diasDemoraPagoPromedio: undefined }
  ];

  const profileMopc = generateInstitutionProfile('MINISTERIO DE OBRAS PUBLICAS Y COMUNICACIONES', mopcTenders, 'MOPC');
  console.log(`[MOPC] Calificación: ${profileMopc.calificacionRiesgo} | Días de Pago: ${profileMopc.diasPromedioPago} | Tasa Cancelación: ${profileMopc.tasaCancelacionPct}% | Adendas/Llamado: ${profileMopc.adendasPorLlamadoPromedio}`);

  assert(profileMopc.calificacionRiesgo === 'C', 'MOPC calificado con riesgo C (Demoras de pago entre 120-210 días)');
  assert(profileMopc.diasPromedioPago === 150, 'Demora promedio de 150 días calculada con exactitud');
  assert(profileMopc.adendasPorLlamadoPromedio >= 2.0, 'Alta frecuencia de adendas típica del sector vial detectada');

  // CASO 3: Municipio con Severo Riesgo Financiero
  console.log('\n--- TEST 3: Municipio de Alto Riesgo (D) ---');
  const munTenders: HistoricalInstitutionTender[] = [
    { id: 'mun-1', convocante: 'MUNICIPALIDAD EJEMPLO', fechaLlamado: '2023-01-10', montoTotalAdjudicado: 500000000, proveedorAdjudicado: 'CONSTRUCTORA X', rucProveedor: '80099999-9', cantidadAdendas: 1, estado: 'ADJUDICADA', diasDemoraPagoPromedio: 270 },
    { id: 'mun-2', convocante: 'MUNICIPALIDAD EJEMPLO', fechaLlamado: '2023-06-12', montoTotalAdjudicado: 0, proveedorAdjudicado: '', rucProveedor: '', cantidadAdendas: 0, estado: 'CANCELADA', diasDemoraPagoPromedio: undefined },
    { id: 'mun-3', convocante: 'MUNICIPALIDAD EJEMPLO', fechaLlamado: '2023-09-05', montoTotalAdjudicado: 0, proveedorAdjudicado: '', rucProveedor: '', cantidadAdendas: 0, estado: 'DESIERTA', diasDemoraPagoPromedio: undefined }
  ];

  const profileMun = generateInstitutionProfile('MUNICIPALIDAD EJEMPLO', munTenders);
  console.log(`[MUNICIPIO] Calificación: ${profileMun.calificacionRiesgo} | Días de Pago: ${profileMun.diasPromedioPago} | Tasa Cancelación: ${profileMun.tasaCancelacionPct}%`);

  assert(profileMun.calificacionRiesgo === 'D', 'Municipio clasificado como D (Alto Riesgo por demoras > 210 días y cancelaciones > 50%)');

  // CASO 4: Convocante Desconocido sin Historial (UNKNOWN != DEFAULT)
  console.log('\n--- TEST 4: Convocante Desconocido (SIN_DATOS) ---');
  const profileDesconocido = generateInstitutionProfile('ENTIDAD SIN REGISTRO', []);
  console.log(`[DESCONOCIDO] Calificación: ${profileDesconocido.calificacionRiesgo} | Días de Pago: ${profileDesconocido.diasPromedioPago} | Resumen: ${profileDesconocido.resumenRiesgo}`);
  assert(profileDesconocido.calificacionRiesgo === 'SIN_DATOS', 'Convocante sin datos calificado como SIN_DATOS (no B)');
  assert(profileDesconocido.diasPromedioPago === 0, 'Días de pago es 0/no calibrado (no 90d)');

  // CASO 5: Convocante con Llamados pero sin Registro de Plazo de Pago
  console.log('\n--- TEST 5: Convocante con Llamados pero sin Registro de Plazo de Pago ---');
  const tendersSinPago: HistoricalInstitutionTender[] = [
    { id: 't-1', convocante: 'ENTIDAD SIN COBROS', fechaLlamado: '2024-01-01', montoTotalAdjudicado: 1000000000, proveedorAdjudicado: 'PROVEEDOR 1', rucProveedor: '80011111-1', cantidadAdendas: 0, estado: 'ADJUDICADA' },
    { id: 't-2', convocante: 'ENTIDAD SIN COBROS', fechaLlamado: '2024-02-01', montoTotalAdjudicado: 2000000000, proveedorAdjudicado: 'PROVEEDOR 2', rucProveedor: '80022222-2', cantidadAdendas: 1, estado: 'ADJUDICADA' }
  ];
  const profileSinPago = generateInstitutionProfile('ENTIDAD SIN COBROS', tendersSinPago);
  console.log(`[SIN REGISTRO PAGO] Calificación: ${profileSinPago.calificacionRiesgo} | Días de Pago: ${profileSinPago.diasPromedioPago} | Resumen: ${profileSinPago.resumenRiesgo}`);
  assert(profileSinPago.diasPromedioPago === 0, 'Días de pago promedio permanece 0 cuando no hay certificados de cobro');
  assert(profileSinPago.calificacionRiesgo === 'SIN_DATOS', 'Calificación es SIN_DATOS (no inventa 90 días ni rating A o B)');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 12 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 12:', err);
  process.exit(1);
});
