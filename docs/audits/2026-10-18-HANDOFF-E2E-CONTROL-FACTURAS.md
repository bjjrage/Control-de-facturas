# Handoff del proyecto para la auditoría final

Fecha: 18/10/2026. Destinatario: agente que hará la revisión de código y los recorridos E2E previos al merge. Este documento describe el estado comprobado al entregarlo; **no declara GO ni autoriza el merge**. El procedimiento de trabajo está en el [plan de auditoría](2026-10-18-PLAN-AUDITORIA-CODIGO-FLUJOS-E2E.md).

## Objetivo y límites

Auditar el candidato consolidado de Control de Facturas, corregir en **esa misma rama** los defectos demostrados, repetir las pruebas afectadas y emitir un dictamen GO/NO-GO basado en evidencia. No crear otra rama preview, otro proyecto Supabase o un deployment para resolver la auditoría. No mergear a `main` ni desplegar a producción como parte de este encargo. No usar cuentas, repositorios, SQL ni conexiones de Nexora.

La única base autorizada para pruebas y fixtures es el proyecto Supabase aislado `kyiihlkncatojvlasoag`. El proyecto de producción `ezucivipgmbvamhugkbj` queda **fuera de alcance**: no leerlo, migrarlo, modificarlo ni usarlo como destino por defecto. Existe un incidente histórico de SQL aplicado al entorno equivocado y reparado; está narrado en informes anteriores, no requiere acción sobre producción para esta auditoría.

## Estado Git y publicación

