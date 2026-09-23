-- Batch 5: keep email approval snapshots inside the existing draft-visibility
-- boundary, and make stale CLAIMED recovery mutually exclusive with dispatch.

-- Preserve tenant-wide visibility for non-email approvals. Email snapshots are
-- visible only to the draft owner or a same-tenant admin, matching the existing
-- email_drafts SELECT policy. service_role continues to bypass RLS as before.
drop policy if exists agent_approvals_select on public.agent_approvals;
create policy agent_approvals_select on public.agent_approvals
  for select
  to authenticated
  using (
    empresa_id = public.current_empresa_id()
    and (
      tool_name <> 'send_email'
      or exists (
        select 1
        from public.email_drafts d
        where d.id::text = (agent_approvals.payload_json ->> 'draft_id')
          and (agent_approvals.payload_json ->> 'draft_id')
            = (agent_approvals.payload_json -> 'draft_snapshot' ->> 'draftId')
          and d.empresa_id = agent_approvals.empresa_id
          and (
            d.created_by = (select auth.uid())
            or public.is_internal_role(array['admin']::public.user_role[])
          )
      )
    )
  );

-- Use the same lock order as recovery (attempt -> draft -> approval). Reset
-- started_at on the transition so DISPATCHING staleness is measured from the
-- dispatch barrier, while CLAIMED staleness remains measured from claim time.
create or replace function public.mark_email_send_attempt_dispatching(
  p_send_attempt_id uuid,
  p_empresa_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt public.email_send_attempts%rowtype;
  v_draft public.email_drafts%rowtype;
  v_approval_status text;
  v_changed_id uuid;
begin
  select a.* into v_attempt
  from public.email_send_attempts a
  where a.id = p_send_attempt_id
    and a.empresa_id = p_empresa_id
  for update;

  if not found or v_attempt.status <> 'CLAIMED' then
    raise exception 'email send attempt is not claimable for dispatch';
  end if;

  select d.* into v_draft
  from public.email_drafts d
  where d.id = v_attempt.draft_id
    and d.empresa_id = v_attempt.empresa_id
    and d.created_by = p_user_id
  for update;

  if not found or v_draft.status <> 'SENDING' then
    raise exception 'email draft is not in the claimed sending state';
  end if;
  if v_draft.revision is distinct from v_attempt.approved_revision
     or v_draft.content_hash is distinct from v_attempt.content_hash then
    raise exception 'email draft changed after the send claim';
  end if;

  select a.status into v_approval_status
  from public.agent_approvals a
  where a.id = v_attempt.approval_id
    and a.empresa_id = v_attempt.empresa_id
    and a.tool_name = 'send_email'
    and a.status in ('APPROVED', 'EXECUTING')
  for update;

  if not found then
    raise exception 'email approval is no longer executable';
  end if;

  update public.email_send_attempts
  set status = 'DISPATCHING', started_at = pg_catalog.clock_timestamp()
  where id = p_send_attempt_id
    and empresa_id = p_empresa_id
    and status = 'CLAIMED'
  returning id into v_changed_id;

  if v_changed_id is null then
    raise exception 'email send attempt lost the dispatch transition';
  end if;

  return pg_catalog.jsonb_build_object(
    'attempt_id', p_send_attempt_id,
    'status', 'DISPATCHING'
  );
end;
$$;

-- Extend the existing recovery RPC so existing callers recover both states.
-- CLAIMED is safe to fail only while its state, draft, and approval all match;
-- each row is locked and every update is repeated with an expected-state CAS.
-- A stale claim is terminal for its old approval and needs a new approval.
create or replace function public.recover_stale_email_send_attempts(
  p_cutoff timestamptz
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_attempt record;
  v_draft_status text;
  v_approval_status text;
  v_changed_id uuid;
  v_count integer := 0;
begin
  if p_cutoff is null or p_cutoff >= pg_catalog.clock_timestamp() then
    raise exception 'email recovery cutoff must be a timestamp in the past';
  end if;

  -- A dispatch and this recovery compete for the same attempt row. If dispatch
  -- wins, status becomes DISPATCHING and this query cannot recover it as safe.
  -- If recovery wins, the later dispatch RPC sees FAILED_SAFE and rejects it.
  for v_attempt in
    select a.id, a.draft_id, a.empresa_id, a.approval_id
    from public.email_send_attempts a
    where a.status = 'CLAIMED'
      and a.started_at < p_cutoff
    order by a.started_at, a.id
    for update skip locked
  loop
    select d.status into v_draft_status
    from public.email_drafts d
    where d.id = v_attempt.draft_id
      and d.empresa_id = v_attempt.empresa_id
    for update skip locked;

    if not found or v_draft_status <> 'SENDING' then
      continue;
    end if;

    select a.status into v_approval_status
    from public.agent_approvals a
    where a.id = v_attempt.approval_id
      and a.empresa_id = v_attempt.empresa_id
      and a.tool_name = 'send_email'
      and a.status in ('APPROVED', 'EXECUTING')
    for update skip locked;

    if not found then
      continue;
    end if;

    v_changed_id := null;
    update public.email_send_attempts
    set status = 'FAILED_SAFE',
        error_code = 'STALE_CLAIMED',
        completed_at = pg_catalog.clock_timestamp()
    where id = v_attempt.id
      and empresa_id = v_attempt.empresa_id
      and status = 'CLAIMED'
      and started_at < p_cutoff
    returning id into v_changed_id;

    if v_changed_id is null then
      continue;
    end if;

    update public.email_drafts
    set status = 'FAILED',
        delivery_retry_authorized = false,
        failure_reason = 'El intento no inició el despacho; requiere una nueva aprobación.'
    where id = v_attempt.draft_id
      and empresa_id = v_attempt.empresa_id
      and status = 'SENDING';

    if not found then
      raise exception 'email draft changed during CLAIMED recovery';
    end if;

    update public.agent_approvals
    set status = 'FAILED'
    where id = v_attempt.approval_id
      and empresa_id = v_attempt.empresa_id
      and tool_name = 'send_email'
      and status in ('APPROVED', 'EXECUTING');

    if not found then
      raise exception 'email approval changed during CLAIMED recovery';
    end if;

    v_count := v_count + 1;
  end loop;

  -- Preserve the existing conservative recovery for attempts that crossed the
  -- dispatch barrier: their delivery outcome remains unknown, never FAILED_SAFE.
  for v_attempt in
    select a.id, a.draft_id, a.empresa_id, a.approval_id
    from public.email_send_attempts a
    where a.status = 'DISPATCHING'
      and a.started_at < p_cutoff
    order by a.started_at, a.id
    for update skip locked
  loop
    v_changed_id := null;
    update public.email_send_attempts
    set status = 'DELIVERY_UNKNOWN',
        error_code = 'STALE_DISPATCHING',
        completed_at = pg_catalog.clock_timestamp()
    where id = v_attempt.id
      and status = 'DISPATCHING'
      and started_at < p_cutoff
    returning id into v_changed_id;

    if v_changed_id is null then
      continue;
    end if;

    update public.email_drafts
    set status = 'DELIVERY_UNKNOWN',
        failure_reason = 'El intento quedó incierto y no se reintentará automáticamente.'
    where id = v_attempt.draft_id
      and status = 'SENDING';

    -- The old approval must not remain EXECUTING after its attempt is terminal.
    update public.agent_approvals
    set status = 'FAILED'
    where id = v_attempt.approval_id
      and empresa_id = v_attempt.empresa_id
      and tool_name = 'send_email'
      and status in ('APPROVED', 'EXECUTING');

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.mark_email_send_attempt_dispatching(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.recover_stale_email_send_attempts(timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_email_send_attempt_dispatching(uuid, uuid, uuid)
  to service_role;
grant execute on function public.recover_stale_email_send_attempts(timestamptz)
  to service_role;
