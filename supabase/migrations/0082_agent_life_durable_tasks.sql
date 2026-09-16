-- =============================================================================
-- 0082_agent_life_durable_tasks.sql
--
-- BATCH 6 - Agent Life / durable task lifecycle.
--
-- This migration deliberately creates agent_events before agent_task_waits:
-- waits carry a composite FK to the event that satisfied them.
-- =============================================================================

-- The composite keys below are the DB-side tenant boundary. RLS is not enough
-- for service_role, so every child relation also carries empresa_id.
create unique index if not exists idx_agent_tasks_id_empresa
  on public.agent_tasks(id, empresa_id);
create unique index if not exists idx_agent_runs_id_empresa
  on public.agent_runs(id, empresa_id);

create index if not exists idx_agent_runs_task_empresa
  on public.agent_runs(task_id, empresa_id);
create index if not exists idx_agent_steps_task_empresa
  on public.agent_steps(task_id, empresa_id);
create index if not exists idx_agent_steps_run_empresa
  on public.agent_steps(run_id, empresa_id);
create index if not exists idx_agent_approvals_task_empresa
  on public.agent_approvals(task_id, empresa_id);

-- ---------------------------------------------------------------------------
-- 1. agent_events - durable events with exact tenant/type/correlation matching
-- ---------------------------------------------------------------------------
create table if not exists public.agent_events (
  id                   uuid primary key default gen_random_uuid(),
  empresa_id           uuid not null references public.empresas(id) on delete cascade,
  event_type           text not null,
  source_type          text not null,
  source_id            text,
  correlation_key      text not null,
  dedup_key            text,
  payload_json         jsonb not null default '{}'::jsonb,
  occurred_at          timestamptz not null default now(),
  processed_at         timestamptz,
  processor_id         uuid,
  created_at           timestamptz not null default now()
);

create unique index if not exists idx_agent_events_id_empresa
  on public.agent_events(id, empresa_id);
create unique index if not exists idx_agent_events_dedup
  on public.agent_events(empresa_id, dedup_key)
  where dedup_key is not null;
create index if not exists idx_agent_events_empresa_correlation
  on public.agent_events(empresa_id, correlation_key);
create index if not exists idx_agent_events_empresa_type
  on public.agent_events(empresa_id, event_type);
create index if not exists idx_agent_events_match
  on public.agent_events(empresa_id, event_type, correlation_key, occurred_at);
create index if not exists idx_agent_events_unprocessed
  on public.agent_events(empresa_id, processed_at)
  where processed_at is null;

-- ---------------------------------------------------------------------------
-- 2. agent_task_leases - one active lease per task
-- ---------------------------------------------------------------------------
create table if not exists public.agent_task_leases (
  id               uuid primary key default gen_random_uuid(),
  task_id          uuid not null references public.agent_tasks(id) on delete cascade,
  empresa_id       uuid not null references public.empresas(id) on delete cascade,
  holder_id        text not null,
  holder_type      text not null default 'worker',
  acquired_at      timestamptz not null default now(),
  expires_at       timestamptz not null,
  renewed_at       timestamptz,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint fk_agent_task_leases_task_empresa
    foreign key (task_id, empresa_id)
    references public.agent_tasks(id, empresa_id)
    on delete cascade
);

create index if not exists idx_agent_task_leases_task
  on public.agent_task_leases(task_id);
create index if not exists idx_agent_task_leases_task_empresa
  on public.agent_task_leases(task_id, empresa_id);
create index if not exists idx_agent_task_leases_empresa
  on public.agent_task_leases(empresa_id);
create index if not exists idx_agent_task_leases_expires
  on public.agent_task_leases(expires_at);
create unique index if not exists idx_agent_task_leases_task_unique
  on public.agent_task_leases(task_id);

