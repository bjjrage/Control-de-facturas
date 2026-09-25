# ERP MASTER WIRING AUDIT
origin/main: 43add3f33eff8625b17c9c8ad303a946f90f42fd
fecha: 2026-09-24

## Resultado ejecutivo

El estado que puede sostenerse con esta auditoría es **PARTIALLY WIRED**, no “ERP certificado E2E”. Hay recorridos completos a nivel de código para partes importantes (p. ej. aceptación de cotización→OT, scanner→alta de factura y plan semanal→reserva central), pero quedan límites entre modelos de inventario, acciones multi-escritura no atómicas, superficies no descubribles y dependencias/runtime que no fueron validados.

| Dominio | Evaluación estática | Conclusión corta |
|---|---|---|
| Administración | PARTIALLY WIRED | Facturas, compras, ventas, cobros y tesorería tienen UI/acciones/RPCs; hay caminos legacy, pasos manuales entre dominios y excepciones no atómicas. |
| Obras / Operaciones | PARTIALLY WIRED | Presupuesto, BIM/cómputo, plan semanal, ejecución y certificados existen; MRP mezcla stock de obra legacy con disponibilidad central canónica. Inventario, Recepciones y Pañol están implementados, pero ocultos de la navegación del proyecto. |
| Licitaciones | PARTIALLY WIRED | Ingesta DNCP, evaluación y conversión a obra están conectadas; extracción de requisitos requiere texto provisto y puede usar requisitos genéricos. Auction Lab es un simulador persistido; Auction Bot no conserva su política y no opera contra DNCP. |
| Rodrigo | PARTIALLY WIRED | Tiene chat, tareas, registry, tools de ERP y aprobaciones durables; el alcance real depende de cada tool/proveedor y no equivale a autonomía E2E. |
| Aislamiento multiempresa | UNKNOWN en runtime | El código deriva empresa desde el perfil y hay políticas/RPCs tenant-scoped en migraciones; no se ejecutaron pruebas RLS ni consultas contra una base. |

## Alcance, método y límites

- Se fijó como fuente el SHA exacto de origin/main indicado arriba, tras fetch de origin. El checkout compartido permaneció en recovery/restore-legacy-surface-contract; no se usó su código como autoridad.
- Se compararon superficies/cambios relevantes con ee31ef962eeb51f8765e05ac5db650c25192a081 (pre-NIU V3) y f7a48a0dc125425d4aa9bba7ea8970427056e0fd (recuperación de superficies). No se cambió ni se movió ninguna rama.
- El trabajo es lectura estática de rutas, componentes, acciones, servicios, migraciones, tests y documentación. No se ejecutaron tests, scripts, RPCs, migraciones ni requests de aplicación. No se consultó Supabase.
- No se inspeccionó estado live, credenciales, datos, RLS aplicado, disponibilidad de proveedores, deployment ni comportamiento en dispositivo. Todo eso queda UNKNOWN; “hay una función/migración” no demuestra que opere en la instancia desplegada.
- Permanecieron intactos los artefactos untracked preexistentes: docs/ERP_OPERATIONAL_WIRING_AUDIT.md y instructivos y roadmap/Sistema Stock.html. El segundo no pertenece al árbol de origin/main.

### Criterios

| Etiqueta | Uso en este reporte |
|---|---|
| FULLY WIRED | Evidencia estática de superficie, handler, persistencia/efecto y lectura posterior del mismo contrato; no implica certificación live. |
| PARTIALLY WIRED | Hay partes conectadas, pero queda un salto manual, modelo duplicado, fallback, dependencia externa o ausencia de prueba runtime. |
| READ ONLY | Lee/proyecta datos sin acción de escritura en esa superficie. |
| LEGACY PATH | Camino anterior todavía ejecutable y no demostrado como migrado al modelo canónico. |
| DEAD/ORPHANED | No se encontró entrada ni caller alcanzable; no se marca así solo porque esté oculto. |
| BROKEN | Evidencia de contradicción/defecto estático concreto; no se infiere a partir de “no probado”. |
| HIDDEN | Renderer/ruta existe, pero no es descubrible por navegación normal observada. |
| UNKNOWN | La respuesta depende de ejecución, datos, credenciales o configuración no inspeccionados. |

Los rótulos “fully wired” describen solo la cadena estática. No se asigna ese estado a un módulo E2E completo porque no hubo ejecución.

## 1. Superficies, workspaces y navegación

