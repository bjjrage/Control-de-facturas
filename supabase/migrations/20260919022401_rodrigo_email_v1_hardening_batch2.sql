-- Rodrigo Email V1 hardening batch 2.
-- Forward-only: this migration is intentionally not applied to PROD by this branch.
-- It closes the send/disconnect, edit/send and provider-accepted/DB-failed races.

alter table public.email_drafts drop constraint if exists email_drafts_status_check;
alter table public.email_drafts
  add constraint email_drafts_status_check
  check (status in (
    'READY', 'WAITING_APPROVAL', 'SENDING', 'SENT', 'FAILED',
    'DELIVERY_UNKNOWN', 'CANCELLED'
  ));

alter table public.email_drafts
  add column if not exists revision bigint not null default 1,
  add column if not exists delivery_retry_authorized boolean not null default false;

alter table public.email_drafts
  add constraint email_drafts_revision_positive_check
  check (revision > 0);

alter table public.agent_approvals
  add column if not exists approved_revision bigint,
  add column if not exists approved_content_hash text;

alter table public.agent_approvals
  add constraint agent_approvals_approved_revision_positive_check
  check (approved_revision is null or approved_revision > 0);

alter table public.agent_approvals
  add constraint agent_approvals_approved_content_hash_check
  check (approved_content_hash is null or approved_content_hash ~ '^[a-f0-9]{64}$');