drop trigger if exists trg_agent_task_leases_updated_at on public.agent_task_leases;
create trigger trg_agent_task_leases_updated_at
  before update on public.agent_task_leases
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. agent_task_waits - durable EVENT/TIMER/APPROVAL waits
-- ---------------------------------------------------------------------------
create table if not exists public.agent_task_waits (
  id                  uuid primary key default gen_random_uuid(),
  task_id             uuid not null references public.agent_tasks(id) on delete cascade,
  run_id              uuid references public.agent_runs(id) on delete set null,
  empresa_id          uuid not null references public.empresas(id) on delete cascade,
  kind                text not null check (kind in ('EVENT','TIMER','APPROVAL')),
  event_type          text,
  correlation_key     text,
  wake_at             timestamptz,
  payload_json        jsonb not null default '{}'::jsonb,
  status              text not null default 'WAITING'
                        check (status in ('WAITING','CLAIMED','SATISFIED','CANCELLED','EXPIRED')),
  satisfied_by_event_id uuid references public.agent_events(id) on delete set null,
  satisfied_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint agent_task_waits_event_fields_check
    check (kind = 'TIMER' or (event_type is not null and correlation_key is not null)),
  constraint agent_task_waits_timer_check
    check (kind <> 'TIMER' or wake_at is not null),
  constraint fk_agent_task_waits_task_empresa
    foreign key (task_id, empresa_id)
    references public.agent_tasks(id, empresa_id)
    on delete cascade,
  constraint fk_agent_task_waits_run_empresa
    foreign key (run_id, empresa_id)
    references public.agent_runs(id, empresa_id)
    on delete restrict,
  constraint fk_agent_task_waits_event_empresa
    foreign key (satisfied_by_event_id, empresa_id)
    references public.agent_events(id, empresa_id)
    on delete restrict
);

create index if not exists idx_agent_task_waits_task
  on public.agent_task_waits(task_id);
create index if not exists idx_agent_task_waits_task_empresa
  on public.agent_task_waits(task_id, empresa_id);
create index if not exists idx_agent_task_waits_empresa
  on public.agent_task_waits(empresa_id);
create index if not exists idx_agent_task_waits_empresa_status
  on public.agent_task_waits(empresa_id, status);
create index if not exists idx_agent_task_waits_event_match
  on public.agent_task_waits(empresa_id, event_type, correlation_key, status)
  where status = 'WAITING';
create index if not exists idx_agent_task_waits_run
  on public.agent_task_waits(run_id);
create index if not exists idx_agent_task_waits_run_empresa
  on public.agent_task_waits(run_id, empresa_id);
create index if not exists idx_agent_task_waits_satisfied_event
  on public.agent_task_waits(satisfied_by_event_id);
create index if not exists idx_agent_task_waits_satisfied_event_empresa
  on public.agent_task_waits(satisfied_by_event_id, empresa_id);
create index if not exists idx_agent_task_waits_wake_at
  on public.agent_task_waits(wake_at)
  where kind = 'TIMER' and status = 'WAITING';

drop trigger if exists trg_agent_task_waits_updated_at on public.agent_task_waits;
create trigger trg_agent_task_waits_updated_at
  before update on public.agent_task_waits
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. agent_task_retries - durable retry attempts
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
  backoff_base_ms       integer not null default 5000,
  backoff_max_ms        integer not null default 300000,
  backoff_multiplier    numeric not null default 2.0,
  status                text not null default 'PENDING'
                          check (status in ('PENDING','SCHEDULED','EXECUTING','EXHAUSTED','RESOLVED','CANCELLED')),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint fk_agent_task_retries_task_empresa
    foreign key (task_id, empresa_id)
    references public.agent_tasks(id, empresa_id)
    on delete cascade,
  constraint fk_agent_task_retries_run_empresa
    foreign key (run_id, empresa_id)
    references public.agent_runs(id, empresa_id)
    on delete restrict
);

create index if not exists idx_agent_task_retries_task
  on public.agent_task_retries(task_id);