### Workspaces globales

components/layout/workspace.ts:4-29 divide rutas en Administración, Operativo y Licitaciones. app/(internal)/layout.tsx:17-23 limita Operativo a plan Pro+ y rol administración/admin; Licitaciones a Pro+ y comercial/administración/admin. components/layout/topbar.tsx presenta el cambio de workspace. La selección de empresa no aparece como un selector de workspace/tenant en ese shell; lib/auth.ts resuelve el perfil/empresa activa.

La navegación global observada en components/layout/sidebar.tsx:82-129 incluye:

| Grupo | Rutas enlazadas | Observación |
|---|---|---|
| Administración | Dashboard; Proveedores, Cotizaciones/RFQ, OC, Facturas proveedor, Pagos, Stock; Clientes, Proformas, OT, Remisiones, Facturas de venta, NC, Cobros; Tesorería, Flujo de caja | Varias rutas además dependen de rol y flags de módulos Compras/Ventas. |
| Operativo | Dashboard de obras y navegación contextual por proyecto | El sidebar del proyecto se genera con el registry de features. |
| Licitaciones | Dashboard, Competidores, Documentos, Auction Bot y Auction Lab | No debe interpretarse Auction Lab como integración de subasta real. |

Discrepancias de discoverability verificadas:

| Superficie | Evidencia | Estado |
|---|---|---|
| Inventario global /inventario | La ruta renderiza snapshot canónico (app/(internal)/inventario/page.tsx e inventario-global-section.tsx), pero no aparece en GLOBAL_ITEMS, COMPRAS_ITEMS, FINANZAS_ITEMS ni en enlaces globales del sidebar. | HIDDEN; además READ ONLY en esa ruta. |
| Inventario, Recepciones y Pañol del proyecto | lib/projects/project-features.ts:68-73 coloca inventario, recepciones y panol en PROJECT_NAV_HIDDEN_FEATURE_KEYS; getProjectFeatureGroups los filtra en líneas 86-91. Existen los renderers en project-tabs-client.tsx. La validación de tab usa las keys/gates, por lo que una URL directa puede seguir siendo accesible. | HIDDEN, no DEAD/ORPHANED. |
| Stock de proyecto | Sigue expuesto como “Stock / Materiales” y convive con Inventory canónico. | LEGACY PATH; no es sustituto del saldo canónico. |
| /costs | Hay route de aplicación, pero no se localizó un enlace de entrada en el sidebar inspeccionado. | HIDDEN; caller de entrada adicional UNKNOWN. |
| Notificaciones/ayuda global | Topbar conserva controles no operativos o “próximamente”. | Parcial/placeholder, no una tarea ERP completa. |

La rama/histórico ee31ef tiene el shell anterior y los grupos de trabajo previos a la evolución actual; el diff desde ese snapshot contiene cambios amplios en shell, dashboard, scanner y módulos de obra. La reconstrucción posterior f7a48a0 incorporó un registry de superficies y pretendía hacer visibles Inventario/Recepciones/Pañol y el Inventario global. En el origin/main auditado, esas tres tabs vuelven a estar excluidas del sidebar y no hay entrada global a /inventario. Por tanto, el documento de recovery de f7 no describe la navegación efectiva de este SHA.

## 2. Administración

### Flujos y fronteras entre dominios