-- The attempt is durable before any request is made to Gmail. A CLAIMED or
-- DISPATCHING attempt is the single in-flight owner of a draft. DELIVERY_UNKNOWN
-- is terminal for automatic purposes: it is never retried implicitly.
create table if not exists public.email_send_attempts (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  draft_id uuid not null references public.email_drafts(id) on delete restrict,
  connection_id uuid not null references public.email_connections(id) on delete restrict,
  approval_id uuid not null references public.agent_approvals(id) on delete restrict,
  approved_revision bigint not null check (approved_revision > 0),
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  delivery_fingerprint text not null check (delivery_fingerprint ~ '^[a-f0-9]{64}$'),
  client_message_id text not null unique,
  status text not null check (status in (
    'CLAIMED', 'DISPATCHING', 'SENT', 'FAILED_SAFE', 'DELIVERY_UNKNOWN'
  )),
  provider_message_id text,
  started_at timestamptz not null default now(),
  provider_accepted_at timestamptz,
  completed_at timestamptz,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_email_send_attempts_draft
  on public.email_send_attempts (empresa_id, draft_id, created_at desc);
create index if not exists idx_email_send_attempts_connection_active
  on public.email_send_attempts (empresa_id, connection_id, status)
  where status in ('CLAIMED', 'DISPATCHING');
create index if not exists idx_email_send_attempts_fingerprint
  on public.email_send_attempts (empresa_id, delivery_fingerprint, created_at desc);

alter table public.email_send_attempts enable row level security;
revoke all on public.email_send_attempts from public, anon, authenticated;
grant select, insert, update on public.email_send_attempts to service_role;

-- Keep the approval binding immutable even if a future generic approval update
-- changes its lifecycle state.
create or replace function public.guard_email_approval_binding()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if old.approved_revision is distinct from new.approved_revision
     or old.approved_content_hash is distinct from new.approved_content_hash then
    raise exception 'email approval binding is immutable (approval %)', old.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_email_approval_binding on public.agent_approvals;
create trigger trg_email_approval_binding
  before update on public.agent_approvals
  for each row execute function public.guard_email_approval_binding();

-- Content mutations advance the revision. Attachment mutations have their own
-- trigger because they live in a child table. Authenticated callers cannot
-- mutate a draft while the send claim holds SENDING.
create or replace function public.guard_email_draft_send_barrier()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if old.status = 'SENDING' and v_role = 'authenticated' then
    raise exception 'email draft is locked by an in-flight send attempt';
  end if;

  if old.status = 'SENDING'
     and new.status not in ('SENDING', 'SENT', 'FAILED', 'DELIVERY_UNKNOWN') then
    raise exception 'email draft cannot leave SENDING through this transition';
  end if;

  if old.to_json is distinct from new.to_json
     or old.cc_json is distinct from new.cc_json
     or old.bcc_json is distinct from new.bcc_json
     or old.subject is distinct from new.subject
     or old.body_text is distinct from new.body_text
     or old.body_html is distinct from new.body_html
     or old.content_hash is distinct from new.content_hash
     or old.provider_connection_id is distinct from new.provider_connection_id then
    new.revision := old.revision + 1;
    new.delivery_retry_authorized := false;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_email_draft_send_barrier on public.email_drafts;
create trigger trg_email_draft_send_barrier
  before update on public.email_drafts
  for each row execute function public.guard_email_draft_send_barrier();

create or replace function public.guard_email_attachment_send_barrier()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_draft_id uuid := coalesce(new.draft_id, old.draft_id);
  v_status text;
begin
  select d.status into v_status
  from public.email_drafts d
  where d.id = v_draft_id
  for update;

  if v_status = 'SENDING' then
    raise exception 'email draft attachments are locked by an in-flight send attempt';
  end if;

  update public.email_drafts
  set revision = revision + 1,
      delivery_retry_authorized = false
  where id = v_draft_id;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_email_attachment_send_barrier_insert on public.email_draft_attachments;
create trigger trg_email_attachment_send_barrier_insert
  before insert on public.email_draft_attachments
  for each row execute function public.guard_email_attachment_send_barrier();
drop trigger if exists trg_email_attachment_send_barrier_update on public.email_draft_attachments;
create trigger trg_email_attachment_send_barrier_update
  before update on public.email_draft_attachments
  for each row execute function public.guard_email_attachment_send_barrier();
drop trigger if exists trg_email_attachment_send_barrier_delete on public.email_draft_attachments;
create trigger trg_email_attachment_send_barrier_delete
  before delete on public.email_draft_attachments
  for each row execute function public.guard_email_attachment_send_barrier();

-- A claim locks the connection first. Disconnect uses the same row as its
-- linearization point: disconnect-before-claim is denied, claim-before-
-- disconnect has a durable in-flight attempt and may not be cancelled.
create or replace function public.claim_email_send(
  p_empresa_id uuid,
  p_user_id uuid,
  p_draft_id uuid,
  p_connection_id uuid,
  p_approval_id uuid,
  p_approved_revision bigint,
  p_approved_content_hash text,
  p_delivery_fingerprint text,
  p_allow_delivery_unknown_retry boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_connection public.email_connections%rowtype;
  v_draft public.email_drafts%rowtype;
  v_approval public.agent_approvals%rowtype;
  v_attempt_id uuid := gen_random_uuid();
  v_client_message_id text := '<' || v_attempt_id::text || '@dominio-control-facturas>';
  v_unknown_created_at timestamptz;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required for email send claim';
  end if;
  if p_empresa_id is null or p_user_id is null or p_draft_id is null
     or p_connection_id is null or p_approval_id is null then
    raise exception 'email send claim identity is incomplete';
  end if;
  if p_approved_revision is null or p_approved_content_hash is null
     or p_delivery_fingerprint is null then
    raise exception 'email send claim binding is incomplete';
  end if;

  select * into v_connection
  from public.email_connections c
  where c.id = p_connection_id
    and c.empresa_id = p_empresa_id
    and c.user_id = p_user_id
    and c.provider = 'GMAIL'
  for update;
  if not found or v_connection.status <> 'CONNECTED' then
    raise exception 'email connection is not CONNECTED at send linearization point';
  end if;

  select * into v_draft
  from public.email_drafts d
  where d.id = p_draft_id
    and d.empresa_id = p_empresa_id
    and d.created_by = p_user_id
  for update;
  if not found then
    raise exception 'email draft does not belong to the requested actor';
  end if;
  if v_draft.status <> 'WAITING_APPROVAL' then
    raise exception 'email draft is not waiting for approval';
  end if;
  if v_draft.provider_connection_id is distinct from p_connection_id then
    raise exception 'email draft connection changed after approval';
  end if;
  if v_draft.revision is distinct from p_approved_revision
     or v_draft.content_hash is distinct from p_approved_content_hash then
    raise exception 'email draft revision or content hash changed after approval';
  end if;

  select * into v_approval
  from public.agent_approvals a
  where a.id = p_approval_id
    and a.empresa_id = p_empresa_id
    and a.tool_name = 'send_email'
  for update;
  if not found or v_approval.status not in ('APPROVED', 'EXECUTING') then
    raise exception 'email approval is not valid or has already been consumed';
  end if;
  if v_approval.approved_revision is distinct from p_approved_revision
     or v_approval.approved_content_hash is distinct from p_approved_content_hash
     or v_approval.payload_json ->> 'draft_id' is distinct from p_draft_id::text
     or v_approval.payload_json ->> 'draft_hash' is distinct from p_approved_content_hash
     or (v_approval.payload_json ->> 'draft_revision')::bigint is distinct from p_approved_revision then
    raise exception 'email approval snapshot does not match the send claim';
  end if;

  select max(a.created_at) into v_unknown_created_at
  from public.email_send_attempts a
  where a.empresa_id = p_empresa_id
    and a.delivery_fingerprint = p_delivery_fingerprint
    and a.status = 'DELIVERY_UNKNOWN';
  if v_unknown_created_at is not null
     and (not p_allow_delivery_unknown_retry or v_approval.created_at <= v_unknown_created_at) then
    raise exception 'delivery outcome is unknown; explicit resend with a new approval is required';
  end if;

  insert into public.email_send_attempts (
    id, empresa_id, draft_id, connection_id, approval_id,
    approved_revision, content_hash, delivery_fingerprint,
    client_message_id, status
  ) values (
    v_attempt_id, p_empresa_id, p_draft_id, p_connection_id, p_approval_id,
    p_approved_revision, p_approved_content_hash, p_delivery_fingerprint,
    v_client_message_id, 'CLAIMED'
  );

  update public.email_drafts
  set status = 'SENDING', failure_reason = null
  where id = p_draft_id;

  return jsonb_build_object(
    'attempt_id', v_attempt_id,
    'client_message_id', v_client_message_id,
    'status', 'CLAIMED',
    'approved_revision', p_approved_revision,
    'content_hash', p_approved_content_hash
  );
end;
$$;

-- The send credential bridge accepts only a durable claimed attempt. The
-- revoke bridge is deliberately separate and never accepts a send attempt id.
create or replace function public.email_read_oauth_secret_for_send(
  p_send_attempt_id uuid,
  p_connection_id uuid,
  p_empresa_id uuid,
  p_user_id uuid
)
returns text
language sql
security definer
set search_path = pg_catalog, public, vault, pg_temp
as $$
  select ds.decrypted_secret
  from public.email_send_attempts a
  join public.email_connections c on c.id = a.connection_id
  join vault.decrypted_secrets ds on ds.id = c.refresh_token_secret_id
  join public.email_drafts d on d.id = a.draft_id
  where a.id = p_send_attempt_id
    and a.connection_id = p_connection_id
    and a.empresa_id = p_empresa_id
    and c.empresa_id = p_empresa_id
    and c.user_id = p_user_id
    and c.provider = 'GMAIL'
    and a.status in ('CLAIMED', 'DISPATCHING')
    and d.status = 'SENDING'
    and a.approved_revision = d.revision
    and a.content_hash = d.content_hash
  limit 1;
$$;

create or replace function public.email_read_oauth_secret_for_revoke(
  p_connection_id uuid,
  p_empresa_id uuid,
  p_user_id uuid
)
returns text
language sql
security definer
set search_path = pg_catalog, public, vault, pg_temp
as $$
  select ds.decrypted_secret
  from public.email_connections c
  join vault.decrypted_secrets ds on ds.id = c.refresh_token_secret_id
  where c.id = p_connection_id
    and c.empresa_id = p_empresa_id
    and c.user_id = p_user_id
    and c.provider = 'GMAIL'
    and c.status in ('REVOKE_PENDING', 'DISCONNECT_FAILED')
  limit 1;
$$;

create or replace function public.mark_email_send_attempt_dispatching(
  p_send_attempt_id uuid,
  p_empresa_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_attempt public.email_send_attempts%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required for email attempt transition';
  end if;
  select a.* into v_attempt
  from public.email_send_attempts a
  join public.email_drafts d on d.id = a.draft_id
  where a.id = p_send_attempt_id and a.empresa_id = p_empresa_id
    and d.created_by = p_user_id
  for update;
  if not found or v_attempt.status <> 'CLAIMED' then
    raise exception 'email send attempt is not claimable for dispatch';
  end if;
  update public.email_send_attempts
  set status = 'DISPATCHING', started_at = coalesce(started_at, now())
  where id = p_send_attempt_id;
  return jsonb_build_object('attempt_id', p_send_attempt_id, 'status', 'DISPATCHING');
end;
$$;

create or replace function public.complete_email_send_attempt(
  p_send_attempt_id uuid,
  p_empresa_id uuid,
  p_user_id uuid,
  p_provider_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_attempt public.email_send_attempts%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required for email attempt transition';
  end if;
  select a.* into v_attempt
  from public.email_send_attempts a
  join public.email_drafts d on d.id = a.draft_id
  where a.id = p_send_attempt_id and a.empresa_id = p_empresa_id
    and d.created_by = p_user_id
  for update;
  if not found or v_attempt.status <> 'DISPATCHING' then
    raise exception 'email send attempt is not dispatching';
  end if;
  update public.email_send_attempts
  set status = 'SENT', provider_message_id = p_provider_message_id,
      provider_accepted_at = coalesce(provider_accepted_at, now()), completed_at = now()
  where id = p_send_attempt_id;
  update public.email_drafts
  set status = 'SENT', provider_message_id = p_provider_message_id,
      sent_at = now(), failure_reason = null
  where id = v_attempt.draft_id and status = 'SENDING';
  return jsonb_build_object('attempt_id', p_send_attempt_id, 'status', 'SENT',
    'provider_message_id', p_provider_message_id);
end;
$$;

create or replace function public.fail_email_send_attempt(
  p_send_attempt_id uuid,
  p_empresa_id uuid,
  p_user_id uuid,
  p_error_code text,
  p_failure_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_attempt public.email_send_attempts%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required for email attempt transition';
  end if;
  select a.* into v_attempt
  from public.email_send_attempts a
  join public.email_drafts d on d.id = a.draft_id
  where a.id = p_send_attempt_id and a.empresa_id = p_empresa_id
    and d.created_by = p_user_id
  for update;
  if not found or v_attempt.status not in ('CLAIMED', 'DISPATCHING') then
    raise exception 'email send attempt cannot be failed safely';
  end if;
  update public.email_send_attempts
  set status = 'FAILED_SAFE', error_code = p_error_code, completed_at = now()
  where id = p_send_attempt_id;
  update public.email_drafts
  set status = 'FAILED', failure_reason = p_failure_reason
  where id = v_attempt.draft_id and status = 'SENDING';
  return jsonb_build_object('attempt_id', p_send_attempt_id, 'status', 'FAILED_SAFE');
end;
$$;

create or replace function public.mark_email_send_attempt_unknown(
  p_send_attempt_id uuid,
  p_empresa_id uuid,
  p_user_id uuid,
  p_error_code text,
  p_failure_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_attempt public.email_send_attempts%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required for email attempt transition';
  end if;
  select a.* into v_attempt
  from public.email_send_attempts a
  join public.email_drafts d on d.id = a.draft_id
  where a.id = p_send_attempt_id and a.empresa_id = p_empresa_id
    and d.created_by = p_user_id
  for update;
  if not found or v_attempt.status not in ('CLAIMED', 'DISPATCHING') then
    raise exception 'email send attempt cannot be marked delivery-unknown';
  end if;
  update public.email_send_attempts
  set status = 'DELIVERY_UNKNOWN', error_code = p_error_code, completed_at = now()
  where id = p_send_attempt_id;
  update public.email_drafts
  set status = 'DELIVERY_UNKNOWN', failure_reason = p_failure_reason
  where id = v_attempt.draft_id and status = 'SENDING';
  return jsonb_build_object('attempt_id', p_send_attempt_id, 'status', 'DELIVERY_UNKNOWN');
end;
$$;

-- Recovery is intentionally a state transition only; it never calls Gmail.
create or replace function public.recover_stale_email_send_attempts(
  p_cutoff timestamptz
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_attempt record;
  v_count integer := 0;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required for email attempt recovery';
  end if;
  for v_attempt in
    select a.id, a.draft_id
    from public.email_send_attempts a
    where a.status = 'DISPATCHING'
      and a.started_at < p_cutoff
    for update skip locked
  loop
    update public.email_send_attempts
    set status = 'DELIVERY_UNKNOWN', error_code = 'STALE_DISPATCHING', completed_at = now()
    where id = v_attempt.id and status = 'DISPATCHING';
    update public.email_drafts
    set status = 'DELIVERY_UNKNOWN', failure_reason = 'El intento quedó incierto y no se reintentará automáticamente.'
    where id = v_attempt.draft_id and status = 'SENDING';
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- Restrict every bridge and transition to the server role. In particular, an
-- authenticated or anonymous caller can never read a Vault secret or advance
-- an attempt state.
revoke all on function public.email_read_oauth_secret(uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_read_oauth_secret(uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.email_delete_oauth_secret(uuid) from public, anon, authenticated;
revoke all on function public.email_delete_oauth_secret(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.guard_email_approval_binding() from public, anon, authenticated;
revoke all on function public.guard_email_draft_send_barrier() from public, anon, authenticated;
revoke all on function public.guard_email_attachment_send_barrier() from public, anon, authenticated;
revoke all on function public.claim_email_send(uuid, uuid, uuid, uuid, uuid, bigint, text, text, boolean) from public, anon, authenticated;
revoke all on function public.email_read_oauth_secret_for_send(uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.email_read_oauth_secret_for_revoke(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_email_send_attempt_dispatching(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.complete_email_send_attempt(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.fail_email_send_attempt(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.mark_email_send_attempt_unknown(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.recover_stale_email_send_attempts(timestamptz) from public, anon, authenticated;

grant execute on function public.claim_email_send(uuid, uuid, uuid, uuid, uuid, bigint, text, text, boolean) to service_role;
grant execute on function public.email_read_oauth_secret_for_send(uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.email_read_oauth_secret_for_revoke(uuid, uuid, uuid) to service_role;
grant execute on function public.mark_email_send_attempt_dispatching(uuid, uuid, uuid) to service_role;
grant execute on function public.complete_email_send_attempt(uuid, uuid, uuid, text) to service_role;
grant execute on function public.fail_email_send_attempt(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.mark_email_send_attempt_unknown(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.recover_stale_email_send_attempts(timestamptz) to service_role;
