# ERP MASTER WIRING AUDIT — F7 RECOVERY

Snapshot: f7a48a0dc125425d4aa9bba7ea8970427056e0fd  
Fecha de auditoría: 2026-09-24  
Commit: fix: recover ERP project surfaces and workbook import  
Parent: 5aefd69ed8000c00b5ef8662e41182255c972b20

## Resumen ejecutivo

Auditoría estática del árbol exacto F7. El checkout permaneció en recovery/restore-legacy-surface-contract, HEAD 901fb009ca3d7574ef8717e2891b05c83f7900a1; la rama no fue cambiada y no se usó como autoridad. Se consultó el reporte anterior docs/ERP_MASTER_WIRING_AUDIT.md, correspondiente a 43add3f33eff8625b17c9c8ad303a946f90f42fd, solo como comparación.

| Workspace | Estado | Conclusión |
|---|---|---|
| Administración | PARTIALLY WIRED | Facturas, compras, ventas, pagos y tesorería tienen interfaces y persistencia; hay puentes manuales, fallback no atómico y proyecciones de dashboard legacy/incompletas. |
| Obras | PARTIALLY WIRED | F7 publica 18 features de proyecto, incluida la superficie canónica. MRP mezcla stock/inbound legacy con disponibilidad central canónica; recepción visible de OC sigue legacy. |
| Licitaciones | PARTIALLY WIRED | Ingesta, evaluación, conversión y sandbox existen; texto PBC puede sustituirse por sugerencias genéricas y Auction Bot no persiste la policy ni oferta en DNCP. |
| Rodrigo | PARTIALLY WIRED | Widget, API, registry, persistencia de task/run/step y approvals están cableados; autorización y efectos dependen de cada tool. No equivale a autonomía E2E certificada. |
| Multiempresa / RLS | UNKNOWN en runtime | Perfil fija empresa_id y hay tenant checks/policies/RPCs en el código/migraciones. No se conectó a una base ni se probó aislamiento. |

**Decisión solicitada:** YES — F7 es una mejor base de recuperación que 43add3f para preservar las superficies canónicas del ERP: su registry hace descubribles las 18 tabs del proyecto y expone Inventario global; 43add3f vuelve a esconder Inventario, Recepciones y Pañol y reintroduce la tab legacy Stock. Esto es una decisión de base de UI/código, no un dictamen de “READY”, certificación E2E o seguridad productiva. Antes de cualquier declaración operativa hay que resolver los P0 y rescatar selectivamente los avances posteriores listados en §9.

## Alcance, método y límites

- Fuente primaria: git show, git grep, git diff, git log y git ls-tree restringidos a f7a48a0dc125425d4aa9bba7ea8970427056e0fd. ee31ef962eeb51f8765e05ac5db650c25192a081 se usó únicamente como referencia histórica solicitada.
- Se recorrieron rutas, componentes, server actions, APIs, servicios, RPCs/migraciones, tests y los 14 HTML rastreados bajo instructivos y roadmap. Los hallazgos nombran archivos y líneas del árbol F7; las referencias a main proceden del reporte previo y de diff puntual.
- No se ejecutaron tests, scripts, build, typecheck, RPCs, migraciones, navegador ni requests; no se consultó Supabase, Vercel ni proveedores externos. No se inspeccionó el estado desplegado, la aplicación efectiva de RLS, credenciales ni datos live. Toda conclusión es estática.
- Se encontraron rutas de tests/scripts que contienen el ref productivo ezucivipgmbvamhugkbj. Se inspeccionaron guardas relevantes sin ejecutar los archivos.
- Se intentó dividir la revisión entre agentes, pero el host rechazó la creación por límite de threads activos. Este documento es la revisión directa del agente principal, no una revisión independiente completada por subagentes.
- Permanecen intactos los untracked preexistentes docs/ERP_MASTER_WIRING_AUDIT.md, docs/ERP_OPERATIONAL_WIRING_AUDIT.md e instructivos y roadmap/Sistema Stock.html. El último no está en el árbol F7.

### Criterio de estados

FULLY WIRED significa que la cadena estática visible llega a persistencia y lectura posterior del mismo contrato; no implica prueba runtime. PARTIALLY WIRED significa que queda un salto manual, un modelo paralelo, un fallback, una dependencia externa o runtime no verificado. READ ONLY no ofrece escritura desde esa superficie. LEGACY PATH identifica un flujo anterior aún ejecutable. HIDDEN existe pero no se descubre por navegación normal. DEAD / ORPHANED se reserva a una entrada sin caller válido conocido. BROKEN requiere una contradicción estática concreta. UNKNOWN depende de entorno, datos, proveedor o ejecución no inspeccionados.

## 1. Administración

### Navegación y aislamiento

components/layout/workspace.ts separa Administración, Operativo y Licitaciones; el workspace se deriva de la URL. app/(internal)/layout.tsx muestra Operativo para plan Pro+ y roles administración/admin, y Licitaciones para Pro+ y roles comercial/administración/admin. El shell no ofrece selector de empresa: lib/auth.ts obtiene empresa_id del perfil autenticado y rechaza perfiles sin empresa. No se validó que los claims/RLS efectivos coincidan con ese diseño.

El sidebar de F7 enlaza /inventario como “Inventario global” y /stock como “Catálogo de materiales” (components/layout/sidebar.tsx:140-141). Las demás superficies administrativas agrupan compras, ventas y finanzas con gates de roles, plan y módulos. Los detalles de usuarios/empresas dependen de pantallas superadmin; la identidad tenant normal sigue perfil-empresa, no un selector interactivo.

### Dashboard

app/(internal)/dashboard/data.ts reúne documentos de venta, cobros, facturas, órdenes, cuentas, gastos recurrentes, productos y invoice_jobs, y los transforma con lib/dashboard/admin-kpis.ts, cashflow.ts y attention-alerts.ts. Esto produce KPIs/alertas de ventas, cobros, CxP, liquidez, facturas/jobs y órdenes, pero no una conciliación contable global.

- Las alertas de stock consultan productos.stock_actual (dashboard/data.ts:118), no inventory_balances menos reservas.
- El flujo de caja invoca build30DayCashflowItems con certificados: [] (líneas 149-153); por esa entrada no incluye certificados de obra.
- El estado de jobs de scanner/extracción es una señal de revisión, no una factura aprobada automáticamente.
- No se comprobó exactitud frente a datos, moneda, pagos bancarios ni runtime.