| Flujo | Recorrido estático | Estado / límite |
|---|---|---|
| Ventas y aceptación | /proformas o /ventas → link de cotización → /cotizacion/[token] → accept_quotation RPC → work_orders/work_order_items → aprobación interna en /ordenes-trabajo | PARTIALLY WIRED. El RPC de aceptación crea la OT con reglas idempotentes (migraciones 0090/0091; accept_quotation en 0091:357-536). La OT es un agregado distinto de projects; la conversión a obra ERP no queda demostrada como automática. Manual-de-obra.html también aclara que la OT por sí sola no mueve stock ni factura. |
| Cotización/compra | /rfqs → invitación a proveedores → /cotizar/[token] → quote_versions → selección de oferta → authorized_orders y partidas | PARTIALLY WIRED. app/(internal)/rfqs/[id]/actions.ts:52 ejecuta autorización y cambios relacionados como varias escrituras; no hay una transacción única de punta a punta visible en ese action. Falla intermedia puede dejar estados parciales. |
| Factura de proveedor | Alta manual, carga múltiple mediante invoice_jobs, worker que reclama/extracción y revisión → factura persistida → conciliación con OC / apto para pago | PARTIALLY WIRED. El worker requiere ejecución/configuración independiente; los tests y el worker no fueron arrancados. |
| Scanner→factura | Alta de factura integra ScanButton con contexto invoice; guarda scanner_session_id y createInvoice valida sesión/empresa/contexto antes de crear attachment/factura. | FULLY WIRED estáticamente para la integración de UI y el contrato de sesión; cámara móvil/dispositivo y backend desplegado UNKNOWN. No se afirmó validación física. |
| Factura apta→OP→pago | /invoices → APTO_PARA_PAGO → createPaymentOrderFromInvoice → payment_orders + payment_order_invoices → ejecutar_orden_pago_atomica → facturas/tesorería | PARTIALLY WIRED. El camino principal es RPC; existe fallback de compatibilidad no atómico en pagos/actions.ts:94-145 si falta la función: primero marca OP y factura y luego asienta tesorería, pudiendo devolver error tras haber aplicado parte del cambio. Instancia que ejecuta ese fallback UNKNOWN. |
| Tesorería | /tesoreria → cuentas, movimiento por registrar_movimiento_tesoreria, transferencia por registrar_transferencia | PARTIALLY WIRED. Escrituras contables dependen de RPC; alta de cuenta + saldo inicial son dos operaciones. No se validó conciliación contra banco real. |
| Inventario global | /inventario carga getCanonicalInventorySnapshot, cantidades/costos por location y links a obra | READ ONLY/HIDDEN. La página muestra el modelo canónico, pero la ruta global no ofrece el flujo completo de movimientos en esta superficie. |
| Empresas/usuarios | Perfil autenticado fija empresa_id; pantallas superadmin crean/administran empresas y usuarios | PARTIALLY WIRED/UNKNOWN. El diseño de tenant/RLS aparece en lib/auth.ts y migraciones de multi-tenant; no hubo pruebas de aislamiento entre empresas ni de permisos desplegados. |

### Dashboard administrativo

app/(internal)/dashboard/data.ts:152 pasa certificados: [] a build30DayCashflowItems. En consecuencia, aunque haya certificados de obra, el flujo de caja proyectado del dashboard no los incorpora por esa entrada. La consulta de alertas de productos usa productos.stock_actual, no el saldo disponible del inventario canónico; el dashboard no es una vista conciliada de inventario. Los KPIs de ventas, cobros, CxP y liquidez se calculan en lib/dashboard/admin-kpis.ts. Estado: PARTIALLY WIRED para lectura ejecutiva; no usar sus alertas como autoridad del stock/certificación.

## 3. Obras y operaciones

### Entrada de obra y presupuesto

Hay al menos tres workflows distintos y no deben confundirse:

| Workflow | UI/handler | Efecto observado | Estado |
|---|---|---|---|
| ImportBudgetDialog | app/(internal)/projects/[id]/import-budget-dialog.tsx:156,249,286 | Lee Excel/CSV en navegador y llama importBudgetItems para insertar budget_items de un proyecto existente. | FULLY WIRED estáticamente como importador de presupuesto. No es importador de certificado. |
| Workbook Interpreter | workbook-import-preview.tsx:202,226,263 → /api/workbook-interpretation → createProjectFromWorkbook en projects/actions.ts:107 | Interpreta planillas para alta de proyecto; puede aplicar presupuesto y certificado solo si se cumplen gates. MEDICIÓN puede quedar DETECTED_NOT_APPLIED (actions.ts:209; canonical-import.ts:218). | PARTIALLY WIRED: deliberadamente no garantiza aplicación de medición/ejecución. La suite/golden no se ejecutó en esta auditoría. |
| Receta productiva | import-recipe-dialog.tsx:123,236 → actions de receta | Carga relaciones de rubro/material y alimenta budget_item_materials/BOM para el MRP. | PARTIALLY WIRED junto con el ciclo MRP; requiere mapeo/confirmación. |

### Plan semanal, MRP y cobertura de materiales

La cadena de código es visible: objetivo físico → receta/BOM en budget_item_materials → cálculo de necesidad → preview/save del plan → commit_production_plan_atomic y inventory_reservations. weekly-plan-shared.ts:439 consulta reservas centrales. Sin embargo, las entradas no usan un único modelo:

- stock de obra se lee de stock_por_proyecto (lib/procurement/weekly-plan-shared.ts:270);
- recepción inbound se lee de oc_order_item_recibido (línea 298);
- stock central/reservas sí consulta inventario canónico y reservations (línea 439; weekly-plan-actions.ts:190).

