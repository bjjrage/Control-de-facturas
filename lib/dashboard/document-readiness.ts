import type {
  NormalizedDocumentType,
  RequirementReadinessStatus,
  ExtractedTenderRequirement,
  RequirementEvaluationResult,
  TenderReadinessAssessment,
} from "./types";

export type { TenderReadinessAssessment };

export const NORMALIZED_DOC_LABELS: Record<NormalizedDocumentType, string> = {
  CERTIFICADO_CUMPLIMIENTO_TRIBUTARIO: "Certificado de Cumplimiento Tributario (DNIT/SET)",
  CONSTANCIA_IPS: "Constancia de No Adeudar (IPS)",
  PATENTE_MUNICIPAL: "Patente Municipal",
  RUC: "Constancia de RUC",
  PODER_REPRESENTANTE: "Poder del Representante Legal",
  ACTA_CONSTITUCION: "Acta de Constitución",
  ESTATUTOS: "Estatutos Sociales",
  BALANCE_AUDITADO: "Balance General Auditado",
  REGISTRO_PROVEEDORES_ESTADO: "Constancia de Proveedor del Estado (DNCP)",
  DECLARACION_JURADA_ART_40: "Declaración Jurada Art. 40 (Inhabilitaciones)",
  GARANTIA_MANTENIMIENTO_OFERTA: "Garantía de Mantenimiento de Oferta",
  OTRO: "Otro Requisito Documental",
};

export interface RawEmpresaDocumento {
  id: string;
  tipo: string;
  descripcion?: string | null;
  fecha_emision?: string | null;
  fecha_vencimiento?: string | null;
}

export interface RawLicitacionForReadiness {
  id: string;
  titulo: string;
  dncp_nro: string;
  fecha_entrega_ofertas: string | null;
  decision: string;
  raw_json?: any;
}

export interface RawLicitacionDocumento {
  id: string;
  licitacion_id: string;
  tipo: string | null;
  tipo_detalle: string | null;
  titulo: string | null;
  url_dncp: string | null;
  storage_path?: string | null;
}

/**
 * Normaliza un texto o tipo documental libre hacia el catálogo normalizado oficial.
 */
export function normalizeDocumentType(rawText: string): {
  normalizedType: NormalizedDocumentType;
  confidence: number;
} {
  if (!rawText || !rawText.trim()) {
    return { normalizedType: "OTRO", confidence: 0 };
  }

  const s = rawText.toLowerCase().trim();

  // 1. Tributario / SET / DNIT / CCT
  if (
    s.includes("cumplimiento tributario") ||
    s.includes("cct") ||
    s.includes("dnit") ||
    s.includes("set") ||
    s.includes("tributari") ||
    s.includes("marangatu")
  ) {
    return { normalizedType: "CERTIFICADO_CUMPLIMIENTO_TRIBUTARIO", confidence: 0.95 };
  }

  // 2. IPS
  if (
    s.includes("ips") ||
    s.includes("prevision social") ||
    s.includes("previsión social") ||
    s.includes("obrero patronal") ||
    s.includes("seguridad social")
  ) {
    return { normalizedType: "CONSTANCIA_IPS", confidence: 0.95 };
  }

  // 3. Patente Municipal
  if (s.includes("patente") || s.includes("municipalidad") || s.includes("municipal")) {
    return { normalizedType: "PATENTE_MUNICIPAL", confidence: 0.92 };
  }

  // 4. RUC
  if (s.includes("constancia de ruc") || s.includes("cedula tributaria") || s.includes("cédula tributaria") || s === "ruc") {
    return { normalizedType: "RUC", confidence: 0.94 };
  }

  // 5. Poder del Representante
  if (
    s.includes("poder") ||
    s.includes("representante legal") ||
    s.includes("apoderado") ||
    s.includes("poder especial") ||
    s.includes("poder general")
  ) {
    return { normalizedType: "PODER_REPRESENTANTE", confidence: 0.92 };
  }

  // 6. Acta de Constitución
  if (s.includes("acta notarial") || s.includes("acta de constitucion") || s.includes("acta de constitución") || s.includes("constitutiva")) {
    return { normalizedType: "ACTA_CONSTITUCION", confidence: 0.9 };
  }

  // 7. Estatutos Sociales
  if (s.includes("estatuto") || s.includes("contrato social")) {
    return { normalizedType: "ESTATUTOS", confidence: 0.92 };
  }

  // 8. Balance General Auditado
  if (s.includes("balance") || s.includes("auditad") || s.includes("estados contables") || s.includes("estados financieros")) {
    return { normalizedType: "BALANCE_AUDITADO", confidence: 0.94 };
  }

  // 9. Registro de Proveedores del Estado (DNCP)
  if (s.includes("proveedores del estado") || s.includes("registro de proveedores") || s.includes("sicp") || s.includes("proveedor del estado")) {
    return { normalizedType: "REGISTRO_PROVEEDORES_ESTADO", confidence: 0.93 };
  }

  // 10. Declaración Jurada Art. 40
  if (
    s.includes("art. 40") ||
    s.includes("articulo 40") ||
    s.includes("artículo 40") ||
    s.includes("inhabilitado") ||
    s.includes("inhabilitacion") ||
    s.includes("ley 2051") ||
    s.includes("ley 7021") ||
    s.includes("declaracion jurada") ||
    s.includes("declaración jurada")
  ) {
    return { normalizedType: "DECLARACION_JURADA_ART_40", confidence: 0.92 };
  }

  // 11. Garantía de Mantenimiento de Oferta
  if (s.includes("garantia") || s.includes("garantía") || s.includes("fianza") || s.includes("poliza") || s.includes("póliza")) {
    return { normalizedType: "GARANTIA_MANTENIMIENTO_OFERTA", confidence: 0.91 };
  }

  return { normalizedType: "OTRO", confidence: 0.5 };
}

