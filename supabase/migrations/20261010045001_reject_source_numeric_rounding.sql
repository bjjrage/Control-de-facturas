-- Numeric typmods round before BEFORE triggers run. Store editable invoice and
-- authorized-order source amounts without typmods so the existing source
-- guards can reject excessive scale instead of observing already-rounded data.
BEGIN;

LOCK TABLE public.invoice_items,public.authorized_order_items IN ACCESS EXCLUSIVE MODE;
LOCK TABLE public.invoice_jobs IN ACCESS EXCLUSIVE MODE;

DO $source_numeric_preflight$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.invoice_items l
    WHERE (l.quantity IS NOT NULL AND (
             l.quantity::text IN ('NaN','Infinity','-Infinity') OR l.quantity<=0
             OR l.quantity>=1000000000000::numeric OR pg_catalog.scale(l.quantity)>2))
       OR (l.unit_price IS NOT NULL AND (
             l.unit_price::text IN ('NaN','Infinity','-Infinity') OR l.unit_price<0
             OR l.unit_price>=10000000000::numeric OR pg_catalog.scale(l.unit_price)>4))
       OR (l.subtotal IS NOT NULL AND (
             l.subtotal::text IN ('NaN','Infinity','-Infinity') OR l.subtotal<0
             OR l.subtotal>=1000000000000::numeric OR pg_catalog.scale(l.subtotal)>2))
  ) OR EXISTS (
    SELECT 1 FROM public.authorized_order_items oi
    WHERE oi.quantity::text IN ('NaN','Infinity','-Infinity') OR oi.quantity<=0
       OR oi.quantity>=1000000000000::numeric OR pg_catalog.scale(oi.quantity)>2
       OR oi.unit_price::text IN ('NaN','Infinity','-Infinity') OR oi.unit_price<0
       OR oi.unit_price>=10000000000::numeric OR pg_catalog.scale(oi.unit_price)>4
       OR oi.total_price::text IN ('NaN','Infinity','-Infinity') OR oi.total_price<0
       OR oi.total_price>=1000000000000::numeric OR pg_catalog.scale(oi.total_price)>2
  ) THEN
    RAISE EXCEPTION 'Source numeric precision preflight failed; inspect and explicitly repair invoice/order item data before retrying';
  END IF;
END;
$source_numeric_preflight$;

DO $invoice_job_fencing_preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM public.invoice_jobs WHERE attempts<0) THEN
    RAISE EXCEPTION 'Invoice job fencing preflight failed: negative attempts require explicit repair';
  END IF;
END;
$invoice_job_fencing_preflight$;

ALTER TABLE public.invoice_items
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric,
  ALTER COLUMN unit_price TYPE numeric USING unit_price::numeric,
  ALTER COLUMN subtotal TYPE numeric USING subtotal::numeric;

ALTER TABLE public.authorized_order_items
  ALTER COLUMN quantity TYPE numeric USING quantity::numeric,
  ALTER COLUMN unit_price TYPE numeric USING unit_price::numeric,
  ALTER COLUMN total_price TYPE numeric USING total_price::numeric;

ALTER TABLE public.invoice_items
  ADD CONSTRAINT r3_invoice_items_quantity_precision_check CHECK (
    quantity IS NULL OR (quantity::text NOT IN ('NaN','Infinity','-Infinity')
      AND quantity>0 AND quantity<1000000000000::numeric AND pg_catalog.scale(quantity)<=2)
  ),
  ADD CONSTRAINT r3_invoice_items_unit_price_precision_check CHECK (
    unit_price IS NULL OR (unit_price::text NOT IN ('NaN','Infinity','-Infinity')
      AND unit_price>=0 AND unit_price<10000000000::numeric AND pg_catalog.scale(unit_price)<=4)
  ),
  ADD CONSTRAINT r3_invoice_items_subtotal_precision_check CHECK (
    subtotal IS NULL OR (subtotal::text NOT IN ('NaN','Infinity','-Infinity')
      AND subtotal>=0 AND subtotal<1000000000000::numeric AND pg_catalog.scale(subtotal)<=2)
  );

ALTER TABLE public.authorized_order_items
  ADD CONSTRAINT r3_aoi_quantity_precision_check CHECK (
    quantity::text NOT IN ('NaN','Infinity','-Infinity')
      AND quantity>0 AND quantity<1000000000000::numeric AND pg_catalog.scale(quantity)<=2
  ),
  ADD CONSTRAINT r3_aoi_unit_price_precision_check CHECK (
    unit_price::text NOT IN ('NaN','Infinity','-Infinity')
      AND unit_price>=0 AND unit_price<10000000000::numeric AND pg_catalog.scale(unit_price)<=4
  ),
  ADD CONSTRAINT r3_aoi_total_price_precision_check CHECK (
    total_price::text NOT IN ('NaN','Infinity','-Infinity')
      AND total_price>=0 AND total_price<1000000000000::numeric AND pg_catalog.scale(total_price)<=2
  );

-- Keep the attempt counter monotonic and fence every new processing lease.
-- Invoice checkpoints are writable only inside SECURITY DEFINER RPCs owned by
-- a database administrator. The invoice delete RPC is SECURITY DEFINER owned
-- by the migration owner, so its FK ON DELETE SET NULL remains permitted.
ALTER TABLE public.invoice_jobs
  ADD CONSTRAINT r3_invoice_jobs_attempts_nonnegative CHECK (attempts>=0);

CREATE OR REPLACE FUNCTION private.guard_invoice_job_fencing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO ''
AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.invoice_id IS NOT NULL AND current_user NOT IN ('postgres','supabase_admin') THEN
      RAISE EXCEPTION 'El checkpoint de factura solo puede cambiarse mediante RPC transaccional' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.empresa_id IS DISTINCT FROM OLD.empresa_id THEN
    RAISE EXCEPTION 'No se puede mover un trabajo de factura entre empresas' USING ERRCODE='42501';
  END IF;
  IF NEW.attempts < OLD.attempts THEN
    RAISE EXCEPTION 'El contador de intentos del trabajo no puede retroceder' USING ERRCODE='40001';
  END IF;
  IF NEW.status='processing'::public.invoice_job_status
     AND OLD.status IS DISTINCT FROM 'processing'::public.invoice_job_status
     AND NEW.attempts <> OLD.attempts+1 THEN
    RAISE EXCEPTION 'Una nueva lease requiere incrementar el contador de intentos' USING ERRCODE='40001';
  END IF;
  IF NEW.invoice_id IS DISTINCT FROM OLD.invoice_id
     AND current_user NOT IN ('postgres','supabase_admin') THEN
    RAISE EXCEPTION 'El checkpoint de factura solo puede cambiarse mediante RPC transaccional' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.guard_invoice_job_fencing() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER r3_invoice_job_fencing
BEFORE INSERT OR UPDATE ON public.invoice_jobs
FOR EACH ROW EXECUTE FUNCTION private.guard_invoice_job_fencing();

REVOKE ALL PRIVILEGES ON TABLE public.invoice_jobs
  FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.invoice_jobs
  TO authenticated,service_role;
REVOKE TRUNCATE,TRIGGER,REFERENCES,MAINTAIN ON TABLE public.invoice_jobs
  FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