La misma separación aparece en progress-forecast-actions.ts:173-193. Resultado: PARTIALLY WIRED, con una fuente legacy para stock físico de obra y una fuente canónica para disponibilidad central. Las cantidades pueden divergir si una recepción/consumo se registró solo en uno de los dos modelos.

**Hallazgo crítico de estado de recepción:** la vista oc_order_item_recibido se crea en migration 0042 y se redefine con security_invoker en 0080, pero ambas versiones suman oc_recepcion_items sin filtrar el estado de oc_recepciones. La migración canónica posterior añade status DRAFT/CONFIRMED/VOIDED (20260913230000_inventory_panol.sql:367-380), mientras el formulario visible de recepción de OC continúa llamando registrarRecepcion (orders/[id]/recepcion-section.tsx:10,74; orders/oc-recepcion-actions.ts:15,79). Ese action crea datos legacy sin señal de “confirmado”; al sumar todas las líneas, los borradores pueden contarse como recibidos para inbound/MRP. Esto es un riesgo estático verificable, no un resultado medido en datos live. Clasificación: BROKEN para el contrato de “recibido confirmado” de esa vista; P0 antes de confiar en la cobertura inbound.

La recepción canónica existe en inventory/actions.ts:31,402 y service/RPC asociado; el renderer Recepciones del proyecto presenta movimientos canónicos. Pero el ingreso de mercancía más obvio desde el detalle de OC sigue en el camino legacy. El mismo nombre oc_recepciones alberga además el ciclo de estado más nuevo; la separación de modelo no está cerrada.

### Ejecución, certificados, personal y subcontratistas

| Módulo | Fuente/efecto | Estado |
|---|---|---|
| Ejecución/avance diario | Tab de proyecto, action de execution_entries y portal /avance/[token] con evidencia. Avance alimenta mapas de cantidad de certificate actions. | PARTIALLY WIRED: el resync de un certificado borrador desde ejecución es una acción explícita (certificado-actions.ts:713), no una sincronización automática de cualquier estado. |
| Certificado del comitente | project_certificates/items con estados borrador/aprobación/facturación; permite copiar o pegar la columna Presente y recalcular desde unidades/ejecución. | PARTIALLY WIRED. paste-avance-dialog.tsx:96 llama bulkSetCertificatePresente; certificados-table.tsx muestra la columna Presente. En las superficies revisadas no aparece un uploader directo .xlsx/.xls para cargar el certificado. |
| Factura de certificado | createSalesDocumentFromCertificate (certificado-actions.ts:773) exige certificado APROBADO y crea borrador sales_documents; emisión posterior es manual. | PARTIALLY WIRED, puente explícito y trazable, no facturación automática. |
| Certificado de subcontratista | contracts/subcontractor certificates y portal separado /certificados/[token]. | PARTIALLY WIRED; no se encontró puente automático de aprobado a pago de proveedor. |
| Personal | daily_labor_entries y pantalla Caterpillar. | PARTIALLY WIRED; coste/impacto financiero requiere recorrido separado. |
| Cronograma/Clima | ProjectGantt y ClimateWorkdaysPanel; evaluar clima, confirmar/override y adjuntar evidencia. Cron de evaluación con secret gate. | PARTIALLY WIRED. La fuente meteorológica DMH/DINAC/Open-Meteo depende de red/configuración y no se validó aquí. |
| Informes | ProjectReports y exportadores consultan datos del proyecto. | READ/EXPORT; la actualización desde cada dominio no equivale a una conciliación global. |

### BIM y cómputo

La tab BIM/IFC está detrás de Caterpillar. bim-section.tsx carga IFC, registra modelo/elementos y expone matching/revisión; computo-section.tsx:109,218,232 acepta Excel/CSV y PDF en una ruta separada sin IFC. La confirmación humana puede actualizar cantidades de partidas; el export es otra salida. No se encontró un flujo que convierta cada sugerencia automáticamente en ejecución o certificado. Estado: PARTIALLY WIRED como herramientas de asistencia al presupuesto, no como digitalización IFC→obra E2E. DeepSeek/proveedor y comportamiento en un proyecto real UNKNOWN.

### Comparación con snapshots históricos