create index if not exists idx_agent_task_retries_task_empresa
  on public.agent_task_retries(task_id, empresa_id);
create index if not exists idx_agent_task_retries_empresa
  on public.agent_task_retries(empresa_id);
create index if not exists idx_agent_task_retries_run
  on public.agent_task_retries(run_id);
create index if not exists idx_agent_task_retries_run_empresa
  on public.agent_task_retries(run_id, empresa_id);
create index if not exists idx_agent_task_retries_next_retry
  on public.agent_task_retries(next_retry_at)
  where status in ('PENDING','SCHEDULED');
create unique index if not exists idx_agent_task_retries_task_attempt
  on public.agent_task_retries(task_id, attempt_number);

drop trigger if exists trg_agent_task_retries_updated_at on public.agent_task_retries;
create trigger trg_agent_task_retries_updated_at
  before update on public.agent_task_retries
  for each row execute function public.set_updated_at();

-- Advisors also identified these parent-table FK lookups from the existing
-- approval runtime; keep them covered while this batch hardens its lifecycle.
create index if not exists idx_agent_approvals_requested_by
  on public.agent_approvals(requested_by)
  where requested_by is not null;
create index if not exists idx_agent_approvals_decided_by
  on public.agent_approvals(decided_by)
  where decided_by is not null;

