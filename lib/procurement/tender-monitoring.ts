/**
 * TENDER MONITORING AGENT (GATE 15)
 * Monitor reactivo y autónomo del ciclo de vida de licitaciones públicas seguidas:
 * 1. Detección de cambios de estado (CONVOCADA -> ADJUDICADA / CANCELADA / DESIERTA).
 * 2. Detección de nuevas adendas y aclaraciones publicadas en la DNCP.
 * 3. Detección de postergaciones o prórrogas en la fecha límite de entrega / apertura.
 * 4. Generación de eventos y alertas operativas con nivel de severidad (CRITICAL, WARNING, INFO).
 * 5. Determinación de acción requerida (e.g., RECALCULAR_OFERTA, RENOVAR_GARANTIA, PRESENTARSE, INFORMAR).
 */

export interface TenderDocumentFingerprint {
  id?: string;
  tipo?: string | null;
  tipo_detalle?: string | null;
  titulo?: string | null;
  url?: string | null;
}

export interface TenderSnapshot {
  tenderId: string;
  status: string;
  submissionDeadline: string; // ISO date/time
  clarificationsCount?: number;
  addendaCount?: number;
  documents?: TenderDocumentFingerprint[];
  lastModifiedDate: string;
}

export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface MonitoringAlert {
  id: string;
  tenderId: string;
  eventType: 'NUEVA_ADENDA' | 'PRORROGA_FECHA' | 'CAMBIO_ESTADO' | 'ACLARACION_PUBLICADA' | 'NUEVO_DOCUMENTO' | 'SIN_CAMBIOS';
  severity: AlertSeverity;
  title: string;
  description: string;
  actionRequired: 'REVISAR_ADENDA_Y_RECALCULAR' | 'ACTUALIZAR_CALENDARIO' | 'VERIFICAR_RESULTADOS' | 'REVISAR_DOCUMENTACION' | 'NINGUNA';
  detectedAt: string;
}

/**
 * Determina si un documento corresponde a una adenda o enmienda contractual oficial
 */
export function isAddendumDocument(doc: TenderDocumentFingerprint): boolean {
  const text = `${doc.tipo || ''} ${doc.tipo_detalle || ''} ${doc.titulo || ''}`.toLowerCase();
  return (
    text.includes('adenda') ||
    text.includes('enmienda') ||
    text.includes('modificaci') ||
    doc.tipo === 'tenderNotice' && text.includes('rectificaci')
  );
}

/**
 * Determina si un documento corresponde a una nota o acta de aclaración
 */
export function isClarificationDocument(doc: TenderDocumentFingerprint): boolean {
  const text = `${doc.tipo || ''} ${doc.tipo_detalle || ''} ${doc.titulo || ''}`.toLowerCase();
  return (
    text.includes('aclaraci') ||
    text.includes('consulta') ||
    text.includes('circular') ||
    doc.tipo === 'clarifications'
  );
}

/**
 * Compara dos snapshots consecutivos de una licitación para detectar cambios y disparar alertas basadas en evidencia
 */
