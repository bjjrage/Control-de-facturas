-- SEC03: approval decisions and lifecycle transitions are server-owned.
-- Authenticated users retain tenant-scoped reads, but cannot forge or mutate
-- approval state through the Data API.

CREATE OR REPLACE FUNCTION public.create_agent_approval(
  p_task_id uuid,
  p_run_id uuid,
  p_empresa_id uuid,
  p_tool_name text,
  p_payload_json jsonb,
  p_payload_hash text,
  p_risk_level integer,
  p_requested_by uuid,
  p_expires_at timestamptz,
  p_approved_revision bigint,
  p_approved_content_hash text,
  p_actor_id uuid
) RETURNS public.agent_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_task_user_id uuid;
  v_approval public.agent_approvals%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required for approval creation';
  END IF;
  IF p_task_id IS NULL OR p_empresa_id IS NULL OR p_actor_id IS NULL
     OR p_requested_by IS DISTINCT FROM p_actor_id
     OR p_tool_name IS NULL OR p_tool_name !~ '^[a-z][a-z0-9_]*$'
     OR p_payload_json IS NULL
     OR p_payload_hash IS NULL OR p_payload_hash !~ '^[a-f0-9]{64}$'
     OR p_risk_level IS NULL OR p_risk_level NOT BETWEEN 0 AND 4 THEN
    RAISE EXCEPTION 'approval creation identity or snapshot is invalid';
  END IF;

  SELECT p.role::text INTO v_role
  FROM public.profiles p
  JOIN public.empresas e ON e.id = p.empresa_id AND e.active
  WHERE p.id = p_actor_id AND p.empresa_id = p_empresa_id AND p.active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval requester is not an active member of the company';
  END IF;

  SELECT t.user_id INTO v_task_user_id
  FROM public.agent_tasks t
  WHERE t.id = p_task_id AND t.empresa_id = p_empresa_id;
  IF NOT FOUND OR (v_task_user_id IS NOT NULL AND v_task_user_id IS DISTINCT FROM p_actor_id) THEN
    RAISE EXCEPTION 'approval task does not belong to the requesting actor and company';
  END IF;
  IF p_run_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.agent_runs r
    WHERE r.id = p_run_id AND r.task_id = p_task_id AND r.empresa_id = p_empresa_id
  ) THEN
    RAISE EXCEPTION 'approval run does not belong to the task and company';
  END IF;

  IF p_tool_name = 'send_email' THEN
    IF p_approved_revision IS NULL OR p_approved_revision <= 0
       OR p_approved_content_hash IS NULL
       OR p_approved_content_hash !~ '^[a-f0-9]{64}$'
       OR p_payload_json ->> 'draft_hash' IS DISTINCT FROM p_approved_content_hash
       OR (p_payload_json ->> 'draft_revision')::bigint IS DISTINCT FROM p_approved_revision
       OR coalesce(p_payload_json ->> 'draft_id', '') = '' THEN
      RAISE EXCEPTION 'email approval snapshot binding is invalid';
    END IF;
  ELSIF p_approved_revision IS NOT NULL OR p_approved_content_hash IS NOT NULL THEN
    RAISE EXCEPTION 'non-email approval cannot carry an email snapshot binding';
  END IF;

  INSERT INTO public.agent_approvals (
    task_id, run_id, empresa_id, tool_name, payload_json, payload_hash,
    risk_level, status, requested_by, expires_at,
    approved_revision, approved_content_hash
  ) VALUES (
    p_task_id, p_run_id, p_empresa_id, p_tool_name, p_payload_json, p_payload_hash,
    p_risk_level, 'REQUESTED', p_actor_id, p_expires_at,
    p_approved_revision, p_approved_content_hash
  ) RETURNING * INTO v_approval;

  RETURN v_approval;
END;
$$;

