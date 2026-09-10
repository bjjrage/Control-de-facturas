/**
 * TENDER MONITORING RUNNER (GATE 15)
 * Motor desatendido de monitoreo y sondeo periódico de licitaciones públicas:
 * 1. Selecciona licitaciones activas ('CONVOCATORIA', 'EVALUACION', o con seguimiento activo).
 * 2. Consulta de forma resiliente la API OCDS de la DNCP para cada licitación.
 * 3. Ejecuta la detección diferencial por huella digital de documentos (compareTenderSnapshots).
 * 4. Persiste alertas operativas críticas e informativas en audit_logs.
 * 5. Actualiza el estado y fecha de sincronización (synced_at) de la licitación.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { fetchRecord, DncpNotFoundError } from '../dncp/client';
import { parseCompiledRelease } from '../dncp/parse';
import { compareTenderSnapshots, MonitoringAlert, TenderSnapshot } from './tender-monitoring';

export interface TenderMonitoringBatchOptions {
  empresaId?: string;
  limit?: number;
  dryRun?: boolean;
}

export interface TenderMonitoringBatchResult {
  checkedCount: number;
  updatedCount: number;
  alertsGeneratedCount: number;
  criticalAlertsCount: number;
  alerts: MonitoringAlert[];
  errors: Array<{ tenderId: string; dncpNro: string; error: string }>;
  startedAt: string;
  finishedAt: string;
}

/**
 * Ejecuta un lote de monitoreo desatendido sobre licitaciones activas
 */
export async function runTenderMonitoringBatch(
  supabase: SupabaseClient,
  options: TenderMonitoringBatchOptions = {}
): Promise<TenderMonitoringBatchResult> {
  const startedAt = new Date().toISOString();
  const limit = options.limit ?? 25;
  const errors: TenderMonitoringBatchResult['errors'] = [];
  const allAlerts: MonitoringAlert[] = [];
  let updatedCount = 0;
  let criticalAlertsCount = 0;

  // 1. Buscar licitaciones activas ordenadas por la fecha de sincronización más antigua
  let query = supabase
    .from('licitaciones')
    .select('id, empresa_id, dncp_nro, ocid, titulo, estado, fecha_entrega_ofertas, raw_json, synced_at')
    .neq('decision', 'DESCARTADA')
    .order('synced_at', { ascending: true, nullsFirst: true })
    .limit(limit);

  if (options.empresaId) {
    query = query.eq('empresa_id', options.empresaId);
  }

  const { data: tenders, error: fetchErr } = await query;

  if (fetchErr || !tenders) {
    return {
      checkedCount: 0,
      updatedCount: 0,
      alertsGeneratedCount: 0,
      criticalAlertsCount: 0,
      alerts: [],
      errors: [{ tenderId: 'GLOBAL', dncpNro: 'N/A', error: fetchErr?.message || 'Error consultando licitaciones' }],
      startedAt,
      finishedAt: new Date().toISOString()
    };
  }

  // 2. Procesar secuencialmente cada licitación para respetar límites de tasa de la DNCP
  for (const lic of tenders) {
    const nro = lic.dncp_nro;
    if (!nro) continue;

    try {
      // Consultar estado actual en la DNCP
      let compiled: Record<string, unknown>;
      try {
        compiled = await fetchRecord(nro);
      } catch (err) {
        if (err instanceof DncpNotFoundError) {
          errors.push({ tenderId: lic.id, dncpNro: nro, error: 'Licitación no encontrada en la DNCP' });
        } else {
          errors.push({ tenderId: lic.id, dncpNro: nro, error: (err as Error).message || String(err) });
        }
        continue;
      }

      const parsed = parseCompiledRelease(compiled);
      const c = parsed.cabecera;

      // Construir snapshots de comparación
      const prevDocs = Array.isArray(lic.raw_json?.tender?.documents)
        ? lic.raw_json.tender.documents.map((d: any) => ({
            tipo: d.documentType,
            tipo_detalle: d.documentTypeDetails,
            titulo: d.title,
            url: d.url
          }))
        : [];

      const currDocs = Array.isArray((compiled as any)?.tender?.documents)
        ? (compiled as any).tender.documents.map((d: any) => ({
            tipo: d.documentType,
            tipo_detalle: d.documentTypeDetails,
            titulo: d.title,
            url: d.url
          }))
        : [];

      const previousSnapshot: TenderSnapshot = {
        tenderId: lic.id,
        status: lic.estado || 'DESCONOCIDO',
        submissionDeadline: lic.fecha_entrega_ofertas || '',
        documents: prevDocs,
        lastModifiedDate: lic.synced_at || startedAt
      };

      const currentSnapshot: TenderSnapshot = {
        tenderId: lic.id,
        status: c.estado || lic.estado || 'DESCONOCIDO',
        submissionDeadline: c.fecha_entrega_ofertas || lic.fecha_entrega_ofertas || '',
        documents: currDocs,
        lastModifiedDate: startedAt
      };

      // Comparación diferencial de Gate 15
      const tenderAlerts = compareTenderSnapshots(previousSnapshot, currentSnapshot);

      for (const alert of tenderAlerts) {
        allAlerts.push(alert);
        if (alert.severity === 'CRITICAL') {
          criticalAlertsCount++;
        }

        if (!options.dryRun) {
          // Registrar alerta en log de auditoría del sistema
          await supabase.from('audit_logs').insert({
            empresa_id: lic.empresa_id,
            action: 'tender.monitoring_alert',
            detail: {
              licitacion_id: lic.id,
              dncp_nro: nro,
              titulo: lic.titulo,
              event_type: alert.eventType,
              severity: alert.severity,
              alert_title: alert.title,
              description: alert.description,
              action_required: alert.actionRequired,
              detected_at: alert.detectedAt
            }
          });
        }
      }

      if (!options.dryRun) {
        // Actualizar cabecera con nuevo raw_json y synced_at
        await supabase
          .from('licitaciones')
          .update({
            estado: c.estado || lic.estado,
            estado_detalle: c.estado_detalle,
            fecha_entrega_ofertas: c.fecha_entrega_ofertas || lic.fecha_entrega_ofertas,
            raw_json: compiled,
            synced_at: startedAt,
            updated_at: startedAt
          })
          .eq('id', lic.id);
      }

      updatedCount++;
    } catch (err) {
      errors.push({
        tenderId: lic.id,
        dncpNro: nro,
        error: (err as Error).message || String(err)
      });
    }
  }

  return {
    checkedCount: tenders.length,
    updatedCount,
    alertsGeneratedCount: allAlerts.length,
    criticalAlertsCount,
    alerts: allAlerts,
    errors,
    startedAt,
    finishedAt: new Date().toISOString()
  };
}