export function compareTenderSnapshots(
  previous: TenderSnapshot,
  current: TenderSnapshot
): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = [];
  const now = new Date().toISOString();

  // 1. Análisis de documentos basado en huella digital (URL o tipo+titulo)
  if (current.documents && previous.documents) {
    const prevKeySet = new Set(
      previous.documents.map(d => d.url || `${d.tipo_detalle || d.tipo}-${d.titulo}`)
    );

    const newDocs = current.documents.filter(
      d => !prevKeySet.has(d.url || `${d.tipo_detalle || d.tipo}-${d.titulo}`)
    );

    for (const doc of newDocs) {
      if (isAddendumDocument(doc)) {
        alerts.push({
          id: `alert-addenda-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tenderId: current.tenderId,
          eventType: 'NUEVA_ADENDA',
          severity: 'CRITICAL',
          title: `Nueva adenda detectada: ${doc.titulo || doc.tipo_detalle || 'Adenda oficial'}`,
          description: `El pliego fue modificado formalmente en la DNCP. Es mandatorio revisar si alteró cómputos, especificaciones técnicas o plazos.`,
          actionRequired: 'REVISAR_ADENDA_Y_RECALCULAR',
          detectedAt: now
        });
      } else if (isClarificationDocument(doc)) {
        alerts.push({
          id: `alert-clarification-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tenderId: current.tenderId,
          eventType: 'ACLARACION_PUBLICADA',
          severity: 'INFO',
          title: `Nueva aclaración publicada: ${doc.titulo || doc.tipo_detalle || 'Aclaración'}`,
          description: `El convocante respondió consultas de oferentes sin emitir una adenda modificatoria sustancial.`,
          actionRequired: 'NINGUNA',
          detectedAt: now
        });
      } else {
        alerts.push({
          id: `alert-doc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          tenderId: current.tenderId,
          eventType: 'NUEVO_DOCUMENTO',
          severity: 'INFO',
          title: `Nuevo documento publicado: ${doc.titulo || doc.tipo_detalle || 'Documento adicional'}`,
          description: `Se publicó un nuevo documento administrativo o técnico en el portal de la DNCP.`,
          actionRequired: 'REVISAR_DOCUMENTACION',
          detectedAt: now
        });
      }
    }
  } else if ((current.addendaCount ?? 0) > (previous.addendaCount ?? 0)) {
    // Fallback cuantitativo si no se proveyeron listas completas de documentos
    const diff = (current.addendaCount ?? 0) - (previous.addendaCount ?? 0);
    alerts.push({
      id: `alert-addenda-${Date.now()}`,
      tenderId: current.tenderId,
      eventType: 'NUEVA_ADENDA',
      severity: 'CRITICAL',
      title: `Se publicaron ${diff} nueva(s) adenda(s) en la DNCP`,
      description: `El pliego ha sido modificado oficialmente. Es mandatorio revisar si alteró cómputos, especificaciones o fórmulas económicas.`,
      actionRequired: 'REVISAR_ADENDA_Y_RECALCULAR',
      detectedAt: now
    });
  }

  // 2. Detección de prórrogas o cambios en la fecha límite
  if (current.submissionDeadline && previous.submissionDeadline && current.submissionDeadline !== previous.submissionDeadline) {
    alerts.push({
      id: `alert-deadline-${Date.now()}`,
      tenderId: current.tenderId,
      eventType: 'PRORROGA_FECHA',
      severity: 'WARNING',
      title: 'Modificación de fecha límite de presentación y apertura',
      description: `La fecha límite cambió de ${previous.submissionDeadline} a ${current.submissionDeadline}.`,
      actionRequired: 'ACTUALIZAR_CALENDARIO',
      detectedAt: now
    });
  }

  // 3. Detección de cambios de estado del proceso
  if (current.status && previous.status && current.status !== previous.status) {
    let severity: AlertSeverity = 'INFO';
    if (current.status === 'CANCELADA' || current.status === 'DESIERTA') {
      severity = 'CRITICAL';
    } else if (current.status === 'ADJUDICADA') {
      severity = 'WARNING';
    }

    alerts.push({
      id: `alert-status-${Date.now()}`,
      tenderId: current.tenderId,
      eventType: 'CAMBIO_ESTADO',
      severity,
      title: `Cambio de estado: ${previous.status} -> ${current.status}`,
      description: `La licitación ha pasado formalmente al estado ${current.status}.`,
      actionRequired: 'VERIFICAR_RESULTADOS',
      detectedAt: now
    });
  }

  // 4. Detección de nuevas aclaraciones (fallback cuantitativo)
  if (!current.documents && (current.clarificationsCount ?? 0) > (previous.clarificationsCount ?? 0)) {
    const diff = (current.clarificationsCount ?? 0) - (previous.clarificationsCount ?? 0);
    alerts.push({
      id: `alert-clarification-${Date.now()}`,
      tenderId: current.tenderId,
      eventType: 'ACLARACION_PUBLICADA',
      severity: 'INFO',
      title: `Publicadas ${diff} nueva(s) nota(s) de aclaración`,
      description: 'El convocante respondió consultas de oferentes sin modificar sustancialmente el pliego.',
      actionRequired: 'NINGUNA',
      detectedAt: now
    });
  }

  return alerts;
}
