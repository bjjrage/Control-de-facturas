-- Extensions
create extension if not exists pgcrypto;

-- Enums
create type public.user_role as enum ('comercial', 'administracion', 'admin');

create type public.rfq_status as enum (
  'BORRADOR',
  'COTIZANDO',
  'OFERTAS_RECIBIDAS',
  'OFERTA_SELECCIONADA',
  'AUTORIZADO',
  'FACTURADO',
  'CONCILIADO',
  'APTO_PARA_PAGO',
  'PAGADO',
  'CANCELADO',
  'RECHAZADO',
  'DIFERENCIA',
  'REQUIERE_REVISION'
);

create type public.rfq_provider_status as enum (
  'PENDIENTE',
  'ABIERTO',
  'RESPONDIDO'
);

create type public.order_status as enum (
  'AUTORIZADO',
  'FACTURADO',
  'CONCILIADO',
  'APTO_PARA_PAGO',
  'PAGADO'
);

create type public.invoice_status as enum (
  'PENDIENTE',
  'MATCH',
  'REQUIERE_REVISION',
  'APROBADO_EXCEPCION',
  'APTO_PARA_PAGO',
  'PAGADO'
);

create type public.currency_code as enum ('PYG', 'USD', 'EUR', 'BRL', 'ARS');

create type public.selection_reason as enum (
  'MENOR_PLAZO',
  'MEJOR_CALIDAD',
  'PROVEEDOR_HABITUAL',
  'DISPONIBILIDAD',
  'INCLUYE_ADICIONALES',
  'CONDICIONES_PAGO',
  'REQUERIMIENTO_CLIENTE',
  'OTRO'
);
