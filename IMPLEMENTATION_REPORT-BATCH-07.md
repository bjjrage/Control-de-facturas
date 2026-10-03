# Batch 07 — Forecast + BIM / ejecución

Base: f65790b6c4c76f6b5dd8e8e09779d10fb0f41232. Branch: batch/07-forecast-bim-execution. PR base: batch/06-tender-project-handoff.

## Descubrimiento completo del módulo
BIM upload/parser/IfcUnitAssignment/QTO, storage, modelos/elementos/grupos, matching técnico y LLM, sugerencias/decisiones/regroup, creación de partidas y aplicación de cantidades; Cómputo/APU/pricing compartidos; Gantt/importación/borrado de cronograma/dependencias; ejecución interna y portal/fotos; Forecast actions, motor puro, velocidades observadas/programadas, BOM, stock confirmado e inbound neto, analista operacional/cache, clima/proveedores/cron, jornadas y evidencia/causalidad, métricas climáticas; reportes/Curva S y certificados congelados; handoff/baseline/tenant/ACL/RLS y catálogo real de Preview. Inspección read-only del commit histórico 746549c2b007e327daacbfce67b77bf6439a9aff; no cherry-pick/merge. Rutas y gating existentes conservados.

## P1 corregidos
- Clima consultaba tablas y columnas ausentes del baseline desplegado. Nuevas migrations restauran el contrato climático existente (sin ejecutar backfill/recalcular historia) y métricas de Forecast.
- Forecast filtraba execution_entries por empresa_id inexistente y BOM por productos.codigo/unidad_medida inexistentes: usa proyecto autorizado y campos sku/unidad reales, errores obligatorios.
- Forecast inventaba coordenadas de Asunción y mutaba projects al correr: exige coordenadas reales finitas; 0 válido; no cambia configuración ni baseline. Horizonte entero 7..90 y fecha ISO real.
- Forecast usa rango exacto Open-Meteo y cobertura real, no multiplica días sin evidencia; no asume campos faltantes como 0; días duplicados/fuera del horizonte no suman capacidad. Proyección nunca antes del cronograma. Duración y horizonte inclusivos.
- Error de lectura de stock/recepciones/costos no equivale a disponibilidad cero. Stock único inventory_stock_by_project, sumado por producto; inbound autorizado neto de CONFIRMED, sin doble cómputo. Precios con mismo selector factual de Costeo/APU/Plan Semanal, sin adoptar cotización automáticamente.
- Forecast persistía run/items en dos llamadas e ignoraba fallos: execution_save_forecast valida actor activo/plan/tenant/owner/hojas/factores/cantidades/fechas y guarda ambas tablas atómicamente. Snapshots append-only; no UPDATE de presupuesto, baseline, ejecución, certificados ni stock.
- Input snapshot inmutable contiene contexto/coordenadas/cobertura/clima/partidas/avance/BOM/stock/inbound/pricing provenance/análisis. SHA-256 derivado por DB. No convierte proyecciones en avance ejecutado o contractual.
- Motor y reportes excluyen padres mediante jerarquía canónica (fallback de códigos solo cuando no hay parent links), bloquean predecessor desconocido y evitan doble conteo. DB rechaza dependencia cruzada, self/ciclo y fechas incompletas/invertidas; serializa por proyecto.
- Curva S usa duración inclusiva y no traza valor financiero parcial como total cuando faltan precios contractuales: usa plan mensual/certificados existentes si disponibles, sin repartir award ni inventar precios de venta.
- BIM registration usa workspace_register_bim compartido, con provenance de objeto Storage y modelo+elementos en una transacción. Acciones scoped por proyecto; lecturas principales propagan errores.
- Apply BIM usa workspace_apply_bim_quantity compartido: CAS, locks, owner, unidades explícitamente compatibles, suma factual y un solo match confirmado por elemento. Rechaza sets parcialmente incompatibles/no medidos; no excluye silenciosamente elementos para alterar Cómputo.
- Confirmación de grupo y actualización opcional de cantidad atómicas; total cacheado del grupo no es autoridad factual. Creación de partidas desde grupos atómica e idempotente, sin precio de venta inventado; retry concurrente no duplica partidas.
- Preview expuso UPDATE policy ausente en bim_elements que producía cero filas modificadas durante regroup: policy project-scoped y guards de actor/plan Caterpillar, modelo/grupo/owner, origen inmutable. Confirmaciones no pueden ser destruidas por regroup ni borrado de modelo; membership y mediciones confirmadas protegidas.
- Clima conserva decisión humana: cron/automatización no confirman ni reemplazan jornadas confirmadas. Causas de lluvia posterior exigen lluvia confirmada previa del mismo proyecto. Fecha real dentro de período de ejecución; actor de evidencia/confirmación server-owned; Storage existente y causalidad verificados; evidencia append-only y jornadas confirmadas no se borran.
- DMH no atribuye observaciones de otro día al solicitado; null/blank/negativo no se convierten en medición 0. Fallback modelado queda explícito con fuente/error/raw payload; no certifica días por sí solo.
- Avance real exige partida hoja del mismo proyecto, cantidad finita no negativa, fecha no futura, actor autorizado; fotos verifican entrada/proyecto/objeto. Nunca reparenta historia.
- Integración B06: deleteProject rechaza proyectos con source_tender_id ANTES de borrar una ubicación vacía; conserva baseline y ubicación canónica.