| Referencia | Diferencia relevante para este encargo |
|---|---|
| ee31ef962eeb51f8765e05ac5db650c25192a081 | Snapshot pre-NIU V3. Tenía el ERP/shell anterior y los grupos operativos previos; no contiene la nueva secuencia completa de Plan semanal, BIM/IFC ni las nuevas superficies canónicas de Inventario/Recepciones/Pañol. La comparación es de árbol/código, no un juicio de calidad visual. |
| f7a48a0dc125425d4aa9bba7ea8970427056e0fd | Recuperación de superficie con registry project-features, Plan semanal y propuesta explícita de descubrir Inventario, Recepciones, Pañol e Inventario global. El código actual conserva gran parte de la implementación, pero el filtro de navegación actual vuelve a ocultar tres features y no expone /inventario en el sidebar. |
| origin/main | Estado auditado arriba. No asumir que las afirmaciones de la certificación de f7 aplican a este SHA actual. |

## 4. Licitaciones y subastas

| Flujo | Recorrido/evidencia | Estado |
|---|---|---|
| Captura de DNCP | /licitaciones → ingreso de número → importarLicitacion en actions.ts:21 → fetchRecord → ingestar_proceso_ocds_global y snapshot tenant de licitación/items/documentos. | PARTIALLY WIRED; depende de DNCP/red, y la acción actualiza varias tablas en secuencia. Sin llamada externa no se certifica frescura/alcance de la fuente. |
| Radar/seguimiento | tender-monitoring cron lee licitaciones activas ya seguidas y agrega alertas/sync; el import inicial lo inicia el usuario con identificador DNCP. | PARTIALLY WIRED; no se evidencia descubrimiento amplio sin número/proceso aportado. |
| Documentos y readiness | Bóveda empresa_documentos, matriz genérica por categoría y vencimiento. | PARTIALLY WIRED. lib/dashboard/document-readiness.ts describe una heurística, no interpretación completa de pliegos por sí sola. |
| Extracción PBC/acta | extraerRequisitosDePliego(actions.ts:1107) recibe texto del PBC; extraerOfertasDeActa(:1186) recibe texto de acta y escribe ofertantes. | PARTIALLY WIRED. No equivale a carga/lectura automática de cualquier PDF. Si faltan requisitos extraídos, persistirEvaluacionComercial usa GENERIC_REQUIREMENT_SUGGESTIONS; una puntuación positiva no prueba lectura del PBC real. |
| Evaluación y conversión | persistirEvaluacionComercial congela análisis; convertirLicitacionAProyecto(:399) exige decisión GANADA, monto adjudicado positivo e ítems verificados y los pasa al presupuesto. | PARTIALLY WIRED; gate contractual fail-closed es explícito, pero aprobación económica, origen de datos e integración de proyecto son pasos diferenciados. |
| Auction Bot | auction-bot-client.tsx mantiene activePolicy/justFrozen solo en estado React y corre SimulatorRunnerView con escenario local. No se encontró llamada a DNCP desde esa superficie. | PARTIALLY WIRED/SIMULATOR ONLY; la política se pierde al recargar. No es bot de oferta productivo. |
| Auction Lab | /licitaciones/auction-lab carga auction_sandbox_rooms y ofrece salas/roles/tokens con acciones persistidas. La propia UI dice “Simulación — no es DNCP real” (auction-lab/page.tsx:20). | PARTIALLY WIRED como sandbox de simulación; no es conexión real. |

## 5. Rodrigo / agente

El widget en shell habla con /api/agent/chat y /api/agent/status. lib/agent/registry.ts fija esquema, roles y riskLevel del lado ERP; lib/tools/index.ts auto-registra tools de lectura, compras, plan semanal, inventario, certificados, tesorería, licitación, workbook y otros dominios. lib/agent/gateway.ts:137-142 valida requiredRoles; :189-223 detiene los tools de riesgo ≥2, crea approval REQUESTED y no ejecuta el handler hasta el gate de aprobación. Los handlers deben usar el empresaId confiable del actor (gateway.ts:226-231).

Estado: PARTIALLY WIRED, con guardrails visibles estáticamente:

- Lecturas de resumen de obra/stock/finanzas/licitación/OC y varias operaciones ERP están registradas.
- Hay ciclo durable de task/run/step, estado de espera y approvals con payload hash, además de acciones de decisión/ejecución en app/(internal)/agent/approval-actions.ts.
- Los niveles de riesgo y requiredRoles son heterogéneos por tool; muchos tools declaran requiredRoles null y dependen de contexto interno/validación del handler. No se ha certificado que cada acción ERP tenga los mismos roles que su pantalla humana.
- send_email tiene flujo de borrador/preview/aprobación y requiere integración externa; no se envió ningún mail ni se probó Gmail.
- No se ejecutaron tools, proveedores LLM ni event workers. No se comprobó si una tarea de conversación concreta puede completar todos sus pasos sin contexto humano.

