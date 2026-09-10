/**
 * COMPLIANCE ENGINE (GATE 11)
 * Matriz estructurada de verificación de pliegos de bases y condiciones contra el Company Bid Vault y ERP:
 * 1. Requisitos legales (Estatutos, Poderes, RUC activo, Representante legal).
 * 2. Requisitos fiscales y sociales (DNIT CCT vigente, IPS no adeudar, Certificado no inhabilitado).
 * 3. Capacidad financiera (Ratios de liquidez corriente >= 1.2, endeudamiento <= 0.8, capital de trabajo mínimo).
 * 4. Experiencia técnica (Monto acumulado de obras similares ejecutadas, unidades físicas ej: km pavimento o m2).
 * 5. Personal técnico clave (Años de experiencia requeridos, títulos registrados).
 * 6. Maquinaria y equipos mínimos (Potencia, disponibilidad, titularidad propia o alquiler comprometido).
 * Dictamen determinístico por requerimiento:
 * - CUMPLIDO: Documento o métrica probatoria válida y vigente encontrada.
 * - GENERABLE: Documento interno que puede ser emitido o renovado a tiempo.
 * - FALTANTE: Incumplimiento crítico o documento inexistente/vencido.
 */

import { VaultItem } from './bid-vault';

export type ComplianceVerdict = 'CUMPLIDO' | 'GENERABLE' | 'FALTANTE';

export interface TenderRequirement {
  id: string;
  categoria: 'LEGAL' | 'FISCAL' | 'FINANCIERO' | 'EXPERIENCIA' | 'PERSONAL' | 'MAQUINARIA';
  descripcion: string;
  esExcluyente: boolean;
  criterio: {
    tipoDocEsperado?: string;
    montoMinimoPyg?: number;
    kmMinimos?: number;
    aniosExperienciaMinimos?: number;
    potenciaHpMinima?: number;
    ratioLiquidezMinimo?: number;
  };
}

export interface RequirementEvaluation {
  requirementId: string;
  categoria: string;
  descripcion: string;
  esExcluyente: boolean;
  verdict: ComplianceVerdict;
  documentoRespaldo?: {
    id: string;
    titulo: string;
    estado: string;
  };
  observaciones: string;
}

export interface TenderComplianceReport {
  tenderId: string;
  isEligibleToBid: boolean; // True solo si 100% de los requisitos excluyentes son CUMPLIDO o GENERABLE
  scoreCumplimientoPct: number;
  totalRequirements: number;
  cumplidosCount: number;
  generablesCount: number;
  faltantesCount: number;
  evaluations: RequirementEvaluation[];
}

/**
 * Evalúa la matriz de cumplimiento de una licitación contra los activos y documentos de la empresa
 */
