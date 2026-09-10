/**
 * TEST SUITE: TENDER MONITORING AGENT (GATE 15)
 * Verifica:
 * 1. Detección inmediata de nuevas adendas con severidad CRITICAL
 * 2. Detección de prórrogas de fecha con ajuste de calendario
 * 3. Detección de adjudicación o cancelación de llamados
 * 4. Detección de notas de aclaración informativas
 */

import { compareTenderSnapshots, TenderSnapshot } from '../lib/procurement/tender-monitoring';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

async function runTests() {
  console.log('\n======================================================');
  console.log('🧪 TEST SUITE: TENDER MONITORING AGENT (GATE 15)');
  console.log('======================================================\n');

  const baseline: TenderSnapshot = {
    tenderId: 'DNCP-455120',
    status: 'CONVOCADA',
    submissionDeadline: '2026-04-10T09:00:00Z',
    clarificationsCount: 1,
    addendaCount: 0,
    lastModifiedDate: '2026-03-01'
  };

  // CASO 1: Convocante publica Adenda y prorroga plazo
  console.log('--- TEST 1: Detección de Adenda Modificatoria y Prórroga ---');
  const snapshotWithAddenda: TenderSnapshot = {
    ...baseline,
    addendaCount: 1,
    submissionDeadline: '2026-04-20T09:00:00Z', // +10 días de prórroga
    lastModifiedDate: '2026-03-15'
  };

  const alerts1 = compareTenderSnapshots(baseline, snapshotWithAddenda);
  console.log(`Alertas detectadas: ${alerts1.length}`);
  alerts1.forEach(a => console.log(`   [${a.severity}] ${a.title} -> Acción: ${a.actionRequired}`));

  assert(alerts1.length === 2, 'Genera exactamente 2 alertas (Adenda + Prórroga)');
  assert(alerts1.some(a => a.eventType === 'NUEVA_ADENDA' && a.severity === 'CRITICAL'), 'Alerta de Adenda catalogada como CRITICAL');
  assert(alerts1.some(a => a.eventType === 'PRORROGA_FECHA' && a.actionRequired === 'ACTUALIZAR_CALENDARIO'), 'Alerta de prórroga exige actualización de calendario');

  // CASO 2: Licitación adjudicada formalmente
  console.log('\n--- TEST 2: Detección de Adjudicación ---');
  const snapshotAwarded: TenderSnapshot = {
    ...snapshotWithAddenda,
    status: 'ADJUDICADA',
    lastModifiedDate: '2026-05-02'
  };

  const alerts2 = compareTenderSnapshots(snapshotWithAddenda, snapshotAwarded);
  console.log(`Alertas en adjudicación: ${alerts2.length}`);
  alerts2.forEach(a => console.log(`   [${a.severity}] ${a.title} -> Acción: ${a.actionRequired}`));

  assert(alerts2.length === 1, 'Genera 1 alerta de cambio de estado');
  assert(alerts2[0].eventType === 'CAMBIO_ESTADO' && alerts2[0].actionRequired === 'VERIFICAR_RESULTADOS', 'Requiere verificar resultados oficiales');

  // CASO 3: Detección granular por huella digital de documentos (No disparar NUEVA_ADENDA si es solo un anexo)
  console.log('\n--- TEST 3: Huella Digital de Documentos (Adenda vs Anexo vs Aclaración) ---');
  const snapWithInitialDocs: TenderSnapshot = {
    tenderId: 'DNCP-455120',
    status: 'CONVOCADA',
    submissionDeadline: '2026-04-10T09:00:00Z',
    documents: [
      { tipo: 'tenderNotice', tipo_detalle: 'Pliego de Bases', titulo: 'PBC Llamado 455120', url: 'https://dncp.gov.py/doc1.pdf' }
    ],
    lastModifiedDate: '2026-03-01'
  };

  // 3.1 Se sube un anexo genérico: NO debe ser NUEVA_ADENDA
  const snapWithAttachment: TenderSnapshot = {
    ...snapWithInitialDocs,
    documents: [
      ...snapWithInitialDocs.documents!,
      { tipo: 'technicalSpecifications', tipo_detalle: 'Plano', titulo: 'Plano de Estructura', url: 'https://dncp.gov.py/plano.pdf' }
    ]
  };
  const alertsDoc = compareTenderSnapshots(snapWithInitialDocs, snapWithAttachment);
  assert(alertsDoc.length === 1, 'Genera 1 alerta por nuevo documento');
  assert(alertsDoc[0].eventType === 'NUEVO_DOCUMENTO', 'Documento técnico no es adenda, es NUEVO_DOCUMENTO');
  assert(alertsDoc[0].severity === 'INFO', 'Severidad es INFO');

  // 3.2 Se publica una Adenda Modificatoria formal: SÍ debe ser NUEVA_ADENDA
  const snapWithRealAddenda: TenderSnapshot = {
    ...snapWithAttachment,
    documents: [
      ...snapWithAttachment.documents!,
      { tipo: 'tenderNotice', tipo_detalle: 'Adenda N° 1', titulo: 'Modificación de Cómputo Métrico', url: 'https://dncp.gov.py/adenda1.pdf' }
    ]
  };
  const alertsAddenda = compareTenderSnapshots(snapWithAttachment, snapWithRealAddenda);
  assert(alertsAddenda.length === 1, 'Genera 1 alerta por adenda');
  assert(alertsAddenda[0].eventType === 'NUEVA_ADENDA', 'Identifica fielmente la adenda');
  assert(alertsAddenda[0].severity === 'CRITICAL', 'Severidad de adenda es CRITICAL');

  // 3.3 Se publica una Nota de Aclaración: SÍ debe ser ACLARACION_PUBLICADA
  const snapWithClarification: TenderSnapshot = {
    ...snapWithRealAddenda,
    documents: [
      ...snapWithRealAddenda.documents!,
      { tipo: 'clarifications', tipo_detalle: 'Aclaración N° 1', titulo: 'Respuesta a Consultas', url: 'https://dncp.gov.py/aclaracion1.pdf' }
    ]
  };
  const alertsClarif = compareTenderSnapshots(snapWithRealAddenda, snapWithClarification);
  assert(alertsClarif.length === 1, 'Genera 1 alerta por nota de aclaración');
  assert(alertsClarif[0].eventType === 'ACLARACION_PUBLICADA', 'Identifica fielmente la nota de aclaración');

  // CASO 4: Scheduled Background Runner (runTenderMonitoringBatch)
  console.log('\n--- TEST 4: Scheduled Background Runner (Batch Polling) ---');
  const { runTenderMonitoringBatch } = await import('../lib/procurement/tender-monitoring-runner');

  const insertedAuditLogs: any[] = [];
  const updatedLicitaciones: any[] = [];

  const mockSupabase: any = {
    from: (table: string) => {
      if (table === 'licitaciones') {
        return {
          select: () => ({
            neq: () => ({
              order: () => ({
                limit: (lim: number) => Promise.resolve({
                  data: [
                    {
                      id: 'lic-batch-1',
                      empresa_id: 'emp-101',
                      dncp_nro: '455120',
                      ocid: 'ocds-03ad3f-455120',
                      titulo: 'Construcción Puente MOPC',
                      estado: 'CONVOCATORIA',
                      fecha_entrega_ofertas: '2026-04-10T09:00:00Z',
                      raw_json: {
                        tender: {
                          documents: [
                            { documentType: 'tenderNotice', documentTypeDetails: 'Pliego', title: 'PBC Inicial', url: 'https://dncp.gov.py/pbc.pdf' }
                          ]
                        }
                      },
                      synced_at: '2026-03-01T10:00:00Z'
                    }
                  ],
                  error: null
                })
              })
            })
          }),
          update: (patch: any) => ({
            eq: (field: string, val: any) => {
              updatedLicitaciones.push({ field, val, patch });
              return Promise.resolve({ error: null });
            }
          })
        };
      }
      if (table === 'audit_logs') {
        return {
          insert: (entry: any) => {
            insertedAuditLogs.push(entry);
            return Promise.resolve({ error: null });
          }
        };
      }
      return {};
    }
  };

  const batchResult = await runTenderMonitoringBatch(mockSupabase, { limit: 1, dryRun: false });
  console.log(`Licitaciones verificadas: ${batchResult.checkedCount} | Actualizadas: ${batchResult.updatedCount} | Alertas: ${batchResult.alertsGeneratedCount}`);

  assert(batchResult.checkedCount === 1, 'Procesa exactamente 1 licitación en el lote');
  assert(batchResult.startedAt !== undefined, 'Registra timestamp de inicio');
  assert(batchResult.finishedAt !== undefined, 'Registra timestamp de finalización');

  console.log('\n======================================================');
  console.log('🎉 TODOS LOS TESTS DE GATE 15 PASARON CON ÉXITO');
  console.log('======================================================\n');
}

runTests().catch(err => {
  console.error('Error fatal en suite de pruebas Gate 15:', err);
  process.exit(1);
});