No clasificar a Rodrigo como DEAD/ORPHANED: el widget, API, registry y handlers están conectados en el código. Tampoco clasificarlo como operador autónomo plenamente certificado.

## 6. Legacy vs canónico y bridges manuales

| Concepto | Camino legacy | Camino/capa más canónica | Consecuencia observada |
|---|---|---|---|
| Stock de obra | stock_movimientos / stock_por_proyecto / productos.stock_actual | inventory_locations, inventory_movements, inventory_balances y vistas por proyecto/consumo | MRP y forecast siguen leyendo stock_por_proyecto mientras dashboard/Inventory UI tiene otra fuente. |
| Recepción de compra | OC detail → registrarRecepcion → oc_recepciones/oc_recepcion_items → registrar_stock_movimiento | createCanonicalReceipt/confirmCanonicalReceipt y movimientos canónicos | Entry principal de OC permanece legacy; estado de confirmación no filtra la vista inbound. |
| Presupuesto | ImportBudgetDialog a budget_items | Workbook Interpreter en creación de proyecto y planilla embebida | Son flujos válidos pero distintos; Workbook puede retener MEDICIÓN pendiente. |
| Certificación | Presente manual/copiar-pegar | Resync borrador desde execution_entries; documento de venta opcional desde certificado aprobado | No se encontró uploader directo del workbook del certificado. |
| OT/proyecto | work_orders y workflow interno | projects con budget, ejecución y operación | Aceptar cotización crea OT; no se encontró conversión automática de cada OT aceptada a proyecto de construcción. |
| Compras/MRP | faltante informado en plan | RFQ/OC se crean por superficies de compra o tools aparte | MRP no abre/autoriza OC automáticamente, de forma coherente con gate humano; es un puente deliberado/manual. |
| Certificado/facturación | project_certificates | sales_documents.certificate_id vía acción explícita | Existe trazabilidad, pero el usuario debe disparar la creación y luego emitir el documento. |

## 7. Documentación: contrato escrito vs código actual

Se revisaron 14 HTML tracked de instructivos/roadmap y 2 Markdown tracked de recuperación/certificación. La clasificación dominante por documento frente a origin/main es: **VERIFIED (1), PARTIAL (10), STALE (3), ASPIRATIONAL (2)**. “VERIFIED” significa que el wiring descrito está presente en código; no valida runtime, despliegue ni datos.

| Documento | Estado dominante | Diferencia clave / evidencia |
|---|---|---|
| flujo-de-obra.html | PARTIAL | Describe MRP completo; el source aún mezcla stock_por_proyecto e inbound legacy con reserva central canónica (líneas de código citadas arriba). |
| manual-de-obra.html | STALE | Su matriz visible enumera grupos/tab anteriores (línea 519) y no refleja los actuales Plan semanal/BIM ni el filtro que oculta Inventario/Recepciones/Pañol. |
| modo_agente_frictionless_erp.html | ASPIRATIONAL | Lenguaje de modo/alcance futuro no equivale a recorrido implementado/certificado. |
| modulo-aceptacion-cotizacion-orden-trabajo.html | VERIFIED estáticamente | El RPC y la OT con aprobación interna existen en 0090/0091; no se valida funcionamiento live. |
| modulo-auction-bot-auction-lab.html | PARTIAL | Auction Lab está persistido y rotulado simulación; Auction Bot mantiene política solo en React. El doc declara SBE real futuro/pendiente, lo cual sí coincide. |
| modulo-bim-presupuesto.html | PARTIAL | Parser, matcher y revisión existen; proveedor LLM, resultados reales y actualización E2E no se ejecutaron. |
| modulo-control-scanner.html | PARTIAL | El scanner se integra al alta de factura; captura real WebKit/iPhone/producción queda UNKNOWN. |
| modulo-dias-climaticos.html | PARTIAL | UI/actions/evidencias y cron existen; fuente meteorológica, cron desplegado y resultados no se validaron. |
| modulo-erp predictivo semanal lookahead.html | PARTIAL | El motor existe, pero no usa un único read model canónico de stock físico e inbound. |
| modulo-frictionless-agent-rodrigo.html | PARTIAL | Registry, handler y approval existen; “frictionless” no prueba autonomía ni igualdad de permisos entre todos los tools. |
| modulo-plan-semanal-lookahead.html | PARTIAL | Describe reserva/coverage; stock de obra y estado de recepción mantienen seam legacy. |
| modulo-plan-semanal-obra.html | PARTIAL | Mismo hallazgo: flujo implementado por partes, sin contrato uniforme de inventario E2E. |
| modulo-planilla-embebida.html | PARTIAL | UI/grid y acciones de snapshot/autosave/confirm están presentes; RLS y ciclo durable no se probaron en un tenant aislado. |
| roadmap_control_de_facturas.html | ASPIRATIONAL | Es roadmap: sus estados deben leerse como planes/entregables, no como certificación del origin/main actual. |
| docs/ERP_SURFACE_CERTIFICATION.md | STALE para este SHA | Documenta explícitamente una rama/worktree de recuperación y base previa. Sus conteos/test/deploy no certifican 43add3f; tampoco se repitieron aquí. |
| docs/ERP_SURFACE_RECOVERY.md | STALE para este SHA | Afirma Inventario, Recepciones, Pañol e Inventario global como USER_SURFACE visibles; el sidebar de origin/main filtra las tres tabs y no enlaza /inventario. |

