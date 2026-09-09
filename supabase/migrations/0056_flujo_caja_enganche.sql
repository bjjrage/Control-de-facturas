-- Flujo de caja — enganche con lo que ya existe (Partes A3 y B1 del plan).
--
--   - invoices.due_date: hasta ahora las facturas de compra solo tenían
--     invoice_date. Sin fecha de vencimiento no se sabe en qué semana hay que
--     pagarlas → la proyección de caja no puede ubicarlas.
--   - payment_orders.cuenta_id / sales_receipts.cuenta_id: de qué cuenta salió
--     o entró la plata. Nullable: si no se elige cuenta, el comportamiento
--     actual no cambia y no se genera movimiento de tesorería.
--
-- Todo aditivo. Nada se rompe si estas columnas quedan en null.

alter table public.invoices
  add column if not exists due_date date;

comment on column public.invoices.due_date is
  'Vencimiento de pago. Si es null se asume contado / a la vista.';

alter table public.payment_orders
  add column if not exists cuenta_id uuid references public.cuentas_financieras(id) on delete set null;

alter table public.sales_receipts
  add column if not exists cuenta_id uuid references public.cuentas_financieras(id) on delete set null;

create index if not exists idx_invoices_due_date on public.invoices(due_date) where due_date is not null;