CREATE OR REPLACE FUNCTION public.decide_agent_approval(
  p_approval_id uuid,
  p_empresa_id uuid,
  p_decision text,
  p_actor_id uuid,
  p_allowed_roles text[]
) RETURNS public.agent_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_approval public.agent_approvals%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required for approval decision';
  END IF;
  IF p_decision IS NULL OR p_decision NOT IN ('APPROVED', 'REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'invalid human approval decision';
  END IF;
  IF p_allowed_roles IS NULL OR cardinality(p_allowed_roles) = 0 THEN
    RAISE EXCEPTION 'approval policy is required';
  END IF;

  SELECT * INTO v_approval
  FROM public.agent_approvals a
  WHERE a.id = p_approval_id AND a.empresa_id = p_empresa_id
  FOR UPDATE;
  IF NOT FOUND OR v_approval.status <> 'REQUESTED' THEN
    RAISE EXCEPTION 'approval is missing or no longer pending';
  END IF;
  IF v_approval.expires_at IS NOT NULL AND v_approval.expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'approval has expired';
  END IF;

  SELECT p.role::text INTO v_role
  FROM public.profiles p
  JOIN public.empresas e ON e.id = p.empresa_id AND e.active
  WHERE p.id = p_actor_id AND p.empresa_id = p_empresa_id AND p.active;
  IF NOT FOUND OR NOT (v_role = ANY (p_allowed_roles)) THEN
    RAISE EXCEPTION 'approver is not active or is not authorized for this tool';
  END IF;
  IF v_approval.tool_name = 'send_email' AND v_role NOT IN ('comercial', 'admin') THEN
    RAISE EXCEPTION 'current role cannot approve email sends';
  END IF;

  UPDATE public.agent_approvals
  SET status = p_decision, decided_by = p_actor_id, decided_at = pg_catalog.now()
  WHERE id = p_approval_id AND empresa_id = p_empresa_id AND status = 'REQUESTED'
  RETURNING * INTO v_approval;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval was decided concurrently';
  END IF;
  RETURN v_approval;
END;
$$;

CREATE OR REPLACE FUNCTION public.expire_agent_approval(
  p_approval_id uuid,
  p_empresa_id uuid
) RETURNS public.agent_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_approval public.agent_approvals%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required for approval expiration';
  END IF;
  UPDATE public.agent_approvals
  SET status = 'EXPIRED', decided_by = NULL, decided_at = pg_catalog.now()
  WHERE id = p_approval_id AND empresa_id = p_empresa_id AND status = 'REQUESTED'
  RETURNING * INTO v_approval;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval is missing or no longer pending';
  END IF;
  RETURN v_approval;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_agent_approval(
  p_approval_id uuid,
  p_empresa_id uuid,
  p_transition text
) RETURNS public.agent_approvals
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_from text;
  v_to text;
  v_approval public.agent_approvals%rowtype;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required for approval transition';
  END IF;
  IF p_transition = 'claim' THEN
    v_from := 'APPROVED';
    v_to := 'EXECUTING';
  ELSIF p_transition = 'executed' THEN
    v_from := 'EXECUTING';
    v_to := 'EXECUTED';
  ELSIF p_transition = 'failed' THEN
    v_from := 'EXECUTING';
    v_to := 'FAILED';
  ELSE
    RAISE EXCEPTION 'invalid approval transition';
  END IF;

  UPDATE public.agent_approvals
  SET status = v_to
  WHERE id = p_approval_id AND empresa_id = p_empresa_id AND status = v_from
  RETURNING * INTO v_approval;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'approval transition lost its compare-and-set';
  END IF;
  RETURN v_approval;
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_email_approval_for_draft(
  p_draft_id uuid,
  p_empresa_id uuid,
  p_actor_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_role text;
  v_count integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required to cancel email approval';
  END IF;
  SELECT p.role::text INTO v_role
  FROM public.profiles p
  JOIN public.empresas e ON e.id = p.empresa_id AND e.active
  WHERE p.id = p_actor_id AND p.empresa_id = p_empresa_id AND p.active;
  IF NOT FOUND OR v_role NOT IN ('comercial', 'admin') THEN
    RAISE EXCEPTION 'current actor cannot cancel email approvals';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.email_drafts d
    WHERE d.id = p_draft_id AND d.empresa_id = p_empresa_id AND d.created_by = p_actor_id
  ) THEN
    RAISE EXCEPTION 'email draft does not belong to the active actor';
  END IF;

  UPDATE public.agent_approvals
  SET status = 'CANCELLED', decided_by = p_actor_id, decided_at = pg_catalog.now()
  WHERE empresa_id = p_empresa_id
    AND tool_name = 'send_email'
    AND status = 'REQUESTED'
    AND payload_json ->> 'draft_id' = p_draft_id::text;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Keep the email send claim as the linearization point, and re-check the live
-- company membership/role immediately before transitioning the draft to SENDING.
CREATE OR REPLACE FUNCTION public.claim_email_send(
  p_empresa_id uuid,
  p_user_id uuid,
  p_draft_id uuid,
  p_connection_id uuid,
  p_approval_id uuid,
  p_approved_revision bigint,
  p_approved_content_hash text,
  p_delivery_fingerprint text,
  p_allow_delivery_unknown_retry boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_connection public.email_connections%rowtype;
  v_draft public.email_drafts%rowtype;
  v_approval public.agent_approvals%rowtype;
  v_attempt_id uuid := pg_catalog.gen_random_uuid();
  v_client_message_id text := '<' || v_attempt_id::text || '@dominio-control-facturas>';
  v_unknown_created_at timestamptz;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'service role required for email send claim';
  END IF;
  IF p_empresa_id IS NULL OR p_user_id IS NULL OR p_draft_id IS NULL
     OR p_connection_id IS NULL OR p_approval_id IS NULL THEN
    RAISE EXCEPTION 'email send claim identity is incomplete';
  END IF;
  IF p_approved_revision IS NULL OR p_approved_content_hash IS NULL
     OR p_delivery_fingerprint IS NULL THEN
    RAISE EXCEPTION 'email send claim binding is incomplete';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.empresas e ON e.id = p.empresa_id AND e.active
    WHERE p.id = p_user_id AND p.empresa_id = p_empresa_id AND p.active
      AND p.role IN ('comercial', 'admin')
  ) THEN
    RAISE EXCEPTION 'email sender is not an active comercial/admin of the company';
  END IF;

  SELECT * INTO v_connection
  FROM public.email_connections c
  WHERE c.id = p_connection_id
    AND c.empresa_id = p_empresa_id
    AND c.user_id = p_user_id
    AND c.provider = 'GMAIL'
  FOR UPDATE;
  IF NOT FOUND OR v_connection.status <> 'CONNECTED' THEN
    RAISE EXCEPTION 'email connection is not CONNECTED at send linearization point';
  END IF;

  SELECT * INTO v_draft
  FROM public.email_drafts d
  WHERE d.id = p_draft_id
    AND d.empresa_id = p_empresa_id
    AND d.created_by = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'email draft does not belong to the requested actor';
  END IF;
  IF v_draft.status <> 'WAITING_APPROVAL' THEN
    RAISE EXCEPTION 'email draft is not waiting for approval';
  END IF;
  IF v_draft.provider_connection_id IS DISTINCT FROM p_connection_id THEN
    RAISE EXCEPTION 'email draft connection changed after approval';
  END IF;
  IF v_draft.revision IS DISTINCT FROM p_approved_revision
     OR v_draft.content_hash IS DISTINCT FROM p_approved_content_hash THEN
    RAISE EXCEPTION 'email draft revision or content hash changed after approval';
  END IF;

  SELECT * INTO v_approval
  FROM public.agent_approvals a
  WHERE a.id = p_approval_id
    AND a.empresa_id = p_empresa_id
    AND a.tool_name = 'send_email'
  FOR UPDATE;
  IF NOT FOUND OR v_approval.status NOT IN ('APPROVED', 'EXECUTING') THEN
    RAISE EXCEPTION 'email approval is not valid or has already been consumed';
  END IF;
  IF v_approval.decided_by IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.empresas e ON e.id = p.empresa_id AND e.active
    WHERE p.id = v_approval.decided_by AND p.empresa_id = p_empresa_id AND p.active
      AND p.role IN ('comercial', 'admin')
  ) THEN
    RAISE EXCEPTION 'email approver is no longer active or authorized';
  END IF;
  IF v_approval.approved_revision IS DISTINCT FROM p_approved_revision
     OR v_approval.approved_content_hash IS DISTINCT FROM p_approved_content_hash
     OR v_approval.payload_json ->> 'draft_id' IS DISTINCT FROM p_draft_id::text
     OR v_approval.payload_json ->> 'draft_hash' IS DISTINCT FROM p_approved_content_hash
     OR (v_approval.payload_json ->> 'draft_revision')::bigint IS DISTINCT FROM p_approved_revision THEN
    RAISE EXCEPTION 'email approval snapshot does not match the send claim';
  END IF;

  SELECT max(a.created_at) INTO v_unknown_created_at
  FROM public.email_send_attempts a
  WHERE a.empresa_id = p_empresa_id
    AND a.delivery_fingerprint = p_delivery_fingerprint
    AND a.status = 'DELIVERY_UNKNOWN';
  IF v_unknown_created_at IS NOT NULL
     AND (NOT p_allow_delivery_unknown_retry OR v_approval.created_at <= v_unknown_created_at) THEN
    RAISE EXCEPTION 'delivery outcome is unknown; explicit resend with a new approval is required';
  END IF;

  INSERT INTO public.email_send_attempts (
    id, empresa_id, draft_id, connection_id, approval_id,
    approved_revision, content_hash, delivery_fingerprint,
    client_message_id, status
  ) VALUES (
    v_attempt_id, p_empresa_id, p_draft_id, p_connection_id, p_approval_id,
    p_approved_revision, p_approved_content_hash, p_delivery_fingerprint,
    v_client_message_id, 'CLAIMED'
  );

  UPDATE public.email_drafts
  SET status = 'SENDING', failure_reason = NULL
  WHERE id = p_draft_id AND empresa_id = p_empresa_id AND created_by = p_user_id;

  RETURN pg_catalog.jsonb_build_object(
    'attempt_id', v_attempt_id,
    'client_message_id', v_client_message_id,
    'status', 'CLAIMED',
    'approved_revision', p_approved_revision,
    'content_hash', p_approved_content_hash
  );