Estado: PARTIALLY WIRED. No usar el KPI/alerta como autoridad de saldo canónico ni de cashflow de certificados.

### Compras: necesidad → RFQ → OC → recepción

El recorrido estático encontrado es: necesidad/solicitud manual o generada aparte → RFQ → invitación/token de proveedor → cotización y quote_versions → selección/autorización de oferta → authorized_orders y partidas → formulario de recepción de OC.

- Las acciones de RFQ crean invitaciones y cotizaciones; selectAndAuthorizeOffer valida/selecciona oferta y escribe OC/partidas en varias operaciones (app/(internal)/rfqs/[id]/actions.ts). La transacción completa RFQ→OC no está encapsulada en un único RPC; puede quedar trabajo parcial ante error intermedio.
- Hay herramientas separadas de Rodrigo para send_rfq e issue_purchase_order. La cobertura MRP no genera ni autoriza automáticamente una OC: la decisión de compra sigue siendo una transición humana.
- El ingreso visible de mercancía desde detalle de OC llama registrarRecepcion: recepcion-section.tsx:10,74 → orders/oc-recepcion-actions.ts:15,47,60,79. Escribe oc_recepciones/oc_recepcion_items y llama registrar_stock_movimiento; es LEGACY PATH, no inventory_confirm_receipt.

Estado global: PARTIALLY WIRED; el punto crítico OC→inventario canónico no está integrado al entry point normal.

### Ventas: cotización → aceptación → OT

Ventas crea/actualiza sales_documents; quotation-actions genera/revoca el link tokenizado; /cotizacion/[token] usa accept_quotation/reject_quotation del backend (migraciones 0090-0092). La aceptación crea work_orders y work_order_items con protecciones de idempotencia/estado; luego existe aprobación interna de la OT. La aceptación/rechazo no convierte automáticamente la OT en projects de obra: abrir/iniciar el ERP de construcción es un paso posterior.

Estado: PARTIALLY WIRED. La cadena de cotización hasta OT es cableada estáticamente, pero el puente OT→proyecto y la emisión/ejecución posterior siguen explícitos. Runtime del token, expiración y RLS no se probó.

### Facturas, scanner y jobs

- Alta manual usa InvoiceDialog → createInvoice; existe flujo de extracción puntual de foto/PDF vía extractInvoiceFromPhoto → lib/invoice-extraction.
- Alta por lote escribe invoice_jobs y archivos; worker/index.ts corre como proceso independiente, reclama jobs, descarga archivo, extrae datos, deja estado de revisión/error y la UI permite revisar antes de crear la factura.
- Integración de scanner captura y asocia scanner_session_id/contexto a la factura; el contrato se valida por acciones/server. No se probó cámara iPhone/WebKit, realtime, permisos, deployment ni capacidad del worker.
- Conciliación OC y estado APTO_PARA_PAGO existen en las superficies de factura, pero no se demuestra cierre contable E2E.

Estado: PARTIALLY WIRED. El worker y proveedores de extracción requieren configuración/ejecución separada; E2E UNKNOWN.

### Pagos y tesorería

El camino principal factura apta → OP usa payment_orders/payment_order_invoices y ejecutar_orden_pago_atomica; la RPC escribe estados de factura, OP y movimiento de tesorería con validación tenant. Sin embargo, pagos/actions.ts:127-177 conserva fallback de varias escrituras directas si la RPC falla/no existe. Una falla a mitad puede dejar OP/factura/movimiento desalineados. Alta de cuenta y saldo inicial también son operaciones separadas. Transferencia y movimientos dependen de RPCs.

Estado: PARTIALLY WIRED, con P1 por fallback no atómico y sin conciliación de banco real.

### Inventario global

/inventario carga getCanonicalInventorySnapshot (app/(internal)/inventario/page.tsx; lib/inventory/service.ts:103-113), que lee inventory_stock_global_quantity e inventory_stock_by_location. No se encontró en esa página el flujo humano para registrar todos los tipos de movimiento: es READ ONLY. El modelo incluye inventory_locations, inventory_balances, inventory_movements e inventory_movement_costs y las vistas por ubicación, proyecto, global, cantidad global y consumo por partida (migración 20260913230000_inventory_panol.sql:19,49,258,325,1506-1565; hardening redefine vistas). Las vistas canónicas se declaran security_invoker en las migraciones. Esto es evidencia de diseño, no validación de grants/RLS desplegados.

## 2. Obras

### Superficies exactas de F7

lib/projects/project-features.ts declara estas 18 claves; getProjectFeatureGroups no excluye claves. El sidebar de proyecto y la validación server-side usan el registry (project page y project-tabs-client.tsx). Roles normales permitidos: administración/admin; el gate de plan es Pro para las superficies estándar y Caterpillar para BIM, Personal, Subcontratistas, Certificados y Avance físico; superadmin tiene bypass. No hay clave de feature stock legacy en el registry F7.

| Grupo | Tabs visibles para perfil con rol/plan permitido |
|---|---|
| Preparar | Presupuesto; Cronograma; Plan semanal; BIM / IFC (Caterpillar) |
| Comprar | Proveedores; Cotizaciones; OC; Facturas; Pagos |
| Ejecutar | Ejecución; Inventario; Recepciones; Pañol; Personal (Caterpillar); Subcontratistas (Caterpillar) |
| Certificar | Certificados (Caterpillar); Avance físico (Caterpillar); Informes |

Son superficies publicadas en código, no un resultado de smoke de navegador. En F7 la ruta global /inventario también está enlazada. El renderer antiguo de tab stock sigue presente en project-tabs-client.tsx:428-429, pero stock no es una key aceptada por el registry F7: queda como renderer legacy sin tab normal válida; la ruta global /stock sí permanece como catálogo legacy.

### Presupuesto, Excel y workbook

Hay flujos diferentes que no deben confundirse:

