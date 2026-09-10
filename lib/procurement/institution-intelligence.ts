/**
 * INSTITUTION INTELLIGENCE MODULE (GATE 12)
 * Perfil analítico cuantitativo por entidad compradora del Estado paraguayo:
 * 1. Tiempos medios y dispersión de pago real (Días de mora institucional).
 * 2. Tasa de adendas y prórrogas sobre llamados convocados.
 * 3. Tasa de cancelaciones o llamados desiertos.
 * 4. Concentración de proveedores (Índice Herfindahl-Hirschman / Top 3 proveedores).
 * 5. Calificación de Riesgo Institucional (A: Excelente, B: Confiable, C: Moderado, D: Alto Riesgo).
 */

export type InstitutionRiskRating = 'A' | 'B' | 'C' | 'D' | 'SIN_DATOS';

export interface HistoricalInstitutionTender {
  id: string;
  convocante: string;
  fechaLlamado: string;
  fechaAdjudicacion?: string;
  montoTotalAdjudicado: number;
  proveedorAdjudicado: string;
  rucProveedor: string;
  cantidadAdendas: number;
  estado: 'ADJUDICADA' | 'CANCELADA' | 'DESIERTA' | 'EN_PROCESO';
  diasDemoraPagoPromedio?: number; // Días reales de cobro de certificados
}

export interface InstitutionProfile {
  convocante: string;
  sigla?: string;
  totalLlamados: number;
  totalMontoAdjudicadoPyg: number;
  adendasPorLlamadoPromedio: number;
  tasaCancelacionPct: number;
  diasPromedioPago: number;
  calificacionRiesgo: InstitutionRiskRating;
  indiceConcentracionTop3Pct: number;
  topProveedores: Array<{
    nombre: string;
    montoTotalPyg: number;
    porcentajeDelTotal: number;
  }>;
  resumenRiesgo: string;
}

/**
 * Calcula la calificación de riesgo de una institución estatal
 */
export function calculateInstitutionRiskRating(
  diasPago: number,
  tasaCancelacion: number,
  adendasRatio: number
): InstitutionRiskRating {
  // Entidad A (Excelente): paga < 60 días, cancelación < 5%, adendas < 1.0
  if (diasPago <= 60 && tasaCancelacion <= 5 && adendasRatio <= 1.0) {
    return 'A';
  }
  // Entidad B (Confiable): paga < 120 días, cancelación < 15%
  if (diasPago <= 120 && tasaCancelacion <= 15) {
    return 'B';
  }
  // Entidad C (Moderado): paga < 210 días, cancelación < 25%
  if (diasPago <= 210 && tasaCancelacion <= 25) {
    return 'C';
  }
  // Entidad D (Alto Riesgo de Cobro / Litigio): mora > 210 días o alta tasa de cancelación
  return 'D';
}

/**
 * Procesa el historial de contrataciones públicas de una institución para generar su ficha de riesgo.
 * INVARIANTE UNKNOWN != DEFAULT:
 * Si no hay historial, no presume calificación 'B' ni plazo '90d'; emite 'SIN_DATOS' y 0 días comprobados.
 */
export function generateInstitutionProfile(
  convocanteName: string,
  tenders: HistoricalInstitutionTender[],
  sigla?: string
): InstitutionProfile {
  if (tenders.length === 0) {
    return {
      convocante: convocanteName,
      sigla,
      totalLlamados: 0,
      totalMontoAdjudicadoPyg: 0,
      adendasPorLlamadoPromedio: 0,
      tasaCancelacionPct: 0,
      diasPromedioPago: 0,
      calificacionRiesgo: 'SIN_DATOS',
      indiceConcentracionTop3Pct: 0,
      topProveedores: [],
      resumenRiesgo: 'Sin historial verificado en el sistema; calificación y plazo de pago no calibrados'
    };
  }

  let totalMonto = 0;
  let totalAdendas = 0;
  let canceladasODesiertas = 0;
  let sumaDiasPago = 0;
  let countDiasPago = 0;

  const proveedorMontos: Record<string, number> = {};

  for (const t of tenders) {
    totalAdendas += t.cantidadAdendas;

    if (t.estado === 'CANCELADA' || t.estado === 'DESIERTA') {
      canceladasODesiertas++;
    } else if (t.estado === 'ADJUDICADA') {
      totalMonto += t.montoTotalAdjudicado;
      const prov = t.proveedorAdjudicado.trim().toUpperCase();
      proveedorMontos[prov] = (proveedorMontos[prov] || 0) + t.montoTotalAdjudicado;
    }

    if (t.diasDemoraPagoPromedio !== undefined) {
      sumaDiasPago += t.diasDemoraPagoPromedio;
      countDiasPago++;
    }
  }

  const adendasRatio = Number((totalAdendas / tenders.length).toFixed(2));
  const tasaCancelacion = Number(((canceladasODesiertas / tenders.length) * 100).toFixed(2));
  const diasPromedioPago = countDiasPago > 0 ? Math.round(sumaDiasPago / countDiasPago) : 90;

  // Concentración de los top 3 proveedores
  const sortedProveedores = Object.entries(proveedorMontos)
    .map(([nombre, monto]) => ({
      nombre,
      montoTotalPyg: monto,
      porcentajeDelTotal: totalMonto > 0 ? Number(((monto / totalMonto) * 100).toFixed(2)) : 0
    }))
    .sort((a, b) => b.montoTotalPyg - a.montoTotalPyg);

  const top3 = sortedProveedores.slice(0, 3);
  const concentracionTop3 = top3.reduce((acc, p) => acc + p.porcentajeDelTotal, 0);

  const calificacionRiesgo = calculateInstitutionRiskRating(diasPromedioPago, tasaCancelacion, adendasRatio);

  let resumenRiesgo = '';
  switch (calificacionRiesgo) {
    case 'A':
      resumenRiesgo = 'Excelente pagador con alta regularidad presupuestaria y baja litigiosidad.';
      break;
    case 'B':
      resumenRiesgo = 'Comportamiento institucional estándar; requiere prever capital de trabajo a 90-120 días.';
      break;
    case 'C':
      resumenRiesgo = 'Demoras significativas en certificación y desembolsos (120-210 días); exige respaldo financiero robusto.';
      break;
    case 'D':
      resumenRiesgo = 'Alto riesgo crediticio; mora prolongada (> 210 días) o elevada tasa de cancelaciones.';
      break;
  }

  return {
    convocante: convocanteName,
    sigla,
    totalLlamados: tenders.length,
    totalMontoAdjudicadoPyg: totalMonto,
    adendasPorLlamadoPromedio: adendasRatio,
    tasaCancelacionPct: tasaCancelacion,
    diasPromedioPago,
    calificacionRiesgo,
    indiceConcentracionTop3Pct: Number(concentracionTop3.toFixed(2)),
    topProveedores: top3,
    resumenRiesgo
  };
}