El archivo untracked Sistema Stock.html no es documentación de origin/main; se conserva como artefacto local y no se usa para declarar cumplimiento del producto.

## 8. Tests y evidencia de cobertura

Inventario de tests realizado por inspección del árbol, sin ejecución:

| Tipo | Ejemplos localizados | Qué cubren / qué no prueba esta auditoría |
|---|---|---|
| UNIT | weekly-plan, mrp-coverage, production-recipe, progress-forecast, dashboard KPI/cashflow, scanner detection/session, agent registry/gateway/approval, auction-bot | Algoritmos/estados aislados con fixtures o mocks. No prueba un deployment ni RLS real. |
| CONTRACT / SOURCE | project-features, migration-contract, inventory hardening, UI integration scanner, workbook import plan/golden | Contratos de forma y wiring por fuente; no demuestran que migraciones estén aplicadas. |
| INTEGRATION / LIVE | weekly-plan-atomic-db, mrp-rpc-live, mrp-lifecycle-live, weekly-plan-rls-auth, climate-workdays-rls-auth | Requieren variables/DB; varios archivos contienen ref/URL del proyecto Supabase de producción ezucivipgmbvamhugkbj. No se ejecutaron. |
| BROWSER / E2E | Playwright y scripts para scanner/cámara, workbook, subastas/licitaciones y flujos de plan semanal | No se ejecutaron; no se probó autenticación/empresa/deployment en navegador. |

La existencia de una prueba llamada E2E o RLS no equivale a resultado E2E/RLS. No se proporciona un porcentaje de cobertura: no se ejecutó el runner ni se consultó reporte vigente. Los tests live que apuntan al ref de producción son una barrera de seguridad P0 para cualquier corrida futura: deben reconfigurarse a entorno aislado antes de ejecutarse.

## 9. Hallazgos priorizados

### P0

1. **Inbound de MRP puede contar recepciones DRAFT como recibidas.** La vista oc_order_item_recibido suma todas las líneas sin filtrar estado, y el schema actual sí distingue DRAFT/CONFIRMED/VOIDED. El camino visible de OC crea recepciones legacy. No confiar en cifras de cobertura hasta validar/corregir el contrato de confirmación y la fuente utilizada.
2. **Hay pruebas de integración que apuntan a Supabase de producción.** Los archivos live encontrados incluyen ezucivipgmbvamhugkbj. Ningún test fue ejecutado; una corrida futura requiere aislar/parametrizar el target antes de autorizar ejecución.

### P1

