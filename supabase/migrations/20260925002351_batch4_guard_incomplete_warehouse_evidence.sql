BEGIN;

-- A confirmation may only consume a complete, successfully processed evidence set.
-- Row-level spreadsheet validation warnings are stored on the proposed lines and
-- must be reviewed there; failed/unprocessed evidence always blocks confirmation.
CREATE OR REPLACE FUNCTION public.prevent_confirmation_with_unresolved_warehouse_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status = 'CONFIRMED'
     AND OLD.status IS DISTINCT FROM 'CONFIRMED'
     AND EXISTS (
       SELECT 1
       FROM public.warehouse_submission_evidence e
       WHERE e.submission_id = NEW.id
         AND e.empresa_id = NEW.empresa_id
         AND (
           e.extraction_status IN ('NOT_PROCESSED', 'PROCESSING', 'FAILED')
           OR e.extraction_error IS NOT NULL
         )
     ) THEN
    RAISE EXCEPTION 'Hay evidencia sin procesar o con errores; resolvé su revisión antes de confirmar';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_confirmation_with_unresolved_warehouse_evidence()
  FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS trg_prevent_confirmation_with_unresolved_warehouse_evidence
  ON public.warehouse_submissions;
CREATE TRIGGER trg_prevent_confirmation_with_unresolved_warehouse_evidence
  BEFORE UPDATE OF status ON public.warehouse_submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_confirmation_with_unresolved_warehouse_evidence();

COMMIT;
