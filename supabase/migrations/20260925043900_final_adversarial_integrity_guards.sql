-- Close two irreversible review gaps found by the final adversarial pass.

-- Closed project certificates and their lines are frozen against DELETE as
-- well as INSERT/UPDATE. Draft parent deletion may still cascade normally.
CREATE OR REPLACE FUNCTION public.guard_project_certificate_line_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_certificate_id uuid;
  v_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_certificate_id := OLD.certificate_id;
  ELSE
    v_certificate_id := NEW.certificate_id;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.certificate_id IS DISTINCT FROM NEW.certificate_id THEN
    RAISE EXCEPTION 'No se puede mover una línea entre certificados';
  END IF;

  SELECT c.status::text INTO v_status
  FROM public.project_certificates c
  WHERE c.id = v_certificate_id
  FOR UPDATE;
  IF NOT FOUND AND TG_OP = 'DELETE' THEN
    -- A draft parent may be deleted; its ON DELETE CASCADE removes the lines.
    RETURN OLD;
  END IF;
  IF NOT FOUND OR v_status IS DISTINCT FROM 'BORRADOR' THEN
    RAISE EXCEPTION 'Solo se pueden modificar líneas de un certificado en borrador';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_project_certificate_line_write
  ON public.project_certificate_items;
CREATE TRIGGER trg_guard_project_certificate_line_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.project_certificate_items
  FOR EACH ROW EXECUTE FUNCTION public.guard_project_certificate_line_write();
REVOKE ALL ON FUNCTION public.guard_project_certificate_line_write()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.prevent_closed_project_certificate_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status::text IS DISTINCT FROM 'BORRADOR' THEN
    RAISE EXCEPTION 'Un certificado cerrado no se puede eliminar';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_closed_project_certificate_delete
  ON public.project_certificates;
CREATE TRIGGER trg_prevent_closed_project_certificate_delete
  BEFORE DELETE ON public.project_certificates
  FOR EACH ROW EXECUTE FUNCTION public.prevent_closed_project_certificate_delete();
REVOKE ALL ON FUNCTION public.prevent_closed_project_certificate_delete()
  FROM PUBLIC, anon, authenticated, service_role;

-- Portal receipts must resolve every stock item before the irreversible
-- confirmation transition. Manual/legacy receipts retain their existing rules.
CREATE OR REPLACE FUNCTION public.prevent_unmapped_portal_receipt_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM 'CONFIRMED'
     AND NEW.status = 'CONFIRMED'
     AND pg_catalog.left(coalesce(NEW.idempotency_key, ''), pg_catalog.length('receipt-portal:')) = 'receipt-portal:'
     AND EXISTS (
       SELECT 1
       FROM public.oc_recepcion_items ri
       WHERE ri.recepcion_id = NEW.id AND ri.empresa_id = NEW.empresa_id
         AND ri.producto_id IS NULL
     ) THEN
    RAISE EXCEPTION 'Vinculá todos los productos de inventario antes de confirmar esta recepción externa';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_unmapped_portal_receipt_confirmation
  ON public.oc_recepciones;
CREATE TRIGGER trg_prevent_unmapped_portal_receipt_confirmation
  BEFORE UPDATE OF status ON public.oc_recepciones
  FOR EACH ROW EXECUTE FUNCTION public.prevent_unmapped_portal_receipt_confirmation();
REVOKE ALL ON FUNCTION public.prevent_unmapped_portal_receipt_confirmation()
  FROM PUBLIC, anon, authenticated, service_role;
