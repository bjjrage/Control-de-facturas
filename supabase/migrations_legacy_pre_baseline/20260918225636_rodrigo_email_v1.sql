-- Rodrigo Email V1: drafts, Gmail connections, approvals and technical audit.
-- Forward-only. Do not run against production from this branch.
--
-- OAuth refresh tokens are stored only in Supabase Vault. The public schema
-- stores a UUID reference, never the token itself or a token JSON payload.

create extension if not exists supabase_vault with schema vault;

create table if not exists public.email_connections (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('GMAIL')),
  provider_email text,
  status text not null default 'CONNECTED'
    check (status in ('CONNECTED', 'REVOKED', 'ERROR')),
  scopes text[] not null default '{}',
  refresh_token_secret_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disconnected_at timestamptz
);

create unique index if not exists uq_email_connections_active
  on public.email_connections (empresa_id, user_id, provider)
  where status = 'CONNECTED';
create index if not exists idx_email_connections_tenant
  on public.email_connections (empresa_id, user_id, provider, status);

create table if not exists public.email_oauth_states (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('GMAIL')),
  state_hash text not null unique,
  code_verifier text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_oauth_states_lookup
  on public.email_oauth_states (user_id, empresa_id, state_hash, expires_at)
  where consumed_at is null;

create table if not exists public.email_drafts (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete restrict,
  project_id uuid references public.projects(id) on delete set null,
  provider_connection_id uuid references public.email_connections(id) on delete set null,
  to_json jsonb not null default '[]'::jsonb,
  cc_json jsonb not null default '[]'::jsonb,
  bcc_json jsonb not null default '[]'::jsonb,
  subject text not null,
  body_text text not null,
  body_html text,
  content_hash text not null,
  status text not null default 'READY'
    check (status in ('READY', 'WAITING_APPROVAL', 'SENDING', 'SENT', 'FAILED', 'CANCELLED')),
  idempotency_key text not null,
  provider_message_id text,
  sent_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (empresa_id, idempotency_key)
);

create index if not exists idx_email_drafts_tenant_status
  on public.email_drafts (empresa_id, status, updated_at desc);
create index if not exists idx_email_drafts_created_by
  on public.email_drafts (empresa_id, created_by, updated_at desc);

create table if not exists public.email_draft_attachments (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  draft_id uuid not null references public.email_drafts(id) on delete cascade,
  document_id uuid not null references public.attachments(id) on delete restrict,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  storage_bucket text not null,
  storage_path text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (draft_id, document_id)
);

create index if not exists idx_email_draft_attachments_draft
  on public.email_draft_attachments (empresa_id, draft_id, sort_order);

