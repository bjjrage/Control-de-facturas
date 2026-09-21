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
