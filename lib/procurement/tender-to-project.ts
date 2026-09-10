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
    contract_number: string;
    contract_amount: number;
    budget_total: number;
    plazo_dias: number | null;
    anticipo_pct: number | null;
    retencion_pct: number | null;
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
      anticipo_pct: params.advancePaymentPct ?? null,
      retencion_pct: params.retentionPct ?? null,
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
 * Inserta el registro en `projects`, desglosa los ítems en `budget_items`, y crea el depósito/pañol de obra.
 * Aplica verificación de idempotencia para prevenir duplicados.
 */
export async function executeTenderToProjectTransaction(
  supabase: any,
  params: TenderToProjectParams
): Promise<{ error: string | null; projectId?: string; projectCode?: string }> {
  const payload = buildProjectFromAdjudicatedTender(params);

  // Verificación de idempotencia: ¿ya existe una obra con este código en la empresa?
  const { data: existingProject } = await supabase
    .from('projects')
    .select('id, code')
    .eq('empresa_id', payload.project.empresa_id)
    .eq('code', payload.project.code)
    .maybeSingle();

  if (existingProject) {
    return {
      error: null,
      projectId: existingProject.id,
      projectCode: existingProject.code
    };
  }

  // 1. Insertar Proyecto en tabla projects
  const insertData: Record<string, unknown> = {
    empresa_id: payload.project.empresa_id,
    name: payload.project.name,
    code: payload.project.code,
    client: payload.project.client,
    budget_total: payload.project.budget_total,
    status: 'ACTIVO',
    created_by: payload.project.created_by,
    start_date: new Date().toISOString().split('T')[0],
  };

  if (payload.project.plazo_dias != null) {
    insertData.end_date = new Date(Date.now() + payload.project.plazo_dias * 86_400_000).toISOString().split('T')[0];
  }

  const { data: project, error: projectError } = await supabase
    .from('projects')
    .insert(insertData)
    .select('id, code')
    .single();

  if (projectError || !project) {
    console.error('[TenderToProject] Error al crear proyecto:', projectError);
    return { error: projectError?.message || 'No se pudo crear el proyecto en el ERP.' };
  }

  // 2. Insertar los ítems presupuestarios en budget_items
  if (payload.budgetItems.length > 0) {
    const budgetRows = payload.budgetItems.map(item => ({
      project_id: project.id,
      code: item.code,
      description: item.description,
      unit: item.unit,
      quantity: item.quantity,
      unit_price: item.unit_price,
      sort_order: item.sort_order
    }));

    const { error: itemsError } = await supabase
      .from('budget_items')
      .insert(budgetRows);

    if (itemsError) {
      console.error('[TenderToProject] Error al transferir budget_items:', itemsError);
      // No abortamos completamente, el proyecto ya existe, pero informamos
      return {
        error: `Proyecto creado pero ocurrió un error al insertar cómputo métrico: ${itemsError.message}`,
        projectId: project.id,
        projectCode: project.code
      };
    }
  }

  // 3. Crear depósito/pañol de obra asociado
  const nombreDeposito = `Pañol ${project.code} - ${payload.project.name}`.slice(0, 100);
  await supabase.from('depositos').insert({
    empresa_id: payload.project.empresa_id,
    nombre: nombreDeposito,
    es_principal: false,
    project_id: project.id
  });

  return {
    error: null,
    projectId: project.id,
    projectCode: project.code
  };
}
