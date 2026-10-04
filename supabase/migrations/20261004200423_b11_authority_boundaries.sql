-- B11: defensive authority boundaries. No historical facts or fiscal/provider logic changed.
-- Reviewed deployed definitions are preserved below with caller/tenant guards only.
BEGIN;
CREATE OR REPLACE FUNCTION public.current_empresa_id() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p.empresa_id FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
 WHERE p.id=auth.uid() AND p.active AND (e.active OR p.is_super_admin);
$$;
CREATE OR REPLACE FUNCTION public.current_profile_role() RETURNS public.user_role
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p.role FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id
 WHERE p.id=auth.uid() AND p.active AND (e.active OR p.is_super_admin);
$$;
CREATE OR REPLACE FUNCTION public.is_super_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT coalesce((SELECT p.is_super_admin FROM public.profiles p WHERE p.id=auth.uid() AND p.active),false);
$$;

CREATE OR REPLACE FUNCTION private.b11_guard_profile_authority() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 -- Invoker trigger: trusted service provisioning and database maintenance remain possible.
 IF current_user IN ('postgres','supabase_admin','service_role') OR public.is_super_admin() THEN
   IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.is_super_admin THEN RAISE EXCEPTION 'Superadmin authority required' USING ERRCODE='42501'; END IF;
 ELSE
   IF OLD.is_super_admin OR (TG_OP='UPDATE' AND
      (NEW.is_super_admin IS DISTINCT FROM OLD.is_super_admin OR NEW.empresa_id IS DISTINCT FROM OLD.empresa_id OR NEW.id IS DISTINCT FROM OLD.id)) THEN
     RAISE EXCEPTION 'Protected profile authority' USING ERRCODE='42501';
   END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.b11_guard_profile_authority() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER b11_profile_authority BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION private.b11_guard_profile_authority();

CREATE OR REPLACE FUNCTION private.b11_require_financial_actor(p_empresa uuid) RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
 IF auth.role()='service_role' OR (auth.role() IS NULL AND current_setting('role',true) IN ('none','postgres') AND session_user IN ('postgres','supabase_admin')) THEN RETURN; END IF;
 IF auth.uid() IS NULL OR p_empresa IS NULL OR p_empresa IS DISTINCT FROM public.current_empresa_id()
    OR NOT public.is_internal_role(ARRAY['admin','administracion']::public.user_role[]) THEN
   RAISE EXCEPTION 'Financial actor/tenant denied' USING ERRCODE='42501';
 END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.b11_require_financial_actor(uuid) FROM PUBLIC, anon, authenticated;

-- Global worker leases are service-only. Public payment settlement uses the existing atomic OP RPC.
REVOKE ALL ON FUNCTION public.claim_invoice_job(), public.requeue_stale_invoice_jobs(integer,integer),
 public.mark_invoice_pagado(uuid), public.next_cot_code() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_invoice_job(), public.requeue_stale_invoice_jobs(integer,integer),
 public.mark_invoice_pagado(uuid), public.next_cot_code() TO service_role;

