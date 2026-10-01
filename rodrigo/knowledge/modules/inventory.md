# Módulo: inventario y stock

## Verificado

El catálogo `productos` alimenta stock global y desgloses por depósito y proyecto. La aplicación también tiene recepción de OC, evidencias, transferencias, inventario de obra, pañol y portal de depósito.

Rodrigo puede resolver producto, obra y depósito por nombre con `resolve_erp_entity`. `get_project_inventory_overview` lee stock y consumo imputado a una obra; `get_stock_availability` sigue disponible para el desglose detallado de un producto. `get_material_need` compara presupuesto contra stock. `post_inventory_movement` usa el servicio canónico y permite recepciones, transferencias físicas, consumos, devoluciones y ajustes con aprobación. El matching es una ayuda; cuando el dato no está determinado debe permanecer desconocido.

## Source map

- `lib/inventory/service.ts`
- `lib/tools/stock/get-stock-availability.ts`
- `lib/tools/procurement/get-material-need.ts`
- `app/(internal)/stock/stock-actions.ts`
- `app/(internal)/inventory/actions.ts`
- `app/warehouse/[token]/page.tsx`
- `lib/agent/erp-entity-resolver.ts`
- `lib/tools/erp/get-project-inventory-overview.ts`
- `lib/tools/erp/post-inventory-movement.ts`
- `lib/tools/erp/manage-inventory-operation.ts`
