/**
 * TENDER OPERATIONS AGENT V1 (GATE 14)
 * Orquestador autónomo de preparación y ensamblaje de ofertas para licitaciones públicas:
 * 1. Integración de Ítems de Oferta con precios unitarios calculados por el Cost Engine (Gate 5B).
 * 2. Autocompletado de Formularios Oficiales estándar de la DNCP:
 *    - Formulario 1: Carta de Presentación de Oferta.
 *    - Formulario 2: Declaración Jurada de no encontrarse inhabilitado (Art. 40 Ley 2051/03 / Ley 7021/22).
 *    - Formulario 3: Planilla de Precios Unitarios y Cómputo Métrico.
 * 3. Enlace automático de documentos probatorios de respaldo desde el Company Bid Vault (Gate 9).
 * 4. Generación del Índice Maestro del Expediente y dictamen de completitud (READY_TO_SIGN / INCOMPLETO).
 */

import { VaultItem } from './bid-vault';
import { TenderComplianceReport } from './compliance-engine';

export interface TenderBidItemInput {
  itemNumber: number;
  description: string;
  unit: string;
  quantity: number;
  unitPricePyg: number;
}

export interface PreparedForm {
  formCode: string;
  title: string;
  content: string;
  isCompleted: boolean;
  requiredSignatures: string[];
}

export interface BidPackage {
  tenderId: string;
  bidderName: string;
  bidderRuc: string;
  totalOfferAmountPyg: number;
  preparedForms: PreparedForm[];
  attachedEvidenceDocs: Array<{
    category: string;
    documentTitle: string;
    vaultItemId: string;
  }>;
  packageStatus: 'READY_TO_SIGN' | 'DRAFT_INCOMPLETE';
  validationErrors: string[];
  generatedAt: string;
}

/**
 * Prepara el Borrador de Carta de Presentación de la Oferta (Formulario 1)
 */
export function generateFormularioPresentacion(params: {
  tenderId: string;
  tenderTitle: string;
  buyerName: string;
  bidderName: string;
  bidderRuc: string;
  totalAmountPyg: number;
  validityDays?: number | null;
}): PreparedForm {
  const validityClause = (typeof params.validityDays === 'number' && params.validityDays > 0)
    ? `por un período de ${params.validityDays} días calendario`
    : 'por el período de validez y mantenimiento de oferta establecido en el Pliego de Bases y Condiciones (PBC)';

  const content = `[BORRADOR / PLANTILLA INTERNA - NO PRESENTAR SIN REVISIÓN LEGAL]
A: ${params.buyerName}
REF: LLAMADO A LICITACIÓN ${params.tenderId} - "${params.tenderTitle}"

De nuestra consideración:

Por la presente, la empresa ${params.bidderName}, con RUC ${params.bidderRuc}, presenta formalmente su oferta para la ejecución de la obra de referencia por un monto total de Gs. ${params.totalAmountPyg.toLocaleString('es-PY')} (Guaraníes ${params.totalAmountPyg.toLocaleString('es-PY')}).

Declaramos que nuestra oferta se mantendrá válida y vinculante ${validityClause} a partir de la fecha límite de presentación.

Atentamente,
REPRESENTANTE LEGAL
${params.bidderName}`;

  return {
    formCode: 'DRAFT-FORM-01',
    title: 'Borrador / Plantilla interna: Carta de Presentación de la Oferta',
    content,
    isCompleted: params.totalAmountPyg > 0 && !!params.bidderRuc && params.bidderRuc !== '80000000-1',
    requiredSignatures: ['Representante Legal']
  };
}

/**
 * Prepara el Borrador de Declaración Jurada de no estar inhabilitado (Formulario 2)
 */
export function generateFormularioDeclaracionJurada(params: {
  tenderId: string;
  bidderName: string;
  bidderRuc: string;
  legalRepresentative: string;
}): PreparedForm {
  const content = `[BORRADOR / PLANTILLA INTERNA - DECLARACIÓN JURADA ART. 40 LEY 2051/03 & LEY 7021/22]

Quien suscribe, ${params.legalRepresentative}, en mi carácter de Representante Legal de ${params.bidderName} (RUC ${params.bidderRuc}), declaro bajo fe de juramento que la empresa ni sus directores/socios se encuentran comprendidos en ninguna de las causales de inhabilidad o incompatibilidad para contratar con el Estado paraguayo.

Licitación: ${params.tenderId}
Fecha: ${new Date().toISOString().split('T')[0]}`;

  return {
    formCode: 'DRAFT-FORM-02',
    title: 'Borrador / Plantilla interna: Declaración Jurada de Integridad e Inhabilidades',
    content,
    isCompleted: !!params.legalRepresentative && params.legalRepresentative !== 'Representante Legal',
    requiredSignatures: ['Representante Legal']
  };
}

