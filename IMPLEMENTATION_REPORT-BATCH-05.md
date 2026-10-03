# Batch 05 — Inventario canónico

Base: 585420964c0332cf75777b5a1b55a8196dc477ab. Preview: xddlzgjwufskgasomval.
Producción permanece READ ONLY. Anomalía 71x2: ACCEPTED DATA-RECONCILIATION ANOMALY; no bloquea Batch06.

## DISCOVERED MODULE SURFACES
Inventario global/stock/catalogo oculto; detalle de materiales; dashboard/portfolio; inventario y consumo del proyecto; ubicaciones; carga inicial Excel/ajustes/transferencias/devoluciones; OC receipt actions/services/UI; receipt portal y warehouse portal/API/token; rendición/evidencia/processing/revisión/confirmación; ledger/costs/balances/vistas; RLS/ACL/triggers/RPC; legacy stock; assistant stock tools/resolver/formatter; lectores existentes de Forecast y procurement; jobs de facturas inspeccionados sin introducir otro procesador de inventario; tests dominio/servicio/evidencia y contratos históricos vs DB real.

## P1 corregidos
- RPCs receipt/create/product mapping/manual warehouse line ausentes del baseline desplegado restaurados en NUEVA migration; sin backfill histórico.
- oc_order_item_recibido incluye solo CONFIRMED; DRAFT/VOIDED excluidos. Ledger inventory_movements/costs/balances es autoridad física única.
- Receipts distintos serializan por OC; parciales no superan remanente. Confirmación repetida no duplica movimientos.
- Header/líneas confirmados y provenance inmutables; tenant/producto/unidad/actor validados en DB. Cantidad de recepción conserva 4 decimales.
- Identidad lógica de apertura: empresa/producto/destino/fecha efectiva/moneda, independiente de UUID aleatorio. Advisory lock y trigger al confirmar. Mismos hechos devuelven ID existente; hechos cambiados o identidad histórica ambigua rechazan y requieren revisión. Ajustes normales siguen posibles.
- Posting genérico y RPCs externos service-only. Wrapper manual valida actor/tenant/permiso. Escrituras legacy de stock cerradas.
- Portal receipt crea+confirma en una transacción; consumo revalida token/contexto bajo lock y usa attempt como source_line_id. Retry persistido en localStorage, no nueva clave por reload/error de red. Payload pendiente cambiado rechaza.
- UUID de link externo no se inserta en auth.users FK. Consumo conserva link como actor externo; receipt/evidence usan sponsor interno válido.
- Lectores físicos consumen vistas canónicas y suman buckets monetarios. Error DB no se presenta como cero. Resolver no anuncia counter legacy y formatter consume shape real.

## Validaciones
29/29 pruebas PostgreSQL Preview PASS: apertura retry/nueva UUID/payload/tenant/unidades/concurrencia; receipt DRAFT/parcial/completa/retry/exceso/inmutabilidad/concurrencia; transferencia/consumo; portal real receipt+consumption, presupuesto inválido, stock insuficiente, token revocado; ACL reales anon/auth/service.
Fixtures sintéticos B05 aislados retenidos en Preview para auditar concurrencia. No datos de prueba en producción.
Preview ledger25 = base20 + 5 nuevas migrations. Applied migrations inmutables.
Focused/full regression/TypeScript/build: resultados finales en manifest.
Security Advisor: portales y posting genérico sin EXECUTE anon/authenticated; helpers private con search_path fijo. RPCs humanas authenticated por diseño, con límites internos.
Legacy fuera de scope: competitor views definer, funciones ajenas anon/search_path, password protection. No arreglos laterales.
Browser autenticado y extracción real por IA de evidencia externa: NOT VERIFIED; no se declara smoke que no se ejecutó.

## Evidencia productiva exacta
Archivo audit-evidence/BATCH-05-INITIAL-STOCK-PAIRS.json: 142 IDs/claves/timestamps/contextos/hechos/metadata obtenidos READ ONLY.
Dos series completas71, mismo carga-inicial-stock-100-MAGY.xlsx, filas2..72, fecha2026-09-28, mismos productos/qty/unidades/destinos/contextos/costos; claves diferentes.
Serie1 2026-09-28 03:25:44.518617–03:26:44.654269 UTC; serie2 03:48:22.631236–03:49:19.965684 UTC.
142 cost rows, 71 balances no cero; conservación mecánica por producto sin diferencias. Checksum cantidades20008 es control técnico de unidades mezcladas, no magnitud física agregable.
Counter legacy coincide mecánicamente, no es validación independiente del stock físico.
ROOT CAUSE: clave aleatoria de intento usada como identidad de evento; sin exclusión/serialización del mismo conteo inicial, el segundo import se aceptó como nuevo stock.
FUTURE PREVENTION: identidad lógica y serialización de apertura, guard al confirmar y retry estable. No borra ni ignora historial confirmado.

## PRODUCTION REMEDIATION PLAN — NOT EXECUTED
1. Congelar evidencia y cotejar los71 pares con Excel original y responsable del conteo físico.
2. Aprobar explícitamente cuál serie duplica el conteo, cantidades y unidades por ubicación; no elegir por timestamp automáticamente.
3. Revisar consumos/transferencias/recepciones posteriores, costos y disponibilidad por bucket; no compensar si produciría saldo negativo o costos inconsistentes sin resolver dependencias.
4. Preparar expediente de71 ajustes compensatorios mediante motor canónico con IDs reversados, motivo, aprobación humana y claves estables. No DELETE ni UPDATE directo del ledger/balances/costos.
5. Ensayar expediente aislado, revisar impacto físico/contable, obtener autorización SEPARADA para producción.
6. Solo bajo autorización futura ejecutar y verificar conservación/saldos/trazabilidad.
PRODUCTION REMEDIATION EXECUTED: NO.

## Pendientes P2/P3
Reconciliación física aceptada pendiente. Upload de evidencia opcional del portal ocurre después de movimiento y no revierte la recepción si storage falla; gate obligatorio de warehouse submissions preservado. get_material_need solo cambia lector físico; matching/campos económicos legacy se conservan para Batch08. Forecast completo se audita en Batch07. Sin redesign, MRP ni Need-to-Buy.

IMPLEMENTED: hardening/wiring. TESTED: unit/regression/DB. PREVIEW VERIFIED: schema/RPC/locks/balances/ACL. PRODUCTION VERIFIED: evidencia READ ONLY y ledger20; fixes NO DEPLOYED.
No main mutation, merge, producción, infraestructura nueva ni Batch08.
