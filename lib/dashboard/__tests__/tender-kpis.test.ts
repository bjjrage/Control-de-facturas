import { describe, it, expect } from "vitest";
import { computeTenderKpis, RawLicitacionForTenderKpi } from "../tender-kpis";
import type { TenderReadinessAssessment, RawEmpresaDocumento } from "../document-readiness";

const todayIso = "2026-09-19";

describe("computeTenderKpis", () => {
  it("computa ofertas que entregan en ≤ 7 días excluyendo resueltas y descartadas", () => {
    const licitaciones: RawLicitacionForTenderKpi[] = [
      // En preparación, entrega en 3 días (2026-09-22): debe contar
      { id: "1", decision: "EN_PREPARACION", fecha_entrega_ofertas: "2026-09-22" },
      // Sin revisar, entrega en 6 días (2026-09-25): debe contar
      { id: "2", decision: "SIN_REVISAR", fecha_entrega_ofertas: "2026-09-25" },
      // En preparación pero entrega en 20 días: NO cuenta en ventana de 7 días
      { id: "3", decision: "EN_PREPARACION", fecha_entrega_ofertas: "2026-10-15" },
      // Descartada que vencía en 2 días: NO debe contar
      { id: "4", decision: "DESCARTADA", fecha_entrega_ofertas: "2026-09-21" },
      // Ganada: NO debe contar
      { id: "5", decision: "GANADA", fecha_entrega_ofertas: "2026-09-21" },
    ];

    const kpis = computeTenderKpis({
      todayIso,
      licitaciones,
      empresaDocs: [],
      readinessAssessments: [],
      canUseLicitaciones: true,
    });

    const entreganKpi = kpis.find((k) => k.key === "entregan-7-dias");
    expect(entreganKpi).toBeDefined();
    expect(entreganKpi?.value).toBe("2");
    expect(entreganKpi?.tone).toBe("warn");
  });

  it("computa pipeline referencial sumando por moneda sin mezclar", () => {
    const licitaciones: RawLicitacionForTenderKpi[] = [
      { id: "1", decision: "EN_PREPARACION", monto_referencial: 1000000000, moneda: "PYG" },
      { id: "2", decision: "SIN_REVISAR", monto_referencial: 500000000, moneda: "PYG" },
      { id: "3", decision: "PRESENTADA", monto_referencial: 50000, moneda: "USD" },
      // Descartada: no suma al pipeline activo
      { id: "4", decision: "DESCARTADA", monto_referencial: 800000000, moneda: "PYG" },
    ];

    const kpis = computeTenderKpis({
      todayIso,
      licitaciones,
      empresaDocs: [],
      readinessAssessments: [],
      canUseLicitaciones: true,
    });

    const pipelineKpi = kpis.find((k) => k.key === "pipeline-referencial");
    expect(pipelineKpi?.value).toContain("1.500.000.000");
    expect(pipelineKpi?.multiCurrencyExtra).toBe("+ USD 50.000");
  });

  it("computa documentos vencidos y por vencer a 30 días en bóveda", () => {
    const empresaDocs: RawEmpresaDocumento[] = [
      // Vencido
      { id: "1", tipo: "CCT", fecha_vencimiento: "2026-09-01" },
      // Por vencer en 10 días (2026-09-29)
      { id: "2", tipo: "IPS", fecha_vencimiento: "2026-09-29" },
      // Vence en 6 meses (2027-03-01): no cuenta en ventana 30 días
      { id: "3", tipo: "Patente", fecha_vencimiento: "2027-03-01" },
    ];

    const kpis = computeTenderKpis({
      todayIso,
      licitaciones: [],
      empresaDocs,
      readinessAssessments: [],
      canUseLicitaciones: true,
    });

    const vencidosKpi = kpis.find((k) => k.key === "documentos-vencidos");
    expect(vencidosKpi?.value).toBe("1");
    expect(vencidosKpi?.tone).toBe("error");

    const porVencerKpi = kpis.find((k) => k.key === "documentos-por-vencer");
    expect(porVencerKpi?.value).toBe("1");
    expect(porVencerKpi?.tone).toBe("warn");
  });

  it("reporta 'Sin analizar' si no se cuenta con pliegos analizados, en lugar de un 0 falso", () => {
    const licitaciones: RawLicitacionForTenderKpi[] = [
      { id: "1", decision: "EN_PREPARACION" },
    ];

    const assessments: TenderReadinessAssessment[] = [
      {
        licitacionId: "1",
        titulo: "Licitación X",
        dncpNro: "111",
        fechaEntregaOfertas: "2026-09-30",
        hasAnalyzedPbc: false,
        evaluations: [],
        isAtRisk: true,
        missingCount: 0,
        expiringCount: 0,
        expiredCount: 0,
      },
    ];

    const kpis = computeTenderKpis({
      todayIso,
      licitaciones,
      empresaDocs: [],
      readinessAssessments: assessments,
      canUseLicitaciones: true,
    });

    const missingKpi = kpis.find((k) => k.key === "requisitos-faltantes");
    expect(missingKpi?.title).toBe("Documentación base faltante");
    expect(missingKpi?.value).toBe("Sin analizar");
    expect(missingKpi?.secondaryText).toBe("Pliego pendiente de análisis");
    expect(missingKpi?.trendText).toBe("Chequeo preventivo · no sustituye análisis del PBC");
    expect(missingKpi?.infoTooltip).toContain("no fueron analizados");

    const riskKpi = kpis.find((k) => k.key === "riesgo-documental");
    expect(riskKpi?.value).toBe("Sin analizar");
    expect(riskKpi?.secondaryText).toBe("Pliego pendiente de análisis");
    expect(riskKpi?.infoTooltip).toContain("no fueron analizados");
  });

  it("distingue claramente entre defectos en docs base y pliegos pendientes en riesgo documental", () => {
    const licitaciones: RawLicitacionForTenderKpi[] = [
      { id: "1", decision: "EN_PREPARACION" },
      { id: "2", decision: "EN_PREPARACION" },
    ];

    const assessments: TenderReadinessAssessment[] = [
      {
        licitacionId: "1",
        titulo: "Llamado 1",
        dncpNro: "111",
        fechaEntregaOfertas: "2026-09-30",
        hasAnalyzedPbc: true,
        evaluations: [],
        isAtRisk: true,
        missingCount: 1,
        expiringCount: 0,
        expiredCount: 0,
      },
      {
        licitacionId: "2",
        titulo: "Llamado 2",
        dncpNro: "222",
        fechaEntregaOfertas: "2026-09-30",
        hasAnalyzedPbc: false,
        evaluations: [],
        isAtRisk: true,
        missingCount: 0,
        expiringCount: 0,
        expiredCount: 0,
      },
    ];

    const kpis = computeTenderKpis({
      todayIso,
      licitaciones,
      empresaDocs: [],
      readinessAssessments: assessments,
      canUseLicitaciones: true,
    });

    const riskKpi = kpis.find((k) => k.key === "riesgo-documental");
    expect(riskKpi?.value).toBe("2");
    expect(riskKpi?.secondaryText).toContain("1 por docs base · 1 pliego pendiente");
  });
});