/**
 * Heurística Canónica V1:
 * Evalúa la presencia de pliego o metadatos en una licitación y asocia la matriz
 * de documentación base legal/tributaria requerida según normativa DNCP.
 * NOTA: Chequeo preventivo de documentación base. No sustituye ni efectúa la lectura
 * o extracción del contenido particular del texto del PBC.
 */
export function extractRequirementsForTender(
  lic: RawLicitacionForReadiness,
  docs: RawLicitacionDocumento[]
): { requirements: ExtractedTenderRequirement[]; hasAnalyzedPbc: boolean } {
  const tenderDocs = docs.filter((d) => d.licitacion_id === lic.id);
  const pbcDocs = tenderDocs.filter((d) => {
    const t = (d.tipo || "").toLowerCase();
    const td = (d.tipo_detalle || "").toLowerCase();
    const tit = (d.titulo || "").toLowerCase();
    return (
      t.includes("bidding") ||
      t.includes("pliego") ||
      td.includes("pliego") ||
      td.includes("pbc") ||
      td.includes("bases y condiciones") ||
      tit.includes("pliego") ||
      tit.includes("pbc") ||
      tit.includes("bases y condiciones")
    );
  });

  const requirements: ExtractedTenderRequirement[] = [];

  // Requisitos obligatorios legales/fiscales canónicos para cualquier licitación pública oficial en Paraguay (DNCP)
  // Siempre que la convocatoria sea formal (CONVOCATORIA / EN_PREPARACION) y tenga pliego identificado
  if (pbcDocs.length > 0 || (lic.raw_json && lic.raw_json.tender)) {
    // 1. CCT DNIT
    requirements.push({
      id: `${lic.id}-cct`,
      licitacion_id: lic.id,
      normalized_type: "CERTIFICADO_CUMPLIMIENTO_TRIBUTARIO",
      source_text: "Certificado de Cumplimiento Tributario emitido por la DNIT vigente a la apertura",
      source_document: pbcDocs[0]?.titulo || "Pliego de Bases y Condiciones",
      required: true,
      confidence: 0.95,
    });

    // 2. Constancia IPS
    requirements.push({
      id: `${lic.id}-ips`,
      licitacion_id: lic.id,
      normalized_type: "CONSTANCIA_IPS",
      source_text: "Constancia de no adeudar aportes obrero-patronales al IPS",
      source_document: pbcDocs[0]?.titulo || "Pliego de Bases y Condiciones",
      required: true,
      confidence: 0.95,
    });

    // 3. Declaración Jurada Art. 40
    requirements.push({
      id: `${lic.id}-art40`,
      licitacion_id: lic.id,
      normalized_type: "DECLARACION_JURADA_ART_40",
      source_text: "Declaración jurada de no hallarse comprendido en las prohibiciones o inhabilitaciones del Art. 40",
      source_document: pbcDocs[0]?.titulo || "Pliego de Bases y Condiciones",
      required: true,
      confidence: 0.95,
    });

    // 4. RUC
    requirements.push({
      id: `${lic.id}-ruc`,
      licitacion_id: lic.id,
      normalized_type: "RUC",
      source_text: "Copia de constancia de RUC",
      source_document: pbcDocs[0]?.titulo || "Pliego de Bases y Condiciones",
      required: true,
      confidence: 0.92,
    });

    // 5. Poder o Estatuto
    requirements.push({
      id: `${lic.id}-poder`,
      licitacion_id: lic.id,
      normalized_type: "PODER_REPRESENTANTE",
      source_text: "Poder del Representante Legal o Estatuto Social de la firma",
      source_document: pbcDocs[0]?.titulo || "Pliego de Bases y Condiciones",
      required: true,
      confidence: 0.9,
    });

    // 6. Patente Municipal
    requirements.push({
      id: `${lic.id}-patente`,
      licitacion_id: lic.id,
      normalized_type: "PATENTE_MUNICIPAL",
      source_text: "Comprobante de pago o patente municipal comercial vigente",
      source_document: pbcDocs[0]?.titulo || "Pliego de Bases y Condiciones",
      required: false,
      confidence: 0.85,
    });

    return { requirements, hasAnalyzedPbc: true };
  }

  // Si no hay pliego identificado ni OCDS tender estructurado: fail-closed
  return { requirements: [], hasAnalyzedPbc: false };
}

