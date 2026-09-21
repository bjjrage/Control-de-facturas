# Módulo: finanzas y tesorería

## Verificado

La aplicación tiene ventas, facturas, cobros, flujo de caja, cuentas financieras y órdenes de pago. Son datos vivos y tienen pantallas/acciones propias.

## Límite de Rodrigo

En V1 no se registra ningún tool financiero en el registry. Rodrigo puede explicar términos y reconocer que la aplicación tiene estas superficies, pero no puede leer saldos actuales mediante un tool ni ejecutar pago, cobro, transferencia, movimiento bancario, conciliación, liquidación o registro efectivo de dinero.

## Source map

- `app/(internal)/ventas/actions.ts`
- `app/(internal)/invoices/actions.ts`
- `app/(internal)/cobros/section-action.ts`
- `app/(internal)/flujo-caja/gastos-actions.ts`
- `app/(internal)/tesoreria/actions.ts`
- `app/(internal)/pagos/actions.ts`
- `lib/agent/registry.ts`