1. **Dos libros de inventario se consultan dentro del mismo ciclo de obra.** stock_por_proyecto alimenta stock de obra/forecast, mientras el inventario canónico recibe/consume por inventory_movements y inventory_balances. El global canónico es además READ ONLY y HIDDEN.
2. **El formulario principal de recepción de OC escribe por el camino legacy.** La acción canónica existe, pero no es el mismo entry point. Riesgo de saldos distintos entre MRP, /stock y /inventario.
3. **Navegación/documentación no coincide con origin/main.** Inventario, Recepciones y Pañol de obra están filtrados; Inventario global no está enlazado; los dos Markdown de recuperación reflejan una rama anterior.
4. **No existe uploader directo de Excel de certificado en las superficies revisadas.** El UI documenta/implementa pegado de la columna Presente; el presupuesto y workbook interpreter son flujos diferentes.
5. **La proyección de caja/stock del Dashboard no es canónica/completa.** Los certificados se pasan como lista vacía y alertas de bajo stock usan productos.stock_actual.
6. **Operaciones multi-tabla no siempre comparten una transacción.** RFQ→OC, alta de cuenta→saldo inicial y el fallback de pago pueden persistir parcialmente. Los caminos atómicos deben ser obligatorios o el fallback eliminarse/encapsularse.
7. **Elegibilidad de licitación puede derivarse de requisitos genéricos.** Si el texto real del PBC no se extrajo/proveyó, el sistema evalúa sugerencias genéricas; el resultado no es certificación documental del pliego.
8. **Auction Bot no es el producto real descrito por “bot operativo”.** La política no persiste en la UI y el simulador no envía ofertas DNCP. Auction Lab sí tiene sandbox persistido, expresamente simulado.

### P2

1. Separar visual y semánticamente stock legacy del inventario canónico en rutas, nombres y reportes para evitar que los usuarios traten ambos saldos como intercambiables.
2. Exponer/retirar deliberadamente rutas ocultas (/inventario, /costs y tabs Inventory/Recepciones/Pañol) en vez de depender de links directos o URLs recordadas.
3. Añadir a dashboard/reportes procedencia, fecha de cálculo y cobertura/exclusiones de certificados, stock y compromisos de compra.
4. Marcar como histórica la certificación f7 en el propio título/metadata de ambos Markdown, si se mantienen como evidencia documental del repositorio.

## 10. Causas raíz y plan mínimo de reparación (sin implementación)

### Root cause 1 — coexistencia de contratos de inventario

El camino de stock legacy se mantuvo vivo al agregar el ledger canónico; luego partes de MRP, forecast, recepción OC, dashboard y nuevas pantallas quedaron leyendo/escribiendo contratos distintos. La vista de inbound también ignora los nuevos estados de recepción.

**Reparación mínima sugerida:** escoger el ledger canónico como fuente única para saldos y recepción confirmada; hacer que el commit del plan, la recepción de OC y el consumo de pañol usen ese contrato; reconstruir inbound con estado confirmado y referencia a OC/partida; reconciliar las proyecciones legacy antes de retirar compatibilidad. No basta con cambiar una etiqueta del sidebar.

### Root cause 2 — surface contract no gobierna todos los entry points

El registry de features existe, pero el código lo usa intencionalmente para filtrar tres tabs canónicas; además, el sidebar global y las rutas contextuales no publican Inventario global. Documentos de recuperación cuentan una superficie distinta de la que el usuario puede descubrir hoy.

**Reparación mínima sugerida:** mantener un inventario único route→feature→role/plan→nav/entrypoint→renderer; etiquetar en ese inventario qué es hidden/embedded/legacy; regenerar o revisar las matrices documentales desde el SHA actual. Evitar declarar “0 orphaned” sin comparar la navegación construida en este commit.

### Root cause 3 — integración de negocio distribuida en pasos manuales y escrituras independientes

Hay entidades correctamente separadas (OT, proyecto, presupuesto, certificado, documento de venta, factura y pago), pero los puentes son manuales o multi-request. Los errores intermedios dejan estados válidos pero parciales; el Dashboard no reúne todos los dominios.

**Reparación mínima sugerida:** definir para cada transición el evento/entidad fuente, idempotency key, transacción o saga con compensación, estado visible y read-back; priorizar RFQ→OC, recepción→stock→inbound, OP→facturas→tesorería y certificado aprobado→documento de venta. Mantener gates humanos donde impliquen autorización comercial/financiera.

## Cierre de auditoría

- No se hicieron cambios funcionales, commits, deploys, llamadas a Supabase ni ejecuciones de tests.
- Solo queda autorizado/previsto este documento como nuevo archivo.
- Resultado: **STOP / no declarar READY FOR MAIN ni certificación E2E** basándose únicamente en esta lectura estática.
- Próximo gate seguro: resolver los P0 en un entorno aislado y definir un recorrido E2E por empresa sintética, sin reutilizar los tests que apuntan a producción.
