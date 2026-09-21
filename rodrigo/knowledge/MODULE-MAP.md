# Module map V3

## Superficies verificadas y exposición de Rodrigo

| Área | Código real inspeccionado | Exposición actual |
| --- | --- | --- |
| Administración | clientes/actions, providers/actions, projects/actions | `manage_master_data` cubre clientes, proveedores y obras donde las acciones existentes lo permiten. |
| Obras | projects/actions, weekly-plan-actions, production-recipe-actions, certificado-actions, BIM/computo actions | Lectura de presupuesto/BIM/cómputo; partidas, avance, recetas/BOM, planificación/MRP y certificados con aprobación. Personal/subcontratos siguen sin tool. |
| Comprar | RFQ/order/invoice actions, inventory/actions | Se mantienen tools de RFQ/OC existentes; V3 suma factura de proveedor, recepciones, ubicaciones y rendiciones. Pagos no. |
| Vender | ventas/actions | `manage_sales_document` crea, edita y emite documentos; cobros siguen fuera. |
| Finanzas | finance tools y tesorería existente | `get_finance_overview` es lectura. No hay mutación monetaria allowlisteada. |
| Licitaciones | licitaciones/actions, dashboard-data, documentos/actions | `get_tender_overview` lee; `manage_tender` decide, prepara/evalúa, extrae texto y convierte una GANADA. DNCP/Auction Lab/Bot no se operan. |
| Auxiliares | inventory/actions, scanner, documents/actions | Portal/rendiciones y metadatos empresariales vía tools. Scanner binario y adjuntos no se cargan desde chat. |

## Tools registradas tras V3

Además de las 26 herramientas base/V2, V3 registra 13 nuevas:

`manage_master_data`, `preview_weekly_plan`, `save_weekly_plan`, `manage_budget_item`, `manage_production_recipe`, `manage_sales_document`, `create_invoice`, `manage_company_document`, `manage_inventory_operation`, `manage_climate_workday`, `manage_tender`, `manage_certificate`, `get_project_modeling_overview`.

Las lecturas son riesgo 0. Las acciones mutables son riesgo 2 y requieren aprobación del Gateway. Todas las referencias técnicas deben venir de `resolve_erp_entity` y cada handler conserva el tenant del actor.

## Separaciones intencionales

- Knowledge es estático; estado, saldos y existencias salen de tools vivos.
- MRP puede reservar dentro del commit semanal existente; no emite compras automáticamente.
- La factura/documento comercial no es cobro.
- Inventario físico no es tesorería.
- La UI o un módulo real no implica capability de Rodrigo si no existe tool registrado.

## Source map

- `lib/tools/index.ts`
- `lib/agent/registry.ts`
- `lib/agent/gateway.ts`
- `lib/agent/knowledge/documents.ts`
- `rodrigo/knowledge/modules/operations-v3.md`
- `rodrigo/knowledge/CAPABILITIES-GAPS.md`

## Exposición V4

| Área auditada | Código real | Exposición Rodrigo |
| --- | --- | --- |
| Personal/subcontratos | `caterpillar-actions.ts`, `project_certificate_staff`, `daily_labor_entries`, `subcontractor_*` | Lectura `get_labor_subcontractor_overview`; escritura aprobable `manage_labor_subcontractor`. |
| APU/BOM | `budget_item_materials`, `saveBudgetItemMaterialAction`, `progress-forecast-actions.ts` | Lectura `get_apu_overview`; escritura aprobable `manage_apu_material`. Solo materiales. |
| Scanner | `lib/scanner/session-service.ts`, `scan_sessions` | `get_scanner_session_overview` solo metadata/estado; sin binarios ni credenciales. |
| Auction Lab | `lib/auction-sandbox/server.ts`, `auction_sandbox_*`, `auction-lab/actions.ts` | Fuera del scope conversacional de Rodrigo; no hay tool operativo allowlisteado. |
| Obras/clima | `execution_entries`, `project_weekly_*`, `project_certificates`, `climate_*` | `get_project_operational_overview` compone lecturas vivas. Mutaciones siguen `manage_*` aprobables. |
| Inventario | `lib/inventory/service.ts`, `inventory_*`, `inventory_reservations` | `get_inventory_overview` para balances, reservas, movimientos y consumos. Mutaciones siguen wrappers V3 aprobables. |
| Ventas/facturación | `sales_documents`, `sales_document_items`, `work_orders` | `get_billing_overview` amplía lecturas; `manage_sales_document`/`create_invoice` siguen siendo mutaciones aprobables. |

V4 no agrega skills ni migraciones. La resolución humana se amplía en `lib/agent/erp-entity-resolver.ts` y conserva scoping por `empresa_id` o por `project_id` validado contra la empresa.

## Exposición V5

| Área auditada | Código real | Exposición Rodrigo |
| --- | --- | --- |
| Facturas de proveedor | `invoices/actions.ts`, `invoices/[id]/actions.ts`, `invoices`, `attachments`, `invoice_order_matches`, `invoice_exceptions` | Lectura completa con `get_supplier_invoice_overview`; registro existente con `create_invoice`; vínculo/desvínculo/eliminación aprobables con `manage_supplier_invoice`; nunca pagos. |
| Órdenes de trabajo | `ventas/[id]/quotation-actions.ts`, `0090_quotation_acceptance_work_orders.sql`, `work_orders`, `work_order_items`, `sales_quotation_events` | Lectura completa con `get_work_order_overview`; estado/aprobación interna con `manage_work_order`; creación sólo desde aceptación real. |
| SIFEN | `ventas/sifen-actions.ts`, `lib/goekua.ts`, `sales_documents.cdc/xml_url/kude_url` | Lectura `get_sifen_overview`; emisión/consulta existente con aprobación mediante `manage_sifen_document`. |
| Adjuntos desde chat | `lib/scanner/session-service.ts`, `app/api/scanner/*`, `attachments`, `/api/agent/chat` | Parcial: se leen sesiones/archivos existentes, pero el chat no sube, reemplaza ni asocia binarios. |

V5 no agrega migraciones, skills ni rutinas. La clasificación crítica completa está en `CAPABILITIES-GAPS.md` y el runtime en `operations-v5.md`.