-- These DO blocks also repair a database that had an older 0082 definition.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_agent_runs_task_empresa') then
    alter table public.agent_runs
      add constraint fk_agent_runs_task_empresa
      foreign key (task_id, empresa_id)
      references public.agent_tasks(id, empresa_id)
      on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_agent_steps_task_empresa') then
    alter table public.agent_steps
      add constraint fk_agent_steps_task_empresa
      foreign key (task_id, empresa_id)
      references public.agent_tasks(id, empresa_id)
      on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_agent_steps_run_empresa') then
    alter table public.agent_steps
      add constraint fk_agent_steps_run_empresa
      foreign key (run_id, empresa_id)
      references public.agent_runs(id, empresa_id)
      on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_agent_approvals_task_empresa') then
    alter table public.agent_approvals
      add constraint fk_agent_approvals_task_empresa
      foreign key (task_id, empresa_id)
      references public.agent_tasks(id, empresa_id)
      on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_agent_task_leases_task_empresa') then
    alter table public.agent_task_leases
      add constraint fk_agent_task_leases_task_empresa
      foreign key (task_id, empresa_id)
      references public.agent_tasks(id, empresa_id)
      on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_agent_task_waits_task_empresa') then
    alter table public.agent_task_waits
      add constraint fk_agent_task_waits_task_empresa
      foreign key (task_id, empresa_id)
      references public.agent_tasks(id, empresa_id)
      on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_agent_task_waits_run_empresa') then
    alter table public.agent_task_waits
      add constraint fk_agent_task_waits_run_empresa
      foreign key (run_id, empresa_id)
      references public.agent_runs(id, empresa_id)
      on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_agent_task_waits_event_empresa') then
    alter table public.agent_task_waits
      add constraint fk_agent_task_waits_event_empresa
      foreign key (satisfied_by_event_id, empresa_id)
      references public.agent_events(id, empresa_id)
      on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_agent_task_retries_task_empresa') then
    alter table public.agent_task_retries
      add constraint fk_agent_task_retries_task_empresa
      foreign key (task_id, empresa_id)
      references public.agent_tasks(id, empresa_id)
      on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'fk_agent_task_retries_run_empresa') then
    alter table public.agent_task_retries
      add constraint fk_agent_task_retries_run_empresa
      foreign key (run_id, empresa_id)
      references public.agent_runs(id, empresa_id)
      on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_task_waits_event_fields_check') then
    alter table public.agent_task_waits
      add constraint agent_task_waits_event_fields_check
      check (kind = 'TIMER' or (event_type is not null and correlation_key is not null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'agent_task_waits_timer_check') then
    alter table public.agent_task_waits
      add constraint agent_task_waits_timer_check
      check (kind <> 'TIMER' or wake_at is not null);
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. agent_tasks state machine and tenant immutability
-- ---------------------------------------------------------------------------
alter table public.agent_tasks
  drop constraint if exists agent_tasks_status_check;

alter table public.agent_tasks
  add constraint agent_tasks_status_check
  check (status in ('PENDING','RUNNING','WAITING_EXTERNAL','WAITING_APPROVAL','SCHEDULED','COMPLETED','FAILED','CANCELLED'));

create or replace function public.guard_agent_task_tenant_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.empresa_id is distinct from new.empresa_id then
    raise exception 'agent_tasks.empresa_id is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_agent_tasks_tenant_immutable on public.agent_tasks;
create trigger trg_agent_tasks_tenant_immutable
  before update on public.agent_tasks
  for each row execute function public.guard_agent_task_tenant_immutable();

create or replace function public.validate_agent_task_transition(
  p_current_status text,
  p_new_status text,
  p_actor_type text default 'system',
  p_actor_role text default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
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
      v_allowed := false;
    when 'FAILED' then
      v_allowed := p_new_status in ('RUNNING');
    when 'CANCELLED' then
      v_allowed := false;
    else
      v_allowed := false;
  end case;

  if not v_allowed then
    raise exception 'Transicion de estado invalida: % -> % (actor: %, role: %)',
      p_current_status, p_new_status, p_actor_type, p_actor_role;
  end if;
end;
$$;

create or replace function public.validate_agent_tasks_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
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
-- 6. Tenant integrity for service_role as well as RLS callers
-- ---------------------------------------------------------------------------
create or replace function public.validate_agent_life_tenant_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_task_empresa uuid;
  v_run_empresa uuid;
  v_run_task_id uuid;
  v_event_empresa uuid;
begin
  select empresa_id into v_task_empresa
    from public.agent_tasks where id = new.task_id;
  if v_task_empresa is null then
    raise exception '% references a missing task %', tg_table_name, new.task_id;
  end if;
  if v_task_empresa is distinct from new.empresa_id then
    raise exception '% empresa_id % does not match task empresa_id %',
      tg_table_name, new.empresa_id, v_task_empresa;
  end if;

  if tg_table_name in ('agent_task_waits', 'agent_task_retries', 'agent_steps', 'agent_approvals') then
    if new.run_id is not null then
      select empresa_id, task_id into v_run_empresa, v_run_task_id
        from public.agent_runs where id = new.run_id;
      if v_run_empresa is null then
        raise exception '% references a missing run %', tg_table_name, new.run_id;
      end if;
      if v_run_empresa is distinct from new.empresa_id
         or v_run_task_id is distinct from new.task_id then
        raise exception '% run % is not owned by task % / empresa %',
          tg_table_name, new.run_id, new.task_id, new.empresa_id;
      end if;
    end if;
  end if;

  if tg_table_name = 'agent_task_waits' then
    if new.satisfied_by_event_id is not null then
      select empresa_id into v_event_empresa
        from public.agent_events where id = new.satisfied_by_event_id;
      if v_event_empresa is distinct from new.empresa_id then
        raise exception 'agent_task_waits event % does not belong to empresa %',
          new.satisfied_by_event_id, new.empresa_id;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_agent_task_leases_tenant on public.agent_task_leases;
create trigger trg_agent_task_leases_tenant
  before insert or update on public.agent_task_leases
  for each row execute function public.validate_agent_life_tenant_link();
drop trigger if exists trg_agent_task_waits_tenant on public.agent_task_waits;
create trigger trg_agent_task_waits_tenant
  before insert or update on public.agent_task_waits
  for each row execute function public.validate_agent_life_tenant_link();
drop trigger if exists trg_agent_task_retries_tenant on public.agent_task_retries;
create trigger trg_agent_task_retries_tenant
  before insert or update on public.agent_task_retries
  for each row execute function public.validate_agent_life_tenant_link();

-- Existing Agent Life children get the same protection on both writes and
-- updates. The z-prefix makes this trigger run after the legacy INSERT
-- tenant-default triggers that fill a missing empresa_id.
drop trigger if exists trg_agent_runs_z_tenant_link on public.agent_runs;
create trigger trg_agent_runs_z_tenant_link
  before insert or update on public.agent_runs
  for each row execute function public.validate_agent_life_tenant_link();
drop trigger if exists trg_agent_steps_z_tenant_link on public.agent_steps;
create trigger trg_agent_steps_z_tenant_link
  before insert or update on public.agent_steps
  for each row execute function public.validate_agent_life_tenant_link();
drop trigger if exists trg_agent_approvals_z_tenant_link on public.agent_approvals;
create trigger trg_agent_approvals_z_tenant_link
  before insert or update on public.agent_approvals
  for each row execute function public.validate_agent_life_tenant_link();

-- ---------------------------------------------------------------------------
-- 7. RLS for new tables
-- ---------------------------------------------------------------------------
alter table public.agent_task_leases enable row level security;
alter table public.agent_task_waits enable row level security;
alter table public.agent_events enable row level security;
alter table public.agent_task_retries enable row level security;

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

-- ---------------------------------------------------------------------------
-- 8. Atomic event effects + processed marker
-- ---------------------------------------------------------------------------
-- The worker calls this RPC instead of marking processed and then performing
-- separate writes. A failure rolls back both the wait effects and the marker.
create or replace function public.process_agent_event(
  p_event_id uuid,
  p_empresa_id uuid,
  p_processor_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_event public.agent_events%rowtype;
  v_wait record;
  v_wait_ids uuid[] := array[]::uuid[];
  v_task_ids uuid[] := array[]::uuid[];
  v_woken jsonb := '[]'::jsonb;
begin
  select * into v_event
    from public.agent_events
    where id = p_event_id and empresa_id = p_empresa_id
    for update;

  if not found then
    raise exception 'process_agent_event: evento no encontrado';
  end if;

  if v_event.processed_at is not null then
    return jsonb_build_object(
      'wokenCount', 0,
      'wokenWaitIds', to_jsonb(v_wait_ids),
      'taskIds', to_jsonb(v_task_ids)
    );
  end if;

  for v_wait in
    select id, task_id
      from public.agent_task_waits
      where empresa_id = p_empresa_id
        and status = 'WAITING'
        and event_type = v_event.event_type
        and correlation_key = v_event.correlation_key
      order by created_at, id
      for update
  loop
    update public.agent_task_waits
      set status = 'SATISFIED',
          satisfied_by_event_id = p_event_id,
          satisfied_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where id = v_wait.id and status = 'WAITING';
    if found then
      v_wait_ids := array_append(v_wait_ids, v_wait.id);
      v_task_ids := array_append(v_task_ids, v_wait.task_id);
      v_woken := v_woken || jsonb_build_array(jsonb_build_object('waitId', v_wait.id, 'taskId', v_wait.task_id));
    end if;
  end loop;

  update public.agent_events
    set processed_at = clock_timestamp(), processor_id = p_processor_id
    where id = p_event_id and empresa_id = p_empresa_id and processed_at is null;

  return jsonb_build_object(
    'wokenCount', cardinality(v_wait_ids),
    'wokenWaitIds', to_jsonb(v_wait_ids),
    'taskIds', to_jsonb(v_task_ids),
    'woken', v_woken
  );
end;
$$;

-- If a worker processed an event just before the next wait was created, the
-- event must remain usable for that exact wait. This closes the RFQ
-- multi-supplier race without reusing the same event for another wait cycle
-- of the same task.
create or replace function public.replay_agent_event_to_wait(
  p_wait_id uuid,
  p_empresa_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_wait public.agent_task_waits%rowtype;
  v_event public.agent_events%rowtype;
begin
  select * into v_wait
    from public.agent_task_waits
   where id = p_wait_id
     and empresa_id = p_empresa_id
   for update;

  if not found then
    raise exception 'replay_agent_event_to_wait: wait no encontrado';
  end if;
  if v_wait.status <> 'WAITING' or v_wait.kind = 'TIMER' then
    return jsonb_build_object('replayed', false, 'eventId', null);
  end if;

  select e.* into v_event
    from public.agent_events e
   where e.empresa_id = p_empresa_id
     and e.event_type = v_wait.event_type
     and e.correlation_key = v_wait.correlation_key
     and e.processed_at is not null
     and not exists (
       select 1
         from public.agent_task_waits used_wait
        where used_wait.task_id = v_wait.task_id
          and used_wait.empresa_id = p_empresa_id
          and used_wait.satisfied_by_event_id = e.id
     )
   order by e.occurred_at desc, e.id desc
   limit 1;

  if not found then
    return jsonb_build_object('replayed', false, 'eventId', null);
  end if;

  update public.agent_task_waits
     set status = 'SATISFIED',
         satisfied_by_event_id = v_event.id,
         satisfied_at = clock_timestamp(),
         updated_at = clock_timestamp()
   where id = v_wait.id
     and status = 'WAITING';

  return jsonb_build_object('replayed', true, 'eventId', v_event.id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9. SECURITY DEFINER hardening
-- ---------------------------------------------------------------------------
-- Existing agent trigger helpers from 0080 are not public RPCs. Keep them
-- usable by triggers/service_role while removing direct anon/authenticated use.
alter function public.set_agent_tasks_empresa() set search_path = pg_catalog, public, pg_temp;
alter function public.set_agent_runs_empresa() set search_path = pg_catalog, public, pg_temp;
alter function public.set_agent_steps_empresa() set search_path = pg_catalog, public, pg_temp;
alter function public.set_agent_approvals_empresa() set search_path = pg_catalog, public, pg_temp;
alter function public.guard_agent_approval_immutable_payload() set search_path = pg_catalog, public, pg_temp;

revoke all on function public.set_agent_tasks_empresa() from public, anon, authenticated;
revoke all on function public.set_agent_runs_empresa() from public, anon, authenticated;
revoke all on function public.set_agent_steps_empresa() from public, anon, authenticated;
revoke all on function public.set_agent_approvals_empresa() from public, anon, authenticated;
revoke all on function public.guard_agent_approval_immutable_payload() from public, anon, authenticated;
revoke all on function public.validate_agent_task_transition(text, text, text, text) from public, anon, authenticated;
revoke all on function public.validate_agent_tasks_transition() from public, anon, authenticated;
revoke all on function public.guard_agent_task_tenant_immutable() from public, anon, authenticated;
revoke all on function public.validate_agent_life_tenant_link() from public, anon, authenticated;
revoke all on function public.process_agent_event(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.replay_agent_event_to_wait(uuid, uuid) from public, anon, authenticated;

grant execute on function public.set_agent_tasks_empresa() to service_role;
grant execute on function public.set_agent_runs_empresa() to service_role;
grant execute on function public.set_agent_steps_empresa() to service_role;
grant execute on function public.set_agent_approvals_empresa() to service_role;
grant execute on function public.guard_agent_approval_immutable_payload() to service_role;
grant execute on function public.validate_agent_task_transition(text, text, text, text) to service_role;
grant execute on function public.validate_agent_tasks_transition() to service_role;
grant execute on function public.guard_agent_task_tenant_immutable() to service_role;
grant execute on function public.validate_agent_life_tenant_link() to service_role;
grant execute on function public.process_agent_event(uuid, uuid, uuid) to service_role;
grant execute on function public.replay_agent_event_to_wait(uuid, uuid) to service_role;

-- =============================================================================
-- END 0082
-- =============================================================================
