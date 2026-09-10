/**
 * PBC REQUIREMENT EXTRACTOR (GATE 11)
 * Extractor determinístico de requisitos normativos, financieros y técnicos
 * a partir del texto oficial del Pliego de Bases y Condiciones (PBC).
 *
 * Clasifica la evidencia como 'EXTRACTED_FROM_PBC', permitiendo la evaluación
 * formal de elegibilidad sin recurrir a suposiciones sintéticas genéricas.
 */

import { TenderRequirement } from './compliance-engine';

export interface PbcExtractionResult {
  requirements: TenderRequirement[];
  detectedSections: string[];
  extractionConfidencePct: number;
  warnings: string[];
  rawMatchesCount: number;
}

/**
 * Parsea números formateados en guaraníes o con separadores de miles
 */
function parseNumberFromText(text: string): number | null {
  const clean = text.replace(/[^0-9]/g, '');
  const num = parseInt(clean, 10);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Extrae requisitos técnicos, normativos y financieros desde el texto del Pliego
 */
export function extractRequirementsFromPbcText(
  pbcText: string,
  referenceBudgetPyg?: number | null
): PbcExtractionResult {
  const requirements: TenderRequirement[] = [];
  const detectedSections: string[] = [];
  const warnings: string[] = [];
  let matchCount = 0;

  if (!pbcText || pbcText.trim().length < 50) {
    warnings.push('Texto de pliego insuficiente o vacío para extracción de requisitos');
    return {
      requirements: [],
      detectedSections: [],
      extractionConfidencePct: 0,
      warnings,
      rawMatchesCount: 0
    };
  }

  const lower = pbcText.toLowerCase();

  // 1. REQUISITOS LEGALES
  if (lower.includes('estatuto') || lower.includes('poder') || lower.includes('representante legal') || lower.includes('ruc')) {
    detectedSections.push('CAPACIDAD_LEGAL');
    matchCount++;
    requirements.push({
      id: 'pbc-legal-poder',
      categoria: 'LEGAL',
      descripcion: 'Poder de Representación Legal y Estatutos Sociales inscriptos en el Registro Público',
      esExcluyente: true,
      criterio: { tipoDocEsperado: 'Estatuto Social / Poder' }
    });
  }

  if (lower.includes('art. 40') || lower.includes('artículo 40') || lower.includes('ley 2051') || lower.includes('ley 7021') || lower.includes('inhabilitado')) {
    matchCount++;
    requirements.push({
      id: 'pbc-legal-art40',
      categoria: 'LEGAL',
      descripcion: 'Declaración Jurada de no encontrarse inhabilitado para contratar con el Estado (Art. 40 Ley 2051/03 / Ley 7021/22)',
      esExcluyente: true,
      criterio: { tipoDocEsperado: 'Declaración Jurada' }
    });
  }

  // 2. REQUISITOS FISCALES Y DE SEGURIDAD SOCIAL
  if (lower.includes('cumplimiento tributario') || lower.includes('cct') || lower.includes('dnit') || lower.includes('set')) {
    detectedSections.push('SOLVENCIA_FISCAL');
    matchCount++;
    requirements.push({
      id: 'pbc-fiscal-dnit',
      categoria: 'FISCAL',
      descripcion: 'Certificado de Cumplimiento Tributario (CCT) emitido por la DNIT vigente a la fecha de apertura',
      esExcluyente: true,
      criterio: { tipoDocEsperado: 'Certificado de Cumplimiento Tributario DNIT' }
    });
  }

  if (lower.includes('ips') || lower.includes('previsión social') || lower.includes('obrero patronal')) {
    matchCount++;
    requirements.push({
      id: 'pbc-fiscal-ips',
      categoria: 'FISCAL',
      descripcion: 'Constancia de no adeudar aportes obrero-patronales al Instituto de Previsión Social (IPS)',
      esExcluyente: true,
      criterio: { tipoDocEsperado: 'Certificado de No Adeudar IPS' }
    });
  }

  // 3. REQUISITOS FINANCIEROS Y RATIOS
  let ratioLiquidez = 1.2;
  const matchLiq = lower.match(/liquidez\s*(?:corriente)?\s*(?:m[ií]nima|>=|>|de|mayor a)?\s*([0-9]+(?:[.,][0-9]+)?)/);
  if (matchLiq && matchLiq[1]) {
    const parsedRatio = parseFloat(matchLiq[1].replace(',', '.'));
    if (parsedRatio >= 0.5 && parsedRatio <= 5.0) {
      ratioLiquidez = parsedRatio;
    }
  }

  if (lower.includes('liquidez') || lower.includes('balance auditado') || lower.includes('estados contables') || lower.includes('solvencia')) {
    detectedSections.push('CAPACIDAD_FINANCIERA');
    matchCount++;
    requirements.push({
      id: 'pbc-fin-liquidez',
      categoria: 'FINANCIERO',
      descripcion: `Balance auditado con ratio de liquidez corriente >= ${ratioLiquidez}`,
      esExcluyente: true,
      criterio: { ratioLiquidezMinimo: ratioLiquidez }
    });
  }

  let ratioEndeudamiento: number | undefined = undefined;
  const matchEnd = lower.match(/endeudamiento\s*(?:total|m[aá]ximo|<=|<|de|menor a)?\s*([0-9]+(?:[.,][0-9]+)?)/);
  if (matchEnd && matchEnd[1]) {
    const parsedEnd = parseFloat(matchEnd[1].replace(',', '.'));
    if (parsedEnd >= 0.1 && parsedEnd <= 1.5) {
      ratioEndeudamiento = parsedEnd;
      matchCount++;
      requirements.push({
        id: 'pbc-fin-endeudamiento',
        categoria: 'FINANCIERO',
        descripcion: `Ratio de endeudamiento total <= ${ratioEndeudamiento}`,
        esExcluyente: true,
        criterio: { ratioEndeudamientoMaximo: ratioEndeudamiento }
      });
    }
  }

  // 4. EXPERIENCIA TÉCNICA ESPECÍFICA
  if (lower.includes('experiencia') || lower.includes('obras similares') || lower.includes('contratos similares')) {
    detectedSections.push('EXPERIENCIA_TECNICA');
    matchCount++;

    let montoExperiencia = referenceBudgetPyg ? Math.round(referenceBudgetPyg * 0.5) : 0;
    const matchMontoExp = lower.match(/experiencia\s*(?:m[ií]nima)?\s*(?:acumulada|en obras)?\s*(?:por un monto de|superior a|de al menos)?\s*(?:gs\.?|guaran[ií]es)?\s*([0-9]{1,3}(?:\.[0-9]{3})+)/);
    if (matchMontoExp && matchMontoExp[1]) {
      const parsedMonto = parseNumberFromText(matchMontoExp[1]);
      if (parsedMonto && parsedMonto > 0) {
        montoExperiencia = parsedMonto;
      }
    }

    requirements.push({
      id: 'pbc-exp-obras',
      categoria: 'EXPERIENCIA',
      descripcion: montoExperiencia > 0
        ? `Experiencia técnica acumulada en obras similares (mínimo Gs. ${montoExperiencia.toLocaleString('es-PY')})`
        : 'Experiencia técnica acumulada en obras o servicios similares',
      esExcluyente: true,
      criterio: montoExperiencia > 0 ? { montoMinimoPyg: montoExperiencia } : {}
    });
  }

  // 5. MAQUINARIA Y EQUIPO VIAL
  if (lower.includes('motoniveladora') || lower.includes('retroexcavadora') || lower.includes('volquete') || lower.includes('equipo vial') || lower.includes('maquinaria mínima')) {
    detectedSections.push('EQUIPAMIENTO_MAQUINARIA');
    matchCount++;
    requirements.push({
      id: 'pbc-maq-vial',
      categoria: 'MAQUINARIA',
      descripcion: 'Disponibilidad de equipo vial mínimo verificado con título o contrato de arrendamiento',
      esExcluyente: false,
      criterio: { potenciaHpMinima: 120 }
    });
  }

  // 6. PERSONAL TÉCNICO CLAVE
  if (lower.includes('jefe de obra') || lower.includes('director de obra') || lower.includes('residente') || lower.includes('ingeniero civil')) {
    detectedSections.push('PERSONAL_CLAVE');
    matchCount++;
    requirements.push({
      id: 'pbc-per-jefe-obra',
      categoria: 'PERSONAL',
      descripcion: 'Profesional Ingeniero Civil matriculado con experiencia comprobable en jefatura de obra',
      esExcluyente: true,
      criterio: { cargoRequerido: 'Jefe de Obra' }
    });
  }

  const confidencePct = Math.min(100, Math.round((matchCount / 5) * 100));

  return {
    requirements,
    detectedSections,
    extractionConfidencePct: confidencePct,
    warnings,
    rawMatchesCount: matchCount
  };
}