/**
 * Evalúa la vigencia de un requisito respecto a la fecha de entrega de la oferta:
 * - READY: vigencia cubre hoy Y cubre la fecha de apertura/entrega.
 * - EXPIRING_BEFORE_DEADLINE: vigente hoy pero expira antes de la fecha de entrega.
 * - EXPIRED: ya está vencido hoy.
 * - MISSING: no existe ningún documento cargado en empresa_documentos.
 * - UNKNOWN: falta fecha de entrega o datos suficientes.
 */
export function evaluateRequirementReadiness(
  req: ExtractedTenderRequirement,
  empresaDocs: RawEmpresaDocumento[],
  fechaEntregaOfertasIso: string | null,
  todayIso: string
): RequirementEvaluationResult {
  // Buscar documento(s) en la bóveda que mapeen al mismo normalized_type
  const matches = empresaDocs.filter((d) => {
    const norm = normalizeDocumentType(`${d.tipo} ${d.descripcion || ""}`);
    return norm.normalizedType === req.normalized_type;
  });

  if (matches.length === 0) {
    return {
      requirement: req,
      status: "MISSING",
      matchingDoc: null,
      reason: `Falta cargar ${NORMALIZED_DOC_LABELS[req.normalized_type]} en la bóveda de documentos`,
    };
  }

  // Ordenar para tomar el documento con mayor vigencia
  const sorted = [...matches].sort((a, b) => {
    if (!a.fecha_vencimiento && !b.fecha_vencimiento) return 0;
    if (!a.fecha_vencimiento) return 1; // Documento permanente (sin vencimiento) es ideal
    if (!b.fecha_vencimiento) return -1;
    return b.fecha_vencimiento.localeCompare(a.fecha_vencimiento);
  });

  const bestDoc = sorted[0];

  // Documento sin vencimiento (ej. Estatuto, Acta de Constitución)
  if (!bestDoc.fecha_vencimiento) {
    return {
      requirement: req,
      status: "READY",
      matchingDoc: {
        id: bestDoc.id,
        tipo: bestDoc.tipo,
        fecha_vencimiento: null,
      },
      reason: "Documento permanente disponible en bóveda",
    };
  }

  const vencimiento = bestDoc.fecha_vencimiento;

  // 1. Ya vencido hoy
  if (vencimiento < todayIso) {
    return {
      requirement: req,
      status: "EXPIRED",
      matchingDoc: {
        id: bestDoc.id,
        tipo: bestDoc.tipo,
        fecha_vencimiento: vencimiento,
      },
      reason: `Documento vencido el ${vencimiento}`,
    };
  }

  // 2. Si no hay fecha de entrega de licitación definida, pero está vigente hoy
  if (!fechaEntregaOfertasIso) {
    return {
      requirement: req,
      status: "READY",
      matchingDoc: {
        id: bestDoc.id,
        tipo: bestDoc.tipo,
        fecha_vencimiento: vencimiento,
      },
      reason: `Vigente hasta ${vencimiento} (sin fecha límite de licitación)`,
    };
  }

  const deadlineDay = fechaEntregaOfertasIso.slice(0, 10);

  // 3. Vence antes de la fecha de entrega de ofertas
  if (vencimiento < deadlineDay) {
    return {
      requirement: req,
      status: "EXPIRING_BEFORE_DEADLINE",
      matchingDoc: {
        id: bestDoc.id,
        tipo: bestDoc.tipo,
        fecha_vencimiento: vencimiento,
      },
      reason: `Vence el ${vencimiento}, antes de la entrega de ofertas (${deadlineDay})`,
    };
  }

  // 4. Vigente a la fecha de entrega de ofertas
  return {
    requirement: req,
    status: "READY",
    matchingDoc: {
      id: bestDoc.id,
      tipo: bestDoc.tipo,
      fecha_vencimiento: vencimiento,
    },
    reason: `Documentación base vigente para la presentación de ofertas (${deadlineDay})`,
  };
}

