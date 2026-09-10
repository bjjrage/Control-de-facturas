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

export type ComplianceVerdict = 'CUMPLIDO' | 'GENERABLE' | 'FALTANTE' | 'REVIEW_REQUIRED';

export type RequirementExtractionState =
  | 'REQUIREMENT_DETECTED'
  | 'CRITERION_EXTRACTED'
  | 'CRITERION_UNKNOWN'
  | 'REVIEW_REQUIRED';

export interface TenderRequirement {
  id: string;
  categoria: 'LEGAL' | 'FISCAL' | 'FINANCIERO' | 'EXPERIENCIA' | 'PERSONAL' | 'MAQUINARIA';
  descripcion: string;
  esExcluyente: boolean;
  extractionState?: RequirementExtractionState;
  sourceEvidence?: {
    snippet: string;
    sectionLocator?: string;
    confidencePct: number;
    provenance: string;
  };
  permiteAlquilerOCompromiso?: boolean;
  permiteNominacionPosterior?: boolean;
  criterio: {
    tipoDocEsperado?: string;
    montoMinimoPyg?: number;
    kmMinimos?: number;
    aniosExperienciaMinimos?: number;
    potenciaHpMinima?: number;
    ratioLiquidezMinimo?: number;
    ratioEndeudamientoMaximo?: number;
    cargoRequerido?: string;
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
  isEligibleToBid: boolean; // True solo si los requisitos provienen de PBC/adenda real extraída, array > 0, y 100% de los excluyentes son CUMPLIDO o GENERABLE
  evidenceOrigin: 'EXTRACTED_FROM_PBC' | 'GENERIC_REQUIREMENT_SUGGESTIONS' | 'MANUAL_ENTRY';
  scoreCumplimientoPct: number;
  totalRequirements: number;
  cumplidosCount: number;
  generablesCount: number;
  faltantesCount: number;
  reviewRequiredCount: number;
  evaluations: RequirementEvaluation[];
}

function matchesDocType(vaultItem: VaultItem, expectedDocType?: string): boolean {
  if (!expectedDocType) return true;
  const docType = vaultItem.tipoDocumento.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const expType = expectedDocType.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const title = (vaultItem.titulo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (vaultItem.tipoDocumento === expectedDocType) return true;
  if (docType.includes(expType) || expType.includes(docType)) return true;
  if (title.includes(expType) || expType.includes(title)) return true;

  // Semantic mappings
  if ((docType.includes('DNIT') || docType.includes('CCT')) && (expType.includes('DNIT') || expType.includes('CCT') || expType.includes('TRIBUTARIO'))) return true;
  if (docType.includes('IPS') && expType.includes('IPS')) return true;
  if ((docType.includes('ESTATUTO') || docType.includes('PODER')) && (expType.includes('ESTATUTO') || expType.includes('PODER'))) return true;
  if (docType.includes('DECLARACION') && (expType.includes('DECLARACION') || expType.includes('ART40'))) return true;

  return false;
}

/**
 * Evalúa la matriz de cumplimiento de una licitación contra los activos y documentos de la empresa.
 * FAIL-CLOSED:
 * - evidenceOrigin DEBE ser explícito (no se asume EXTRACTED_FROM_PBC por defecto).
 * - Un array vacío de requerimientos NUNCA confiere 100% de cumplimiento ni isEligibleToBid=true.
 * - Criterios desconocidos ('CRITERION_UNKNOWN' o 'REVIEW_REQUIRED') resultan en 'REVIEW_REQUIRED' y bloquean elegibilidad si son excluyentes.
 * - No se inventan umbrales de liquidez, experiencia o potencia de maquinaria.
 * - Maquinaria y personal solo son 'GENERABLE' si el pliego explícitamente autoriza alquiler/compromiso.
 */
export function evaluateTenderCompliance(
  tenderId: string,
  requirements: TenderRequirement[],
  vaultItems: VaultItem[],
  financialMetrics: {
    liquidezCorriente?: number;
    endeudamientoTotal?: number;
    capitalTrabajoPyg?: number;
  } | undefined,
  evidenceOrigin: TenderComplianceReport['evidenceOrigin']
): TenderComplianceReport {
  // P0 INVARIANTE: Un pliego sin requisitos analizados NUNCA produce 100% ni habilita para ofertar
  if (!requirements || requirements.length === 0) {
    return {
      tenderId,
      isEligibleToBid: false,
      evidenceOrigin,
      scoreCumplimientoPct: 0,
      totalRequirements: 0,
      cumplidosCount: 0,
      generablesCount: 0,
      faltantesCount: 0,
      reviewRequiredCount: 0,
      evaluations: []
    };
  }

  const evaluations: RequirementEvaluation[] = [];
  let cumplidos = 0;
  let generables = 0;
  let faltantes = 0;
  let reviewRequired = 0;
  let hasDisqualifyingBreach = false;

  for (const req of requirements) {
    let verdict: ComplianceVerdict = 'FALTANTE';
    let docRespaldo: RequirementEvaluation['documentoRespaldo'] = undefined;
    let obs = '';

    // Si el extractor no pudo determinar el criterio cuantitativo o exige revisión
    if (req.extractionState === 'CRITERION_UNKNOWN' || req.extractionState === 'REVIEW_REQUIRED') {
      verdict = 'REVIEW_REQUIRED';
      obs = `Requisito detectado en pliego pero criterio no extraído con certeza: ${req.descripcion}`;
    } else if (req.categoria === 'LEGAL') {
      const match = vaultItems.find(
        v => v.categoria === 'LEGAL' && matchesDocType(v, req.criterio.tipoDocEsperado)
      );
      if (match && match.estado === 'VIGENTE' && match.id) {
        verdict = 'CUMPLIDO';
        docRespaldo = { id: match.id, titulo: match.titulo, estado: match.estado };
        obs = 'Documento legal vigente en bóveda';
      } else {
        verdict = req.esExcluyente ? 'FALTANTE' : 'GENERABLE';
        obs = match ? `Documento en estado ${match.estado}` : 'Documento legal ausente en bóveda';
      }
    } else if (req.categoria === 'FISCAL') {
      const match = vaultItems.find(
        v => v.categoria === 'FISCAL' && matchesDocType(v, req.criterio.tipoDocEsperado)
      );
      if (match && match.estado === 'VIGENTE' && match.id) {
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
      if (req.criterio.ratioEndeudamientoMaximo !== undefined) {
        const maxEndeudamiento = req.criterio.ratioEndeudamientoMaximo;
        const actualEndeudamiento = financialMetrics?.endeudamientoTotal;
        if (actualEndeudamiento !== undefined && actualEndeudamiento > 0 && actualEndeudamiento <= maxEndeudamiento) {
          verdict = 'CUMPLIDO';
          obs = `Ratio de endeudamiento total (${actualEndeudamiento}) dentro del límite máximo (${maxEndeudamiento})`;
        } else if (actualEndeudamiento === undefined || actualEndeudamiento === null) {
          verdict = 'FALTANTE';
          obs = `Ratio de endeudamiento de la empresa no determinado en balances contables`;
        } else {
          verdict = 'FALTANTE';
          obs = `Ratio de endeudamiento excesivo (${actualEndeudamiento} > ${maxEndeudamiento})`;
        }
      } else if (req.criterio.ratioLiquidezMinimo !== undefined) {
        const minLiquidez = req.criterio.ratioLiquidezMinimo;
        const actualLiquidez = financialMetrics?.liquidezCorriente;
        if (actualLiquidez !== undefined && actualLiquidez >= minLiquidez) {
          verdict = 'CUMPLIDO';
          obs = `Ratio de liquidez corriente (${actualLiquidez}) cumple el mínimo requerido (${minLiquidez})`;
        } else if (actualLiquidez === undefined || actualLiquidez === null) {
          verdict = 'FALTANTE';
          obs = `Ratio de liquidez no determinado en balances contables`;
        } else {
          verdict = 'FALTANTE';
          obs = `Ratio de liquidez insuficiente (${actualLiquidez} < ${minLiquidez})`;
        }
      } else {
        verdict = 'REVIEW_REQUIRED';
        obs = 'Requisito financiero sin ratio cuantitativo verificado; revisión requerida';
      }
    } else if (req.categoria === 'EXPERIENCIA') {
      const reqMonto = req.criterio.montoMinimoPyg;
      const reqKm = req.criterio.kmMinimos;

      if (reqMonto === undefined && reqKm === undefined) {
        verdict = 'REVIEW_REQUIRED';
        obs = 'Requisito de experiencia sin umbral numérico extraíble del pliego; revisión manual requerida';
      } else {
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

        const cumpleMonto = reqMonto === undefined || totalMontoEjecutado >= reqMonto;
        const cumpleKm = reqKm === undefined || totalKm >= reqKm;

        if (cumpleMonto && cumpleKm) {
          verdict = 'CUMPLIDO';
          obs = `Experiencia acumulada comprobada: Gs. ${(totalMontoEjecutado / 1e6).toFixed(0)}M${reqMonto ? ` (Req: Gs. ${(reqMonto / 1e6).toFixed(0)}M)` : ''}${reqKm ? `, ${totalKm} km (Req: ${reqKm} km)` : ''}`;
          if (expDocs.length > 0) {
            docRespaldo = { id: expDocs[0].id, titulo: `${expDocs.length} Certificados de Obras`, estado: 'VIGENTE' };
          }
        } else {
          verdict = 'FALTANTE';
          obs = `Experiencia insuficiente: Gs. ${(totalMontoEjecutado / 1e6).toFixed(0)}M acumulados`;
        }
      }
    } else if (req.categoria === 'MAQUINARIA') {
      const reqHp = req.criterio.potenciaHpMinima;
      const equipMatch = vaultItems.find(
        v => v.categoria === 'MAQUINARIA' && (!reqHp || (v.metadatos?.potencia_hp && v.metadatos.potencia_hp >= reqHp))
      );

      if (equipMatch) {
        verdict = 'CUMPLIDO';
        docRespaldo = { id: equipMatch.id, titulo: equipMatch.titulo, estado: equipMatch.estado };
        obs = `Equipo disponible (${equipMatch.metadatos?.potencia_hp || 0} HP${reqHp ? ` >= ${reqHp} HP req` : ''})`;
      } else if (req.permiteAlquilerOCompromiso === true) {
        verdict = 'GENERABLE';
        obs = 'Maquinaria no propia disponible vía carta de compromiso de alquiler autorizada por el pliego';
      } else {
        verdict = 'FALTANTE';
        obs = 'Maquinaria no disponible en inventario propio y el pliego no autoriza compromiso de alquiler';
      }
    } else if (req.categoria === 'PERSONAL') {
      const match = vaultItems.find(
        v => v.categoria === 'PERSONAL' && (!req.criterio.cargoRequerido || matchesDocType(v, req.criterio.cargoRequerido) || (v.metadatos?.cargo && String(v.metadatos.cargo).toLowerCase().includes(req.criterio.cargoRequerido.toLowerCase())))
      );
      if (match && match.estado === 'VIGENTE') {
        verdict = 'CUMPLIDO';
        docRespaldo = { id: match.id, titulo: match.titulo, estado: match.estado };
        obs = `Personal técnico clave verificado: ${match.titulo}`;
      } else if (req.permiteNominacionPosterior === true) {
        verdict = 'GENERABLE';
        obs = 'Personal clave a nominar formalmente mediante carta de compromiso autorizada por el pliego';
      } else {
        verdict = 'FALTANTE';
        obs = 'Personal técnico clave no registrado en la empresa y el pliego exige legajo previo';
      }
    } else {
      verdict = 'REVIEW_REQUIRED';
      obs = 'Requisito no categorizado; requiere revisión manual';
    }

    if (verdict === 'CUMPLIDO') {
      cumplidos++;
    } else if (verdict === 'GENERABLE') {
      generables++;
    } else if (verdict === 'REVIEW_REQUIRED') {
      reviewRequired++;
      if (req.esExcluyente) {
        hasDisqualifyingBreach = true;
      }
    } else {
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
  const scoreCumplimientoPct = total > 0 ? Math.round(((cumplidos + generables * 0.5) / total) * 100) : 0;

  // Si la evidencia proviene solo de sugerencias heurísticas genéricas o hay faltantes/review excluyentes, NO se puede declarar habilitado
  const isEligibleToBid = evidenceOrigin === 'EXTRACTED_FROM_PBC' && !hasDisqualifyingBreach && total > 0;

  return {
    tenderId,
    isEligibleToBid,
    evidenceOrigin,
    scoreCumplimientoPct,
    totalRequirements: total,
    cumplidosCount: cumplidos,
    generablesCount: generables,
    faltantesCount: faltantes,
    reviewRequiredCount: reviewRequired,
    evaluations
  };
}

/**
 * Genera sugerencias genéricas de requisitos previas al análisis del PBC oficial.
 * NO constituye extracción de pliego ni debe habilitar ofertas automáticamente.
 */
export function generateGenericRequirementSuggestions(tender: {
  id: string;
  categoria?: string | null;
  procurement_method?: string | null;
  monto_referencial?: number | null;
}): TenderRequirement[] {
  const reqs: TenderRequirement[] = [
    {
      id: 'sug-ruc-legal',
      categoria: 'LEGAL',
      descripcion: 'RUC activo, Cédula de Identidad de Representante Legal y Estatutos Sociales (Sugerido estándar)',
      esExcluyente: true,
      criterio: { tipoDocEsperado: 'Estatuto Social / Poder' }
    },
    {
      id: 'sug-dnit-cct',
      categoria: 'FISCAL',
      descripcion: 'Certificado de Cumplimiento Tributario (CCT) emitido por la DNIT vigente (Sugerido estándar)',
      esExcluyente: true,
      criterio: { tipoDocEsperado: 'Certificado de Cumplimiento Tributario DNIT' }
    },
    {
      id: 'sug-ips-social',
      categoria: 'FISCAL',
      descripcion: 'Constancia de no adeudar aportes obrero-patronales al IPS (Sugerido estándar)',
      esExcluyente: true,
      criterio: { tipoDocEsperado: 'Certificado de No Adeudar IPS' }
    }
  ];

  const ref = Number(tender.monto_referencial || 0);

  if (ref > 1000000000 || tender.procurement_method === 'open') {
    reqs.push({
      id: 'sug-cap-financiera',
      categoria: 'FINANCIERO',
      descripcion: 'Balance auditado con ratio de liquidez corriente >= 1.2 y solvencia patrimonial (Sugerido LPN)',
      esExcluyente: true,
      criterio: { ratioLiquidezMinimo: 1.2 }
    });
  }

  const cat = (tender.categoria || '').toLowerCase();
  if (cat.includes('work') || cat.includes('obra') || cat.includes('construc')) {
    reqs.push({
      id: 'sug-exp-obras',
      categoria: 'EXPERIENCIA',
      descripcion: `Experiencia técnica acumulada en obras similares (Sugerido obras)`,
      esExcluyente: true,
      criterio: { montoMinimoPyg: Math.round(ref * 0.50) }
    });

    reqs.push({
      id: 'sug-maquinaria-minima',
      categoria: 'MAQUINARIA',
      descripcion: 'Disponibilidad de equipo vial mínimo (Sugerido obras)',
      esExcluyente: false,
      criterio: { potenciaHpMinima: 120 }
    });
  }

  return reqs;
}

// Retrocompatibilidad deprecada
export const extractRequirementsFromTender = generateGenericRequirementSuggestions;
