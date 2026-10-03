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
  contractNumber?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  adjudicatedOfferPricePyg: number;
  durationMonths?: number | null;
  advancePaymentPct?: number | null;
  retentionPct?: number | null;
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
    contract_number: string | null;
    contract_amount: number;
    budget_total: number;
    plazo_dias: number | null;
    anticipo_pct: number | null;
    retencion_pct: number | null;
    start_date: string | null;
    end_date: string | null;
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
  const projectCode = params.dncpNro ? `OBRA-DNCP-${params.dncpNro}` : `OBRA-LIC-${params.tenderId.slice(0, 8)}`;
  const plazoDias = params.durationMonths != null && params.durationMonths > 0
    ? Math.round(params.durationMonths * 30)
    : null;

  if (!params.bidItems || params.bidItems.length === 0) {
    throw new Error('VALIDATION_ERROR: Cannot convert tender to project without budget items.');
  }

  for (const item of params.bidItems) {
    if (!item.description || item.description.trim() === '') {
      throw new Error(`VALIDATION_ERROR: Bid item #${item.itemNumber} has empty description.`);
    }
    if (!item.unit || item.unit.trim() === '') {
      throw new Error(`VALIDATION_ERROR: Bid item #${item.itemNumber} has empty unit of measurement.`);
    }
    if (item.quantity === undefined || item.quantity === null || item.quantity <= 0) {
      throw new Error(`VALIDATION_ERROR: Bid item #${item.itemNumber} has invalid quantity (${item.quantity}). Quantity must be strictly greater than zero.`);
    }
    if (item.unitPricePyg === undefined || item.unitPricePyg === null || isNaN(item.unitPricePyg) || item.unitPricePyg <= 0) {
      throw new Error(`VALIDATION_ERROR: Bid item #${item.itemNumber} has invalid unit price (${item.unitPricePyg}). Price must be strictly greater than zero.`);
    }
  }

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

  const calculatedEndDate = params.endDate || (params.startDate && plazoDias != null
    ? new Date(new Date(params.startDate).getTime() + plazoDias * 86_400_000).toISOString().split('T')[0]
    : null);

  return {
    project: {
      empresa_id: params.empresaId,
      name: params.projectTitle,
      code: projectCode,
      client: params.buyerName,
      comitente: params.buyerName,
      contract_number: params.contractNumber || null,
      contract_amount: params.adjudicatedOfferPricePyg,
      budget_total: totalBudget,
      plazo_dias: plazoDias,
      anticipo_pct: params.advancePaymentPct ?? null,
      retencion_pct: params.retentionPct ?? null,
      start_date: params.startDate || null,
      end_date: calculatedEndDate,
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

/**
 * Persiste la transición de Licitación a Obra directamente en la base de datos de Supabase.
 * Ejecuta la transición de forma estrictamente ATÓMICA vía RPC en PostgreSQL:
 * 1. Inserta el registro en `projects` con trazabilidad a `tender_id` y `bid_analysis_run_id`.
 * 2. Inserta atómicamente todos los `budget_items`.
 * 3. Crea el depósito / pañol de obra vinculado en `depositos`.
 * 4. Actualiza la vinculación de obra en `licitaciones.raw_json`.
 * 5. Si cualquier paso falla, la transacción en BD se revierte en su totalidad (cero registros huérfanos).
 *
 * NOTA: `initialProcurementRequests` son sugerencias en memoria para planificación de compras y NO se persisten
 * como órdenes de compra automáticamente sin aprobación expresa del usuario.
 */
/** Legacy adapter: client budget/award are no longer factual inputs. */
export async function executeTenderToProjectTransaction(supabase: any, params: TenderToProjectParams & { confirmedHandoff?: boolean }) {
  return executeWinningTenderHandoff(supabase, params.tenderId, params.confirmedHandoff ?? false);
}

export async function executeWinningTenderHandoff(supabase: any, tenderId: string, confirmed = false): Promise<{ error: string | null; projectId?: string; projectCode?: string; alreadyExisted?: boolean }> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tenderId) || confirmed !== true) return { error: "Confirmaci�n humana expl�cita del handoff requerida." };
  try {
    const { data, error } = await supabase.rpc("prebid_create_project", { p_tender_id: tenderId, p_confirm: true });
    if (error) return { error: error.message };
    if (!data?.success || !data.project_id || !data.project_code) return { error: "Respuesta inv�lida del handoff." };
    return { error: null, projectId: data.project_id, projectCode: data.project_code, alreadyExisted: data.already_existed === true };
  } catch (error) { return { error: error instanceof Error ? error.message : "Error de handoff." }; }
}