create table if not exists public.email_send_events (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  draft_id uuid references public.email_drafts(id) on delete set null,
  connection_id uuid references public.email_connections(id) on delete set null,
  event_type text not null check (event_type in (
    'email.draft.created',
    'email.draft.updated',
    'email.send.approval_requested',
    'email.send.approved',
    'email.send.started',
    'email.send.completed',
    'email.send.failed',
    'email.connection.created',
    'email.connection.revoked'
  )),
  idempotency_key text,
  provider_message_id text,
  actor_id uuid references auth.users(id) on delete set null,
  actor_type text not null default 'user' check (actor_type in ('user', 'agent', 'system')),
  recipient_domains jsonb not null default '[]'::jsonb,
  subject text,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_send_events_draft
  on public.email_send_events (empresa_id, draft_id, created_at desc);
create index if not exists idx_email_send_events_tenant
  on public.email_send_events (empresa_id, event_type, created_at desc);
create unique index if not exists uq_email_send_event_idempotency
  on public.email_send_events (empresa_id, draft_id, idempotency_key, event_type)
  where idempotency_key is not null and draft_id is not null;

-- RLS is tenant-aware and additionally restricts credentials/connections to
-- their owner. The service-role is never used in browser code.
alter table public.email_connections enable row level security;
alter table public.email_oauth_states enable row level security;
alter table public.email_drafts enable row level security;
alter table public.email_draft_attachments enable row level security;
alter table public.email_send_events enable row level security;

create policy email_connections_select on public.email_connections
  for select using (
    empresa_id = public.current_empresa_id()
    and (user_id = auth.uid() or public.is_internal_role(array['admin']::public.user_role[]))
  );
create policy email_connections_insert on public.email_connections
  for insert with check (empresa_id = public.current_empresa_id() and user_id = auth.uid());
create policy email_connections_update on public.email_connections
  for update using (
    empresa_id = public.current_empresa_id()
    and (user_id = auth.uid() or public.is_internal_role(array['admin']::public.user_role[]))
  ) with check (
    empresa_id = public.current_empresa_id()
    and (user_id = auth.uid() or public.is_internal_role(array['admin']::public.user_role[]))
  );

create policy email_oauth_states_select on public.email_oauth_states
  for select using (empresa_id = public.current_empresa_id() and user_id = auth.uid());
create policy email_oauth_states_insert on public.email_oauth_states
  for insert with check (empresa_id = public.current_empresa_id() and user_id = auth.uid());
create policy email_oauth_states_update on public.email_oauth_states
  for update using (empresa_id = public.current_empresa_id() and user_id = auth.uid())
  with check (empresa_id = public.current_empresa_id() and user_id = auth.uid());
create policy email_oauth_states_delete on public.email_oauth_states
  for delete using (empresa_id = public.current_empresa_id() and user_id = auth.uid());

create policy email_drafts_select on public.email_drafts
  for select using (
    empresa_id = public.current_empresa_id()
    and (created_by = auth.uid() or public.is_internal_role(array['admin']::public.user_role[]))
  );
create policy email_drafts_insert on public.email_drafts
  for insert with check (empresa_id = public.current_empresa_id() and created_by = auth.uid());
create policy email_drafts_update on public.email_drafts
  for update using (
    empresa_id = public.current_empresa_id()
    and (created_by = auth.uid() or public.is_internal_role(array['admin']::public.user_role[]))
  ) with check (
    empresa_id = public.current_empresa_id()
    and (created_by = auth.uid() or public.is_internal_role(array['admin']::public.user_role[]))
  );

create policy email_draft_attachments_select on public.email_draft_attachments
  for select using (
    empresa_id = public.current_empresa_id()
    and exists (
      select 1 from public.email_drafts d
      where d.id = draft_id
        and d.empresa_id = public.current_empresa_id()
        and (d.created_by = auth.uid() or public.is_internal_role(array['admin']::public.user_role[]))
    )
  );
create policy email_draft_attachments_insert on public.email_draft_attachments
  for insert with check (
    empresa_id = public.current_empresa_id()
    and exists (
      select 1 from public.email_drafts d
      where d.id = draft_id
        and d.empresa_id = public.current_empresa_id()
        and (d.created_by = auth.uid() or public.is_internal_role(array['admin']::public.user_role[]))
    )
  );
create policy email_draft_attachments_delete on public.email_draft_attachments
  for delete using (
    empresa_id = public.current_empresa_id()
    and exists (
      select 1 from public.email_drafts d
      where d.id = draft_id
        and d.empresa_id = public.current_empresa_id()
        and (d.created_by = auth.uid() or public.is_internal_role(array['admin']::public.user_role[]))
    )
  );

create policy email_send_events_select on public.email_send_events
  for select using (empresa_id = public.current_empresa_id());
create policy email_send_events_insert on public.email_send_events
  for insert with check (empresa_id = public.current_empresa_id());

grant select, insert, update on public.email_connections to authenticated;
grant select, insert, update, delete on public.email_oauth_states to authenticated;
grant select, insert, update on public.email_drafts to authenticated;
grant select, insert, delete on public.email_draft_attachments to authenticated;
grant select, insert on public.email_send_events to authenticated;

drop trigger if exists trg_email_connections_updated_at on public.email_connections;
create trigger trg_email_connections_updated_at
  before update on public.email_connections
  for each row execute function public.set_updated_at();
drop trigger if exists trg_email_drafts_updated_at on public.email_drafts;
create trigger trg_email_drafts_updated_at
  before update on public.email_drafts
  for each row execute function public.set_updated_at();

-- Vault bridge. These functions expose only a secret reference to the app;
-- the decrypted token is returned only to an authenticated server request
-- after checking the owning connection. The connect function creates the
-- connection and Vault secret in one transaction to avoid orphan secrets.
create or replace function public.email_connect_gmail(
  p_provider_email text,
  p_scopes text[],
  p_refresh_token text
)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_connection_id uuid;
  v_secret_id uuid;
begin
  if auth.uid() is null or public.current_empresa_id() is null then
    raise exception 'authenticated tenant required';
  end if;
  if p_refresh_token is null or btrim(p_refresh_token) = '' then
    raise exception 'refresh token required';
  end if;
  if p_provider_email is null or btrim(p_provider_email) = '' then
    raise exception 'provider email required';
  end if;
  select vault.create_secret(
    p_refresh_token,
    'gmail-refresh-token:' || auth.uid()::text || ':' || gen_random_uuid()::text,
    'Rodrigo Gmail OAuth refresh token'
  ) into v_secret_id;
  delete from vault.secrets
  where id in (
    select refresh_token_secret_id
    from public.email_connections
    where empresa_id = public.current_empresa_id()
      and user_id = auth.uid()
      and provider = 'GMAIL'
      and status in ('CONNECTED', 'ERROR')
      and refresh_token_secret_id is not null
  );
  update public.email_connections
  set status = 'REVOKED', disconnected_at = now(), refresh_token_secret_id = null
  where empresa_id = public.current_empresa_id()
    and user_id = auth.uid()
    and provider = 'GMAIL'
    and status in ('CONNECTED', 'ERROR');
  insert into public.email_connections (
    empresa_id, user_id, provider, provider_email, status, scopes, refresh_token_secret_id
  ) values (
    public.current_empresa_id(), auth.uid(), 'GMAIL', btrim(p_provider_email), 'CONNECTED',
    coalesce(p_scopes, '{}'::text[]), v_secret_id
  ) returning id into v_connection_id;
  return v_connection_id;
end;
$$;

create or replace function public.email_read_oauth_secret(p_connection_id uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select ds.decrypted_secret
  from vault.decrypted_secrets ds
  join public.email_connections c on c.refresh_token_secret_id = ds.id
  where c.id = p_connection_id
    and c.empresa_id = public.current_empresa_id()
    and c.user_id = auth.uid()
    and c.provider = 'GMAIL'
    and c.status = 'CONNECTED'
  limit 1;
$$;

create or replace function public.email_delete_oauth_secret(p_secret_id uuid)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.email_connections c
    where c.refresh_token_secret_id = p_secret_id
      and c.empresa_id = public.current_empresa_id()
      and c.user_id = auth.uid()
  ) then
    raise exception 'secret does not belong to current user and tenant';
  end if;
  delete from vault.secrets where id = p_secret_id;
end;
$$;

revoke all on function public.email_connect_gmail(text, text[], text) from public, anon;
revoke all on function public.email_read_oauth_secret(uuid) from public, anon;
revoke all on function public.email_delete_oauth_secret(uuid) from public, anon;
grant execute on function public.email_connect_gmail(text, text[], text) to authenticated, service_role;
grant execute on function public.email_read_oauth_secret(uuid) to authenticated, service_role;
grant execute on function public.email_delete_oauth_secret(uuid) to authenticated, service_role;

-- A draft update changes the content hash. The application rejects old
-- approvals on send; this cleanup keeps the UI from presenting stale ones.
create or replace function public.cancel_email_approval_for_draft(
  p_draft_id uuid,
  p_empresa_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_empresa_id is distinct from public.current_empresa_id() then
    raise exception 'tenant mismatch';
  end if;
  update public.agent_approvals
  set status = 'CANCELLED', decided_by = auth.uid(), decided_at = now()
  where empresa_id = p_empresa_id
    and tool_name = 'send_email'
    and status = 'REQUESTED'
    and payload_json ->> 'draft_id' = p_draft_id::text;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
revoke all on function public.cancel_email_approval_for_draft(uuid, uuid) from public, anon;
grant execute on function public.cancel_email_approval_for_draft(uuid, uuid) to authenticated, service_role;