| Flujo | Wiring estático | Estado |
|---|---|---|
| Manual | Formulario de partidas → actions → budget_items y lectura en el proyecto | PARTIALLY WIRED; persistencia y validación de cálculo/rendimientos no equivalen a certificación de presupuesto. |
| ImportBudgetDialog | Selección Excel/CSV en navegador → importBudgetItems → budget_items del proyecto | PARTIALLY WIRED como importador de presupuesto, no de certificado. |
| Workbook Interpreter | Workbook de creación → API de interpretación → canonical-import/proyecto; acepta propuesta de presupuesto y certificado según gates | PARTIALLY WIRED. MEDICIÓN puede quedar DETECTED_NOT_APPLIED. No es un importador directo de certificado ni aplica toda hoja automáticamente. |
| Planilla embebida | Grilla, snapshot/autosave/confirmación y lecturas de rango; Rodrigo tiene tools de spreadsheet | PARTIALLY WIRED; runtime/RLS y ciclo multiusuario desconocidos. |
| Receta/BOM | Importación/revisión de recipe y relaciones budget_item_materials → MRP | PARTIALLY WIRED; requiere correspondencia/confirmación de materiales. |

No se encontró uploader .xlsx/.xls del certificado de obra dentro de su flujo; “Pegar avance del mes/Presente” es otra UI.

### BIM/IFC y Cómputo sin IFC

**BIM:** Tab Caterpillar; selección/subida IFC → persistencia en Storage/registro del modelo y elementos → agrupación/matcher semántico → propuesta de correspondencia con budget_items → revisión y confirmGroupMatch humana → cantidades asociadas a partidas. El matcher DeepSeek exige credenciales/proveedor; la sugerencia no se auto-confirma. No se encontró una transición automática de grupo BIM a execution_entries/certificado.

**Cómputo:** Es una ruta separada, independiente de IFC. Excel/CSV y PDF → parseo/extracción → computo_imports/computo_items y mapeo a elementos de cómputo/BIM → matching/revisión → acción de confirmación actualiza cantidades de budget_items. Soporta fixtures/unit tests, pero extracción real, datos complejos y tenant aislado no se verificaron. Ambos módulos: PARTIALLY WIRED; credenciales externas y resultados reales UNKNOWN.

### Plan semanal V3 y MRP — respuestas explícitas

La secuencia de intención física → receta/BOM (production_recipes, production_recipe_components, budget_item_materials) → cálculo → preview → guardado/commit en project_weekly_plans/project_weekly_plan_items → reserva/release en inventory_reservations estática. Las respuestas pedidas:

| Pregunta | Resultado F7 |
|---|---|
| ¿Stock de obra legacy o canónico? | LEGACY: loadWeeklyPlanBaseData lee stock_por_proyecto (weekly-plan-shared.ts:270). No lee inventory_stock_by_project para esa cobertura. |
| ¿Inbound solo recepciones CONFIRMED? | NO. Se lee oc_order_item_recibido (línea 298); migraciones 0042/0080 suman oc_recepcion_items sin filtrar status. El esquema posterior sí distingue DRAFT/CONFIRMED/VOIDED y la recepción visible de OC conserva el camino legacy. Riesgo BROKEN para el contrato “físicamente recibido/confirmado”. |
| ¿Stock central usa inventory_balances? | SÍ, como lectura estática. Busca ubicación CENTRAL activa/principal, carga inventory_balances y resta inventory_reservations ACTIVE (weekly-plan-shared.ts:405-460). Si no hay ubicación central devuelve disponibilidad vacía/cero, no falla cerrado. |
| ¿Evita doble promesa entre obras? | El diseño de commit sí intenta evitarla: RPC server-only, locks por empresa/producto/ubicación, FOR UPDATE sobre balances/reservas, suma de reservas activas, idempotencia y transacción plan+reserva (20260918000003_mrp_final_integrity.sql:120-163,334-404; lifecycle 20260918000004). Resultado estático favorable; no se certificó concurrencia real. |
| ¿Preview y commit usan el mismo contrato? | Comparten loadWeeklyPlanBaseData, calculateWeeklyPlanRequirements, MRP build/fecha y el commit recalcula con datos frescos en servidor (weekly-plan-actions.ts:296-433,737+). Las cantidades de reserva se derivan server-side y se comparan con referencia del cliente antes de RPC. No son el mismo instante de datos; el commit puede rechazar por cambio. Clima ON puede crear forecast batch append-only en preview; el commit no usa el overlay para cobertura. |

Detalle inbound: OC autorizadas con producto_id → resta cantidades recibidas de la vista legacy → compara expected_delivery_date contra neededBy; sin fecha o tarde no cubre el MRP fechado. El defecto está antes del filtro de fecha: la cantidad ya recibida puede incluir borradores. Faltante/caja es resultado para decisión, no crea automáticamente RFQ/OC.

Estado: PARTIALLY WIRED con P0 estático en el read model de inbound.

### Inventario canónico frente a stock legacy

El backend canónico expone inventory_post_movement y tipos RECEIPT, TRANSFER, CONSUMPTION, RETURN y ADJUSTMENT (migraciones inventory_panol y hardening/transfer fix). Servicio: lib/inventory/service.ts → RPC; inventario-actions delega movimiento a postInventoryMovement. Existe tool Rodrigo post_inventory_movement; manage_inventory_operation cubre receipts, ubicaciones, enlaces/portal y propuestas del pañol. El ledger y balances se actualizan en SQL; vistas canónicas alimentan snapshot global/ubicación/proyecto/consumo.

No se encontró una pantalla humana general que ofrezca todos esos movimientos en F7. Para cada clase:

| Tipo | UI humana F7 | Acción/servicio/RPC y ledger | Lectura posterior | Estado |
|---|---|---|---|---|
| RECEIPT | La forma normal del detalle de OC no la usa; escribe por legacy. No hay formulario canónico visible encontrado. | createCanonicalReceipt → confirmCanonicalReceipt → service → inventory_confirm_receipt → inventory_post_movement; inventory_movements/balances/costos | Tab Recepciones y tabs Inventario consultan movimientos/vistas canónicas; global snapshot también | Backend/tool wired; entry point de OC LEGACY PATH; canónico no descubierto. |
| TRANSFER | No se encontró UI humana de movimiento general. | postCanonicalInventoryMovement/service → inventory_post_movement; origen/destino y costo/ledger actualizados | inventory_stock_by_location/global y por proyecto | Backend/tool canonical, UI humana faltante. |
| CONSUMPTION | Portal/pañol permite enviar propuesta; panel interno F7 solo lectura. | Movimiento genérico o confirmación de submission → inventory_confirm_warehouse_submission → CONSUMPTION; asignación posible a budget_item | inventory_stock_by_project e inventory_consumption_by_budget | Backend canonical; confirmación humana interna no se expone en ese panel. |
| RETURN | No se encontró UI humana específica. | postInventoryMovement → inventory_post_movement | Balances/vistas de ubicación/proyecto | Backend/tool canonical; UI faltante. |
| ADJUSTMENT | No se encontró UI humana específica. | postInventoryMovement → inventory_post_movement; SQL valida costo/moneda y delta | Balances y vistas canónicas | Backend/tool canonical; UI faltante. |

