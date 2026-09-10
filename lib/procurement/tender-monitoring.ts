/**
 * TENDER MONITORING AGENT (GATE 15)
 * Monitor reactivo y autónomo del ciclo de vida de licitaciones públicas seguidas:
 * 1. Detección de cambios de estado (CONVOCADA -> ADJUDICADA / CANCELADA / DESIERTA).
 * 2. Detección de nuevas adendas y aclaraciones publicadas en la DNCP.
 * 3. Detección de postergaciones o prórrogas en la fecha límite de entrega / apertura.
 * 4. Generación de eventos y alertas operativas con nivel de severidad (CRITICAL, WARNING, INFO).
 * 5. Determinación de acción requerida (e.g., RECALCULAR_OFERTA, RENOVAR_GARANTIA, PRESENTARSE, INFORMAR).
 */

export interface TenderSnapshot {
  tenderId: string;
  status: string;
  submissionDeadline: string; // ISO date/time
  clarificationsCount: number;
  addendaCount: number;
  lastModifiedDate: string;
}

export type AlertSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface MonitoringAlert {
  id: string;
  tenderId: string;
  eventType: 'NUEVA_ADENDA' | 'PRORROGA_FECHA' | 'CAMBIO_ESTADO' | 'ACLARACION_PUBLICADA' | 'SIN_CAMBIOS';
  severity: AlertSeverity;
  title: string;
  description: string;
  actionRequired: 'REVISAR_ADENDA_Y_RECALCULAR' | 'ACTUALIZAR_CALENDARIO' | 'VERIFICAR_RESULTADOS' | 'NINGUNA';
  detectedAt: string;
}

/**
 * Compara dos snapshots consecutivos de una licitación para detectar cambios y disparar alertas
 */
export function compareTenderSnapshots(
  previous: TenderSnapshot,
  current: TenderSnapshot
): MonitoringAlert[] {
  const alerts: MonitoringAlert[] = [];
  const now = new Date().toISOString();

  // 1. Detección de nuevas adendas
  if (current.addendaCount > previous.addendaCount) {
    const diff = current.addendaCount - previous.addendaCount;
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
  if (current.submissionDeadline !== previous.submissionDeadline) {
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
  if (current.status !== previous.status) {
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

  // 4. Detección de nuevas aclaraciones
  if (current.clarificationsCount > previous.clarificationsCount) {
    const diff = current.clarificationsCount - previous.clarificationsCount;
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