/**
 * Prepara la Planilla de Precios y Cómputo (Formulario 3)
 */
export function generatePlanillaPrecios(items: TenderBidItemInput[]): PreparedForm {
  let table = 'ÍTEM | DESCRIPCIÓN | UD | CANTIDAD | P.UNITARIO (GS) | TOTAL (GS)\n';
  table += '---|---|---|---|---|---\n';

  let grandTotal = 0;
  let hasZeroPrice = false;

  for (const it of items) {
    const totalItem = it.quantity * it.unitPricePyg;
    grandTotal += totalItem;
    if (it.unitPricePyg <= 0) hasZeroPrice = true;
    table += `${it.itemNumber} | ${it.description} | ${it.unit} | ${it.quantity} | ${it.unitPricePyg.toLocaleString('es-PY')} | ${totalItem.toLocaleString('es-PY')}\n`;
  }

  table += `\nMONTO TOTAL DE LA OFERTA: Gs. ${grandTotal.toLocaleString('es-PY')}`;

  return {
    formCode: 'DRAFT-FORM-03',
    title: 'Borrador / Plantilla interna: Planilla de Cómputo y Precios Unitarios',
    content: table,
    isCompleted: items.length > 0 && grandTotal > 0 && !hasZeroPrice,
    requiredSignatures: ['Representante Legal', 'Responsable Técnico']
  };
}

/**
 * Orquesta el armado íntegro del paquete de oferta licitatoria
 */