La etiqueta de los formularios legacy y el snapshot canónico no deben tratarse como saldos intercambiables. Algunas rutinas mantienen productos.stock_actual como proyección de compatibilidad; el dashboard y las rutas antiguas aún leen ese campo.

### Recepciones OC

El botón visible es sí, LEGACY en F7: recepcion-section.tsx → registrarRecepcion → oc_recepciones/oc_recepcion_items → registrar_stock_movimiento. El tab Recepciones del proyecto se documenta como lectura de movimientos que ya pasaron por confirmCanonicalReceipt (recepciones-obra-section.tsx:22-23); no convierte retroactivamente las recepciones legacy en canónicas. inventory_confirm_receipt existe en servicio/RPC y Rodrigo, pero no es la acción de ese formulario. La vista inbound no filtra estados de recepción. Portal tokenizado de recepción con líneas/fotos no existe todavía en F7; se agrega después.

### Pañol

F7 contiene ubicación y token de warehouse → /warehouse/[token] y /api/warehouse-portal/[token] → archivos/evidencias/submission y líneas propuestas. Acciones para link, carga/procesamiento y confirmación existen en app/(internal)/inventory/actions.ts:202,309,439; confirmación genera CONSUMPTION canónico, con atribución a partida cuando los datos la sostienen, y efecto de stock/costo. Pero PanolObraSection declara que el usuario autenticado solo lee el estado/propuestas/confirmaciones (líneas 56-58); no hay UI interna para actuar como depositario/revisor. Las acciones se encuentran expuestas a Rodrigo manage_inventory_operation con aprobación requerida. Estado: backend presente, superficie interna READ ONLY, flujo humano PARTIALLY WIRED.

### Ejecución, certificados, clima y demás

| Módulo | Estado | Límite observado |
|---|---|---|
| Ejecución / avance físico | PARTIALLY WIRED | execution_entries, evidencia/fotos y portal tokenizado /avance permiten informar cantidades. El resync de certificado borrador desde ejecución es acción explícita, no sincronización universal. |
| Certificado del comitente | PARTIALLY WIRED | project_certificates/items, períodos y acumulados/estados, aprobación y puente explícito a sales_documents existen. La entrada de avance admite edición/pegado de Presente; no se encontró uploader directo de Excel de certificado. |
| Certificado de subcontratista | PARTIALLY WIRED | Contrato, certificado y portal propio existen; no se encontró puente automático aprobado→factura/pago proveedor. |
| Clima / Climate Workdays | PARTIALLY WIRED | Forecast opcional en Plan semanal; días históricos, confirmación/override, evidencia y actions existen; proveedor DMH/DINAC/Open-Meteo, cron/configuración y efecto sobre certificación no se validaron. No se vio que el overlay cambie cantidades/reservas. |
| Personal | PARTIALLY WIRED | Tab Caterpillar y daily_labor_entries; impacto/costo consolidado con avance/caja no probado. |
| Subcontratistas | PARTIALLY WIRED | Tab Caterpillar, contratos y certificados; desembolso/proveedor conserva puente explícito. |
| Cronograma | PARTIALLY WIRED | Gantt y calendario del proyecto; integración de actualizaciones/clima/certificado no es una sola transacción. |
| Informes | READ / EXPORT | Lee el proyecto y genera salidas, incluidas hojas XLSX; exportar no equivale a consolidación reconciliada. |

### Referencia histórica ee31ef

ee31ef962eeb51f8765e05ac5db650c25192a081 se trata solo como el snapshot pre-NIU V3 solicitado en el contexto histórico. El diff de registry, tabs y sidebar entre ee31ef y F7 es amplio: F7 incorpora el contrato compartido de 18 features y nuevas superficies Plan semanal, BIM/IFC e Inventario/Recepciones/Pañol. No se audita ee31ef como candidato y no se infiere calidad funcional por comparación visual.

## 3. Licitaciones

El workspace enlaza radar/competidores, documentos, licitaciones, Auction Bot y Auction Lab. La importación comienza con un identificador/proceso DNCP aportado por una persona; importarLicitacion obtiene el record y lo ingiere en tablas globales y snapshot de empresa. El monitor/crons siguen licitaciones ya importadas; no se demostró descubrimiento universal sin identificador inicial. Dependencia DNCP/red y actualización no probadas.

| Flujo | Evidencia estática | Estado |
|---|---|---|
| Radar / DNCP | Entrada de número → importarLicitacion/fetch → RPC OCDS y snapshot empresa | PARTIALLY WIRED; integración externa no validada. |
| Competidores | Datos históricos y agregaciones/radar por RUC, con filtros de período/evidencia | PARTIALLY WIRED; su calidad depende del histórico disponible. |
| Bóveda de documentos | empresa_documentos y proyección company_bid_vault_items; writes separados pueden dejar proyección atrasada | PARTIALLY WIRED. |
| PBC / requisitos | extraerRequisitosDePliego recibe texto; no se comprobó extracción universal de PDF. Si falta PBC, persistirEvaluacionComercial marca GENERIC_REQUIREMENT_SUGGESTIONS | PARTIALLY WIRED; una puntuación no certifica lectura del pliego real. |
| Evaluación → proyecto | Persistencia de evaluación; convertirLicitacionAProyecto exige decisión GANADA, monto adjudicado positivo e ítems verificados para generar proyecto/presupuesto | PARTIALLY WIRED, con gate humano/datos explícito. |
| Auction Bot | activePolicy/justFrozen viven en React y SimulatorRunnerView ejecuta simulación local; no persiste policy ni se encontró submit a DNCP | SIMULATOR ONLY / PARTIALLY WIRED; no opera ofertas reales. |
| Auction Lab | Salas/roles, simulaciones y acciones persistidas en tablas sandbox; la UI lo declara simulación, no DNCP real | PARTIALLY WIRED como laboratorio. |

## 4. Rodrigo / agente