| Elemento | Estado verificado al handoff |
|---|---|
| Repositorio | `bjjrage/Control-de-facturas` |
| PR único | [#38](https://github.com/bjjrage/Control-de-facturas/pull/38), borrador, `codex/compras-ventas-merge-prep` → `main` |
| `main` | `953ebba505b38313bd3e18e6cb9fbf31b7e1eb89` |
| Candidato antes de estos documentos | `0129df4a18933a3ef131ebbcbb251f1bd35c1c15`, 14 commits delante y cero detrás de ese `main` |
| Ramas históricas | `codex/compras-ventas-integration` es ancestro lineal del candidato; `recovery/compras-ventas-approved` diverge, pero sus contratos relevantes fueron contrastados y la guarda faltante de AppShell ya se incorporó |

El commit que publique este handoff cambiará el SHA del candidato. **Anotar el SHA remoto nuevo y congelarlo antes de ejecutar E2E**. Si `main` avanza o la rama cambia durante la auditoría, reconciliar y volver a validar el SHA final. No mezclar automáticamente las ramas históricas: el PR #38 es el único candidato.

El checkout de trabajo contiene modificaciones y archivos sin seguimiento previos ajenos a estos documentos (`integration-evidence/`, scripts QA sueltos, `design-qa.md` y un handoff histórico en la raíz). No borrarlos ni incluirlos en commits por accidente. Usar `git status` y agregar archivos de forma explícita.

## Qué se implementó y qué está demostrado

El candidato integra Compras/Ventas con RFQ y cotización externa, OC y recepción, factura/original/conciliación, orden de pago y tesorería; ventas con proforma/aceptación externa, OT, remisión, factura y cobro; controles financieros en SQL; ajustes de UI del ERP. Las migraciones de octubre del candidato ya se aplicaron y registraron en la **base aislada**. No volver a ejecutar el paquete completo por costumbre.

Migraciones relevantes para revisar: `supabase/migrations/20261017182341_audit_financial_guards.sql`, `20261017182538_warehouse_portal_external_actor.sql`, `20261017194800_sales_receipt_idempotency.sql`, `20261017194900_work_order_transition_guards.sql`, `20261017201618_sales_document_atomic_write.sql` y `20261017204700_invoice_core_atomic_write.sql`. También importa `20261015015138_receipt_portal_confirm_stock.sql` para la recepción. Comprobar versión, definición, permisos y triggers contra el ledger de **`kyiihlkncatojvlasoag`** antes de cualquier prueba; todo comando de Supabase debe fijar explícitamente ese ref y verificar el destino. Nunca inferir el destino del enlace local de la CLI.

Evidencia previa, que **no sustituye** la auditoría final: 2296 pruebas Vitest ejecutadas y aprobadas, 16 omitidas; build Next 16.3.8 con `--webpack`, TypeScript y 59 páginas estáticas aprobados; pruebas SQL/PGlite y transaccionales de atomicidad aprobadas; navegador local con dos usuarios QA comprobó lectura propia/ajena, RLS de lectura, alta/edición de venta y selección de depósito central. Los fixtures de esa corrida se limpiaron y se comprobó ausencia de huérfanos. La lectura de un documento ajeno devuelve HTTP 200 por streaming de Next, pero el contenido no se divulga y RLS devuelve cero filas: el estado HTTP aislado **no** es un criterio de privacidad suficiente.

El estado publicado sigue siendo **NO-GO**. Brechas abiertas: C06 OCR de PDF escaneado; C07 tramo posterior de original/identidad/OC para factura de compra; R03 fallo real de Storage y compensación; V06 escrituras entre empresas; OT01/OT02 transición real, cantidades acumuladas y cancelación; matriz completa de roles y superficies; cobro/reintento de V05 en navegador sobre build final; recorrido integrado de Compras/Ventas. La prueba de selección de depósito central R04 ya pasó, pero debe comprobarse en el SHA final si se toca ese flujo. El informe anterior puede contener afirmaciones de cierre hoy superadas por el [estado de integración](2026-10-17-merge-readiness.md).

## Mapa de código para comenzar

| Recorrido | Entradas y lógica clave |
|---|---|
| RFQ y compras | `app/(internal)/rfqs/`, `app/cotizar/[token]/`, `lib/rfq/` |
| OC, recepción y stock | `app/(internal)/orders/`, `app/recepcion/[token]/`, `app/warehouse/[token]/`, `app/api/warehouse-portal/[token]/`, `lib/inventory/` |
| Factura de compra, pago y tesorería | `app/(internal)/invoices/`, `app/(internal)/pagos/`, `app/(internal)/tesoreria/`, `lib/invoice-*` |
| Ventas, cotización externa y cobros | `app/(internal)/ventas/`, `app/cotizacion/[token]/`, `lib/sales-post-ot.ts`, `lib/sales-receivables.ts` |
| Órdenes de trabajo | `app/(internal)/ordenes-trabajo/`, `app/(internal)/ventas/[id]/quotation-actions.ts`, migración de guardas OT |
| Auditorías y QA previos | `docs/audits/2026-10-17-merge-readiness.md`, `docs/audits/2026-10-17-e2e-premerge-runbook.md`, `docs/audits/2026-10-17-inventario-cobertura.json`, `scripts/qa/` |

Puntos críticos concretos: `app/(internal)/invoices/actions.ts` llama `create_invoice_with_lines_atomico`; `app/(internal)/ventas/actions.ts` usa `save_sales_document_atomico`, `registrar_cobro_idempotente` y `revertir_cobro_atomico`; `app/(internal)/pagos/actions.ts` llama `ejecutar_orden_pago_atomica`; `lib/inventory/service.ts` llama `inventory_confirm_warehouse_submission`. Revisar cada frontera UI → acción → RPC → RLS/triggers → datos/Storage y la conducta ante reintentos o fallos intermedios.

## Trampa del harness E2E actual

`playwright.config.ts` usa `createGuardedLocalWebServer`; su modo predeterminado arranca `next dev`, por lo que `npm run e2e` tal cual **no demuestra** el build final. `tests/e2e/auth.setup.ts` contiene correos fijos y usa `E2E_PASSWORD`; genera sesiones en `tests/e2e/.auth/`. Parte de la suite depende de filas existentes y algunos recorridos pueden mutar datos. No ejecutar la suite completa sobre cuentas o documentos de negocio para declararla PASS.

Preparar un harness dedicado con cuentas/empresas QA temporales, verificación **exacta** de `kyiihlkncatojvlasoag.supabase.co`, `npm.cmd run build -- --webpack` y `npm.cmd run start -- --hostname 127.0.0.1 --port <puerto>`; ejecutar navegador contra ese build, no contra `next dev`. `scripts/qa/verify-isolated-sales-tenant-browser.cjs` sirve como ejemplo limitado de fixture y limpieza, pero prueba solo una parte de Ventas. Guardar estados de sesión y claves fuera de Git, usar datos sintéticos, registrar IDs y limpiar en `finally` con comprobación posterior. No enviar mensajes externos reales por los portales.

## Infraestructura y reportes

No hay preview web remoto del HEAD actual. Vercel generó un intento automático `CANCELED` por Ignored Build Step; dos checks de proyectos Vercel ajenos al despliegue principal fallan antes de compilar con `[MISSING_SERVICES]`. No crear otro deployment, enlazar otra base ni transferir `SUPABASE_SERVICE_ROLE_KEY` a Vercel. El build local conectado a la aislada permite hacer la auditoría funcional.

El [runbook anterior](2026-10-17-e2e-premerge-runbook.md) define P1–P4, V1–V2, S1, D1 y U1. El nuevo [plan](2026-10-18-PLAN-AUDITORIA-CODIGO-FLUJOS-E2E.md) agrega revisión exhaustiva del diff, pruebas adversariales, evidencia por caso y puerta de aceptación. Reportar los hechos por nivel: revisión estática, unitarias/PGlite, SQL real, navegador con Auth/Storage y conciliación de datos. No convertir una prueba de un nivel en certificación de otro.

## Instrucción lista para el agente

> Trabajá únicamente sobre el PR #38 (`codex/compras-ventas-merge-prep`) de Control de Facturas y la base aislada `kyiihlkncatojvlasoag`. Leé primero este handoff y luego el plan E2E vinculado. Congelá el SHA, revisá todo el diff funcional frente a `main`, ejecutá los casos de código y flujo en el build final local con fixtures sintéticos, corregí defectos en la misma rama, repetí las regresiones y dejá evidencia verificable y dictamen GO/NO-GO. No toques producción, Nexora, `main` ni otra base; no hagas merge o deployment. Separá lo realmente ejecutado de lo pendiente.
