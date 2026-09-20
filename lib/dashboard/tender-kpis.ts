import type { MetricCardData, DomainTone } from "./types";
import { formatMultiCurrencyBalances, sumByCurrency } from "./currency-helper";
import type { TenderReadinessAssessment, RawEmpresaDocumento } from "./document-readiness";

export interface RawLicitacionForTenderKpi {
  id: string;
  decision: string;
  synced_at?: string | null;
  fecha_entrega_ofertas?: string | null;
  monto_referencial?: number | null;
  moneda?: string | null;
}

function addDays(isoOrDate: string | Date, days: number): string {
  const d = new Date(isoOrDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Genera los 8 KPIs de Licitaciones ejecutivos y reales.
 */
export function computeTenderKpis(params: {
  todayIso: string;
  licitaciones: RawLicitacionForTenderKpi[];
  empresaDocs: RawEmpresaDocumento[];
  readinessAssessments: TenderReadinessAssessment[];
  canUseLicitaciones: boolean;
}): MetricCardData[] {
  const { todayIso, licitaciones, empresaDocs, readinessAssessments, canUseLicitaciones } = params;

  if (!canUseLicitaciones) return [];

  const en7diasIso = addDays(todayIso, 7);
  const hace7diasIso = addDays(todayIso, -7);

  // Licitaciones activas relevantes en juego (no resueltas ni descartadas)
  const activeTenders = licitaciones.filter(
    (l) => l.decision === "SIN_REVISAR" || l.decision === "EN_PREPARACION" || l.decision === "PRESENTADA"
  );

  // =========================================================================
  // 1. NUEVAS OPORTUNIDADES
  // =========================================================================
  const nuevasOportunidades = licitaciones.filter(
    (l) => l.decision === "SIN_REVISAR" && (!l.synced_at || l.synced_at >= hace7diasIso)
  );

  // =========================================================================
  // 2. EN PREPARACIÓN
  // =========================================================================
  const enPreparacion = licitaciones.filter((l) => l.decision === "EN_PREPARACION");

  // =========================================================================
  // 3. ENTREGAN ≤ 7 DÍAS
  // =========================================================================
  const entreganPronto = activeTenders.filter((l) => {
    if (!l.fecha_entrega_ofertas) return false;
    const f = l.fecha_entrega_ofertas.slice(0, 10);
    return f >= todayIso && f <= en7diasIso;
  });

  // =========================================================================
  // 4. PIPELINE REFERENCIAL
  // =========================================================================
  const pipelineTenders = activeTenders
    .filter((l) => l.monto_referencial && l.monto_referencial > 0)
    .map((l) => ({
      amount: l.monto_referencial ?? 0,
      currency: l.moneda || "PYG",
    }));

  const pipelineMap = sumByCurrency(pipelineTenders, (t) => t.amount);
  const { primaryFormatted: pipelineFormatted, extraFormatted: pipelineExtra } =
    formatMultiCurrencyBalances(pipelineMap, "PYG");

  // =========================================================================
  // 5. DOCUMENTOS VENCIDOS EN BÓVEDA
  // =========================================================================
  const docsVencidos = empresaDocs.filter(
    (d) => d.fecha_vencimiento && d.fecha_vencimiento < todayIso
  );

  // =========================================================================
  // 6. DOCUMENTOS POR VENCER ≤ 30 DÍAS
  // =========================================================================
  const en30diasIso = addDays(todayIso, 30);
  const docsPorVencer = empresaDocs.filter(
    (d) =>
      d.fecha_vencimiento &&
      d.fecha_vencimiento >= todayIso &&
      d.fecha_vencimiento <= en30diasIso
  );

  // =========================================================================
  // 7. DOCUMENTACIÓN BASE FALTANTE (HEURÍSTICA CANÓNICA V1)
  // =========================================================================
  const activeAssessments = readinessAssessments.filter((a) => {
    const lic = licitaciones.find((l) => l.id === a.licitacionId);
    return lic && (lic.decision === "EN_PREPARACION" || lic.decision === "SIN_REVISAR" || lic.decision === "PRESENTADA");
  });

  const analyzedAssessments = activeAssessments.filter((a) => a.hasAnalyzedPbc);
  const totalMissing = analyzedAssessments.reduce((acc, a) => acc + a.missingCount, 0);

  let missingKpiValue: string;
  let missingKpiSecondary: string;
  let missingTone: DomainTone = "ok";

  if (activeAssessments.length === 0) {
    missingKpiValue = "0";
    missingKpiSecondary = "Sin licitaciones activas";
  } else if (analyzedAssessments.length === 0) {
    missingKpiValue = "Sin analizar";
    missingKpiSecondary = "Pliego pendiente de análisis";
    missingTone = "warn";
  } else {
    missingKpiValue = String(totalMissing);
    missingKpiSecondary =
      totalMissing > 0
        ? `Docs base no presentes en bóveda`
        : `Docs base al día en ${analyzedAssessments.length} llamadas`;
    missingTone = totalMissing > 0 ? "error" : "ok";
  }

  // =========================================================================
  // 8. LICITACIONES EN RIESGO DOCUMENTAL (DISTINGUE DOCS BASE VS PLIEGO PENDIENTE)
  // =========================================================================
  // Distingue claramente:
  // A) Documentación base faltante o vencida antes de entrega
  // B) Pliego pendiente de análisis (hasAnalyzedPbc = false)
  const tendersWithDocDefects = activeAssessments.filter(
    (a) => a.hasAnalyzedPbc && (a.missingCount > 0 || a.expiringCount > 0 || a.expiredCount > 0)
  );
  const tendersPendingPbc = activeAssessments.filter((a) => !a.hasAnalyzedPbc);

  let riskKpiValue: string;
  let riskKpiSecondary: string;
  let riskTrendText: string;
  let riskTrendTone: "up" | "down" | "neutral" = "neutral";
  let riskTone: DomainTone = "ok";

  if (activeAssessments.length === 0) {
    riskKpiValue = "0";
    riskKpiSecondary = "Sin licitaciones activas";
    riskTrendText = "Sin llamados en curso";
    riskTone = "ok";
  } else if (analyzedAssessments.length === 0) {
    riskKpiValue = "Sin analizar";
    riskKpiSecondary = "Pliego pendiente de análisis";
    riskTrendText = `${tendersPendingPbc.length} llamadas sin pliego procesado`;
    riskTone = "warn";
  } else {
    const totalInRisk = tendersWithDocDefects.length + tendersPendingPbc.length;
    riskKpiValue = String(totalInRisk);

    if (tendersWithDocDefects.length > 0 && tendersPendingPbc.length > 0) {
      riskKpiSecondary = `${tendersWithDocDefects.length} por docs base · ${tendersPendingPbc.length} pliego pendiente`;
    } else if (tendersWithDocDefects.length > 0) {
      riskKpiSecondary = `${tendersWithDocDefects.length} con doc base faltante o por vencer`;
    } else if (tendersPendingPbc.length > 0) {
      riskKpiSecondary = `${tendersPendingPbc.length} con pliego pendiente de análisis`;
    } else {
      riskKpiSecondary = `Docs base vigentes en ${analyzedAssessments.length} licitaciones`;
    }

    if (totalInRisk > 0) {
      riskTrendText = "Requiere regularización documental";
      riskTrendTone = "down";
      riskTone = tendersWithDocDefects.length > 0 ? "error" : "warn";
    } else {
      riskTrendText = "Docs base vigentes a la apertura";
      riskTrendTone = "up";
      riskTone = "ok";
    }
  }

  return [
    {
      key: "nuevas-oportunidades",
      title: "Nuevas oportunidades",
      value: String(nuevasOportunidades.length),
      multiCurrencyExtra: null,
      secondaryText: "Convocatorias sin revisar (7 días)",
      trendText: "Radar de contrataciones públicas",
      trendTone: "neutral",
      href: "/licitaciones",
      iconKey: "radar",
      tone: nuevasOportunidades.length > 0 ? "warn" : "neutral",
    },
    {
      key: "en-preparacion",
      title: "En preparación",
      value: String(enPreparacion.length),
      multiCurrencyExtra: null,
      secondaryText: "Ofertas en proceso de armado",
      trendText: "Pipeline activo de licitaciones",
      trendTone: "neutral",
      href: "/licitaciones",
      iconKey: "gavel",
      tone: "ok",
    },
    {
      key: "entregan-7-dias",
      title: "Entregan ≤ 7 días",
      value: String(entreganPronto.length),
      multiCurrencyExtra: null,
      secondaryText: "Cierre de ofertas inminente",
      trendText: entreganPronto.length > 0 ? "Vencimientos próximos" : "Sin cierres urgentes esta semana",
      trendTone: entreganPronto.length > 0 ? "down" : "up",
      href: "/licitaciones",
      iconKey: "calendar-clock",
      tone: entreganPronto.length > 0 ? "warn" : "ok",
    },
    {
      key: "pipeline-referencial",
      title: "Pipeline referencial",
      value: pipelineFormatted,
      multiCurrencyExtra: pipelineExtra,
      secondaryText: `${activeTenders.length} licitaciones activas en cartera`,
      trendText: "Monto oficial referencial DNCP",
      trendTone: "neutral",
      href: "/licitaciones",
      iconKey: "trophy",
      tone: "ok",
    },
    {
      key: "documentos-vencidos",
      title: "Documentos vencidos",
      value: String(docsVencidos.length),
      multiCurrencyExtra: null,
      secondaryText: "En bóveda de la empresa",
      trendText: docsVencidos.length > 0 ? "Requiere renovación inmediata" : "Sin documentos vencidos",
      trendTone: docsVencidos.length > 0 ? "down" : "up",
      href: "/licitaciones/documentos",
      iconKey: "file-x",
      tone: docsVencidos.length > 0 ? "error" : "ok",
    },
    {
      key: "documentos-por-vencer",
      title: "Por vencer ≤ 30 días",
      value: String(docsPorVencer.length),
      multiCurrencyExtra: null,
      secondaryText: "En bóveda de la empresa",
      trendText: docsPorVencer.length > 0 ? "Vencen en los próximos 30 días" : "Sin vencimientos a 30 días",
      trendTone: docsPorVencer.length > 0 ? "down" : "up",
      href: "/licitaciones/documentos",
      iconKey: "clock",
      tone: docsPorVencer.length > 0 ? "warn" : "ok",
    },
    {
      key: "requisitos-faltantes",
      title: "Documentación base faltante",
      value: missingKpiValue,
      multiCurrencyExtra: null,
      secondaryText: missingKpiSecondary,
      trendText: "Chequeo preventivo · no sustituye análisis del PBC",
      trendTone: "neutral",
      href: "/licitaciones",
      iconKey: "file-question",
      tone: missingTone,
      infoTooltip: "Chequeo de documentación base. Los requisitos particulares del PBC todavía no fueron analizados.",
    },
    {
      key: "riesgo-documental",
      title: "Riesgo documental",
      value: riskKpiValue,
      multiCurrencyExtra: null,
      secondaryText: riskKpiSecondary,
      trendText: riskTrendText,
      trendTone: riskTrendTone,
      href: "/licitaciones",
      iconKey: "shield-alert",
      tone: riskTone,
      infoTooltip: "Chequeo de documentación base. Los requisitos particulares del PBC todavía no fueron analizados.",
    },
  ];
}
