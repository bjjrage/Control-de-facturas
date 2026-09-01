-- Cola de parseo async del bulk de facturas.
--
-- El cliente sube las fotos/PDFs directo a Storage y encola un invoice_job por
-- archivo. Un worker Node en Railway (polling cada ~2.5s) los procesa de a uno:
-- lee con GPT-4o / pdf-parse, identifica proveedor por RUC, crea la factura y
-- concilia. Los que salen incompletos quedan en 'needs_review' para la cola de
-- revisión manual. La UI de carga se actualiza vía Supabase Realtime.

create type public.invoice_job_status as enum (
  'queued', 'processing', 'done', 'needs_review', 'failed'
);

create table public.invoice_jobs (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id),
  created_by uuid not null references public.profiles(id),
  storage_bucket text not null default 'invoice-files',
  storage_path text not null,
  file_name text not null,
  mime_type text not null,
  batch_date date not null default current_date,
  status public.invoice_job_status not null default 'queued',
  attempts int not null default 0,
  extracted jsonb,
  provider_id uuid references public.providers(id),
  invoice_id uuid references public.invoices(id) on delete set null,
  outcome text,   -- 'matched' | 'created_unmatched' | 'needs_manual' | 'error'
  message text,
  error text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.invoice_jobs enable row level security;

create index idx_invoice_jobs_empresa on public.invoice_jobs(empresa_id);
create index idx_invoice_jobs_status on public.invoice_jobs(status);

create trigger trg_invoice_jobs_empresa before insert on public.invoice_jobs
  for each row execute function public.set_empresa_id_from_caller();

create trigger trg_invoice_jobs_updated_at before update on public.invoice_jobs
  for each row execute function public.set_updated_at();

-- RLS: administracion + admin, scopeado por empresa (igual que invoices).
create policy invoice_jobs_select on public.invoice_jobs
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy invoice_jobs_insert on public.invoice_jobs
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy invoice_jobs_update on public.invoice_jobs
  for update using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));
create policy invoice_jobs_delete on public.invoice_jobs
  for delete using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion','admin']::public.user_role[]));

-- El worker (service role) reclama el job más viejo en 'queued'. FOR UPDATE
-- SKIP LOCKED + el estado 'processing' evitan que dos ciclos tomen el mismo.
create or replace function public.claim_invoice_job()
returns public.invoice_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.invoice_jobs;
begin
  update public.invoice_jobs
    set status = 'processing', locked_at = now(), attempts = attempts + 1
    where id = (
      select id from public.invoice_jobs
      where status = 'queued'
      order by created_at
      limit 1
      for update skip locked
    )
    returning * into v_job;
  return v_job;
end;
$$;

-- Realtime para la pantalla de carga.
alter publication supabase_realtime add table public.invoice_jobs;

-- Storage: el cliente ahora sube directo al bucket invoice-files (0005 solo
-- tenía SELECT; todo lo escribía el service role).
create policy "internal write invoice-files" on storage.objects
  for insert with check (
    bucket_id = 'invoice-files'
    and public.is_internal_role(array['administracion','admin']::public.user_role[])
  );
