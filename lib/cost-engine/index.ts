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
    .or('estado_evidencia.eq.VALIDA,estado_evidencia.is.null')
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
    // INVARIANTE CANÓNICO DE MONEDA:
    // cost_observations.precio_unitario ya se persiste 100% normalizado a PYG.
    // tipo_cambio es solo metadato de trazabilidad y NO debe volverse a multiplicar.
    precioUnitario: Number(row.precio_unitario),
    moneda: row.moneda,
    tipoCambio: row.tipo_cambio != null ? Number(row.tipo_cambio) : undefined,
    fechaObservacion: row.fecha_observacion,
    esVolatil: row.es_volatil,
    estadoEvidencia: row.estado_evidencia || 'VALIDA'
  }));

  return calculateCostEstimate(observations, asOfDateStr, params.config);
}

/**
 * Registra una nueva observación transaccional de costo en la base de datos
 * Invariante canónico: precio_unitario siempre en PYG, tipo_cambio solo como metadato,
 * sin defaults ficticios.
 */
export async function recordCostObservation(observation: Omit<CostObservation, 'id'>): Promise<string> {
  if (!observation.empresaId) throw new Error('empresaId es obligatorio');
  if (!observation.descripcionItem || !observation.descripcionItem.trim()) {
    throw new Error('descripcionItem es obligatoria');
  }
  if (!observation.unidad || !observation.unidad.trim()) {
    throw new Error('unidad de medida es obligatoria y no puede inventarse ni omitirse');
  }
  if (!observation.cantidad || observation.cantidad <= 0) {
    throw new Error('cantidad debe ser estrictamente mayor a cero');
  }
  if (!observation.fechaObservacion || !observation.fechaObservacion.trim()) {
    throw new Error('fechaObservacion es obligatoria');
  }
  if (observation.precioUnitario === undefined || observation.precioUnitario === null || observation.precioUnitario < 0) {
    throw new Error('precioUnitario no puede ser nulo ni negativo');
  }

  // Canonical PYG normalization:
  let normalizedPricePyg = observation.precioUnitario;
  if (observation.moneda === 'USD') {
    if (!observation.tipoCambio || observation.tipoCambio <= 0) {
      throw new Error('tipoCambio válido mayor a cero es obligatorio para normalizar costos en USD a PYG');
    }
    normalizedPricePyg = observation.precioUnitario * observation.tipoCambio;
  }

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
      descripcion_item: observation.descripcionItem.trim(),
      categoria_insumo: observation.categoriaInsumo,
      cantidad: observation.cantidad,
      unidad: observation.unidad.trim().toUpperCase(),
      precio_unitario: normalizedPricePyg,
      moneda: 'PYG',
      tipo_cambio: observation.tipoCambio || null,
      fecha_observacion: observation.fechaObservacion,
      es_volatil: observation.esVolatil || false,
      estado_evidencia: observation.estadoEvidencia || 'VALIDA'
    })
    .select('id')
    .single();

  if (error) {
    console.error('[CostEngine] Error recording cost observation:', error);
    throw new Error(`Error al registrar observación de costo: ${error.message}`);
  }

  return data.id;
}
