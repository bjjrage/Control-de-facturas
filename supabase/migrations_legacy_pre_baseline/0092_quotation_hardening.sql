-- =============================================================================
-- 0092_quotation_hardening.sql — Correcciones de auditoría pre-commit (4 puntos)
--
-- 1. INMUTABILIDAD REAL DEL ACCEPTANCE RECORD:
--    RLS no frena a service_role, así que se agregan triggers BEFORE
--    UPDATE/DELETE que rechazan cualquier escritura o borrado en
--    sales_quotation_acceptances (disparan para TODOS los roles, incluido
--    service_role/postgres). Además se auditan los FK: empresa CASCADE →
--    RESTRICT (un borrado de tenant jamás debe llevarse la evidencia);
--    quotation/client RESTRICT (ya), token/work_order SET NULL nullable
--    (preservan la fila; el snapshot + prefijo conservan la referencia).
--    Verificación automática al final del archivo (DO block fail-fast).
--
-- 2. RPC PÚBLICO / ANON:
--    El portal /cotizacion trabaja 100% server-side con service_role
--    (page.tsx + actions.ts usan createAdminClient; el browser solo invoca
--    server actions, jamás supabase.rpc directo — verificado por grep).
--    Se revocan anon/authenticated en accept_quotation, reject_quotation,
--    log_quotation_view y resolve_work_order_policy: solo service_role.
--    El token sigue siendo la única capacidad pública, pero se consume en
--    el servidor, no vía PostgREST.
--
-- 3. DEFAULT DE WORKFLOW FAIL-SAFE:
--    SYSTEM DEFAULT y default por tenant pasan a RESPONSIBLE_APPROVAL →
--    PENDING_INTERNAL_APPROVAL. DIRECT_TO_PRODUCTION solo por override
--    explícito PROJECT → CLIENT → TENANT. Sin configuración no hay pase
--    directo a producción.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1a. FK empresa: CASCADE → RESTRICT en acceptances
-- ---------------------------------------------------------------------------
ALTER TABLE public.sales_quotation_acceptances
  DROP CONSTRAINT IF EXISTS sales_quotation_acceptances_empresa_id_fkey;
