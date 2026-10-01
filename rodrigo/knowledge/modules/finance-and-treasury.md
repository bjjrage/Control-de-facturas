# Módulo: finanzas y tesorería

## Verificado

La aplicación tiene ventas, facturas, cobros, flujo de caja, cuentas financieras y órdenes de pago. Son datos vivos y tienen pantallas/acciones propias.

## Lectura disponible y límite de Rodrigo

`get_finance_overview` lee cuentas financieras y saldos, facturas a pagar, órdenes de pago existentes y documentos de venta con saldo abierto. La lectura se filtra por empresa y, si corresponde, por proveedor o cliente. Los importes devueltos son datos vivos y deben presentarse como lectura actual, no como conocimiento del manual.

Rodrigo nunca puede ejecutar pago, cobro, transferencia de fondos, movimiento bancario, conciliación, liquidación ni registro efectivo de dinero. La palabra transferencia solo puede habilitar el tool físico de inventario cuando se refiere a materiales y depósitos.

## Source map

- `app/(internal)/ventas/actions.ts`
- `app/(internal)/invoices/actions.ts`
- `app/(internal)/cobros/section-action.ts`
- `app/(internal)/flujo-caja/gastos-actions.ts`
- `app/(internal)/tesoreria/actions.ts`
- `app/(internal)/pagos/actions.ts`
- `lib/agent/registry.ts`
- `lib/tools/erp/get-finance-overview.ts`
- `lib/tools/erp/manage-sales-document.ts`
- `lib/tools/erp/create-invoice.ts`
