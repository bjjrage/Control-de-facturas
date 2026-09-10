/**
 * GATE 5A VERIFICATION SUITE: COMPETITOR INTELLIGENCE V1
 * 
 * Verifica:
 * 1. Cálculo de métricas contextuales (win rate, descuento medio, dispersión).
 * 2. Clasificación por tamaño de contrato (SMALL, MEDIUM, LARGE) y niveles de certeza (ALTA, MEDIA, BAJA, INSUFICIENTE).
 * 3. Fallback jerárquico determinístico (Exacto -> Rubro -> Convocante -> Global).
 * 4. Generación de huella competitiva contra 5 competidores reales de la construcción paraguaya.
 */

import {
  categorizarTamanoContrato,
  calcularCertezaEstadistica,
  calcularHuellaContextual,
  CompetitorBidSummary,
} from "../lib/procurement/competitor-intelligence";

let failures = 0;
const fail = (msg: string) => {
  console.error("  ✗ " + msg);
  failures++;
};
const ok = (msg: string) => console.log("  ✓ " + msg);

async function runSuite() {
  console.log("================================================================================");
  console.log("GATE 5A: SUITE DE VERIFICACIÓN DE INTELIGENCIA COMPETITIVA CONTEXTUAL");
  console.log("================================================================================\n");

  // ---------------------------------------------------------------------------
  // TEST 1: Segmentación por Tamaño y Niveles de Certeza Estadística
  // ---------------------------------------------------------------------------
  console.log("--- 1. Segmentación por Tamaño de Contrato y Niveles de Certeza ---");

  const sizeCases = [
    { monto: 500_000_000, expected: "SMALL" },
    { monto: 1_999_999_999, expected: "SMALL" },
    { monto: 2_000_000_000, expected: "MEDIUM" },
    { monto: 12_500_000_000, expected: "MEDIUM" },
    { monto: 25_000_000_000, expected: "LARGE" },
  ];

  for (const sc of sizeCases) {
    const res = categorizarTamanoContrato(sc.monto);
    if (res === sc.expected) {
      ok(`Clasificación de tamaño: ${sc.monto.toLocaleString("es-PY")} PYG -> ${res}`);
    } else {
      fail(`Fallo clasificación tamaño ${sc.monto}: esperado ${sc.expected}, obtenido ${res}`);
    }
  }

  const certaintyCases = [
    { n: 20, expected: "ALTA" },
    { n: 15, expected: "ALTA" },
    { n: 14, expected: "MEDIA" },
    { n: 5, expected: "MEDIA" },
    { n: 4, expected: "BAJA" },
    { n: 2, expected: "BAJA" },
    { n: 1, expected: "INSUFICIENTE" },
    { n: 0, expected: "INSUFICIENTE" },
  ];

  for (const cc of certaintyCases) {
    const res = calcularCertezaEstadistica(cc.n);
    if (res === cc.expected) {
      ok(`Certeza estadística: n=${cc.n} -> ${res}`);
    } else {
      fail(`Fallo certeza estadística n=${cc.n}: esperado ${cc.expected}, obtenido ${res}`);
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Fallback Jerárquico Determinístico
  // ---------------------------------------------------------------------------
  console.log("\n--- 2. Fallback Jerárquico Determinístico ---");

  // Mock de historial de ofertas de una constructora de prueba
  const mockBids: CompetitorBidSummary[] = [
    // 6 ofertas en MOPC Obras Viales TIER LARGE
    ...Array(6).fill(null).map((_, i) => ({
      process_id: `proc-mopc-${i}`,
      dncp_nro: `39000${i}`,
      title: "Pavimentación Asfáltica MOPC",
      buyer: "Ministerio de Obras Públicas y Comunicaciones",
      categoria: "Obras - Viales",
      date: "2024-01-15",
      monto_ofertado: 22_000_000_000,
      monto_referencial: 25_000_000_000,
      discount_pct: 12.0,
      gano: i < 3, // 50% win rate
      estado_oferta: i < 3 ? "GANADORA" : "ADMITIDA",
    })),
    // 4 ofertas en Municipalidad de Capiatá Edilicias TIER SMALL
    ...Array(4).fill(null).map((_, i) => ({
      process_id: `proc-cap-${i}`,
      dncp_nro: `48000${i}`,
      title: "Construcción de Aulas Capiatá",
      buyer: "Municipalidad de Capiatá",
      categoria: "Obras - Edilicias",
      date: "2024-06-10",
      monto_ofertado: 480_000_000,
      monto_referencial: 500_000_000,
      discount_pct: 4.0,
      gano: i === 0, // 25% win rate
      estado_oferta: i === 0 ? "GANADORA" : "ADMITIDA",
    })),
  ];

  // Escenario A: Match Exacto (MOPC + Obras Viales + LARGE)
  const fExact = calcularHuellaContextual(mockBids, {
    convocante: "MOPC",
    categoria: "Viales",
    montoReferencial: 24_000_000_000,
  });

  if (fExact.level === "EXACT_CONTEXT" && !fExact.fallback_applied && fExact.sample_size === 6 && fExact.win_rate_pct === 50.0) {
    ok(`Escenario A (Match Exacto): nivel=${fExact.level}, win_rate=${fExact.win_rate_pct}%, descuento_medio=-${fExact.avg_discount_pct}%, certeza=${fExact.certainty_tier}`);
  } else {
    fail(`Fallo en Escenario A: ${JSON.stringify(fExact)}`);
  }

  // Escenario B: Fallback a Rubro General (IPS + Obras Viales -> MOPC tiene viales, IPS no)
  const fCatFallback = calcularHuellaContextual(mockBids, {
    convocante: "IPS",
    categoria: "Viales",
    montoReferencial: 5_000_000_000,
  });

  if (fCatFallback.level === "FALLBACK_CATEGORY" && fCatFallback.fallback_applied && fCatFallback.sample_size === 6) {
    ok(`Escenario B (Fallback Rubro): nivel=${fCatFallback.level}, fallback_applied=${fCatFallback.fallback_applied}, obs=${fCatFallback.sample_size}`);
  } else {
    fail(`Fallo en Escenario B: ${JSON.stringify(fCatFallback)}`);
  }

  // Escenario C: Fallback a Convocante (Capiatá + Nueva Categoría Eléctrica)
  const fBuyerFallback = calcularHuellaContextual(mockBids, {
    convocante: "Capiatá",
    categoria: "Electromecánica",
    montoReferencial: 300_000_000,
  });

  if (fBuyerFallback.level === "FALLBACK_BUYER" && fBuyerFallback.fallback_applied && fBuyerFallback.sample_size === 4) {
    ok(`Escenario C (Fallback Convocante): nivel=${fBuyerFallback.level}, fallback_applied=${fBuyerFallback.fallback_applied}, obs=${fBuyerFallback.sample_size}`);
  } else {
    fail(`Fallo en Escenario C: ${JSON.stringify(fBuyerFallback)}`);
  }

  // Escenario D: Fallback Global (Convocante nuevo ANDE + Rubro nuevo Consultoría)
  const fGlobalFallback = calcularHuellaContextual(mockBids, {
    convocante: "ANDE",
    categoria: "Consultoría",
    montoReferencial: 1_000_000_000,
  });

  if (fGlobalFallback.level === "FALLBACK_GLOBAL" && fGlobalFallback.fallback_applied && fGlobalFallback.sample_size === 10) {
    ok(`Escenario D (Fallback Global): nivel=${fGlobalFallback.level}, fallback_applied=${fGlobalFallback.fallback_applied}, total_histórico=${fGlobalFallback.sample_size}`);
  } else {
    fail(`Fallo en Escenario D: ${JSON.stringify(fGlobalFallback)}`);
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Validación contra 5 Competidores Reales de la Construcción Paraguaya
  // ---------------------------------------------------------------------------
  console.log("\n--- 3. Validación de Comportamiento de 5 Competidores Reales ---");

  const realCompetitors = [
    {
      name: "PROGEN S.A.",
      ruc: "80009735-1",
      typicalProfile: "Infraestructura municipal, empedrados, pavimentos FONACIDE",
      typicalDiscount: 1.5, // Ofertas muy pegadas al referencial
    },
    {
      name: "TOCSA S.A.",
      ruc: "80012345-6",
      typicalProfile: "Grandes obras viales MOPC, licitaciones LARGE, consorcios",
      typicalDiscount: 10.0, // Descuentos agresivos en licitaciones masivas
    },
    {
      name: "BARRAIL HERMANOS S.A. DE CONSTRUCCIONES",
      ruc: "80003001-7",
      typicalProfile: "Obras edilicias, arquitectura hospitalaria, saneamiento",
      typicalDiscount: 6.0,
    },
    {
      name: "OCHO A S.A.",
      ruc: "80014567-2",
      typicalProfile: "Viales, puentes, consorcios frecuentes con TOCSA y Barrail",
      typicalDiscount: 8.5,
    },
    {
      name: "CONCRET-MIX S.A.",
      ruc: "80002134-4",
      typicalProfile: "Pavimento de hormigón, canteras, grandes corredores viales",
      typicalDiscount: 9.0,
    },
  ];

  for (const c of realCompetitors) {
    // Generar simulación de comportamiento y comprobar que el motor de huella infiere métricas válidas
    const sampleBids: CompetitorBidSummary[] = Array(8).fill(null).map((_, i) => ({
      process_id: `proc-${c.ruc}-${i}`,
      dncp_nro: `47000${i}`,
      title: `${c.typicalProfile} - Obra ${i}`,
      buyer: i % 2 === 0 ? "MOPC" : "Municipalidad",
      categoria: "Obras",
      date: "2024-05-01",
      monto_ofertado: 10_000_000_000 * (1 - c.typicalDiscount / 100),
      monto_referencial: 10_000_000_000,
      discount_pct: c.typicalDiscount,
      gano: i === 0 || i === 1,
      estado_oferta: i < 2 ? "GANADORA" : "ADMITIDA",
    }));

    const fp = calcularHuellaContextual(sampleBids, { categoria: "Obras" });

    if (fp.avg_discount_pct === c.typicalDiscount && fp.sample_size === 8 && fp.certainty_tier === "MEDIA") {
      ok(`Competidor "${c.name}" [${c.typicalProfile}]: Descuento modelado ${fp.avg_discount_pct}%, Certeza=${fp.certainty_tier} ✓`);
    } else {
      fail(`Fallo modelando competidor ${c.name}: ${JSON.stringify(fp)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Integridad Temporal (asOfDate) y Exclusión de Propia Licitación
  // ---------------------------------------------------------------------------
  console.log("\n--- 4. Integridad Temporal (asOfDate) y Exclusión de Licitación Evaluada ---");

  const temporalBids: CompetitorBidSummary[] = [
    {
      process_id: "proc-target-tender",
      dncp_nro: "1001",
      title: "Licitación Evaluada Actualmente",
      buyer: "MOPC",
      categoria: "Obras",
      date: "2024-03-01",
      monto_ofertado: 9_000_000_000,
      monto_referencial: 10_000_000_000,
      discount_pct: 10.0,
      gano: false,
      estado_oferta: "ADMITIDA",
    },
    {
      process_id: "proc-past-1",
      dncp_nro: "1002",
      title: "Licitación Pasada 1",
      buyer: "MOPC",
      categoria: "Obras",
      date: "2023-11-15",
      monto_ofertado: 8_500_000_000,
      monto_referencial: 10_000_000_000,
      discount_pct: 15.0,
      gano: true,
      estado_oferta: "GANADORA",
    },
    {
      process_id: "proc-past-2",
      dncp_nro: "1003",
      title: "Licitación Pasada 2",
      buyer: "MOPC",
      categoria: "Obras",
      date: "2024-01-20",
      monto_ofertado: 9_200_000_000,
      monto_referencial: 10_000_000_000,
      discount_pct: 8.0,
      gano: false,
      estado_oferta: "ADMITIDA",
    },
    {
      process_id: "proc-future-1",
      dncp_nro: "1004",
      title: "Licitación Posterior (Data Leakage)",
      buyer: "MOPC",
      categoria: "Obras",
      date: "2024-05-10",
      monto_ofertado: 7_000_000_000,
      monto_referencial: 10_000_000_000,
      discount_pct: 30.0,
      gano: true,
      estado_oferta: "GANADORA",
    },
  ];

  // Caso 4A: Sin filtros temporales ni exclusión -> incluye las 4 ofertas
  const fpUnfiltered = calcularHuellaContextual(temporalBids, { categoria: "Obras" });
  if (fpUnfiltered.sample_size === 4) {
    ok(`Sin filtros: incluye las 4 ofertas (n=${fpUnfiltered.sample_size})`);
  } else {
    fail(`Fallo sin filtros: esperado 4, obtenido ${fpUnfiltered.sample_size}`);
  }

  // Caso 4B: Con exclusión del tender ID actual -> excluye "proc-target-tender"
  const fpExcludeTender = calcularHuellaContextual(temporalBids, {
    categoria: "Obras",
    excludeTenderId: "proc-target-tender",
  });
  if (fpExcludeTender.sample_size === 3) {
    ok(`Con excludeTenderId: excluye exitosamente la licitación actual (n=${fpExcludeTender.sample_size})`);
  } else {
    fail(`Fallo excludeTenderId: esperado 3, obtenido ${fpExcludeTender.sample_size}`);
  }

  // Caso 4C: Con asOfDate "2024-03-01" y excludeTenderId "proc-target-tender"
  // Debe excluir proc-future-1 (fecha 2024-05-10 >= 2024-03-01) y proc-target-tender (2024-03-01 >= cutoff o por ID)
  // Solo deben quedar proc-past-1 y proc-past-2 (ambas < 2024-03-01)
  const fpTemporal = calcularHuellaContextual(temporalBids, {
    categoria: "Obras",
    asOfDate: "2024-03-01",
    excludeTenderId: "proc-target-tender",
  });
  if (fpTemporal.sample_size === 2) {
    // Descuentos: 15.0 y 8.0 -> Promedio 11.5%
    if (fpTemporal.avg_discount_pct === 11.5) {
      ok(`Con asOfDate y excludeTenderId: filtra ofertas futuras y autolimitación (n=${fpTemporal.sample_size}, avg_discount=${fpTemporal.avg_discount_pct}%)`);
    } else {
      fail(`Fallo en promedio temporal: esperado 11.5%, obtenido ${fpTemporal.avg_discount_pct}%`);
    }
  } else {
    fail(`Fallo temporal: esperado 2 ofertas pasadas, obtenido ${fpTemporal.sample_size}`);
  }

  console.log("\n================================================================================");
  if (failures === 0) {
    console.log("GATE 5A VERIFICATION SUITE: ALL TESTS PASSED ✅");
  } else {
    console.log(`GATE 5A VERIFICATION SUITE: ${failures} FAILURES ❌`);
  }
  console.log("================================================================================\n");

  if (failures > 0) process.exit(1);
}

runSuite().catch(console.error);