## Validación
- Preview xddlzgjwufskgasomval ACTIVE_HEALTHY (branch d030820b-c2e1-4d52-b3cb-0e21ddacfbfb); ledger36 =20+5+2+9.
- 145 assertions PostgreSQL PASS en rollback: lifecycle PREBID/handoff + Forecast atómico/errores/ACL/hash/tenant, mediciones/causalidad/evidencia/actor, BIM factual/CAS/owner/decisiones, cronograma/ciclo, baseline intacto, actor inactivo/plan.
- Dos conexiones authenticated simultáneas: creación BIM PASS (una partida, cantidad4 aun con cache999); CAS PASS (una escritura y un P0409). Fixtures B07 aislados retenidos únicamente en Preview.
- Focused207 PASS/12 skipped (20 archivos). Tests nuevos19 de dominio/actions; fixtures antiguos de demanda completa ahora contienen cobertura completa explícita, conservando assertions económicas.
- Full serial1427 PASS/16 skipped; comando maxWorkers1/testTimeout30000. Typecheck PASS. Next16.3.1 Webpack build PASS. Resultado final en manifest.
- Security Advisor: RPCs authenticated SECURITY DEFINER nuevas intencionales, limitadas por actor/tenant/plan/contexto, search_path fijo y sin anon/service execute. No findings nuevos RLS ausente/anon/search_path mutable en entidades nuevas. Findings legacy documentados fuera del batch.
- Browser autenticado / smoke visual: NOT VERIFIED. No se declara deploy Vercel ni validación en producción; DB/RPC reales y build sí verificados.

## Límites y findings residuales
P0: none. P1: corregidos y Preview verificados.
P2: disponibilidad de DMH/LLM/Open-Meteo puede degradar Forecast; DMH expone última observación, no prueba por sí sola acumulado contractual completo. El residente debe revisar fuente, timestamp, fotos/medición local y confirmar. Días sin registro son disponibilidad de planificación, no evidencia de ejecución. Valores monetarios agregados son parciales si hay materiales/precios contractuales desconocidos, identificados para revisión; no equivalen al award ni a certificados. Fotos opcionales y metadata GPS/browser no prueban físicamente stock/avance. Browser autenticado pendiente.
P3: helpers de presentación legacy conservados; no nuevo motor, UI redesign, Weekly Plan/MRP/Need-to-Buy ni Batch08.
Baseline contractual y tender/PREBID inmutables. Solo ejecución recibe cantidades/fechas por acción humana; ningún reparenting de RFQ ni datos productivos reconciliados.

- IFC revision identity: un GUID físico no se suma dos veces entre modelos/versiones ni se aplica si ya fue contado en otra partida. Histórico conservado; CAS y serialización del contexto.

## Migraciones nuevas
- 20261003150104_execution_climate_contract_restore.sql
- 20261003150147_execution_snapshot_and_bim_boundaries.sql
- 20261003150909_execution_schedule_and_decision_guards.sql
- 20261003151619_execution_bim_live_permissions.sql
- 20261003151935_execution_observation_provenance.sql
- 20261003152452_execution_bim_computo_atomic.sql
- 20261003153235_execution_forecast_input_provenance.sql
- 20261003153432_execution_climate_history_guard.sql
- 20261003153954_execution_ifc_revision_identity.sql
Todas aplicadas exclusivamente en Preview y conservadas inmutables tras aplicación; correcciones posteriores por nueva versión. No cambio de las20 aplicadas inicialmente.

## Fuentes verificadas
Open-Meteo API: https://open-meteo.com/en/docs (rango/cobertura hasta16días). DMH/DINAC feed: https://www.meteorologia.gov.py/emas/data.json (últimas observaciones con timestamp/valores null reales). Supabase Advisor: https://supabase.com/docs/guides/database/database-linter?lint=authenticated_security_definer_function_executable.

IMPLEMENTED / TESTED / PREVIEW VERIFIED: YES.
MAIN MODIFIED: NO. PRODUCTION MODIFIED: NO. PR MERGED: NO. PRODUCTION DEPLOY: NOT PERFORMED.
