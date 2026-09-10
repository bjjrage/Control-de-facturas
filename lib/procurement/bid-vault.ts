/**
 * COMPANY BID VAULT MODULE (GATE 9)
 * Gestión de la bóveda documental versionada y estructurada para preparación de licitaciones públicas.
 */

import { createClient } from '@/lib/supabase/server';

export type VaultCategory = 'LEGAL' | 'FISCAL' | 'FINANCIERO' | 'EXPERIENCIA' | 'PERSONAL' | 'MAQUINARIA' | 'OTRO';

export type VaultDocumentStatus = 'VIGENTE' | 'POR_VENCER' | 'VENCIDO' | 'EN_TRAMITE' | 'OBSOLETO';

export interface VaultItem {
  id: string;
  empresaId: string;
  categoria: VaultCategory;
  tipoDocumento: string;
  titulo: string;
  descripcion?: string;
  archivoUrl?: string;
  archivoStoragePath?: string;
  archivoNombre?: string;
  archivoMimeType?: string;
  archivoTamanoBytes?: number;
  fechaEmision?: string;
  fechaVencimiento?: string;
  esVencible: boolean;
  metadatos: Record<string, any>;
  estado: VaultDocumentStatus;
  version: number;
  documentoPadreId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Evalúa en memoria el estado de vigencia de un documento dado un horizonte temporal
 */
export function evaluateDocumentValidity(
  fechaVencimiento?: string | null,
  esVencible: boolean = false,
  asOfDateStr: string = new Date().toISOString().split('T')[0],
  alertDaysThreshold: number = 30
): VaultDocumentStatus {
  if (!esVencible || !fechaVencimiento) {
    return 'VIGENTE';
  }

  const asOf = new Date(asOfDateStr).getTime();
  const expires = new Date(fechaVencimiento).getTime();
  const diffDays = Math.floor((expires - asOf) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return 'VENCIDO';
  }
  if (diffDays <= alertDaysThreshold) {
    return 'POR_VENCER';
  }
  return 'VIGENTE';
}

/**
 * Obtiene el resumen de documentos de la bóveda clasificados por categoría y salud de vigencia
 */
export function summarizeVaultHealth(items: VaultItem[], asOfDateStr?: string) {
  const summary = {
    total: items.length,
    vigentes: 0,
    porVencer: 0,
    vencidos: 0,
    byCategory: {} as Record<VaultCategory, { total: number; vigentes: number; vencidos: number }>
  };

  const categories: VaultCategory[] = ['LEGAL', 'FISCAL', 'FINANCIERO', 'EXPERIENCIA', 'PERSONAL', 'MAQUINARIA', 'OTRO'];
  for (const cat of categories) {
    summary.byCategory[cat] = { total: 0, vigentes: 0, vencidos: 0 };
  }

  for (const item of items) {
    const status = evaluateDocumentValidity(item.fechaVencimiento, item.esVencible, asOfDateStr);
    summary.byCategory[item.categoria].total++;

    if (status === 'VIGENTE') {
      summary.vigentes++;
      summary.byCategory[item.categoria].vigentes++;
    } else if (status === 'POR_VENCER') {
      summary.porVencer++;
      summary.byCategory[item.categoria].vigentes++;
    } else if (status === 'VENCIDO') {
      summary.vencidos++;
      summary.byCategory[item.categoria].vencidos++;
    }
  }

  return summary;
}

/**
 * Carga los documentos de la bóveda del tenant desde Supabase
 */
export async function fetchCompanyVaultItems(
  supabase: any,
  empresaId: string
): Promise<VaultItem[]> {
  try {
    const { data, error } = await supabase
      .from('company_bid_vault_items')
      .select('*')
      .eq('empresa_id', empresaId)
      .order('created_at', { ascending: false });

    if (error || !data) {
      return [];
    }

    return data.map((row: any) => ({
      id: row.id,
      empresaId: row.empresa_id,
      categoria: row.categoria,
      tipoDocumento: row.tipo_documento,
      titulo: row.titulo,
      descripcion: row.descripcion ?? undefined,
      archivoUrl: row.archivo_url ?? undefined,
      archivoStoragePath: row.archivo_storage_path ?? undefined,
      archivoNombre: row.archivo_nombre ?? undefined,
      archivoMimeType: row.archivo_mime_type ?? undefined,
      archivoTamanoBytes: row.archivo_tamano_bytes != null ? Number(row.archivo_tamano_bytes) : undefined,
      fechaEmision: row.fecha_emision ?? undefined,
      fechaVencimiento: row.fecha_vencimiento ?? undefined,
      esVencible: !!row.es_vencible,
      metadatos: row.metadatos ?? {},
      estado: row.estado,
      version: Number(row.version ?? 1),
      documentoPadreId: row.documento_padre_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  } catch (err) {
    console.error('[BidVault] Error fetching vault items:', err);
    return [];
  }
}
