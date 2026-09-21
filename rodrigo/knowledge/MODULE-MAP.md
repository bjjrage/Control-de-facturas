# Module map V1

## Workspaces and modules

| Area visible | Superficies reales | Exposición actual a Rodrigo |
| --- | --- | --- |
| Administración | dashboard, empresas, usuarios, configuración, clientes, proveedores | Parcial: entidades se resuelven por nombre/RUC; no hay tool general de dashboard ni CRUD general de clientes/proveedores. |
| Obras / Operativo | proyectos, presupuesto, cronograma, BIM, ejecución, stock, personal, subcontratos, certificados, informes | Parcial: contexto de proyecto, stock/consumo de obra, necesidad de material y planificación semanal se leen; no todos los submódulos tienen tool. |
| Comprar | RFQ, respuestas, comparación, proveedores, borradores y órdenes | Parcial: tools de lectura, preparación y acciones con aprobación. |
| Vender | ventas, proformas, facturas de venta, notas de crédito, cobros | Lectura agregada de cuentas a cobrar; no hay tool de cobro, emisión ni nota de crédito. |
| Finanzas | flujo de caja, tesorería, cuentas financieras, pagos | `get_finance_overview` permite lectura de saldos y documentos abiertos; dinero/mutaciones siguen fuera del registry. |
| Licitaciones | licitaciones, competidores, documentos, Auction Lab, Auction Bot | `get_tender_overview` lee convocatoria, lotes, oferentes y documentos; no opera subastas ni presenta ofertas. |
| Auxiliares | planillas, documentos, email, scanner, portal de depósito | Resolución por nombre de planilla/depósito, tools de documentos/planillas/email y movimiento canónico de inventario; scanner/portal de carga no quedan expuestos como acción automática. |

## Tools registradas en esta base

### Lectura

`resolve_erp_entity`, `get_project_context`, `get_project_inventory_overview`, `get_stock_availability`, `get_material_need`, `get_weekly_plan_overview`, `get_finance_overview`, `get_tender_overview`, `search_suppliers`, `get_rfq`, `get_rfq_responses`, `compare_quotations`, `get_spreadsheet_snapshot`, `read_spreadsheet_range`, `get_document_content`, `extract_document_data`, `get_erp_knowledge`.

### Preparación o cambios controlados

`prepare_email`, `create_rfq_draft`, `prepare_purchase_order`, `update_spreadsheet_rows` son preparación/cambio no final con el riesgo declarado en el registry. `send_rfq`, `send_email`, `confirm_spreadsheet` e `issue_purchase_order` pasan por aprobación según riesgo/rol.

`post_inventory_movement` es una acción física de inventario con aprobación. No es una operación de tesorería.

## Source map

- `components/layout/sidebar.tsx`
- `components/layout/topbar.tsx`
- `lib/tools/index.ts`
- `lib/agent/registry.ts`
- `lib/agent/gateway.ts`
- `app/(internal)/projects/[id]/project-tabs-client.tsx`
- `app/(internal)/licitaciones/actions.ts`
