-- =============================================================================
-- 0082_agent_life_durable_tasks.sql
--
-- BATCH 6 — Agent Life / Vida Propia
--
-- Esquema durable para tareas con espera/reanudación:
--   agent_task_leases   : leases para control de concurrencia (un task = una fila)
--   agent_task_waits    : esperas durables (EVENT, TIMER, APPROVAL)
--   agent_events        : eventos durables con correlación y deduplicación
--   agent_task_retries  : tracking de reintentos con backoff
--   agent_tasks         : state machine con validación de transiciones
--
-- Diseño: la lógica de negocio vive en TypeScript (lib/agent/*.ts), testeable
-- con vitest. Postgres aporta: tablas, índices, RLS por empresa_id y el
-- trigger de validación de transiciones. Sin RPCs de negocio duplicados.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers (reusar si ya existen)
-- ---------------------------------------------------------------------------
-- updated_at genérico ya existe (public.set_updated_at) desde 0003

-- ---------------------------------------------------------------------------
-- 1. agent_task_leases - Leases para control de concurrencia
-- ---------------------------------------------------------------------------
create table if not exists public.agent_task_leases (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.agent_tasks(id) on delete cascade,
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  holder_id        text not null, -- worker/user id como texto (ej: 'worker_<uuid>')
  holder_type      text not null default 'worker', -- 'worker', 'cron', 'api', 'manual'
  acquired_at      timestamptz not null default now(),
  expires_at       timestamptz not null,
  renewed_at       timestamptz,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_agent_task_leases_task on public.agent_task_leases(task_id);
create index if not exists idx_agent_task_leases_expires on public.agent_task_leases(expires_at);

-- Un task = una fila de lease. La expiración se chequea en app:
-- claim = delete expirados de ese task + insert; si hay conflicto, otro holder ganó.
create unique index if not exists idx_agent_task_leases_task_unique
  on public.agent_task_leases(task_id);

-- updated_at
drop trigger if exists trg_agent_task_leases_updated_at on public.agent_task_leases;
create trigger trg_agent_task_leases_updated_at
  before update on public.agent_task_leases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. agent_task_waits - Esperas durables (EVENT, TIMER, APPROVAL)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_task_waits (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references public.agent_tasks(id) on delete cascade,
  run_id              uuid references public.agent_runs(id) on delete set null,
  empresa_id          uuid not null references public.empresas(id) on delete cascade,
  kind                text not null check (kind in ('EVENT','TIMER','APPROVAL')),
  event_type          text, -- ej: 'SUPPLIER_QUOTE_RECEIVED', 'APPROVAL_DECIDED', 'TASK_TIMER_DUE'
  correlation_key     text, -- clave de correlación (ej: 'RFQ:<rfq_id>', 'APPROVAL:<approval_id>')
  wake_at             timestamptz, -- para TIMER: cuándo despertar
  payload_json        jsonb not null default '{}'::jsonb, -- datos extra para el wake
  status              text not null default 'WAITING'
                        check (status in ('WAITING','CLAIMED','SATISFIED','CANCELLED','EXPIRED')),
  satisfied_by_event_id uuid references public.agent_events(id) on delete set null,
  satisfied_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists idx_agent_task_waits_task on public.agent_task_waits(task_id);
create index if not exists idx_agent_task_waits_empresa_status on public.agent_task_waits(empresa_id, status);
create index if not exists idx_agent_task_waits_kind_correlation on public.agent_task_waits(kind, correlation_key) where status = 'WAITING';
create index if not exists idx_agent_task_waits_wake_at on public.agent_task_waits(wake_at) where kind = 'TIMER' and status = 'WAITING';

-- updated_at
drop trigger if exists trg_agent_task_waits_updated_at on public.agent_task_waits;
create trigger trg_agent_task_waits_updated_at
  before update on public.agent_task_waits
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. agent_events - Eventos durables con correlación
-- ---------------------------------------------------------------------------
create table if not exists public.agent_events (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null references public.empresas(id) on delete cascade,
  event_type           text not null, -- ej: 'SUPPLIER_QUOTE_RECEIVED', 'APPROVAL_DECIDED', 'TASK_TIMER_DUE'
  source_type          text not null, -- 'portal', 'api', 'system', 'worker', 'user', 'webhook'
  source_id            text, -- id de la entidad origen (ej: supplier_id, approval_id, task_id)
  correlation_key      text not null, -- clave de correlación (ej: 'RFQ:<rfq_id>', 'APPROVAL:<approval_id>')
  dedup_key            text, -- clave de deduplicación (empresa_id + event_type + correlation_key + source_id)
  payload_json         jsonb not null default '{}'::jsonb,
  occurred_at          timestamptz not null default now(),
  processed_at         timestamptz,
  processor_id         uuid, -- worker/processor que lo procesó
  created_at           timestamptz not null default now()
);

create unique index if not exists idx_agent_events_dedup
  on public.agent_events(empresa_id, dedup_key)
  where dedup_key is not null;

create index if not exists idx_agent_events_empresa_correlation on public.agent_events(empresa_id, correlation_key);
create index if not exists idx_agent_events_empresa_type on public.agent_events(empresa_id, event_type);
create index if not exists idx_agent_events_unprocessed on public.agent_events(empresa_id, processed_at) where processed_at is null;

-- ---------------------------------------------------------------------------
-- 4. agent_task_retries - Tracking de reintentos con backoff
-- ---------------------------------------------------------------------------
create table if not exists public.agent_task_retries (
  id                    uuid primary key default gen_random_uuid(),
  task_id               uuid not null references public.agent_tasks(id) on delete cascade,
  run_id                uuid references public.agent_runs(id) on delete set null,
  empresa_id            uuid not null references public.empresas(id) on delete cascade,
  attempt_number        integer not null default 1,
  max_attempts          integer not null default 3,
  last_error_code       text,
  last_error_message    text,
  last_error_at         timestamptz,
  next_retry_at         timestamptz,
  backoff_base_ms       integer not null default 5000, -- base 5s
  backoff_max_ms        integer not null default 300000, -- max 5 min
  backoff_multiplier    numeric not null default 2.0,
  status                text not null default 'PENDING'
                          check (status in ('PENDING','SCHEDULED','EXECUTING','EXHAUSTED','RESOLVED','CANCELLED')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_agent_task_retries_task on public.agent_task_retries(task_id);
create index if not exists idx_agent_task_retries_next_retry on public.agent_task_retries(next_retry_at) where status in ('PENDING','SCHEDULED');

drop trigger if exists trg_agent_task_retries_updated_at on public.agent_task_retries;
create trigger trg_agent_task_retries_updated_at
  before update on public.agent_task_retries
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. agent_tasks - State Machine Validation
-- ---------------------------------------------------------------------------

alter table public.agent_tasks
  drop constraint if exists agent_tasks_status_check;

alter table public.agent_tasks
  add constraint agent_tasks_status_check
  check (status in ('PENDING','RUNNING','WAITING_EXTERNAL','WAITING_APPROVAL','SCHEDULED','COMPLETED','FAILED','CANCELLED'));

-- ---------------------------------------------------------------------------
-- 6. Función para validar transiciones de estado (State Machine)
-- ---------------------------------------------------------------------------
create or replace function public.validate_agent_task_transition(
  p_current_status text,
  p_new_status text,
  p_actor_type text default 'system',
  p_actor_role text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed boolean := false;
begin
  case p_current_status
    when 'PENDING' then
      v_allowed := p_new_status in ('RUNNING','SCHEDULED','CANCELLED');
    when 'RUNNING' then
      v_allowed := p_new_status in ('WAITING_EXTERNAL','WAITING_APPROVAL','SCHEDULED','COMPLETED','FAILED','CANCELLED');
    when 'WAITING_EXTERNAL' then
      v_allowed := p_new_status in ('RUNNING','CANCELLED');
    when 'WAITING_APPROVAL' then
      v_allowed := p_new_status in ('RUNNING','CANCELLED');
    when 'SCHEDULED' then
      v_allowed := p_new_status in ('RUNNING','CANCELLED');
    when 'COMPLETED' then
      v_allowed := false; -- terminal
    when 'FAILED' then
      v_allowed := p_new_status in ('RUNNING'); -- solo retry explícito
    when 'CANCELLED' then
      v_allowed := false; -- terminal
    else
      v_allowed := false;
  end case;

  if not v_allowed then
    raise exception 'Transicion de estado invalida: % -> % (actor: %, role: %)',
      p_current_status, p_new_status, p_actor_type, p_actor_role;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. Trigger para validar transiciones en agent_tasks
-- ---------------------------------------------------------------------------
create or replace function public.validate_agent_tasks_transition()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_type text := 'system';
  v_actor_role text := null;
begin
  if old.status is distinct from new.status then
    begin
      v_actor_type := coalesce(current_setting('app.current_actor_type', true), 'system');
      v_actor_role := current_setting('app.current_actor_role', true);
    exception when others then
      v_actor_type := 'system';
      v_actor_role := null;
    end;

    perform public.validate_agent_task_transition(
      old.status, new.status, v_actor_type, v_actor_role
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_tasks_transition on public.agent_tasks;
create trigger trg_agent_tasks_transition
  before update on public.agent_tasks
  for each row execute function public.validate_agent_tasks_transition();

-- ---------------------------------------------------------------------------
-- 8. RLS Policies para nuevas tablas
-- ---------------------------------------------------------------------------

-- agent_task_leases
alter table public.agent_task_leases enable row level security;

drop policy if exists agent_task_leases_select on public.agent_task_leases;
create policy agent_task_leases_select on public.agent_task_leases
  for select using (empresa_id = public.current_empresa_id());

drop policy if exists agent_task_leases_insert on public.agent_task_leases;
create policy agent_task_leases_insert on public.agent_task_leases
  for insert with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_task_leases_update on public.agent_task_leases;
create policy agent_task_leases_update on public.agent_task_leases
  for update using (empresa_id = public.current_empresa_id())
  with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_task_leases_delete on public.agent_task_leases;
create policy agent_task_leases_delete on public.agent_task_leases
  for delete using (empresa_id = public.current_empresa_id());

-- agent_task_waits
alter table public.agent_task_waits enable row level security;

drop policy if exists agent_task_waits_select on public.agent_task_waits;
create policy agent_task_waits_select on public.agent_task_waits
  for select using (empresa_id = public.current_empresa_id());

drop policy if exists agent_task_waits_insert on public.agent_task_waits;
create policy agent_task_waits_insert on public.agent_task_waits
  for insert with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_task_waits_update on public.agent_task_waits;
create policy agent_task_waits_update on public.agent_task_waits
  for update using (empresa_id = public.current_empresa_id())
  with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_task_waits_delete on public.agent_task_waits;
create policy agent_task_waits_delete on public.agent_task_waits
  for delete using (empresa_id = public.current_empresa_id());

-- agent_events
alter table public.agent_events enable row level security;

drop policy if exists agent_events_select on public.agent_events;
create policy agent_events_select on public.agent_events
  for select using (empresa_id = public.current_empresa_id());

drop policy if exists agent_events_insert on public.agent_events;
create policy agent_events_insert on public.agent_events
  for insert with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_events_update on public.agent_events;
create policy agent_events_update on public.agent_events
  for update using (empresa_id = public.current_empresa_id())
  with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_events_delete on public.agent_events;
create policy agent_events_delete on public.agent_events
  for delete using (empresa_id = public.current_empresa_id());

-- agent_task_retries
alter table public.agent_task_retries enable row level security;

drop policy if exists agent_task_retries_select on public.agent_task_retries;
create policy agent_task_retries_select on public.agent_task_retries
  for select using (empresa_id = public.current_empresa_id());

drop policy if exists agent_task_retries_insert on public.agent_task_retries;
create policy agent_task_retries_insert on public.agent_task_retries
  for insert with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_task_retries_update on public.agent_task_retries;
create policy agent_task_retries_update on public.agent_task_retries
  for update using (empresa_id = public.current_empresa_id())
  with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_task_retries_delete on public.agent_task_retries;
create policy agent_task_retries_delete on public.agent_task_retries
  for delete using (empresa_id = public.current_empresa_id());

-- =============================================================================
-- FIN MIGRACIÓN 0082
-- Lógica de negocio (claim/resume/retry/timers) en TypeScript: lib/agent/*.ts
-- =============================================================================