/**
 * Evalúa el estado documental integral de un conjunto de licitaciones activas.
 */
export function assessTendersReadiness(params: {
  licitaciones: RawLicitacionForReadiness[];
  docs: RawLicitacionDocumento[];
  empresaDocs: RawEmpresaDocumento[];
  todayIso: string;
}): TenderReadinessAssessment[] {
  const { licitaciones, docs, empresaDocs, todayIso } = params;

  return licitaciones.map((lic) => {
    const { requirements, hasAnalyzedPbc } = extractRequirementsForTender(lic, docs);

    if (!hasAnalyzedPbc || requirements.length === 0) {
      return {
        licitacionId: lic.id,
        titulo: lic.titulo,
        dncpNro: lic.dncp_nro,
        fechaEntregaOfertas: lic.fecha_entrega_ofertas,
        hasAnalyzedPbc: false,
        evaluations: [],
        isAtRisk: true, // Fail-closed: sin pliego analizado está en riesgo de sorpresa documental
        missingCount: 0,
        expiringCount: 0,
        expiredCount: 0,
      };
    }

    const evaluations = requirements.map((req) =>
      evaluateRequirementReadiness(req, empresaDocs, lic.fecha_entrega_ofertas, todayIso)
    );

    const missingCount = evaluations.filter((e) => e.status === "MISSING").length;
    const expiringCount = evaluations.filter((e) => e.status === "EXPIRING_BEFORE_DEADLINE").length;
    const expiredCount = evaluations.filter((e) => e.status === "EXPIRED").length;

    const isAtRisk = missingCount > 0 || expiringCount > 0 || expiredCount > 0;

    return {
      licitacionId: lic.id,
      titulo: lic.titulo,
      dncpNro: lic.dncp_nro,
      fechaEntregaOfertas: lic.fecha_entrega_ofertas,
      hasAnalyzedPbc: true,
      evaluations,
      isAtRisk,
      missingCount,
      expiringCount,
      expiredCount,
    };
  });
}