END;
$$;

-- New deployments cannot prove the provenance of approval rows written while
-- the old direct INSERT/UPDATE grants were active. Force those drafts through
-- the authenticated request-and-approval path again. Completed sends and their
-- audit history remain unchanged.
WITH invalidated AS (
  UPDATE public.agent_approvals a
  SET status = 'CANCELLED', decided_by = NULL, decided_at = pg_catalog.now()
  WHERE a.tool_name = 'send_email'
    AND a.status IN ('REQUESTED', 'APPROVED', 'EXECUTING')
    AND NOT EXISTS (
      SELECT 1 FROM public.email_send_attempts sa WHERE sa.approval_id = a.id
    )
  RETURNING a.empresa_id, a.payload_json ->> 'draft_id' AS draft_id
)
UPDATE public.email_drafts d
SET status = 'READY', failure_reason = 'La aprobación anterior se invalidó; debe solicitarse una aprobación nueva.'
FROM invalidated i
WHERE d.id::text = i.draft_id
  AND d.empresa_id = i.empresa_id
  AND d.status = 'WAITING_APPROVAL';

-- A role can be revoked after claim_email_send returns but before the provider
-- retrieves the OAuth secret. Revalidate the sender and approver at that boundary.
CREATE OR REPLACE FUNCTION public.email_read_oauth_secret_for_send(
  p_send_attempt_id uuid,
  p_connection_id uuid,
  p_empresa_id uuid,
  p_user_id uuid
) RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ds.decrypted_secret
  FROM public.email_send_attempts a
  JOIN public.email_connections c ON c.id = a.connection_id
  JOIN vault.decrypted_secrets ds ON ds.id = c.refresh_token_secret_id
  JOIN public.email_drafts d ON d.id = a.draft_id
  JOIN public.agent_approvals ap ON ap.id = a.approval_id
  WHERE a.id = p_send_attempt_id
    AND a.connection_id = p_connection_id
    AND a.empresa_id = p_empresa_id
    AND c.empresa_id = p_empresa_id
    AND c.user_id = p_user_id
    AND c.provider = 'GMAIL'
    AND a.status IN ('CLAIMED', 'DISPATCHING')
    AND d.status = 'SENDING'
    AND a.approved_revision = d.revision
    AND a.content_hash = d.content_hash
    AND ap.empresa_id = p_empresa_id
    AND ap.tool_name = 'send_email'
    AND ap.status IN ('APPROVED', 'EXECUTING')
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.empresas e ON e.id = p.empresa_id AND e.active
      WHERE p.id = p_user_id AND p.empresa_id = p_empresa_id
        AND p.active AND p.role IN ('comercial', 'admin')
    )
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      JOIN public.empresas e ON e.id = p.empresa_id AND e.active
      WHERE p.id = ap.decided_by AND p.empresa_id = p_empresa_id
        AND p.active AND p.role IN ('comercial', 'admin')
    )
  LIMIT 1;
