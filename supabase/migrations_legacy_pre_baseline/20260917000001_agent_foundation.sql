-- =============================================================================
-- 0080_agent_foundation.sql
--
-- BATCH 1 — Agent Foundation
--
-- Provee el minimal runtime persistente para el modo agente:
--   agent_tasks      : intención/trabajo (persistente, sobrevive al request)
--   agent_runs       : ejecución concreta de un task (1 task -> N runs)
--   agent_steps      : acciones observables dentro de un run (solo tool IO, no CoT)
--   agent_approvals  : snapshot inmutable de lo que se pidió aprobar (payload hash)
--
-- Reglas invariantes:
--   - LLM nunca toca DB directo. Todo pasa por Tool Gateway (RLS + allowlist).
--   - Tenant isolation: todas las tablas tienen empresa_id y RLS con
--     empresa_id = public.current_empresa_id(). service_role bypasses RLS y
--     debe scoping explícito por empresa_id (gateway/runtime siempre lo pasan).
--   - Idempotencia: empresa_id + idempotency_key UNIQUE donde se usa. Dos
--     empresas no colisionan por la misma key.
--   - Approvals guardan snapshot inmutable + hash; la ejecución posterior
--     debe validar contra ese hash (no ejecutar payload B si se aprobó A).
--   - agent_steps guarda solo IO observable sanitizado, sin chain-of-thought,
--     sin secretos, sin blobs grandes.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers (reusar si ya existen)
-- ---------------------------------------------------------------------------
-- updated_at genérico ya existe (public.set_updated_at) desde 0003

-- ---------------------------------------------------------------------------
-- 1. agent_tasks
-- ---------------------------------------------------------------------------
create table if not exists public.agent_tasks (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  user_id          uuid references auth.users(id) on delete set null,
  project_id       uuid references public.projects(id) on delete set null,
  type             text not null default 'USER_INTENT',
  status           text not null default 'PENDING'
                   check (status in ('PENDING','RUNNING','WAITING_EXTERNAL','WAITING_APPROVAL','SCHEDULED','COMPLETED','FAILED','CANCELLED')),
  context_json     jsonb not null default '{}'::jsonb,
  idempotency_key  text,
  error_message    text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);