CREATE OR REPLACE FUNCTION public.mark_invoice_apto_para_pago(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.invoice_status;
  v_order_id uuid;
begin

  perform private.b11_require_financial_actor((select empresa_id from public.invoices where id=p_invoice_id));
  select status into v_status from public.invoices where id = p_invoice_id for update;
  if v_status not in ('MATCH', 'APROBADO_EXCEPCION') then
    raise exception 'La factura debe estar conciliada (MATCH) o aprobada por excepción antes de marcar apto para pago';
  end if;

  update public.invoices set status = 'APTO_PARA_PAGO' where id = p_invoice_id;

  select authorized_order_id into v_order_id
  from public.invoice_order_matches where invoice_id = p_invoice_id;

  perform public.sync_order_payment_status(v_order_id);
end;
$function$
;
REVOKE ALL ON FUNCTION public.mark_invoice_apto_para_pago(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_invoice_apto_para_pago(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recompute_invoice_status(p_invoice_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tolerance_pct constant numeric := 5;  -- espejo de OVERBILL_TOLERANCE_PCT
  v_current_status public.invoice_status;
  v_order_id uuid;
  v_order_total numeric(14,2);
  v_facturado numeric(14,2);
  v_has_exception boolean;
begin

  perform private.b11_require_financial_actor((select empresa_id from public.invoices where id=p_invoice_id));
  select status into v_current_status from public.invoices where id = p_invoice_id;

  -- Una vez que una acción humana marcó la factura apta para pago (o ya se
  -- pagó), el recálculo automático de conciliación no debe revertirla.
  if v_current_status in ('APTO_PARA_PAGO', 'PAGADO') then
    return;
  end if;

  select iom.authorized_order_id into v_order_id
  from public.invoice_order_matches iom
  where iom.invoice_id = p_invoice_id;

  if v_order_id is null then
    update public.invoices set status = 'PENDIENTE' where id = p_invoice_id;
    return;
  end if;

  select ao.total_price into v_order_total
  from public.authorized_orders ao where ao.id = v_order_id;

  select coalesce(sum(i.total), 0) into v_facturado
  from public.invoice_order_matches iom
  join public.invoices i on i.id = iom.invoice_id
  where iom.authorized_order_id = v_order_id;

  update public.authorized_orders
    set facturado_amount = v_facturado,
        status = case
          when status in ('APTO_PARA_PAGO', 'PAGADO') then status
          when v_facturado >= v_order_total then 'FACTURADO'
          else 'AUTORIZADO'
        end
    where id = v_order_id;

  select exists(select 1 from public.invoice_exceptions where invoice_id = p_invoice_id)
    into v_has_exception;

  if v_facturado <= v_order_total * (1 + v_tolerance_pct / 100.0) then
    update public.invoices set status = 'MATCH' where id = p_invoice_id;
  elsif v_has_exception then
    update public.invoices set status = 'APROBADO_EXCEPCION' where id = p_invoice_id;
  else
    update public.invoices set status = 'REQUIERE_REVISION' where id = p_invoice_id;
  end if;
end;
$function$
;
REVOKE ALL ON FUNCTION public.recompute_invoice_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_invoice_status(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recompute_order_facturado(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_total numeric(14,2);
  v_facturado numeric(14,2);
begin
  if p_order_id is null then return; end if;

  perform private.b11_require_financial_actor((select empresa_id from public.authorized_orders where id=p_order_id));
  if p_order_id is null then return; end if;

  select total_price into v_order_total from public.authorized_orders where id = p_order_id;

  select coalesce(sum(i.total), 0) into v_facturado
  from public.invoice_order_matches iom
  join public.invoices i on i.id = iom.invoice_id
  where iom.authorized_order_id = p_order_id;

  update public.authorized_orders set
    facturado_amount = v_facturado,
    status = case
      when status in ('APTO_PARA_PAGO', 'PAGADO') and v_facturado > 0 then status
      when v_facturado >= v_order_total and v_facturado > 0 then 'FACTURADO'::public.order_status
      else 'AUTORIZADO'::public.order_status
    end
  where id = p_order_id;
end;
$function$
;
REVOKE ALL ON FUNCTION public.recompute_order_facturado(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recompute_order_facturado(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.sync_order_payment_status(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order_total numeric(14,2);
  v_facturado numeric(14,2);
  v_n int;
  v_n_apto int;
  v_n_pagado int;
begin
  if p_order_id is null then return; end if;

  perform private.b11_require_financial_actor((select empresa_id from public.authorized_orders where id=p_order_id));
  if p_order_id is null then return; end if;

  select total_price, facturado_amount into v_order_total, v_facturado
  from public.authorized_orders where id = p_order_id;

  select
    count(*),
    count(*) filter (where i.status in ('APTO_PARA_PAGO', 'PAGADO')),
    count(*) filter (where i.status = 'PAGADO')
  into v_n, v_n_apto, v_n_pagado
  from public.invoice_order_matches iom
  join public.invoices i on i.id = iom.invoice_id
  where iom.authorized_order_id = p_order_id;

  update public.authorized_orders set status =
    case
      when v_n > 0 and v_n_pagado = v_n and v_facturado >= v_order_total then 'PAGADO'::public.order_status
      when v_n > 0 and v_n_apto = v_n and v_facturado >= v_order_total then 'APTO_PARA_PAGO'::public.order_status
      when v_facturado >= v_order_total then 'FACTURADO'::public.order_status
      else 'AUTORIZADO'::public.order_status
    end
  where id = p_order_id;
end;
$function$
;
REVOKE ALL ON FUNCTION public.sync_order_payment_status(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sync_order_payment_status(uuid) TO authenticated, service_role;

-- Audit writes carry the authenticated tenant and actor, not caller-supplied attribution.
ALTER POLICY audit_logs_insert ON public.audit_logs WITH CHECK
 (empresa_id=public.current_empresa_id() AND actor_id=auth.uid() AND actor_type='internal');
CREATE OR REPLACE FUNCTION public.log_audit_event(p_action text,p_rfq_id uuid DEFAULT NULL,p_rfq_provider_id uuid DEFAULT NULL,p_invoice_id uuid DEFAULT NULL,p_authorized_order_id uuid DEFAULT NULL,p_detail jsonb DEFAULT NULL,p_actor_type text DEFAULT 'internal',p_actor_label text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid; v_empresa uuid:=public.current_empresa_id();
BEGIN
 IF auth.role() IS DISTINCT FROM 'service_role' THEN
   IF auth.uid() IS NULL OR v_empresa IS NULL OR NOT public.is_internal_role(ARRAY['comercial','administracion','admin']::public.user_role[]) OR p_actor_type IS DISTINCT FROM 'internal' THEN
     RAISE EXCEPTION 'Audit actor denied' USING ERRCODE='42501';
   END IF;
   IF (p_rfq_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rfqs WHERE id=p_rfq_id AND empresa_id=v_empresa))
    OR (p_rfq_provider_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.rfq_providers WHERE id=p_rfq_provider_id AND empresa_id=v_empresa))
    OR (p_invoice_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.invoices WHERE id=p_invoice_id AND empresa_id=v_empresa))
    OR (p_authorized_order_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.authorized_orders WHERE id=p_authorized_order_id AND empresa_id=v_empresa)) THEN
     RAISE EXCEPTION 'Audit source tenant denied' USING ERRCODE='42501';
   END IF;
 END IF;
 INSERT INTO public.audit_logs(empresa_id,actor_id,actor_type,actor_label,action,rfq_id,rfq_provider_id,invoice_id,authorized_order_id,detail)
 VALUES(v_empresa,auth.uid(),p_actor_type,p_actor_label,p_action,p_rfq_id,p_rfq_provider_id,p_invoice_id,p_authorized_order_id,p_detail) RETURNING id INTO v_id;
 RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.log_audit_event(text,uuid,uuid,uuid,uuid,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.log_audit_event(text,uuid,uuid,uuid,uuid,jsonb,text,text) TO authenticated,service_role;
-- Financial statuses are written by the existing definer RPCs, not raw client DML.
CREATE OR REPLACE FUNCTION private.b11_guard_financial_status() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF TG_TABLE_NAME='payment_orders' AND TG_OP='DELETE' THEN
   IF OLD.status::text='EJECUTADA' THEN RAISE EXCEPTION 'Executed OP is immutable' USING ERRCODE='55000'; END IF;
   RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND ((TG_TABLE_NAME='invoices' AND OLD.status::text='PAGADO') OR (TG_TABLE_NAME='payment_orders' AND OLD.status::text='EJECUTADA')) THEN
   IF (to_jsonb(NEW)-'notes'-'observations'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'notes'-'observations'-'updated_at') THEN
     RAISE EXCEPTION 'Settled financial fact is immutable' USING ERRCODE='55000';
   END IF;
 END IF;
 IF current_user IN ('postgres','supabase_admin','service_role') THEN RETURN NEW; END IF;
 IF (TG_OP='INSERT' AND NEW.status::text IS DISTINCT FROM CASE WHEN TG_TABLE_NAME='invoices' THEN 'PENDIENTE' ELSE 'EMITIDA' END)
   OR (TG_OP='UPDATE' AND NEW.status IS DISTINCT FROM OLD.status) THEN
   RAISE EXCEPTION 'Use canonical financial RPC for status changes' USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_NAME='payment_orders' THEN
 IF ((TG_OP='INSERT' AND (NEW.executed_at IS NOT NULL OR NEW.cuenta_id IS NOT NULL))
    OR (TG_OP='UPDATE' AND (NEW.executed_at IS DISTINCT FROM OLD.executed_at OR NEW.cuenta_id IS DISTINCT FROM OLD.cuenta_id))) THEN
   RAISE EXCEPTION 'Use canonical OP execution RPC' USING ERRCODE='42501';
 END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.b11_guard_financial_status() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER b11_invoice_financial_status BEFORE INSERT OR UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION private.b11_guard_financial_status();
CREATE TRIGGER b11_op_financial_status BEFORE INSERT OR UPDATE OR DELETE ON public.payment_orders FOR EACH ROW EXECUTE FUNCTION private.b11_guard_financial_status();
COMMIT;
