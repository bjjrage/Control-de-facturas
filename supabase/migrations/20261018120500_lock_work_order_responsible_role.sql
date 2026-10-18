-- The responsible role is fixed when the accepted quotation creates the OT.
-- A separate update must not change it before the approval transition.
CREATE OR REPLACE FUNCTION private.lock_work_order_responsible_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NEW.responsible_role IS DISTINCT FROM OLD.responsible_role THEN
    RAISE EXCEPTION 'El rol responsable de la OT es inmutable';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER guard_work_order_responsible_role
  BEFORE UPDATE OF responsible_role ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION private.lock_work_order_responsible_role();

REVOKE ALL ON FUNCTION private.lock_work_order_responsible_role() FROM PUBLIC;
