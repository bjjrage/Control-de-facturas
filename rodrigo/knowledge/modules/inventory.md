# Módulo: inventario y stock

## Verificado

El catálogo `productos` alimenta stock global y desgloses por depósito y proyecto. La aplicación también tiene recepción de OC, evidencias, transferencias, inventario de obra, pañol y portal de depósito.

Rodrigo puede usar `get_stock_availability` con UUID de producto y opcionalmente de obra. Puede usar `get_material_need` con UUID de proyecto y descripciones de materiales para comparar presupuesto contra stock. El matching es una ayuda; cuando el dato no está determinado debe permanecer desconocido.

## Source map

- `lib/inventory/service.ts`
- `lib/tools/stock/get-stock-availability.ts`
- `lib/tools/procurement/get-material-need.ts`
- `app/(internal)/stock/stock-actions.ts`
- `app/(internal)/inventory/actions.ts`
- `app/warehouse/[token]/page.tsx`
