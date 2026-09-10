/**
 * COST ENGINE PUBLIC API (GATE 5B)
 * Servicio de estimación de costo de reposición (replacement cost) y registro de observaciones transaccionales de costo.
 */

import { createClient } from '@/lib/supabase/server';
import {
  CostObservation,
  CostEstimate,
  CostEngineConfig
} from './types';
import { calculateCostEstimate } from './weighting';

export * from './types';
export * from './weighting';
export * from './onboarding';

/**
 * Obtiene la estimación de costo de reposición / replacement cost para un producto o descripción de insumo
 * dentro del contexto del tenant actual a partir de observaciones históricas.
 */
export async function getCurrentCostEstimate(params: {
  productoId?: string;
  descripcionItem?: string;
  categoriaInsumo?: string;
  asOfDate?: string;
  config?: CostEngineConfig;
}): Promise<CostEstimate> {
  const supabase = await createClient();
  const asOfDateStr = params.asOfDate ?? new Date().toISOString().split('T')[0];

  let query = supabase
    .from('cost_observations')
    .select('*')
    .lte('fecha_observacion', asOfDateStr)
    .order('fecha_observacion', { ascending: false })
    .limit(100);

  if (params.productoId) {
    query = query.eq('producto_id', params.productoId);
  } else if (params.descripcionItem) {
    query = query.ilike('descripcion_item', `%${params.descripcionItem}%`);
  }

  if (params.categoriaInsumo) {
    query = query.eq('categoria_insumo', params.categoriaInsumo);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[CostEngine] Error querying cost observations:', error);
    throw new Error(`Error en motor de costos: ${error.message}`);
  }

  const observations: CostObservation[] = (data || []).map((row: any) => ({
    id: row.id,
    empresaId: row.empresa_id,
    productoId: row.producto_id,
    projectId: row.project_id,
    proveedorId: row.proveedor_id,
    fuente: row.fuente,
    documentoId: row.documento_id,
    descripcionItem: row.descripcion_item,
    categoriaInsumo: row.categoria_insumo,
    cantidad: Number(row.cantidad),
    unidad: row.unidad,
    precioUnitario: Number(row.precio_unitario) * Number(row.tipo_cambio || 1.0),
    moneda: row.moneda,
    tipoCambio: Number(row.tipo_cambio || 1.0),
    fechaObservacion: row.fecha_observacion,
    esVolatil: row.es_volatil
  }));

  return calculateCostEstimate(observations, asOfDateStr, params.config);
}

/**
 * Registra una nueva observación transaccional de costo en la base de datos
 */
export async function recordCostObservation(observation: Omit<CostObservation, 'id'>): Promise<string> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('cost_observations')
    .insert({
      empresa_id: observation.empresaId,
      producto_id: observation.productoId || null,
      project_id: observation.projectId || null,
      proveedor_id: observation.proveedorId || null,
      fuente: observation.fuente,
      documento_id: observation.documentoId || null,
      descripcion_item: observation.descripcionItem,
      categoria_insumo: observation.categoriaInsumo,
      cantidad: observation.cantidad,
      unidad: observation.unidad,
      precio_unitario: observation.precioUnitario,
      moneda: observation.moneda,
      tipo_cambio: observation.tipoCambio || 1.0,
      fecha_observacion: observation.fechaObservacion,
      es_volatil: observation.esVolatil || false
    })
    .select('id')
    .single();

  if (error) {
    console.error('[CostEngine] Error recording cost observation:', error);
    throw new Error(`Error al registrar observación de costo: ${error.message}`);
  }

  return data.id;
}