El shell monta RodrigoAgentProvider/Widget; el widget llama /api/agent/chat y /api/agent/status. lib/agent y lib/tools/index registran herramientas con schema, dominio, nivel de riesgo, roles requeridos y handler; gateway arma contexto tenant del actor, persiste task/run/step y crea approval para acciones de riesgo elevado. app/(internal)/agent/approval-actions permite decidir y continuar. Riesgo/roles son heterogéneos por tool; requiredRoles nulo requiere confiar en validaciones del handler. Email requiere integración externa y aprobación. Nada fue ejecutado.

| Tool / familia | Dominio | Backend | Contrato | UI equivalente | Estado |
|---|---|---|---|---|---|
| get_inventory_overview; get_project_inventory_overview | Inventario global/obra | Snapshot canónico, reservas, vistas | Canónico, además existe lectura legacy de stock | /inventario y tab Inventario, estas son lecturas | READ tools presentes; dato live UNKNOWN |
| manage_inventory_operation; post_inventory_movement | Recepción, ubicación, pañol, movimientos | Actions + servicios/RPC canónico | Canónico; exceptúa entry point OC que continúa legacy | No hay UI humana general equivalente para movimiento/confirmación | PARTIALLY WIRED; risk/approval |
| preview_weekly_plan; save_weekly_plan; get_weekly_plan_overview | Plan/MRP | Actions de plan, recálculo y RPC atómica | Mezcla stock/inbound legacy y reserva central canónica | Tab Plan semanal | PARTIALLY WIRED; no crea OC |
| send_rfq; issue_purchase_order | Compras | Tools procurement y tablas RFQ/OC | Flujo principal de compra | RFQ y OC | PARTIALLY WIRED; escrituras cruzadas |
| get_supplier_invoice_overview; manage_supplier_invoice; create_invoice | Facturas proveedor | Actions de factura/job | Modelo factura/job | /facturas | PARTIALLY WIRED; worker separado |
| get_billing_overview; get_finance_overview | Facturación / finanzas | Queries resumen | Tablas financieras/ventas | Ventas, pagos y tesorería | READ tools |
| manage_certificate | Certificados | Acciones project_certificates/items | Proyecto; no uploader workbook | Certificados / Pegado Presente | PARTIALLY WIRED; gates de aprobación |
| get_tender_overview; manage_tender | Licitaciones | Actions de tender, PBC, evaluación y conversión | DB tenant + ingesta DNCP | Licitaciones | PARTIALLY WIRED; PBC puede ser genérico |
| get_auction_overview; manage-auction-lab | Subastas | Engine y persistencia sandbox | Sandbox simulado; Auction Bot client-only | Auction Bot / Auction Lab | Lab simulado; Bot no conectado a DNCP |
| get_work_order_overview; manage_work_order | OT | work_orders/RPC de aceptación/acciones | Comercial/OT, aún no project automático | Ventas / OT | PARTIALLY WIRED |
| get_project_modeling_overview; get_apu_overview; manage-apu-material; manage-budget-item; manage-production-recipe | BIM, cómputo, BOM/presupuesto | Actions/modelos del proyecto | Presupuesto/BIM | BIM, Cómputo, Presupuesto | PARTIALLY WIRED; depende de revisión humana y proveedores |
| manage_climate_workday | Clima / días no laborables | Actions de evento/evidencia | project weather/workdays | Clima contextual en Cronograma | PARTIALLY WIRED; runtime externo UNKNOWN |
| get_labor_subcontractor_overview; manage_labor_subcontractor | Personal/subcontratos | Actions de recursos/contratos | Obra | Personal/Subcontratistas | PARTIALLY WIRED |
| manage_company_document; manage_sales_document; manage-sifen-document; get-sifen-overview | Documentos, ventas y SIFEN | Actions/tablas/API fiscal configurada | Comercial/fiscal | Documentos de empresa, ventas, SIFEN | PARTIALLY WIRED; integración externa/runtime UNKNOWN |
| get_scanner_session_overview; spreadsheet read/update tools | Scanner y planillas | Sessions / spreadsheet service | Scanner session; snapshots/planilla | Scanner, planilla embebida | Parcial; cámara y persistencia real sin ejecutar |

Las filas agrupan tools de lectura/escritura por capacidad; no certifican que todos los handlers tengan permisos iguales a las pantallas. Las herramientas de riesgo 2+ esperan aprobación en gateway (estáticamente). No se usaron LLMs, email ni tools.

## 5. Legacy vs Canonical

| Concepto | Legacy | Canonical | UI usa | Backend usa | Riesgo |
|---|---|---|---|---|---|
| Stock de empresa | productos.stock_actual, stock_movimientos, stock_por_deposito | inventory_locations/balances/movements/movement_costs | Dashboard, /stock y OC legacy consumen/escriben campos/funciones legacy; /inventario lee canonical | Ambos; canonical SQL actualiza compatibilidad en algunos movimientos | Saldo divergente; leer no equivale a reconciliar |
| Stock de obra | stock_por_proyecto, stock_consumo_obra | inventory_stock_by_project + inventory_consumption_by_budget | MRP y forecast consultan stock_por_proyecto; tab Inventario usa vistas canonical; también existe renderer legado | MRP consume legacy; warehouse confirma canonical | Una recepción/consumo registrado en un libro puede no reflejarse en el otro |
| Recepción OC | oc_recepciones/items + registrar_stock_movimiento | canonical receipt draft/confirm + inventory_movements | Entry visible de OC usa legacy; Recepciones lee movimientos confirmados canonical | Actions/RPC canonical existen aparte | P0: inbound suma vista que no filtra estado |
| Reserva MRP | No equivalente confiable en stock legacy | inventory_reservations ACTIVE contra inventory_balances | MRP muestra cobertura; sin gestión manual directa | RPC atómica commit/release | La reserva central es canonical, pero su demanda parte de stocks legacy |
| Presupuesto | importación manual y budget_items | Workbook Interpreter/canonical import; mismo modelo final budget_items | Dialog Excel/CSV, creación de proyecto, planilla | Diferentes parsers/actions escriben budget_items | No confundir workbook de presupuesto con certificado/medición |
| Medición/certificado | Presente pegado/manual | execution_entries, project_certificates/items y resync explícito | Pegar Presente; no hay uploader XLSX directo de certificado | Acciones y tablas de certificados | Puente manual, riesgo de creer MEDICIÓN detectada = aplicada |
| OT vs proyecto | work_orders | projects/operación de obra | Pantallas OT y obras separadas | RPC crea OT; conversión a obra no automática en el recorrido revisado | Paso comercial→operativo manual |
| Certificado vs factura venta | project_certificates | sales_documents.certificate_id | Acción explícita desde certificado aprobado y luego emitir | Vínculo persistido | No automático; estado puede quedar intermedio |
| MRP vs compras | Faltante/caja calculados sobre fuentes mixtas | RFQ/OC separadas | Plan informa faltante; Compras ofrece flujo aparte | Tools send_rfq/issue_purchase_order | Aprobación intencional; sin handoff transaccional |
| Docs empresa vs bóveda tender | empresa_documentos | company_bid_vault_items projection | Documentos licitación | Sincronización en actions separadas | Fallo silencioso puede atrasar la proyección |