-- Idempotencia tenant-scoped: dos empresas pueden usar la misma key sin colision
create unique index if not exists idx_agent_tasks_empresa_idempotency
  on public.agent_tasks(empresa_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_agent_tasks_empresa_status on public.agent_tasks(empresa_id, status);
create index if not exists idx_agent_tasks_project on public.agent_tasks(project_id) where project_id is not null;
create index if not exists idx_agent_tasks_user on public.agent_tasks(user_id) where user_id is not null;
create index if not exists idx_agent_tasks_created_at on public.agent_tasks(empresa_id, created_at desc);

-- updated_at
drop trigger if exists trg_agent_tasks_updated_at on public.agent_tasks;
create trigger trg_agent_tasks_updated_at
  before update on public.agent_tasks
  for each row execute function public.set_updated_at();

-- auto empresa_id desde caller si viene null (request con sesión web). Server-side
-- (worker / resumed task) siempre pasa empresa_id explícito; el trigger es fallback.
create or replace function public.set_agent_tasks_empresa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.empresa_id is null then
    new.empresa_id := public.current_empresa_id();
  end if;
  if new.empresa_id is null then
    raise exception 'agent_tasks.empresa_id is required (no session nor explicit tenant)';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_tasks_empresa on public.agent_tasks;
create trigger trg_agent_tasks_empresa
  before insert on public.agent_tasks
  for each row execute function public.set_agent_tasks_empresa();

-- ---------------------------------------------------------------------------
-- 2. agent_runs
-- ---------------------------------------------------------------------------
create table if not exists public.agent_runs (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid not null references public.agent_tasks(id) on delete cascade,
  empresa_id   uuid not null references public.empresas(id) on delete cascade,
  session_id   text,
  model        text,
  status       text not null default 'RUNNING'
               check (status in ('PENDING','RUNNING','COMPLETED','FAILED','CANCELLED')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  error_message text,
  usage_json   jsonb
);

create index if not exists idx_agent_runs_task on public.agent_runs(task_id);
create index if not exists idx_agent_runs_empresa on public.agent_runs(empresa_id, started_at desc);

-- empresa_id derivado del task si no se pasa explícito (consistencia)
create or replace function public.set_agent_runs_empresa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
begin
  if new.empresa_id is null then
    select empresa_id into v_empresa from public.agent_tasks where id = new.task_id;
    new.empresa_id := coalesce(v_empresa, public.current_empresa_id());
  end if;
  if new.empresa_id is null then
    raise exception 'agent_runs.empresa_id is required';
  end if;
  -- validar que empresa del run coincida con la del task (anti cross-tenant link)
  select empresa_id into v_empresa from public.agent_tasks where id = new.task_id;
  if v_empresa is not null and v_empresa is distinct from new.empresa_id then
    raise exception 'agent_runs empresa_id % does not match task empresa_id %', new.empresa_id, v_empresa;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_runs_empresa on public.agent_runs;
create trigger trg_agent_runs_empresa
  before insert on public.agent_runs
  for each row execute function public.set_agent_runs_empresa();

-- ---------------------------------------------------------------------------
-- 3. agent_steps (solo acciones observables, no CoT)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_steps (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.agent_tasks(id) on delete cascade,
  run_id           uuid not null references public.agent_runs(id) on delete cascade,
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  tool_name        text,
  input_json       jsonb,
  output_json      jsonb,
  status           text not null default 'SUCCESS'
                   check (status in ('SUCCESS','ERROR','WAITING_APPROVAL','SKIPPED')),
  error_message    text,
  idempotency_key  text,
  duration_ms      integer,
  created_at       timestamptz not null default now()
);

create index if not exists idx_agent_steps_run on public.agent_steps(run_id, created_at);
create index if not exists idx_agent_steps_task on public.agent_steps(task_id, created_at);
create index if not exists idx_agent_steps_tool on public.agent_steps(tool_name) where tool_name is not null;

-- Idempotencia a nivel step (tool-level): misma empresa + tool + key = mismo resultado
create unique index if not exists idx_agent_steps_idempotency
  on public.agent_steps(empresa_id, tool_name, idempotency_key)
  where idempotency_key is not null and tool_name is not null;

create or replace function public.set_agent_steps_empresa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
begin
  if new.empresa_id is null then
    select empresa_id into v_empresa from public.agent_runs where id = new.run_id;
    new.empresa_id := coalesce(v_empresa, public.current_empresa_id());
  end if;
  if new.empresa_id is null then
    raise exception 'agent_steps.empresa_id is required';
  end if;
  -- validar coherencia empresa entre run y task
  select empresa_id into v_empresa from public.agent_runs where id = new.run_id;
  if v_empresa is distinct from new.empresa_id then
    raise exception 'agent_steps empresa_id does not match run empresa_id';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_steps_empresa on public.agent_steps;
create trigger trg_agent_steps_empresa
  before insert on public.agent_steps
  for each row execute function public.set_agent_steps_empresa();

-- ---------------------------------------------------------------------------
-- 4. agent_approvals (snapshot inmutable)
-- ---------------------------------------------------------------------------
create table if not exists public.agent_approvals (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.agent_tasks(id) on delete cascade,
  run_id        uuid references public.agent_runs(id) on delete set null,
  empresa_id    uuid not null references public.empresas(id) on delete cascade,
  tool_name     text not null,
  payload_json  jsonb not null,
  payload_hash  text not null,
  risk_level    integer not null check (risk_level between 0 and 4),
  status        text not null default 'REQUESTED'
                check (status in ('REQUESTED','APPROVED','REJECTED','EXPIRED','CANCELLED')),
  requested_by  uuid references auth.users(id) on delete set null,
  decided_by    uuid references auth.users(id) on delete set null,
  decided_at    timestamptz,
  expires_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_agent_approvals_task on public.agent_approvals(task_id);
create index if not exists idx_agent_approvals_run on public.agent_approvals(run_id) where run_id is not null;
create index if not exists idx_agent_approvals_status on public.agent_approvals(empresa_id, status) where status = 'REQUESTED';
create index if not exists idx_agent_approvals_tool on public.agent_approvals(tool_name);

drop trigger if exists trg_agent_approvals_updated_at on public.agent_approvals;
create trigger trg_agent_approvals_updated_at
  before update on public.agent_approvals
  for each row execute function public.set_updated_at();

create or replace function public.set_agent_approvals_empresa()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_empresa uuid;
begin
  if new.empresa_id is null then
    select empresa_id into v_empresa from public.agent_tasks where id = new.task_id;
    new.empresa_id := coalesce(v_empresa, public.current_empresa_id());
  end if;
  if new.empresa_id is null then
    raise exception 'agent_approvals.empresa_id is required';
  end if;
  select empresa_id into v_empresa from public.agent_tasks where id = new.task_id;
  if v_empresa is distinct from new.empresa_id then
    raise exception 'agent_approvals empresa_id does not match task empresa_id';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_approvals_empresa on public.agent_approvals;
create trigger trg_agent_approvals_empresa
  before insert on public.agent_approvals
  for each row execute function public.set_agent_approvals_empresa();

-- Inmutabilidad del payload: una vez aprobado/rechazado no se puede cambiar el
-- snapshot ni el hash (evita payload A aprobado -> ejecutar B).
create or replace function public.guard_agent_approval_immutable_payload()
returns trigger
language plpgsql
as $$
begin
  if old.payload_json is distinct from new.payload_json
     or old.payload_hash is distinct from new.payload_hash
     or old.tool_name is distinct from new.tool_name
     or old.risk_level is distinct from new.risk_level then
    raise exception 'agent_approvals payload is immutable after creation (approval %)', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_approvals_immutable on public.agent_approvals;
create trigger trg_agent_approvals_immutable
  before update on public.agent_approvals
  for each row execute function public.guard_agent_approval_immutable_payload();

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table public.agent_tasks enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_steps enable row level security;
alter table public.agent_approvals enable row level security;

-- agent_tasks
drop policy if exists agent_tasks_select on public.agent_tasks;
create policy agent_tasks_select on public.agent_tasks
  for select using (empresa_id = public.current_empresa_id());

drop policy if exists agent_tasks_insert on public.agent_tasks;
create policy agent_tasks_insert on public.agent_tasks
  for insert with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_tasks_update on public.agent_tasks;
create policy agent_tasks_update on public.agent_tasks
  for update using (empresa_id = public.current_empresa_id())
  with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_tasks_delete on public.agent_tasks;
create policy agent_tasks_delete on public.agent_tasks
  for delete using (empresa_id = public.current_empresa_id());

-- agent_runs
drop policy if exists agent_runs_select on public.agent_runs;
create policy agent_runs_select on public.agent_runs
  for select using (empresa_id = public.current_empresa_id());

drop policy if exists agent_runs_insert on public.agent_runs;
create policy agent_runs_insert on public.agent_runs
  for insert with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_runs_update on public.agent_runs;
create policy agent_runs_update on public.agent_runs
  for update using (empresa_id = public.current_empresa_id())
  with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_runs_delete on public.agent_runs;
create policy agent_runs_delete on public.agent_runs
  for delete using (empresa_id = public.current_empresa_id());

-- agent_steps (append-only conceptually, but allow delete for admin via RLS; real
-- guarda in code: nunca borrar steps; la policy existe para no romper service_role)
drop policy if exists agent_steps_select on public.agent_steps;
create policy agent_steps_select on public.agent_steps
  for select using (empresa_id = public.current_empresa_id());

drop policy if exists agent_steps_insert on public.agent_steps;
create policy agent_steps_insert on public.agent_steps
  for insert with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_steps_update on public.agent_steps;
create policy agent_steps_update on public.agent_steps
  for update using (empresa_id = public.current_empresa_id())
  with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_steps_delete on public.agent_steps;
create policy agent_steps_delete on public.agent_steps
  for delete using (empresa_id = public.current_empresa_id());

-- agent_approvals
drop policy if exists agent_approvals_select on public.agent_approvals;
create policy agent_approvals_select on public.agent_approvals
  for select using (empresa_id = public.current_empresa_id());

drop policy if exists agent_approvals_insert on public.agent_approvals;
create policy agent_approvals_insert on public.agent_approvals
  for insert with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_approvals_update on public.agent_approvals;
create policy agent_approvals_update on public.agent_approvals
  for update using (empresa_id = public.current_empresa_id())
  with check (empresa_id = public.current_empresa_id());

drop policy if exists agent_approvals_delete on public.agent_approvals;
create policy agent_approvals_delete on public.agent_approvals
  for delete using (empresa_id = public.current_empresa_id());
