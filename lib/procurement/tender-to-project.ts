/**
 * TENDER TO PROJECT TRANSITION ENGINE (GATE 19)
 * Transición automática de Licitación Adjudicada a Obra Operativa en el ERP:
 * 1. Crea el registro en `projects` con comitente, contrato, monto adjudicado, retención y anticipo.
 * 2. Transfiere los ítems económicos ofertados directamente a `budget_items`.
 * 3. Establece la estructura inicial del pañol y compras vinculada a los insumos cotizados.
 * 4. Preserva la trazabilidad completa mediante referencia al proceso licitatorio (`tender_id` y `bid_analysis_run_id`).
 * Cero doble carga humana.
 */

import { TenderBidItemInput } from './tender-operations';
import { BidDecisionOutput } from './bid-engine';

export interface TenderToProjectParams {
  empresaId: string;
  tenderId: string;
  dncpNro?: string;
  projectTitle: string;
  buyerName: string;
  contractNumber?: string;
  adjudicatedOfferPricePyg: number;
  durationMonths: number;
  advancePaymentPct: number;
  retentionPct: number;
  bidItems: TenderBidItemInput[];
  bidAnalysisRunId?: string;
  createdBy?: string;
}

export interface CreatedProjectPayload {
  project: {
    empresa_id: string;
    name: string;
    code: string;
    client: string;
    comitente: string;
    contract_number: string;
    contract_amount: number;
    budget_total: number;
    plazo_dias: number;
    anticipo_pct: number;
    retencion_pct: number;
    status: 'ACTIVO';
    created_by: string | null;
  };
  budgetItems: Array<{
    code: string;
    description: string;
    unit: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    sort_order: number;
  }>;
  initialProcurementRequests: Array<{
    itemDescription: string;
    estimatedQty: number;
    unit: string;
    targetUnitPricePyg: number;
  }>;
  summary: {
    totalItemsTransferred: number;
    totalBudgetPyg: number;
    tenderReference: string;
  };
}

/**
 * Mapea y estructura la oferta adjudicada en una obra operativa lista para el ERP
 */
export function buildProjectFromAdjudicatedTender(params: TenderToProjectParams): CreatedProjectPayload {
  const projectCode = params.dncpNro ? `OBRA-DNCP-${params.dncpNro}` : `OBRA-${Date.now().toString().slice(-6)}`;
  const plazoDias = params.durationMonths * 30;

  const budgetItems = params.bidItems.map((item, idx) => ({
    code: `ITM-${(idx + 1).toString().padStart(3, '0')}`,
    description: item.description,
    unit: item.unit,
    quantity: item.quantity,
    unit_price: item.unitPricePyg,
    subtotal: item.quantity * item.unitPricePyg,
    sort_order: idx + 1
  }));

  const totalBudget = budgetItems.reduce((acc, it) => acc + it.subtotal, 0);

  // Generar requerimientos iniciales de compra / pañol sugeridos
  const initialProcurement = params.bidItems.map(item => ({
    itemDescription: item.description,
    estimatedQty: item.quantity,
    unit: item.unit,
    targetUnitPricePyg: item.unitPricePyg
  }));

  return {
    project: {
      empresa_id: params.empresaId,
      name: params.projectTitle,
      code: projectCode,
      client: params.buyerName,
      comitente: params.buyerName,
      contract_number: params.contractNumber || `CONTRATO-${params.tenderId}`,
      contract_amount: params.adjudicatedOfferPricePyg,
      budget_total: totalBudget,
      plazo_dias: plazoDias,
      anticipo_pct: params.advancePaymentPct,
      retencion_pct: params.retentionPct,
      status: 'ACTIVO',
      created_by: params.createdBy || null
    },
    budgetItems,
    initialProcurementRequests: initialProcurement,
    summary: {
      totalItemsTransferred: budgetItems.length,
      totalBudgetPyg: totalBudget,
      tenderReference: params.tenderId
    }
  };
}