## 6. Superficies

Estado para usuario con rol y plan habilitados; no es validación visual runtime.

| Superficie F7 | Estado | Nota |
|---|---|---|
| Dashboard administrativo | VISIBLE BUT PARTIALLY WIRED | KPIs con omisión certificados y alertas legacy. |
| Inventario global | VISIBLE, READ ONLY | Enlace /inventario, vistas canonical. |
| Catálogo global /stock | VISIBLE, LEGACY PATH | Catálogo y movimientos del stock histórico; no saldo canónico autoritativo. |
| 18 tabs de proyecto | VISIBLE AND PARTIALLY WIRED | Registry único incluye 18; gates Pro/Caterpillar y rol aplican. |
| Plan semanal | VISIBLE AND WIRED PARTIALLY | Preview/save/commit existen, contrato MRP mixto. |
| Inventario de proyecto | VISIBLE, READ ONLY | Lee canonical stock/consumo. |
| Recepciones de proyecto | VISIBLE, READ ONLY | Lee receipts canónicos, no registra desde OC. |
| Pañol | VISIBLE, INTERNAL READ ONLY | Portal externo recibe envío; panel interno no permite revisión/confirmación humana. |
| BIM / IFC | VISIBLE con Caterpillar, PARTIALLY WIRED | Parser, matcher, revisión existen; DeepSeek y runtime desconocidos. |
| Cómputo | VISIBLE en la experiencia de proyecto, PARTIALLY WIRED | Excel/CSV/PDF separado de BIM; confirmación revisada. |
| Certificados | VISIBLE con Caterpillar, PARTIALLY WIRED | Sin importador directo Excel. |
| Personal / Subcontratistas | VISIBLE con Caterpillar, PARTIALLY WIRED | Persistencia de dominio, integración financiera no E2E. |
| Clima | EMBEDDED en Cronograma/Plan semanal, PARTIALLY WIRED | Histórico y forecast son flujos distintos. |
| Informes | VISIBLE, READ / EXPORT | No consolida ni reconcilia todos los dominios. |
| Renderer project stock antiguo | DEAD / ORPHANED como tab F7 | Componente queda, pero su key no existe en registry F7. |

### Comparación resumida de superficies

F7 cumple mejor el objetivo de superficie de recuperación que 43add3f: registry y links presentan las superficies canonical. En 43add3f se agregan stock y PROJECT_NAV_HIDDEN_FEATURE_KEYS para ocultar inventario, recepciones y pañol; también desaparece el enlace global /inventario. Eso es regresión de discoverability, no eliminación del backend.

## 7. Documentación vs realidad

Se inspeccionaron los 14 HTML tracked de instructivos y roadmap en F7. Estados dominantes por documento; PARTIAL incluye wiring real con un contrato incompleto, no implica runtime:

| Documento | Estado | Observación contra F7 |
|---|---|---|
| flujo-de-obra.html | PARTIAL | Describe cadena de MRP y digitalización física como recorrido completo; stock obra/inbound siguen legacy y el scanner móvil no se ejecutó. |
| manual-de-obra.html | STALE | Matriz/lista de superficies no coincide completamente con el registry/grupos y capacidades actuales de F7. |
| modo_agente_frictionless_erp.html | ASPIRATIONAL | Visión de operación frictionless excede el agente/tools efectivamente validados. |
| modulo-aceptacion-cotizacion-orden-trabajo.html | VERIFIED (estático) | UI/token, RPC de aceptación y OT existen; runtime y puente automático a proyecto no están certificados. |
| modulo-auction-bot-auction-lab.html | PARTIAL | Laboratorio persistente simulado; Auction Bot no guarda policy ni oferta real. |
| modulo-bim-presupuesto.html | PARTIAL | IFC/matcher/revisión existen; proveedor, resultados reales y cadena completa a avance no se validaron. |
| modulo-control-scanner.html | PARTIAL | Integración al alta de factura existe; compatibilidad física móvil/dispositivo sigue UNKNOWN. |
| modulo-dias-climaticos.html | PARTIAL | UI/actions/evidencia y cron existen; proveedor y despliegue del cron no se verificaron. |
| modulo-erp predictivo semanal lookahead.html | PARTIAL | Motor existe; fuentes físicas e inbound mantienen seam legacy/canónico. |
| modulo-frictionless-agent-rodrigo.html | PARTIAL | Registry/approval existen; no demuestra autonomía completa ni equivalencia de permisos. |
| modulo-plan-semanal-lookahead.html | PARTIAL | Contrato de reservas/inbound existe, pero stock obra e inbound no son exclusivamente canonical/confirmados. |
| modulo-plan-semanal-obra.html | PARTIAL | Documento más completo del contrato pedido; no elimina la contradicción del source MRP señalada en §2. |
| modulo-planilla-embebida.html | PARTIAL | Grid y acciones existen; persistencia durable, aislamiento y trabajo multiusuario no se comprobaron. |
| roadmap_control_de_facturas.html | ASPIRATIONAL | Es roadmap con estados/producto aspiracionales; no sirve como certificado del snapshot. |

La codificación de los HTML se leyó desde el árbol F7; algunos textos del roadmap declaran hitos/tests/deploy como terminados, pero esta auditoría no repite ni valida esos resultados. El archivo local Sistema Stock.html no está rastreado en F7; se conserva y se usa solo como contrato conceptual, no como evidencia de funcionalidad.

## 8. Tests y cobertura

Inventario por nombres/ubicación/lectura estática; no se ejecutó nada y no se reporta cobertura porcentual.

