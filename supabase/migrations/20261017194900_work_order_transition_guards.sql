-- Guard the operational state independently of the UI and protect approval
-- metadata from a direct authenticated table update.
CREATE OR REPLACE FUNCTION private.guard_work_order_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
DECLARE
  v_role public.user_role;
BEGIN
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id
     OR NEW.sales_document_id IS DISTINCT FROM OLD.sales_document_id THEN
    RAISE EXCEPTION 'No se puede cambiar la identidad de la OT';
  END IF;

  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
    IF OLD.workflow_status <> 'PENDING_INTERNAL_APPROVAL'
       OR NEW.workflow_status <> 'READY_FOR_PRODUCTION'
       OR OLD.status <> 'PENDIENTE' THEN
      RAISE EXCEPTION 'Transición de aprobación de OT inválida';
    END IF;
    IF NEW.approval_mode = 'RESPONSIBLE_APPROVAL' THEN
      IF NEW.approval_mode IS DISTINCT FROM OLD.approval_mode
         OR NEW.responsible_role IS DISTINCT FROM OLD.responsible_role
         OR NEW.routing_policy_id IS DISTINCT FROM OLD.routing_policy_id
         OR auth.uid() IS NULL
         OR NEW.approved_by IS DISTINCT FROM auth.uid()
         OR NEW.approved_at IS NULL THEN
        RAISE EXCEPTION 'La aprobación debe registrar al responsable autorizado';
      END IF;
      SELECT role INTO v_role FROM public.profiles
      WHERE id = auth.uid() AND empresa_id = OLD.empresa_id AND active = true;
      IF v_role IS NULL OR (v_role <> OLD.responsible_role AND v_role <> 'admin') THEN
        RAISE EXCEPTION 'El actor no tiene el rol responsable de esta OT';
      END IF;
    ELSIF NEW.approval_mode = 'DIRECT_TO_PRODUCTION' THEN
      -- accept_quotation resolves this routing policy while creating the OT.
      IF auth.uid() IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL THEN
        RAISE EXCEPTION 'El pase directo solo se resuelve al aceptar la cotización';
      END IF;
    ELSE
      RAISE EXCEPTION 'Modo de aprobación de OT inválido';
    END IF;
  ELSIF NEW.approved_by IS DISTINCT FROM OLD.approved_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
    RAISE EXCEPTION 'La aprobación de OT es inmutable';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF (OLD.status = 'PENDIENTE' AND NEW.status = 'EN_CURSO'
        AND NEW.workflow_status = 'READY_FOR_PRODUCTION')
       OR (OLD.status = 'EN_CURSO' AND NEW.status = 'COMPLETADA'
        AND NEW.workflow_status = 'READY_FOR_PRODUCTION') THEN
      RETURN NEW;
    END IF;
    IF OLD.status IN ('PENDIENTE','EN_CURSO') AND NEW.status = 'CANCELADA' THEN
      IF EXISTS (
        SELECT 1 FROM public.sales_documents d
        WHERE d.empresa_id = OLD.empresa_id
          AND d.source_document_id = OLD.sales_document_id
          AND d.status <> 'ANULADA'
      ) THEN
        RAISE EXCEPTION 'La OT tiene documentos derivados activos';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Transición de estado de OT inválida o pendiente de aprobación';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zzz_guard_work_order_transition ON public.work_orders;
CREATE TRIGGER zzz_guard_work_order_transition
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION private.guard_work_order_transition();

REVOKE ALL ON FUNCTION private.guard_work_order_transition() FROM PUBLIC;
