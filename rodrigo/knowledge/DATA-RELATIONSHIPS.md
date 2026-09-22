# Data relationships V1

Este mapa usa nombres que aparecen en consultas de la aplicación o en tools. No describe filas actuales.

## Núcleo de obra

`projects` es el registro padre para `budget_items` y `execution_entries`. Las acciones de proyecto también conectan unidades, recetas, certificados, proveedores, subcontratos, personal y datos BIM.

## Inventario

`productos` contiene el catálogo. `stock_por_deposito` agrega por `deposito_id` y `depositos`; `stock_por_proyecto` agrega la lente de una obra. Las recepciones usan `oc_recepciones`, `oc_recepcion_items` y evidencias. El stock de obra/pañol y el portal de depósito tienen superficies adicionales.

## Compras

`rfqs` se relaciona con `projects`, `rfq_items` y `rfq_suppliers`; estos últimos enlazan proveedores. `rfq_responses` contiene respuestas que `compare_quotations` compara. La preparación de OC usa `purchase_order_drafts` y `purchase_order_draft_items`; las órdenes autorizadas usan `authorized_orders` y `authorized_order_items`.

## Facturas y pagos

`invoices` puede relacionarse con `authorized_orders` mediante `invoice_order_matches`. `payment_orders` se vincula a facturas por `payment_order_invoices`. Las cuentas financieras y el flujo de caja son superficies de datos vivos y no forman parte del runtime de conocimiento estático.

## Planificación

`project_weekly_plans` se relaciona con `project_weekly_plan_items` e `inventory_reservations`; el servicio compartido también carga entradas/inbound para calcular necesidades. Rodrigo todavía no posee un lector específico de este submodelo.

## Licitaciones

`licitaciones` se descompone en `licitacion_lotes`, `licitacion_items`, `licitacion_oferentes`, `licitacion_ofertas` y `licitacion_documentos`. El seguimiento de empresa y las observaciones de costos son relaciones auxiliares. Auction Lab usa tablas `auction_sandbox_*` separadas.

## Agente

Una conversación crea `agent_tasks`, `agent_runs` y `agent_steps`. Las acciones de riesgo se registran en `agent_approvals`. El conocimiento V1 no lee ni escribe esas tablas por sí mismo; el Gateway puede mantener su trazabilidad existente cuando ejecuta el tool.

## Source map

- `lib/tools/projects/get-project-context.ts`
- `lib/tools/stock/get-stock-availability.ts`
- `lib/tools/procurement/get-material-need.ts`
- `lib/tools/procurement/get-rfq.ts`
- `lib/tools/procurement/prepare-purchase-order.ts`
- `lib/invoice-auto-match.ts`
- `app/(internal)/pagos/actions.ts`
- `app/(internal)/projects/weekly-plan-actions.ts`
- `app/(internal)/licitaciones/actions.ts`
- `lib/agent/runtime.ts`
- `lib/agent/approvals.ts`

## Relaciones V4 auditadas

- `daily_labor_entries.project_id -> projects.id`; `subcontractor_contracts.project_id -> projects.id` y `subcontractor_contracts.subcontractor_id -> subcontractors.id`; `subcontractor_certificates.project_id/contract_id` completa la trazabilidad de subcontratos.
- `project_certificate_staff.certificate_id -> project_certificates.id -> projects.id` representa la cuadrilla declarada en un certificado; no se encontró un maestro general de personal/cuadrillas.
- `budget_item_materials.project_id/budget_item_id/producto_id` conecta una partida de `budget_items` con materiales de `productos`; el costo material se lee de `productos.costo_promedio` y el desperdicio de `budget_item_materials`.
- `scan_sessions` guarda metadata y referencia de storage; tokens/PIN/hash viven en la misma fila pero se excluyen del tool de lectura.
- `auction_sandbox_rooms` se relaciona con `auction_sandbox_participants`, `auction_sandbox_bids`, `auction_sandbox_events` y `auction_sandbox_policy_versions`; `auction_sandbox_room_private` permanece fuera de vistas.
- `inventory_locations`, `inventory_balances`, `inventory_movements` e `inventory_reservations` son la fuente del inventario V4; `inventory_consumption_by_budget` y `inventory_stock_by_project` son vistas de lectura.
- `sales_documents` se relaciona con `sales_document_items`, `work_orders` y `clients`; `invoices`/`payment_orders` siguen siendo lecturas financieras y no exponen herramientas de cobro/pago.
