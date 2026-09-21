# Module map V1

## Workspaces and modules

| Area visible | Superficies reales | Exposición actual a Rodrigo |
| --- | --- | --- |
| Administración | dashboard, empresas, usuarios, configuración, clientes, proveedores | Parcial: proyecto, proveedores y algunos datos se leen mediante tools; no hay tool general de dashboard/cliente. |
| Obras / Operativo | proyectos, presupuesto, cronograma, BIM, ejecución, stock, personal, subcontratos, certificados, informes | Parcial: `get_project_context`, stock y necesidad de material. |
| Comprar | RFQ, respuestas, comparación, proveedores, borradores y órdenes | Parcial: tools de lectura, preparación y acciones con aprobación. |
| Vender | ventas, proformas, facturas de venta, notas de crédito, cobros | No hay tools de ventas/cobros en el registry actual. |
| Finanzas | flujo de caja, tesorería, cuentas financieras, pagos | Sin tools de datos financieros ni de movimiento monetario. |
| Licitaciones | licitaciones, competidores, documentos, Auction Lab, Auction Bot | No hay tool de consulta/operación de licitaciones para Rodrigo. |
| Auxiliares | planillas, documentos, email, scanner, portal de depósito | Documentos, planillas y email tienen tools; scanner/portal no están expuestos. |

## Tools registradas en esta base

### Lectura

`get_project_context`, `get_stock_availability`, `get_material_need`, `search_suppliers`, `get_rfq`, `get_rfq_responses`, `compare_quotations`, `get_spreadsheet_snapshot`, `read_spreadsheet_range`, `get_document_content`, `extract_document_data`, `get_erp_knowledge`.

### Preparación o cambios controlados

`prepare_email`, `create_rfq_draft`, `prepare_purchase_order`, `update_spreadsheet_rows` son preparación/cambio no final con el riesgo declarado en el registry. `send_rfq`, `send_email`, `confirm_spreadsheet` e `issue_purchase_order` pasan por aprobación según riesgo/rol.

## Source map

- `components/layout/sidebar.tsx`
- `components/layout/topbar.tsx`
- `lib/tools/index.ts`
- `lib/agent/registry.ts`
- `lib/agent/gateway.ts`
- `app/(internal)/projects/[id]/project-tabs-client.tsx`
- `app/(internal)/licitaciones/actions.ts`
