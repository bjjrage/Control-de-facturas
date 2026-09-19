-- 20260918000001_scan_sessions.sql
-- Companion app móvil de escaneo documental vinculada al ERP Control de Facturas.

create table if not exists public.scan_sessions (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  context_type text not null default 'general',
  context_id text,
  target_field text,
  status text not null default 'waiting' check (
    status in ('waiting', 'connected', 'scanning', 'processing', 'completed', 'expired', 'canceled')
  ),
  token_hash text not null unique,
  pin_code text not null,
  expires_at timestamptz not null,
  claimed_by_user_id uuid references auth.users(id) on delete set null,
  claimed_device_info jsonb default '{}'::jsonb,
  storage_bucket text not null default 'invoice-files',
  storage_path text,
  file_name text,
  file_size_bytes bigint,
  page_count integer default 0,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- Índices para búsqueda eficiente y validación rápida
create index if not exists idx_scan_sessions_token_hash on public.scan_sessions (token_hash);
create index if not exists idx_scan_sessions_pin_code on public.scan_sessions (pin_code, expires_at);
create index if not exists idx_scan_sessions_empresa_id on public.scan_sessions (empresa_id);
create index if not exists idx_scan_sessions_status on public.scan_sessions (status);

-- Habilitar Row Level Security (RLS)
alter table public.scan_sessions enable row level security;

-- Política de lectura para usuarios internos de la misma empresa
create policy "internal read scan_sessions" on public.scan_sessions
  for select using (
    empresa_id = public.current_user_empresa_id()
  );

-- Política de inserción para usuarios internos de la misma empresa
create policy "internal insert scan_sessions" on public.scan_sessions
  for insert with check (
    empresa_id = public.current_user_empresa_id()
  );

-- Política de actualización para usuarios internos de la misma empresa
create policy "internal update scan_sessions" on public.scan_sessions
  for update using (
    empresa_id = public.current_user_empresa_id()
  );

-- Habilitar Realtime para scan_sessions
alter publication supabase_realtime add table public.scan_sessions;
