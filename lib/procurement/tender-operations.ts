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
  validityDays: number;
}): PreparedForm {
  const content = `[BORRADOR DE PREPARACIÓN INTERNA - NO PRESENTAR SIN REVISIÓN LEGAL]
A: ${params.buyerName}
REF: LLAMADO A LICITACIÓN ${params.tenderId} - "${params.tenderTitle}"

De nuestra consideración:

Por la presente, la empresa ${params.bidderName}, con RUC ${params.bidderRuc}, presenta formalmente su oferta para la ejecución de la obra de referencia por un monto total de Gs. ${params.totalAmountPyg.toLocaleString('es-PY')} (Guaraníes ${params.totalAmountPyg.toLocaleString('es-PY')}).

Declaramos que nuestra oferta se mantendrá válida y vinculante por un período de ${params.validityDays} días calendario a partir de la fecha límite de presentación.

Atentamente,
REPRESENTANTE LEGAL
${params.bidderName}`;

  return {
    formCode: 'DRAFT-FORM-01',
    title: 'Borrador: Carta de Presentación de la Oferta (Plantilla)',
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
  const content = `[BORRADOR DE PREPARACIÓN INTERNA - DECLARACIÓN JURADA ART. 40 LEY 2051/03 & LEY 7021/22]

Quien suscribe, ${params.legalRepresentative}, en mi carácter de Representante Legal de ${params.bidderName} (RUC ${params.bidderRuc}), declaro bajo fe de juramento que la empresa ni sus directores/socios se encuentran comprendidos en ninguna de las causales de inhabilidad o incompatibilidad para contratar con el Estado paraguayo.

Licitación: ${params.tenderId}
Fecha: ${new Date().toISOString().split('T')[0]}`;

  return {
    formCode: 'DRAFT-FORM-02',
    title: 'Borrador: Declaración Jurada de Integridad e Inhabilidades (Plantilla)',
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
    title: 'Borrador: Planilla de Cómputo y Precios Unitarios (Plantilla)',
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

  const totalAmount = params.items.reduce((acc, it) => acc + it.quantity * it.unitPricePyg, 0);

  const form1 = generateFormularioPresentacion({
    tenderId: params.tenderId,
    tenderTitle: params.tenderTitle,
    buyerName: params.buyerName,
    bidderName: params.bidderName,
    bidderRuc: params.bidderRuc,
    totalAmountPyg: totalAmount,
    validityDays: 90
  });

  const form2 = generateFormularioDeclaracionJurada({
    tenderId: params.tenderId,
    bidderName: params.bidderName,
    bidderRuc: params.bidderRuc,
    legalRepresentative: params.legalRepresentative
  });

  const form3 = generatePlanillaPrecios(params.items);

  // Adjuntar documentos probatorios de la bóveda
  const attachedDocs: BidPackage['attachedEvidenceDocs'] = [];
  const requiredCategories: Array<'LEGAL' | 'FISCAL' | 'EXPERIENCIA'> = ['LEGAL', 'FISCAL', 'EXPERIENCIA'];

  for (const cat of requiredCategories) {
    const doc = params.vaultItems.find(v => v.categoria === cat && v.estado === 'VIGENTE');
    if (doc) {
      attachedDocs.push({
        category: doc.categoria,
        documentTitle: doc.titulo,
        vaultItemId: doc.id
      });
    } else {
      errors.push(`Falta adjuntar documento probatorio vigente de categoría ${cat} desde la Bóveda.`);
    }
  }

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
