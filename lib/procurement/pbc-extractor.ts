/**
 * PBC REQUIREMENT EXTRACTOR (GATE 11)
 * Extractor determinístico de requisitos normativos, financieros y técnicos
 * a partir del texto oficial del Pliego de Bases y Condiciones (PBC).
 *
 * Clasifica la evidencia como 'EXTRACTED_FROM_PBC', distinguiendo:
 * - REQUIREMENT_DETECTED
 * - CRITERION_EXTRACTED
 * - CRITERION_UNKNOWN
 * - REVIEW_REQUIRED
 *
 * P0 INVARIANTE: NUNCA inventa ratios de liquidez (ej. 1.2), porcentaje de experiencia
 * (ej. 50% de referencial), ni potencia de maquinaria (ej. 120 HP) si no están en el texto.
 */

import { TenderRequirement, RequirementExtractionState } from './compliance-engine';

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
 * Extrae un snippet de texto preservando el contexto alrededor del término detectado
 */
function extractSnippet(text: string, index: number, radius = 100): string {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + radius);
  return text.substring(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Verifica si el contexto del requisito en el PBC contiene lenguaje explícito de exclusión, rechazo o descalificación obligatoria
 */
function checkExclusionaryLanguage(snippetOrContext: string): boolean {
  const s = snippetOrContext.toLowerCase();
  return (
    s.includes('excluyente') ||
    s.includes('descalific') ||
    s.includes('obligatorio') ||
    s.includes('causal de rechazo') ||
    s.includes('requisito sustancial') ||
    s.includes('condicion sustancial') ||
    s.includes('so pena de rechazo') ||
    s.includes('bajo apercibimiento de rechazo') ||
    s.includes('deberá presentar') ||
    s.includes('debera presentar') ||
    s.includes('debe presentar') ||
    s.includes('deberá acreditar') ||
    s.includes('debera acreditar') ||
    s.includes('debe acreditar') ||
    s.includes('deberá contar') ||
    s.includes('debera contar') ||
    s.includes('debe contar') ||
    s.includes('sera rechazad') ||
    s.includes('será rechazad')
  );
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

  // Detección de permisos explícitos del pliego para mecanismos sustitutos
  const permiteAlquiler = lower.includes('arrendamiento') || lower.includes('alquiler') || lower.includes('carta de compromiso de disponibilidad');
  const permiteNominacionPosterior = lower.includes('carta de compromiso de prestar servicios') || lower.includes('compromiso de prestacion') || lower.includes('a contratar');

  // 1. REQUISITOS LEGALES
  // CONSERVATISMO PBC: Mención de RUC NO implica requerir "Poder + Estatutos".
  // Requiere mención explícita de estatuto, poder de representación, personería o representante legal.
  const idxPoder = lower.indexOf('estatuto') >= 0
    ? lower.indexOf('estatuto')
    : lower.indexOf('representante legal') >= 0
      ? lower.indexOf('representante legal')
      : lower.indexOf('poder de representacion') >= 0
        ? lower.indexOf('poder de representacion')
        : lower.indexOf('poder especial') >= 0
          ? lower.indexOf('poder especial')
          : lower.indexOf('poder general');

  if (idxPoder >= 0) {
    const snippet = extractSnippet(pbcText, idxPoder);
    const isExcluyente = checkExclusionaryLanguage(snippet) || lower.includes('capacidad legal');
    detectedSections.push('CAPACIDAD_LEGAL');
    matchCount++;
    requirements.push({
      id: 'pbc-legal-poder',
      categoria: 'LEGAL',
      descripcion: 'Poder de Representación Legal y Estatutos Sociales inscriptos en el Registro Público',
      esExcluyente: isExcluyente,
      extractionState: isExcluyente ? 'CRITERION_EXTRACTED' : 'REQUIREMENT_DETECTED',
      sourceEvidence: {
        snippet,
        sectionLocator: 'CAPACIDAD_LEGAL',
        confidencePct: isExcluyente ? 95 : 70,
        provenance: 'PBC_TEXT_PARSER'
      },
      criterio: { tipoDocEsperado: 'Estatuto Social / Poder' }
    });
  }

  const idxArt40 = lower.indexOf('art. 40') >= 0
    ? lower.indexOf('art. 40')
    : lower.indexOf('inhabilitado') >= 0
      ? lower.indexOf('inhabilitado')
      : lower.indexOf('artículo 40') >= 0
        ? lower.indexOf('artículo 40')
        : -1;

  if (idxArt40 >= 0 || (lower.includes('ley 2051') && lower.includes('inhab')) || (lower.includes('ley 7021') && lower.includes('inhab'))) {
    const matchIdx = idxArt40 >= 0 ? idxArt40 : lower.indexOf('ley');
    const snippet = extractSnippet(pbcText, matchIdx);
    const isExcluyente = checkExclusionaryLanguage(snippet) || snippet.toLowerCase().includes('inhabilitad');
    matchCount++;
    requirements.push({
      id: 'pbc-legal-art40',
      categoria: 'LEGAL',
      descripcion: 'Declaración Jurada de no encontrarse inhabilitado para contratar con el Estado (Art. 40 Ley 2051/03 / Ley 7021/22)',
      esExcluyente: isExcluyente,
      extractionState: isExcluyente ? 'CRITERION_EXTRACTED' : 'REQUIREMENT_DETECTED',
      sourceEvidence: {
        snippet,
        sectionLocator: 'CAPACIDAD_LEGAL',
        confidencePct: isExcluyente ? 98 : 75,
        provenance: 'PBC_TEXT_PARSER'
      },
      criterio: { tipoDocEsperado: 'Declaración Jurada' }
    });
  }

  // 2. REQUISITOS FISCALES Y DE SEGURIDAD SOCIAL
  const idxDnit = lower.indexOf('cumplimiento tributario') >= 0
    ? lower.indexOf('cumplimiento tributario')
    : lower.indexOf('cct') >= 0
      ? lower.indexOf('cct')
      : lower.indexOf('tributario') >= 0
        ? lower.indexOf('tributario')
        : -1;

  if (idxDnit >= 0) {
    const snippet = extractSnippet(pbcText, idxDnit);
    const isExcluyente = checkExclusionaryLanguage(snippet) || snippet.toLowerCase().includes('cumplimiento');
    detectedSections.push('SOLVENCIA_FISCAL');
    matchCount++;
    requirements.push({
      id: 'pbc-fiscal-dnit',
      categoria: 'FISCAL',
      descripcion: 'Certificado de Cumplimiento Tributario (CCT) emitido por la DNIT vigente a la fecha de apertura',
      esExcluyente: isExcluyente,
      extractionState: isExcluyente ? 'CRITERION_EXTRACTED' : 'REQUIREMENT_DETECTED',
      sourceEvidence: {
        snippet,
        sectionLocator: 'SOLVENCIA_FISCAL',
        confidencePct: isExcluyente ? 98 : 75,
        provenance: 'PBC_TEXT_PARSER'
      },
      criterio: { tipoDocEsperado: 'Certificado de Cumplimiento Tributario DNIT' }
    });
  }

  const idxIps = lower.indexOf('ips') >= 0
    ? lower.indexOf('ips')
    : lower.indexOf('previsión social') >= 0
      ? lower.indexOf('previsión social')
      : lower.indexOf('obrero patronal') >= 0
        ? lower.indexOf('obrero patronal')
        : -1;

  if (idxIps >= 0) {
    const snippet = extractSnippet(pbcText, idxIps);
    const isExcluyente = checkExclusionaryLanguage(snippet) || snippet.toLowerCase().includes('no adeudar');
    matchCount++;
    requirements.push({
      id: 'pbc-fiscal-ips',
      categoria: 'FISCAL',
      descripcion: 'Constancia de no adeudar aportes obrero-patronales al Instituto de Previsión Social (IPS)',
      esExcluyente: isExcluyente,
      extractionState: isExcluyente ? 'CRITERION_EXTRACTED' : 'REQUIREMENT_DETECTED',
      sourceEvidence: {
        snippet,
        sectionLocator: 'SOLVENCIA_FISCAL',
        confidencePct: isExcluyente ? 95 : 70,
        provenance: 'PBC_TEXT_PARSER'
      },
      criterio: { tipoDocEsperado: 'Certificado de No Adeudar IPS' }
    });
  }

  // 3. REQUISITOS FINANCIEROS Y RATIOS (P0: CERO SUPUESTOS SINTÉTICOS)
  const idxFin = lower.indexOf('liquidez') >= 0 ? lower.indexOf('liquidez') : lower.indexOf('balance auditado');
  if (idxFin >= 0 || lower.includes('estados contables') || lower.includes('solvencia')) {
    const matchIdx = idxFin >= 0 ? idxFin : lower.indexOf('estados contables');
    const snippetFin = extractSnippet(pbcText, matchIdx);
    const esExcluyenteFin = checkExclusionaryLanguage(snippetFin) || lower.includes('solvencia financiera obligatoria');

    detectedSections.push('CAPACIDAD_FINANCIERA');
    matchCount++;

    // Busca ratio numérico dentro de la cláusula de liquidez
    const matchLiq = lower.match(/liquidez[^\n.]{0,90}?(?:>=|>|de|alcanzar|m[ií]nima|superior a|ser[aá]\s+(?:mayor\s+o\s+igual\s+a\s+)?)\s*([0-9]+(?:[.,][0-9]+)?)/);
    let ratioLiquidez: number | undefined = undefined;
    let extractionStateLiq: RequirementExtractionState = 'CRITERION_UNKNOWN';

    if (matchLiq && matchLiq[1]) {
      const parsed = parseFloat(matchLiq[1].replace(',', '.'));
      if (parsed >= 0.5 && parsed <= 5.0) {
        ratioLiquidez = parsed;
        extractionStateLiq = 'CRITERION_EXTRACTED';
      }
    }

    requirements.push({
      id: 'pbc-fin-liquidez',
      categoria: 'FINANCIERO',
      descripcion: ratioLiquidez !== undefined
        ? `Balance auditado con ratio de liquidez corriente >= ${ratioLiquidez}`
        : 'Balance auditado y solvencia financiera (ratio de liquidez mínimo no cuantificado en pliego; revisión requerida)',
      esExcluyente: esExcluyenteFin,
      extractionState: ratioLiquidez !== undefined
        ? (esExcluyenteFin ? 'CRITERION_EXTRACTED' : 'REQUIREMENT_DETECTED')
        : (esExcluyenteFin ? 'CRITERION_UNKNOWN' : 'REQUIREMENT_DETECTED'),
      sourceEvidence: {
        snippet: snippetFin,
        sectionLocator: 'CAPACIDAD_FINANCIERA',
        confidencePct: ratioLiquidez !== undefined ? 90 : 50,
        provenance: 'PBC_TEXT_PARSER'
      },
      criterio: ratioLiquidez !== undefined ? { ratioLiquidezMinimo: ratioLiquidez } : {}
    });
  }

  const idxEnd = lower.indexOf('endeudamiento');
  if (idxEnd >= 0) {
    const snippetEnd = extractSnippet(pbcText, idxEnd);
    const esExcluyenteEnd = checkExclusionaryLanguage(snippetEnd);
    const matchEnd = lower.match(/endeudamiento[^\n.]{0,90}?(?:<=|<|no\s+superar[aá]|menor\s+a|hasta|admitido\s+no\s+superar[aá])\s*([0-9]+(?:[.,][0-9]+)?)/);
    let ratioEndeudamiento: number | undefined = undefined;

    if (matchEnd && matchEnd[1]) {
      const parsed = parseFloat(matchEnd[1].replace(',', '.'));
      if (parsed >= 0.1 && parsed <= 1.5) {
        ratioEndeudamiento = parsed;
      }
    }

    matchCount++;
    requirements.push({
      id: 'pbc-fin-endeudamiento',
      categoria: 'FINANCIERO',
      descripcion: ratioEndeudamiento !== undefined
        ? `Ratio de endeudamiento total <= ${ratioEndeudamiento}`
        : 'Ratio de endeudamiento total (límite máximo no cuantificado en pliego; revisión requerida)',
      esExcluyente: esExcluyenteEnd,
      extractionState: ratioEndeudamiento !== undefined
        ? (esExcluyenteEnd ? 'CRITERION_EXTRACTED' : 'REQUIREMENT_DETECTED')
        : (esExcluyenteEnd ? 'CRITERION_UNKNOWN' : 'REQUIREMENT_DETECTED'),
      sourceEvidence: {
        snippet: snippetEnd,
        sectionLocator: 'CAPACIDAD_FINANCIERA',
        confidencePct: ratioEndeudamiento !== undefined ? 90 : 50,
        provenance: 'PBC_TEXT_PARSER'
      },
      criterio: ratioEndeudamiento !== undefined ? { ratioEndeudamientoMaximo: ratioEndeudamiento } : {}
    });
  }

  // 4. EXPERIENCIA TÉCNICA ESPECÍFICA (P0: CERO SUPUESTOS SINTÉTICOS COMO 50% REFERENCIAL)
  const idxExp = lower.indexOf('experiencia') >= 0 ? lower.indexOf('experiencia') : lower.indexOf('obras similares');
  if (idxExp >= 0 || lower.includes('contratos similares')) {
    const matchIdx = idxExp >= 0 ? idxExp : lower.indexOf('contratos similares');
    const snippetExp = extractSnippet(pbcText, matchIdx);
    const esExcluyenteExp = checkExclusionaryLanguage(snippetExp) || lower.includes('experiencia excluyente');

    detectedSections.push('EXPERIENCIA_TECNICA');
    matchCount++;

    const matchMonto = lower.match(/(?:al\s+menos|m[ií]nimo|superior\s+a|acumulad[ao]\s+de)\s*(?:gs\.?|guaran[ií]es)?\s*([0-9.,]+(?:\s*(?:mil|millones|mill[oó]n))?)/);
    let montoExperiencia: number | undefined = undefined;

    if (matchMonto && matchMonto[1]) {
      const parsed = parseNumberFromText(matchMonto[1]);
      if (parsed && parsed >= 10_000_000) {
        let mult = 1;
        if (matchMonto[1].includes('millon') || matchMonto[1].includes('millón') || matchMonto[1].includes('millones')) {
          mult = 1_000_000;
        }
        montoExperiencia = parsed * mult;
      }
    }

    requirements.push({
      id: 'pbc-exp-obras',
      categoria: 'EXPERIENCIA',
      descripcion: montoExperiencia !== undefined
        ? `Experiencia técnica acumulada in obras similares >= Gs. ${montoExperiencia.toLocaleString('es-PY')}`
        : 'Experiencia técnica acumulada en obras civiles o viales (monto mínimo no cuantificado en pliego; revisión requerida)',
      esExcluyente: esExcluyenteExp,
      extractionState: montoExperiencia !== undefined
        ? (esExcluyenteExp ? 'CRITERION_EXTRACTED' : 'REQUIREMENT_DETECTED')
        : (esExcluyenteExp ? 'CRITERION_UNKNOWN' : 'REQUIREMENT_DETECTED'),
      sourceEvidence: {
        snippet: snippetExp,
        sectionLocator: 'EXPERIENCIA_TECNICA',
        confidencePct: montoExperiencia !== undefined ? 85 : 40,
        provenance: 'PBC_TEXT_PARSER'
      },
      criterio: montoExperiencia !== undefined ? { montoMinimoPyg: montoExperiencia } : {}
    });
  }

  // 5. MAQUINARIA Y EQUIPO VIAL (P0: CERO SUPUESTOS SINTÉTICOS COMO 120 HP)
  const idxMaq = lower.indexOf('maquinaria') >= 0 ? lower.indexOf('maquinaria') : lower.indexOf('motoniveladora');
  if (idxMaq >= 0 || lower.includes('retroexcavadora') || lower.includes('volquete') || lower.includes('equipo vial')) {
    const matchIdx = idxMaq >= 0 ? idxMaq : (lower.indexOf('equipo vial') >= 0 ? lower.indexOf('equipo vial') : lower.indexOf('volquete'));
    const snippetMaq = extractSnippet(pbcText, matchIdx);
    const esExcluyenteMaq = checkExclusionaryLanguage(snippetMaq) || lower.includes('maquinaria excluyente') || lower.includes('descalificación por falta de equipo');

    detectedSections.push('EQUIPAMIENTO_MAQUINARIA');
    matchCount++;

    const matchHp = lower.match(/([0-9]{2,4})\s*(?:hp|cv|caballos)/);
    let potenciaHp: number | undefined = undefined;

    if (matchHp && matchHp[1]) {
      const parsedHp = parseInt(matchHp[1], 10);
      if (parsedHp >= 20 && parsedHp <= 2000) {
        potenciaHp = parsedHp;
      }
    }

    requirements.push({
      id: 'pbc-maq-vial',
      categoria: 'MAQUINARIA',
      descripcion: potenciaHp !== undefined
        ? `Disponibilidad de equipo vial mínimo con potencia >= ${potenciaHp} HP`
        : 'Disponibilidad de equipo vial mínimo verificado con título o contrato de arrendamiento',
      esExcluyente: esExcluyenteMaq,
      extractionState: potenciaHp !== undefined
        ? (esExcluyenteMaq ? 'CRITERION_EXTRACTED' : 'REQUIREMENT_DETECTED')
        : (esExcluyenteMaq ? 'CRITERION_UNKNOWN' : 'REQUIREMENT_DETECTED'),
      permiteAlquilerOCompromiso: permiteAlquiler,
      sourceEvidence: {
        snippet: snippetMaq,
        sectionLocator: 'EQUIPAMIENTO_MAQUINARIA',
        confidencePct: potenciaHp !== undefined ? 85 : 50,
        provenance: 'PBC_TEXT_PARSER'
      },
      criterio: potenciaHp !== undefined ? { potenciaHpMinima: potenciaHp } : {}
    });
  }

  // 6. PERSONAL TÉCNICO CLAVE
  // CONSERVATISMO PBC: No fabricar atributos más ricos que el texto original.
  // "Jefe de obra" solo se describe con "Ingeniero Civil" o "matriculado" si esas palabras están en el pliego.
  const idxPer = lower.indexOf('jefe de obra') >= 0
    ? lower.indexOf('jefe de obra')
    : lower.indexOf('director de obra') >= 0
      ? lower.indexOf('director de obra')
      : lower.indexOf('residente de obra') >= 0
        ? lower.indexOf('residente de obra')
        : lower.indexOf('ingeniero civil') >= 0
          ? lower.indexOf('ingeniero civil')
          : -1;

  if (idxPer >= 0) {
    const snippetPer = extractSnippet(pbcText, idxPer);
    const snipLower = snippetPer.toLowerCase();
    const esExcluyentePer = checkExclusionaryLanguage(snippetPer) || lower.includes('personal clave obligatorio');

    detectedSections.push('PERSONAL_CLAVE');
    matchCount++;

    // Construir descripción estrictamente fiel a las palabras del texto
    const mentionsIngCivil = snipLower.includes('ingeniero civil') || snipLower.includes('ing. civil');
    const mentionsMatricula = snipLower.includes('matricul') || snipLower.includes('registro profesional');
    const mentionsExp = snipLower.includes('experiencia') || snipLower.includes('años de ejercicio');

    let descPersonal = 'Designación de Jefe de Obra / Profesional Responsable';
    let cargoEsperado = 'Jefe de Obra';

    if (snipLower.includes('director de obra')) {
      cargoEsperado = 'Director de Obra';
      descPersonal = 'Designación de Director de Obra';
    } else if (snipLower.includes('residente')) {
      cargoEsperado = 'Residente de Obra';
      descPersonal = 'Designación de Residente de Obra';
    } else if (snipLower.includes('jefe de obra')) {
      cargoEsperado = 'Jefe de Obra';
      descPersonal = 'Designación de Jefe de Obra';
    }

    const qualifiers: string[] = [];
    if (mentionsIngCivil) qualifiers.push('Ingeniero Civil');
    if (mentionsMatricula) qualifiers.push('matriculado');
    if (mentionsExp) qualifiers.push('con experiencia comprobable');

    if (qualifiers.length > 0) {
      descPersonal += ` (${qualifiers.join(', ')})`;
    }

    requirements.push({
      id: 'pbc-per-jefe-obra',
      categoria: 'PERSONAL',
      descripcion: descPersonal,
      esExcluyente: esExcluyentePer,
      extractionState: esExcluyentePer ? 'CRITERION_EXTRACTED' : 'REQUIREMENT_DETECTED',
      permiteNominacionPosterior,
      sourceEvidence: {
        snippet: snippetPer,
        sectionLocator: 'PERSONAL_CLAVE',
        confidencePct: esExcluyentePer ? 90 : 65,
        provenance: 'PBC_TEXT_PARSER'
      },
      criterio: { cargoRequerido: cargoEsperado }
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