| Clase | Ejemplos F7 | Alcance/límite |
|---|---|---|
| UNIT | lib/procurement weekly-plan/MRP/recipes/forecast; lib/inventory domain/evidence/cost; dashboard; agent; auction; BIM; computo; scanner; workbook | Algoritmos con mocks/fixtures; no valida RLS ni instancia desplegada. |
| CONTRACT / SOURCE | project-features tests; inventory migration-contract/hardening; scanner UI contracts; workbook golden/canonical import | Forma y expectativas de fuente; no prueba que migraciones estén aplicadas. |
| INTEGRATION | inventory-p1-hardening, climate-workdays, scanner/session y flujos de UI que usan configuración | Resultado depende de env/backend; no se ejecutó. |
| LIVE / RLS | mrp-rpc-live, mrp-lifecycle-live, weekly-plan-atomic-db, weekly-plan-e2e, weekly-plan-rls-auth, climate-workdays-rls-auth | Varios contienen ref/URL de Supabase de producción ezucivipgmbvamhugkbj. Riesgo P0 para cualquier corrida sin redirección aislada. |
| BROWSER / E2E | tests/e2e de licitaciones, auction-lab, BIM, scanner móvil/facturas, workbook, finanzas/critical flows | No ejecutados; no prueban login, permisos, estado de datos ni build preview en este trabajo. |

Refs productivos localizados: test/mrp-lifecycle-live.test.ts:12; test/mrp-rpc-live.test.ts:14; test/weekly-plan-atomic-db.test.ts:8; test/weekly-plan-e2e.ts:7; test/weekly-plan-rls-auth.test.ts:6; scripts/bim-e2e-seed.ts:29 (aborta si la URL resuelve al ref productivo); scripts/e2e/seed-canonical-demo.ts:13 (incluye guard de producción); scripts/run-historical-backfill.ts:40,97,113,118 (el uso de producción requiere --allow-production). tests/e2e/bim-certification.spec.ts filtra URLs con patrones de prod/vercel. Esas guardas reducen riesgo en paths puntuales, no hacen seguro ejecutar toda la batería. Ningún test/script se inició.

## 9. Comparación F7 vs main actual auditado

Base de comparación: reporte docs/ERP_MASTER_WIRING_AUDIT.md, que declara main 43add3f33eff8625b17c9c8ad303a946f90f42fd. Se confirmó que los HTML de roadmap no cambian entre F7 y ese SHA; la fuente funcional de cada columna se evaluó por separado.

| Hallazgo | main 43add3f | F7 | Mejor/Igual/Peor |
|---|---|---|---|
| Recepción OC | Formulario visible sigue en registrarRecepcion → ledger legacy; portal canónico posterior existe por link, no reemplaza por completo todos los entry points | Mismo formulario legacy; no existe aún el portal tokenizado de recepción nuevo | F7 peor en feature portal; igual en el P0 del botón OC legacy |
| MRP | Stock de obra e inbound legacy; central/reservas canonical; inbound no filtra CONFIRMED | Mismo contrato | Igual; P0 permanece |
| Inventario canonical | Backend/vistas existen, pero UI tabs ocultas y enlace /inventario ausente | Project tabs canonical publicadas y /inventario enlazado; global route sigue read-only | F7 mejor en superficie; mismo límite de edición humana general |
| Tabs visibles | Reincorpora Stock legacy y filtra Inventario, Recepciones y Pañol | Registry de 18 claves visible sin ese filtro; sin tab Stock legacy | F7 mejor para canonical y acceso |
| Dashboard | Certificados omitidos del cashflow; stock alertas legacy | Igual | Igual |
| BIM / Cómputo | Mismo parser/matcher base; posteriores mejoras enumeradas abajo no cambian este flujo BIM/cómputo | Mismo wiring estático | Igual |
| Certificados | Mismo flujo Presente/resync/facturación; sin uploader Excel directo | Igual | Igual |
| Licitaciones | Mismo PBC fallback genérico y Auction Bot simulator-only | Igual | Igual |
| Rodrigo | Mismo widget/registry/approval y permisos heterogéneos | Igual | Igual |
| Tests a PROD | Tests/scripts con refs productivos identificados; posteriores tests de scanner agregan cobertura pero no convierten el suite en seguro | Mismos refs críticos | Igual en riesgo; no ejecutar sin sandbox |
| Scanner físico | Tiene posteriores mejoras de detección, contraste, foco, ajuste y pairing | F7 conserva estado previo a esas mejoras | main mejor en capacidades de cámara, pero runtime sigue sin validar |
| Portales Pañol/recepción | Commit posterior agrega portal tokenizado de recepción con líneas/evidencia y completa superficies de portal Pañol/Recepciones | No está incluido | main mejor como feature; rescatar selectivamente |

### Qué quedaría fuera al adoptar F7

F7 es ancestro de 43add3f. git log --reverse F7..main y diff de 52 archivos (+4006/-332) ubican las diferencias posteriores. Features/cambios relevantes a rescatar o reevaluar antes de declarar nueva base:

| Commit | Contenido posterior ausente en F7 | Relevancia |
|---|---|---|
| 3c49139984795fdb75e6bd995a4369fa4be0b1d1 | OpenCV document detection v2; pipeline/tipos y fixtures/scanner | Mejora material de detección documental; recuperar y validar en dispositivos objetivo. |
| 527aa3bfc86910d3bccfa6af7f10f4d59c125f07 | Detección de cuadriláteros con bajo contraste | Robustez del scanner físico. |
| 1cdb2e781269f739e78b0dd6c7182b11d6194a2f | Focus y ajuste automático de cuadrilátero | UX de captura y encuadre en cámara. |
| a820f3e46572fae8394782abaa17e26425f20520 | Fix de pairing QR para evitar bloqueo | Recuperación del flujo PC↔móvil. |
| 677428cc0fe971bb1a72c527f3a5b561443c53d9 | Portales Pañol/recepción completos: ruta /recepcion/[token], API tokenizada, formulario itemizado, helpers/security/migration 20260922120000_receipt_portal.sql y ampliaciones de paneles | Funcionalidad importante para recepción remota/evidencias. No equivale a migrar el botón visible de OC ni debe asumirse que corrige MRP inbound. |
| 43add3f33eff8625b17c9c8ad303a946f90f42fd | Cambio final de navegación: restaura key Stock y oculta Inventario/Recepciones/Pañol; retira enlace global /inventario | Regresión a no replicar al rescatar las features anteriores. |
| bfda409f7eadef0f70a66bbd60b9ce93bd6c721c; 5b4518f643e48ae8dae3aa89bf11bcc0f7b87753; d9ea031a78b648baf75d2871b2af8b126f6c8809; c0c5fc1209ffb2099327422d727904998747885b | Documentación de certificación/preview y commits de integración de ramas/feature | Revisar trazabilidad; docs no son por sí solas features de producto ni certificado de F7. |

