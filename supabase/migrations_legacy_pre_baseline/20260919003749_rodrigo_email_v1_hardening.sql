-- Rodrigo Email V1 hardening. Forward-only migration; do not edit the
-- historical V1 migration and do not apply this file implicitly to PROD.

alter table public.email_connections drop constraint if exists email_connections_status_check;
alter table public.email_connections
  add constraint email_connections_status_check
  check (status in ('CONNECTED', 'REVOKED', 'ERROR', 'REVOKE_PENDING', 'DISCONNECT_FAILED'));

alter table public.email_draft_attachments
  add column if not exists content_sha256 text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.email_draft_attachments'::regclass
      and conname = 'email_draft_attachments_content_sha256_check'
  ) then
    alter table public.email_draft_attachments
      add constraint email_draft_attachments_content_sha256_check
      check (content_sha256 is null or content_sha256 ~ '^[a-f0-9]{64}$');
  end if;
end;
$$;

-- The browser must never be able to call any Vault bridge. These explicit
-- grants are intentionally server-role-only and the identity is passed by
-- the trusted callback/worker rather than inferred from a browser JWT.
revoke all on function public.email_connect_gmail(text, text[], text) from public, anon, authenticated;
revoke all on function public.email_read_oauth_secret(uuid) from public, anon, authenticated;
revoke all on function public.email_delete_oauth_secret(uuid) from public, anon, authenticated;

create or replace function public.email_connect_gmail(
  p_empresa_id uuid,
  p_user_id uuid,
  p_provider_email text,
  p_scopes text[],
  p_refresh_token text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, vault, pg_temp
as $$
declare
  v_connection_id uuid;
  v_secret_id uuid;
begin
  if p_empresa_id is null or p_user_id is null or nullif(btrim(p_refresh_token), '') is null then
    raise exception 'OAuth connection payload is incomplete';
  end if;
  if nullif(btrim(p_provider_email), '') is null then
    raise exception 'OAuth provider email is required';
  end if;
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_user_id and p.empresa_id = p_empresa_id
  ) then
    raise exception 'OAuth user is not a member of the empresa';
  end if;
  if exists (
    select 1
    from public.email_connections c
    where c.empresa_id = p_empresa_id
      and c.user_id = p_user_id
      and c.provider = 'GMAIL'
      and c.status in ('CONNECTED', 'REVOKE_PENDING', 'DISCONNECT_FAILED')
  ) then
    raise exception 'An existing Gmail connection must be disconnected before reconnecting';
  end if;

  delete from vault.secrets
  where id in (
    select c.refresh_token_secret_id
    from public.email_connections c
    where c.empresa_id = p_empresa_id
      and c.user_id = p_user_id
      and c.provider = 'GMAIL'
      and c.status = 'ERROR'
      and c.refresh_token_secret_id is not null
  );
  update public.email_connections
  set status = 'REVOKED', disconnected_at = now(), refresh_token_secret_id = null
  where empresa_id = p_empresa_id
    and user_id = p_user_id
    and provider = 'GMAIL'
    and status = 'ERROR';

  v_secret_id := vault.create_secret(
    btrim(p_refresh_token),
    'gmail-refresh-token:' || p_user_id::text || ':' || gen_random_uuid()::text,
    'Rodrigo Gmail OAuth refresh token'
  );
  insert into public.email_connections (
    empresa_id, user_id, provider, provider_email, status, scopes, refresh_token_secret_id
  ) values (
    p_empresa_id, p_user_id, 'GMAIL', nullif(btrim(p_provider_email), ''), 'CONNECTED', coalesce(p_scopes, '{}'::text[]), v_secret_id
  )
  returning id into v_connection_id;
  return v_connection_id;
end;
$$;

create or replace function public.email_read_oauth_secret(
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
  from vault.decrypted_secrets ds
  join public.email_connections c on c.refresh_token_secret_id = ds.id
  where c.id = p_connection_id
    and c.empresa_id = p_empresa_id
    and c.user_id = p_user_id
    and c.provider = 'GMAIL'
    and c.status in ('CONNECTED', 'REVOKE_PENDING', 'DISCONNECT_FAILED')
  limit 1;
$$;

create or replace function public.email_delete_oauth_secret(
  p_secret_id uuid,
  p_empresa_id uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, vault, pg_temp
as $$
begin
  if not exists (
    select 1
    from public.email_connections c
    where c.refresh_token_secret_id = p_secret_id
      and c.empresa_id = p_empresa_id
      and c.user_id = p_user_id
      and c.provider = 'GMAIL'
      and c.status in ('REVOKE_PENDING', 'DISCONNECT_FAILED')
  ) then
    raise exception 'OAuth secret ownership or disconnect state invalid';
  end if;
  delete from vault.secrets where id = p_secret_id;
end;
$$;

revoke all on function public.email_connect_gmail(uuid, uuid, text, text[], text) from public, anon, authenticated;
revoke all on function public.email_read_oauth_secret(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.email_delete_oauth_secret(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.email_connect_gmail(uuid, uuid, text, text[], text) to service_role;
grant execute on function public.email_read_oauth_secret(uuid, uuid, uuid) to service_role;
grant execute on function public.email_delete_oauth_secret(uuid, uuid, uuid) to service_role;

revoke insert, update on public.email_connections from authenticated;
revoke insert on public.email_send_events from public, anon, authenticated;
grant insert on public.email_send_events to service_role;
drop policy if exists email_send_events_insert on public.email_send_events;