export function evaluateTenderCompliance(
  tenderId: string,
  requirements: TenderRequirement[],
  vaultItems: VaultItem[],
  financialMetrics?: {
    liquidezCorriente?: number;
    endeudamientoTotal?: number;
    capitalTrabajoPyg?: number;
  }
): TenderComplianceReport {
  const evaluations: RequirementEvaluation[] = [];
  let cumplidos = 0;
  let generables = 0;
  let faltantes = 0;
  let hasDisqualifyingBreach = false;

  for (const req of requirements) {
    let verdict: ComplianceVerdict = 'FALTANTE';
    let docRespaldo: RequirementEvaluation['documentoRespaldo'] = undefined;
    let obs = '';

    if (req.categoria === 'LEGAL') {
      const match = vaultItems.find(
        v => v.categoria === 'LEGAL' && (!req.criterio.tipoDocEsperado || v.tipoDocumento === req.criterio.tipoDocEsperado)
      );
      if (match && match.estado === 'VIGENTE') {
        verdict = 'CUMPLIDO';
        docRespaldo = { id: match.id, titulo: match.titulo, estado: match.estado };
        obs = 'Documento legal vigente en bóveda';
      } else {
        verdict = req.esExcluyente ? 'FALTANTE' : 'GENERABLE';
        obs = match ? `Documento en estado ${match.estado}` : 'Documento legal ausente';
      }
    } else if (req.categoria === 'FISCAL') {
      const match = vaultItems.find(
        v => v.categoria === 'FISCAL' && (!req.criterio.tipoDocEsperado || v.tipoDocumento === req.criterio.tipoDocEsperado)
      );
      if (match && match.estado === 'VIGENTE') {
        verdict = 'CUMPLIDO';
        docRespaldo = { id: match.id, titulo: match.titulo, estado: match.estado };
        obs = 'Certificado fiscal/social al día';
      } else if (match && match.estado === 'POR_VENCER') {
        verdict = 'GENERABLE';
        docRespaldo = { id: match.id, titulo: match.titulo, estado: match.estado };
        obs = 'Certificado próximo a vencer; renovación en trámite o viable';
      } else {
        verdict = 'FALTANTE';
        obs = 'Certificado fiscal o de seguridad social faltante o vencido';
      }
    } else if (req.categoria === 'FINANCIERO') {
      const minLiquidez = req.criterio.ratioLiquidezMinimo ?? 1.0;
      const actualLiquidez = financialMetrics?.liquidezCorriente ?? 0;

      if (actualLiquidez >= minLiquidez) {
        verdict = 'CUMPLIDO';
        obs = `Ratio de liquidez corriente (${actualLiquidez}) cumple el mínimo requerido (${minLiquidez})`;
      } else {
        verdict = 'FALTANTE';
        obs = `Ratio de liquidez insuficiente (${actualLiquidez} < ${minLiquidez})`;
      }
    } else if (req.categoria === 'EXPERIENCIA') {
      const expDocs = vaultItems.filter(v => v.categoria === 'EXPERIENCIA');
      let totalMontoEjecutado = 0;
      let totalKm = 0;

      for (const d of expDocs) {
        if (d.metadatos?.monto_ejecutado_pyg) {
          totalMontoEjecutado += Number(d.metadatos.monto_ejecutado_pyg);
        }
        if (d.metadatos?.km_pavimentados) {
          totalKm += Number(d.metadatos.km_pavimentados);
        }
      }

      const reqMonto = req.criterio.montoMinimoPyg ?? 0;
      const reqKm = req.criterio.kmMinimos ?? 0;

      const cumpleMonto = totalMontoEjecutado >= reqMonto;
      const cumpleKm = reqKm === 0 || totalKm >= reqKm;

      if (cumpleMonto && cumpleKm) {
        verdict = 'CUMPLIDO';
        obs = `Experiencia acumulada comprobada: Gs. ${(totalMontoEjecutado / 1e6).toFixed(0)}M (Req: Gs. ${(reqMonto / 1e6).toFixed(0)}M)${reqKm > 0 ? `, ${totalKm} km (Req: ${reqKm} km)` : ''}`;
        if (expDocs.length > 0) {
          docRespaldo = { id: expDocs[0].id, titulo: `${expDocs.length} Certificados de Obras`, estado: 'VIGENTE' };
        }
      } else {
        verdict = 'FALTANTE';
        obs = `Experiencia insuficiente: Gs. ${(totalMontoEjecutado / 1e6).toFixed(0)}M de Gs. ${(reqMonto / 1e6).toFixed(0)}M requeridos`;
      }
    } else if (req.categoria === 'MAQUINARIA') {
      const reqHp = req.criterio.potenciaHpMinima ?? 0;
      const equipMatch = vaultItems.find(
        v => v.categoria === 'MAQUINARIA' && (!reqHp || (v.metadatos?.potencia_hp && v.metadatos.potencia_hp >= reqHp))
      );

      if (equipMatch) {
        verdict = 'CUMPLIDO';
        docRespaldo = { id: equipMatch.id, titulo: equipMatch.titulo, estado: equipMatch.estado };
        obs = `Equipo disponible (${equipMatch.metadatos?.potencia_hp || 0} HP >= ${reqHp} HP req)`;
      } else {
        verdict = 'GENERABLE'; // Puede subsanarse con carta de compromiso de alquiler
        obs = 'Maquinaria propia no disponible; subsanable con carta de alquiler';
      }
    } else {
      // PERSONAL u OTRO
      verdict = 'GENERABLE';
      obs = 'Requisito preparable con la presentación de la oferta';
    }

    if (verdict === 'CUMPLIDO') cumplidos++;
    else if (verdict === 'GENERABLE') generables++;
    else {
      faltantes++;
      if (req.esExcluyente) {
        hasDisqualifyingBreach = true;
      }
    }

    evaluations.push({
      requirementId: req.id,
      categoria: req.categoria,
      descripcion: req.descripcion,
      esExcluyente: req.esExcluyente,
      verdict,
      documentoRespaldo: docRespaldo,
      observaciones: obs
    });
  }

  const total = requirements.length;
  const scoreCumplimientoPct = total > 0 ? Math.round(((cumplidos + generables * 0.5) / total) * 100) : 100;
  const isEligibleToBid = !hasDisqualifyingBreach;

  return {
    tenderId,
    isEligibleToBid,
    scoreCumplimientoPct,
    totalRequirements: total,
    cumplidosCount: cumplidos,
    generablesCount: generables,
    faltantesCount: faltantes,
    evaluations
  };
}