export function assembleTenderPackage(params: {
  tenderId: string;
  tenderTitle: string;
  buyerName: string;
  bidderName: string;
  bidderRuc: string;
  legalRepresentative: string;
  items: TenderBidItemInput[];
  vaultItems: VaultItem[];
  validityDays?: number | null;
  complianceReport?: TenderComplianceReport | null;
}): BidPackage {
  const errors: string[] = [];

  // Validar datos de empresa (prohibir placeholders)
  const placeholderRucs = ['80000000-1', '00000000-0', '12345678-9'];
  if (!params.bidderRuc || placeholderRucs.includes(params.bidderRuc.trim())) {
    errors.push('RUC del oferente no configurado o utiliza valor ficticio/placeholder (80000000-1).');
  }
  if (!params.bidderName || params.bidderName.trim() === 'Empresa Oferente' || params.bidderName.trim().length < 3) {
    errors.push('Razón social del oferente no especificada.');
  }
  if (!params.legalRepresentative || params.legalRepresentative.trim() === 'Representante Legal' || params.legalRepresentative.trim().length < 3) {
    errors.push('Nombre del Representante Legal no especificado en perfil.');
  }

  // Validar ítems
  if (params.items.length === 0) {
    errors.push('No hay planilla de cómputo métrico ni ítems cotizados.');
  } else {
    for (const it of params.items) {
      if (it.unitPricePyg <= 0) {
        errors.push(`El ítem #${it.itemNumber} ("${it.description}") carece de precio unitario cotizado.`);
      }
      if (it.quantity <= 0) {
        errors.push(`El ítem #${it.itemNumber} ("${it.description}") tiene cantidad nula o inválida.`);
      }
    }
  }

  // 1. Verificación obligatoria de matriz de cumplimiento de PBC
  // READY_TO_SIGN es imposible si no existe matriz extraída del pliego o si hay requisitos excluyentes sin resolver
  const attachedDocs: BidPackage['attachedEvidenceDocs'] = [];

  if (!params.complianceReport) {
    errors.push('Falta matriz formal de requisitos extraída del Pliego de Bases y Condiciones (PBC). No se puede emitir dictamen READY_TO_SIGN sin pliego analizado.');
  } else if (params.complianceReport.evidenceOrigin !== 'EXTRACTED_FROM_PBC') {
    errors.push('La matriz de requisitos no procede de un PBC oficial extraído (origen no verificado). Requiere análisis de pliego real para ser READY_TO_SIGN.');
  } else if (!params.complianceReport.evaluations || params.complianceReport.evaluations.length === 0) {
    errors.push('La matriz de requisitos del pliego está vacía. No se puede certificar cumplimiento sin requisitos verificables.');
  } else {
    for (const ev of params.complianceReport.evaluations) {
      // INVARIANTE READY_TO_SIGN (FINDING 5):
      // CUALQUIER evaluación que resulte en REVIEW_REQUIRED bloquea READY_TO_SIGN (no limitado a esExcluyente=true).
      // Requisitos FALTANTES requeridos también bloquean READY_TO_SIGN.
      if (ev.verdict === 'REVIEW_REQUIRED') {
        errors.push(`Requisito REQUIERE REVISIÓN (REVIEW_REQUIRED) en PBC: [${ev.categoria}] ${ev.descripcion} — ${ev.observaciones || 'Criterio o evidencia pendiente de verificación humana'}`);
      } else if (ev.verdict === 'FALTANTE') {
        if (ev.esExcluyente) {
          errors.push(`Requisito excluyente FALTANTE en PBC: [${ev.categoria}] ${ev.descripcion}`);
        } else {
          errors.push(`Requisito plenario FALTANTE en PBC: [${ev.categoria}] ${ev.descripcion}`);
        }
      }

      // Vincular los documentos probatorios resueltos en la evaluación
      if (ev.documentoRespaldo) {
        if (!attachedDocs.some(d => d.vaultItemId === ev.documentoRespaldo!.id)) {
          attachedDocs.push({
            category: ev.categoria,
            documentTitle: ev.documentoRespaldo.titulo,
            vaultItemId: ev.documentoRespaldo.id
          });
        }
      }
    }

    if (!params.complianceReport.isEligibleToBid) {
      errors.push('El dictamen normativo del pliego concluye que la oferta NO es elegible para presentarse (isEligibleToBid = false).');
    }
  }

  // Si no se proveyó compliance report o no trajo documentos adjuntos pero hay vaultItems disponibles,
  // vincular los documentos vigentes para referencia informativa en el borrador
  if (attachedDocs.length === 0 && params.vaultItems && params.vaultItems.length > 0) {
    for (const v of params.vaultItems) {
      if (v.estado === 'VIGENTE' && !attachedDocs.some(d => d.vaultItemId === v.id)) {
        attachedDocs.push({
          category: v.categoria,
          documentTitle: v.titulo,
          vaultItemId: v.id
        });
      }
    }
  }

  const totalAmount = params.items.reduce((acc, it) => acc + it.quantity * it.unitPricePyg, 0);

  const form1 = generateFormularioPresentacion({
    tenderId: params.tenderId,
    tenderTitle: params.tenderTitle,
    buyerName: params.buyerName,
    bidderName: params.bidderName,
    bidderRuc: params.bidderRuc,
    totalAmountPyg: totalAmount,
    validityDays: params.validityDays ?? null
  });

  const form2 = generateFormularioDeclaracionJurada({
    tenderId: params.tenderId,
    bidderName: params.bidderName,
    bidderRuc: params.bidderRuc,
    legalRepresentative: params.legalRepresentative
  });

  const form3 = generatePlanillaPrecios(params.items);

  const packageStatus = errors.length === 0 ? 'READY_TO_SIGN' : 'DRAFT_INCOMPLETE';

  return {
    tenderId: params.tenderId,
    bidderName: params.bidderName,
    bidderRuc: params.bidderRuc,
    totalOfferAmountPyg: totalAmount,
    preparedForms: [form1, form2, form3],
    attachedEvidenceDocs: attachedDocs,
    packageStatus,
    validationErrors: errors,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Genera el Índice Maestro del Expediente de Oferta
 */
export function generateMasterIndex(bidPackage: BidPackage): string {
  let index = `ÍNDICE MAESTRO DEL EXPEDIENTE DE OFERTA\n`;
  index += `LICITACIÓN: ${bidPackage.tenderId} | OFERENTE: ${bidPackage.bidderName} (RUC ${bidPackage.bidderRuc})\n`;
  index += `ESTADO DE INTEGRIDAD: ${bidPackage.packageStatus}\n`;
  index += `FECHA DE GENERACIÓN: ${bidPackage.generatedAt}\n\n`;
  index += `SECCIÓN I: BORRADORES / PLANTILLAS INTERNAS DE PRESENTACIÓN\n`;
  bidPackage.preparedForms.forEach((f, idx) => {
    index += `  ${idx + 1}. [${f.formCode}] ${f.title} — ${f.isCompleted ? 'COMPLETO' : 'INCOMPLETO'} (Firmas: ${f.requiredSignatures.join(', ')})\n`;
  });
  index += `\nSECCIÓN II: DOCUMENTOS PROBATORIOS Y ANEXOS DE BÓVEDA\n`;
  if (bidPackage.attachedEvidenceDocs.length === 0) {
    index += `  (Sin documentos de respaldo adjuntos)\n`;
  } else {
    bidPackage.attachedEvidenceDocs.forEach((d, idx) => {
      index += `  ${idx + 1}. [${d.category}] ${d.documentTitle} (ID Bóveda: ${d.vaultItemId})\n`;
    });
  }
  if (bidPackage.validationErrors.length > 0) {
    index += `\nOBSERVACIONES Y REQUISITOS PENDIENTES:\n`;
    bidPackage.validationErrors.forEach((err, idx) => {
      index += `  ! [OBS ${idx + 1}] ${err}\n`;
    });
  }
  return index;
}

/**
 * Exporta el expediente licitatorio completo como documento HTML listo para impresión o firma digital
 */
export function exportBidPackageAsDocument(bidPackage: BidPackage): string {
  const masterIndex = generateMasterIndex(bidPackage);
  const totalFmt = bidPackage.totalOfferAmountPyg.toLocaleString('es-PY');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Expediente de Oferta - ${bidPackage.tenderId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; margin: 40px; color: #1f2937; line-height: 1.5; }
    h1, h2, h3 { color: #111827; }
    .header { border-bottom: 2px solid #e5e7eb; padding-bottom: 16px; margin-bottom: 24px; }
    .badge { display: inline-block; padding: 4px 10px; border-radius: 9999px; font-weight: 600; font-size: 12px; }
    .badge-success { background: #dcfce7; color: #15803d; }
    .badge-warn { background: #fef9c3; color: #854d0e; }
    .section { margin-top: 32px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px; background: #fafafa; }
    .pre-box { white-space: pre-wrap; font-family: monospace; font-size: 13px; background: #ffffff; padding: 12px; border: 1px solid #d1d5db; border-radius: 4px; }
    .table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    .table th, .table td { border: 1px solid #e5e7eb; padding: 8px 12px; text-align: left; font-size: 13px; }
    .table th { background: #f3f4f6; }
    .signatures { margin-top: 60px; display: flex; justify-content: space-around; }
    .sig-line { border-top: 1px solid #000; width: 220px; text-align: center; padding-top: 8px; font-size: 12px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>EXPEDIENTE DE OFERTA LICITATORIA</h1>
    <p><strong>Licitación DNCP:</strong> ${bidPackage.tenderId}</p>
    <p><strong>Oferente:</strong> ${bidPackage.bidderName} | <strong>RUC:</strong> ${bidPackage.bidderRuc}</p>
    <p><strong>Monto Total de Oferta:</strong> Gs. ${totalFmt}</p>
    <p><strong>Estado:</strong> <span class="badge ${bidPackage.packageStatus === 'READY_TO_SIGN' ? 'badge-success' : 'badge-warn'}">${bidPackage.packageStatus}</span></p>
    <p><strong>Generado el:</strong> ${bidPackage.generatedAt}</p>
  </div>

  <h2>1. Índice Maestro del Expediente</h2>
  <div class="pre-box">${masterIndex}</div>

  <h2>2. Borradores / Plantillas Internas de Presentación</h2>
  ${bidPackage.preparedForms.map(f => `
    <div class="section">
      <h3>${f.formCode} — ${f.title}</h3>
      <div class="pre-box">${f.content}</div>
    </div>
  `).join('')}

  <h2>3. Documentos Probatorios Anexos (Bóveda)</h2>
  <table class="table">
    <thead>
      <tr>
        <th>Categoría</th>
        <th>Título del Documento</th>
        <th>Identificador Bóveda</th>
      </tr>
    </thead>
    <tbody>
      ${bidPackage.attachedEvidenceDocs.map(d => `
        <tr>
          <td>${d.category}</td>
          <td>${d.documentTitle}</td>
          <td><code>${d.vaultItemId}</code></td>
        </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="signatures">
    <div class="sig-line">
      <strong>REPRESENTANTE LEGAL</strong><br>
      ${bidPackage.bidderName}<br>
      Firma Digital Calificada / Sello
    </div>
    <div class="sig-line">
      <strong>RESPONSABLE TÉCNICO</strong><br>
      Reg. Prof. N° / C.I.<br>
      Firma / Sello
    </div>
  </div>
</body>
</html>`;
}