$$;

-- RLS still governs tenant-scoped reads. Privileges now prevent authenticated
-- Data API writes regardless of what those policies permit.
REVOKE ALL ON TABLE public.agent_approvals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.agent_approvals TO authenticated;
GRANT ALL ON TABLE public.agent_approvals TO service_role;
DROP POLICY IF EXISTS agent_approvals_delete ON public.agent_approvals;
DROP POLICY IF EXISTS agent_approvals_insert ON public.agent_approvals;
DROP POLICY IF EXISTS agent_approvals_update ON public.agent_approvals;

REVOKE ALL ON FUNCTION public.create_agent_approval(uuid, uuid, uuid, text, jsonb, text, integer, uuid, timestamptz, bigint, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_agent_approval(uuid, uuid, uuid, text, jsonb, text, integer, uuid, timestamptz, bigint, text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.decide_agent_approval(uuid, uuid, text, uuid, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decide_agent_approval(uuid, uuid, text, uuid, text[]) TO service_role;
REVOKE ALL ON FUNCTION public.expire_agent_approval(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_agent_approval(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.transition_agent_approval(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.transition_agent_approval(uuid, uuid, text) TO service_role;
REVOKE ALL ON FUNCTION public.cancel_email_approval_for_draft(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_email_approval_for_draft(uuid, uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.claim_email_send(uuid, uuid, uuid, uuid, uuid, bigint, text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_send(uuid, uuid, uuid, uuid, uuid, bigint, text, text, boolean) TO service_role;
REVOKE ALL ON FUNCTION public.email_read_oauth_secret_for_send(uuid, uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_read_oauth_secret_for_send(uuid, uuid, uuid, uuid) TO service_role;

DROP FUNCTION IF EXISTS public.cancel_email_approval_for_draft(uuid, uuid);
