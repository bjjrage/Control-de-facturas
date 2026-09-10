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