ALTER TABLE public.sales_quotation_acceptances
  ADD CONSTRAINT sales_quotation_acceptances_empresa_id_fkey
    FOREIGN KEY (empresa_id) REFERENCES public.empresas(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- 1b. Triggers de inmutabilidad (aplican a todos los roles, incl. service_role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_quotation_acceptance_write()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'sales_quotation_acceptances es append-only: % no permitido (id %)',
    TG_OP, COALESCE(OLD.id, NEW.id);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_acceptances_no_update ON public.sales_quotation_acceptances;
CREATE TRIGGER trg_acceptances_no_update
  BEFORE UPDATE ON public.sales_quotation_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.reject_quotation_acceptance_write();

DROP TRIGGER IF EXISTS trg_acceptances_no_delete ON public.sales_quotation_acceptances;
CREATE TRIGGER trg_acceptances_no_delete
  BEFORE DELETE ON public.sales_quotation_acceptances
  FOR EACH ROW EXECUTE FUNCTION public.reject_quotation_acceptance_write();

-- ---------------------------------------------------------------------------
-- 2. Grants mínimos: solo service_role (portal 100% server-side)
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.accept_quotation(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_quotation(text, text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.reject_quotation(text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reject_quotation(text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.log_quotation_view(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_quotation_view(text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_work_order_policy(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_work_order_policy(uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Default fail-safe: RESPONSIBLE_APPROVAL en todos los niveles
-- ---------------------------------------------------------------------------
UPDATE public.work_order_routing_policies
  SET mode = 'RESPONSIBLE_APPROVAL'
  WHERE scope = 'TENANT_DEFAULT' AND mode IS DISTINCT FROM 'RESPONSIBLE_APPROVAL';

ALTER TABLE public.work_orders
  ALTER COLUMN approval_mode SET DEFAULT 'RESPONSIBLE_APPROVAL';

-- SYSTEM DEFAULT del resolver → RESPONSIBLE_APPROVAL (cuerpo idéntico a
-- 0091 salvo el fallback; se re-grantea service_role-only).
CREATE OR REPLACE FUNCTION public.resolve_work_order_policy(
  p_empresa_id uuid, p_client_id uuid, p_project_id uuid DEFAULT NULL
) RETURNS TABLE (
  mode public.work_order_approval_mode,
  policy_id uuid,
  scope text,
  responsible_role public.user_role
) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  IF p_project_id IS NOT NULL THEN
    SELECT p.mode, p.id, p.scope, p.responsible_role INTO r
    FROM public.work_order_routing_policies p
    WHERE p.empresa_id = p_empresa_id AND p.scope = 'PROJECT' AND p.project_id = p_project_id;
    IF FOUND THEN mode := r.mode; policy_id := r.id; scope := r.scope; responsible_role := r.responsible_role; RETURN NEXT; RETURN; END IF;
  END IF;
  SELECT p.mode, p.id, p.scope, p.responsible_role INTO r
  FROM public.work_order_routing_policies p
  WHERE p.empresa_id = p_empresa_id AND p.scope = 'CLIENT' AND p.client_id = p_client_id;
  IF FOUND THEN mode := r.mode; policy_id := r.id; scope := r.scope; responsible_role := r.responsible_role; RETURN NEXT; RETURN; END IF;
  SELECT p.mode, p.id, p.scope, p.responsible_role INTO r
  FROM public.work_order_routing_policies p
  WHERE p.empresa_id = p_empresa_id AND p.scope = 'TENANT_DEFAULT';
  IF FOUND THEN mode := r.mode; policy_id := r.id; scope := r.scope; responsible_role := r.responsible_role; RETURN NEXT; RETURN; END IF;
  -- Fail-safe: sin configuración no hay pase directo a producción.
  mode := 'RESPONSIBLE_APPROVAL'; policy_id := NULL; scope := 'SYSTEM_DEFAULT'; responsible_role := 'administracion';
  RETURN NEXT;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_work_order_policy(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_work_order_policy(uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Autoverificación fail-fast de la auditoría
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_deltype char;
  v_grants int;
BEGIN
  -- 1. FKs del acceptance: quotation/client/empresa RESTRICT|NO ACTION,
  --    token/work_order SET NULL. Ningún CASCADE.
  FOR v_deltype IN
    SELECT c.confdeltype
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'sales_quotation_acceptances' AND c.contype = 'f'
  LOOP
    IF v_deltype NOT IN ('r', 'a', 'n') THEN
      RAISE EXCEPTION 'AUDIT: FK inesperado (%) en acceptances', v_deltype;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
             WHERE t.relname = 'sales_quotation_acceptances' AND c.contype = 'f' AND c.confdeltype = 'c') THEN
    RAISE EXCEPTION 'AUDIT: existe ON DELETE CASCADE hacia acceptances';
  END IF;
  -- Empresa (tenant) explícitamente RESTRICT: borrar tenant jamás borra evidencia.
  PERFORM 1 FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'sales_quotation_acceptances' AND c.contype = 'f'
    AND c.confdeltype IN ('r', 'a')
    AND (SELECT attname FROM pg_attribute WHERE attrelid = t.oid AND attnum = c.conkey[1]) = 'empresa_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'AUDIT: FK empresa de acceptances no es RESTRICT'; END IF;

  -- 1b. Triggers de inmutabilidad presentes.
  PERFORM 1 FROM pg_trigger WHERE tgname = 'trg_acceptances_no_update';
  IF NOT FOUND THEN RAISE EXCEPTION 'AUDIT: falta trg_acceptances_no_update'; END IF;
  PERFORM 1 FROM pg_trigger WHERE tgname = 'trg_acceptances_no_delete';
  IF NOT FOUND THEN RAISE EXCEPTION 'AUDIT: falta trg_acceptances_no_delete'; END IF;

  -- 2. RPCs sin grants a anon/authenticated.
  SELECT count(*) INTO v_grants FROM information_schema.role_routine_grants
  WHERE routine_schema = 'public'
    AND routine_name IN ('accept_quotation', 'reject_quotation', 'log_quotation_view', 'resolve_work_order_policy')
    AND grantee IN ('anon', 'authenticated', 'PUBLIC');
  IF v_grants > 0 THEN RAISE EXCEPTION 'AUDIT: quedan % grants públicos en RPCs', v_grants; END IF;

  -- 3. Default fail-safe efectivo.
  PERFORM 1 FROM pg_attrdef d JOIN pg_class t ON t.oid = d.adrelid JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.adnum
  WHERE t.relname = 'work_orders' AND a.attname = 'approval_mode'
    AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%RESPONSIBLE_APPROVAL%';
  IF NOT FOUND THEN RAISE EXCEPTION 'AUDIT: default de approval_mode no es RESPONSIBLE_APPROVAL'; END IF;
END $$;