Además del código de cámara, main suma benchmark/debug, pruebas/f fixtures de scanner y configuración correspondiente. El rescue debería portar por unidades verificables, excluyendo explícitamente el cambio de navegación que oculta las superficies. No se ejecutó cherry-pick ni se modificó ninguna rama.

## 10. Hallazgos P0 / P1 / P2 / P3

### P0

1. **MRP inbound puede contar recepciones DRAFT como recibidas — BROKEN estáticamente.** oc_order_item_recibido suma ítems sin filtrar status; el esquema actual tiene DRAFT/CONFIRMED/VOIDED; OC visible escribe por camino legacy. La cobertura/fecha MRP no puede tratarse como confirmación de mercancía recibida hasta corregir contrato/read model.
2. **Hay tests/scripts con target hard-coded de producción.** Se localizaron ref y URL en cinco archivos test más scripts; las guardas solo aplican a ciertos seeds/backfill. No ejecutar suite/live tests contra ese ref; redirigirlos y validar barreras primero.

### P1

1. **Dos modelos de inventario viven en el flujo de obra.** MRP/forecast usan stock_por_proyecto y vista inbound legacy; canonical inventory recibe/consume y alimenta sus nuevas tabs.
2. **La recepción OC principal no escribe al ledger canonical.** Existe action/RPC canónica separada, sin ser la llamada del formulario normal.
3. **Las superficies nuevas tienen lectura, no el control humano completo.** /inventario, tab Inventario, Recepciones y panel interno Pañol son read-only en sus vistas; ciertos writes están tras acciones/tools.
4. **Dashboard excluye certificados de cashflow y alerta stock desde productos.stock_actual.** No es vista financiera/inventario conciliada.
5. **Pago conserva fallback multi-write.** Una ruta de compatibilidad puede actualizar OP/factura antes de que el asiento de tesorería termine.
6. **Compras y vault son operaciones por pasos.** RFQ→OC y empresa_documentos→company_bid_vault_items no tienen transacción única visible en las actions revisadas.
7. **Requisitos tender pueden ser genéricos.** Si no hay texto PBC extraído, origen queda GENERIC_REQUIREMENT_SUGGESTIONS.

### P2

1. No hay uploader directo de Excel de certificado; no confundir Excel de presupuesto, Cómputo o Workbook Interpreter con importación de avance certificado.
2. Aclarar el límite global read-only e incorporar UI humana de movimientos canónicos y revisión/confirmación de Pañol.
3. Planilla/MRP/Clima, BIM y scanner dependen de credenciales/proveedores/dispositivos/crons no validados.
4. Manual/roadmap presentan contratos o estados aspiracionales distintos de la superficie verificable.

### P3

1. Diferenciar visual y semánticamente Stock legacy de Inventario canonical en reportes, ayudas y exportaciones.
2. Exponer procedencia/frescura y exclusiones del Dashboard y de reportes para cifras de stock, certificados, reservas y compromisos.

## 11. Root causes

1. **Coexistencia de contratos de inventario.** Se agregó ledger canonical sin retirar/reencaminar stock legacy: MRP, dashboard, OC y pantallas consultan proyecciones distintas. El inbound no migró junto con el ciclo de estado DRAFT/CONFIRMED.
2. **La superficie y los entry points no comparten una única política de edición.** F7 unifica visibilidad en registry, pero las nuevas pantallas son mayormente consulta; actions de escritura existen en otra capa y se exponen a Rodrigo, mientras la forma humana de OC sigue legacy.
3. **Transiciones ERP distribuidas en llamadas y decisiones separadas.** Cotización→OT→obra, MRP→compra, certificado→factura y factura→pago necesitan paso manual o acciones multi-tabla; faltan read-back/idempotencia uniforme o un estado que haga visible el parcial.

## 12. Minimum Repair Plan — propuesta, no ejecutada

1. Mantener F7 como base de recuperación de superficies solo si se acepta la decisión YES de §9; no promoverla como E2E lista.
2. Aislar cualquier LIVE/RLS suite a proyecto sintético. Retirar o parametrizar refs productivos con allowlist fail-closed y prueba de guardas antes de habilitar ejecución.
3. Definir una sola fuente de verdad para stock físico por ubicación/obra y rehacer inbound como cantidad ordenada menos receipts canonical CONFIRMED ligados a OC/partida. Probar lecturas/write/read-back y migración/reconciliación en sandbox.
4. Cambiar el botón normal de recepción para crear/confirmar movimiento canonical de forma idempotente y atómica; enlazar portal tokenizado posterior a la misma transacción/recibo. No contar DRAFT en cobertura MRP.
5. Alinear MRP, Pañol, recepción, forecast y reportes con ledger canonical; conservar compatibilidad legacy explícita y auditable hasta reconciliar datos.
6. Añadir una superficie humana con permisos para revisar/confirmar Pañol y emitir los demás movimientos canónicos; mantener listado global claramente READ ONLY si esa limitación es intencional.
7. Hacer payment RPC atómica obligatoria o sustituir fallback por workflow transaccional/compensable; añadir estado/read-back para fallas de RFQ/OC y document vault.
8. Etiquetar como “genérico / PBC no leído” cualquier evaluación tender sin requisitos extraídos; bloquear conclusión elegible cuando el contrato requiera evidencia del pliego.
9. Rescatar por separado mejoras de scanner y portales añadidas después de F7; aplicar pruebas focales en entorno aislado, sin arrastrar el cambio de navegación de 43add3f.
10. Revalidar los 14 HTML contra el wiring y usar la secuencia reproducible UI→handler→action→servicio/RPC→tabla/vista→read-back antes de declarar estados VERIFIED.

## Cierre

- Resultado de selección de base: **YES — F7 es mejor que 43add3f para la recuperación de superficies canónicas visibles**, sujeto a P0/P1 y a rescatar selectivamente cambios posteriores.
- Resultado E2E/live: **UNKNOWN / NO CERTIFICADO**. Esta auditoría no constituye aprobación de producción ni de migraciones.
- Único archivo nuevo previsto: docs/ERP_MASTER_WIRING_AUDIT_F7.md. Sin commit, push, merge, deploy, pruebas ni contacto con Supabase.
