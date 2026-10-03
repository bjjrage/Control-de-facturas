-- =============================================================================
-- 0040_project_certificate_billing.sql
--
-- Certificados de obra — FASE 2: capa de facturación + circuito de firmas.
--
-- El certificado (lo que se ejecutó) NO es lo que se cobra. Del monto del
-- certificado se descuentan la devolución del anticipo, la retención de
-- garantía y las penalidades para llegar al monto líquido de la factura.
--
-- Estados (reemplazan BORRADOR/CERRADO de la fase 1):
--   BORRADOR    edición libre de cantidades
--   ELABORADO   líneas congeladas, deducciones calculadas (firma del Residente)
--   VERIFICADO  revisado por Fiscalización / SAT
--   APROBADO    aprobado por Supervisión / comitente — cuenta para el "anterior"
--   FACTURADO   factura emitida
--
-- DECISIONES DE DISEÑO:
--   1. Los % de anticipo/devolución/retención se COPIAN del proyecto al pasar
--      a ELABORADO (denormalizado, igual que subcontractor_certificates.
--      retention_pct en 0030): si el contrato cambia sus %s después, los
--      certificados ya emitidos no se recalculan.
--   2. monto_liquido es GENERATED sobre columnas reales de la misma fila.
--   3. Las penalidades se separan en avance y presentación como en el
--      certificado oficial (5.1 y 5.2).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Nuevas columnas
-- ---------------------------------------------------------------------------
alter table public.project_certificates
  add column if not exists ajustes                 numeric(18,2) not null default 0,
  add column if not exists devolucion_anticipo     numeric(18,2) not null default 0,
  add column if not exists retencion               numeric(18,2) not null default 0,
  add column if not exists penalidad_avance        numeric(18,2) not null default 0,
  add column if not exists penalidad_presentacion  numeric(18,2) not null default 0,
  -- Snapshots del contrato al momento de elaborar (ver decisión #1).
  add column if not exists devolucion_anticipo_pct_snap numeric(5,2),
  add column if not exists retencion_pct_snap           numeric(5,2),
  -- Circuito de firmas.
  add column if not exists elaborado_por  uuid references auth.users(id) on delete set null,
  add column if not exists elaborado_at   timestamptz,
  add column if not exists verificado_por uuid references auth.users(id) on delete set null,
  add column if not exists verificado_at  timestamptz,
  add column if not exists aprobado_por   uuid references auth.users(id) on delete set null,
  add column if not exists aprobado_at    timestamptz,
  add column if not exists facturado_at   timestamptz,
  add column if not exists factura_numero text;

alter table public.project_certificates
  add column if not exists monto_liquido numeric(18,2)
  generated always as (
    monto_presente + ajustes
      - devolucion_anticipo
      - retencion
      - penalidad_avance
      - penalidad_presentacion
  ) stored;

-- ---------------------------------------------------------------------------
-- 2. Nueva máquina de estados
-- ---------------------------------------------------------------------------
alter table public.project_certificates drop constraint if exists project_certificates_status_check;

-- Datos existentes de la fase 1: 'CERRADO' equivalía a "congelado y final".
update public.project_certificates set status = 'APROBADO' where status = 'CERRADO';
update public.project_certificates
  set elaborado_at = coalesce(elaborado_at, closed_at),
      verificado_at = coalesce(verificado_at, closed_at),
      aprobado_at = coalesce(aprobado_at, closed_at),
      elaborado_por = coalesce(elaborado_por, created_by),
      aprobado_por = coalesce(aprobado_por, created_by)
  where status = 'APROBADO';

alter table public.project_certificates
  add constraint project_certificates_status_check
  check (status in ('BORRADOR', 'ELABORADO', 'VERIFICADO', 'APROBADO', 'FACTURADO'));
