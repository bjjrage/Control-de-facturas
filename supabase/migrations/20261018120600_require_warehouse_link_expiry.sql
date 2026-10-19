-- Previously issued indefinite links are expired immediately. New links must
-- always carry a deadline, including writes that bypass the application.
UPDATE public.warehouse_portal_links
SET expires_at = now() - interval '1 second'
WHERE expires_at IS NULL;

ALTER TABLE public.warehouse_portal_links
  ALTER COLUMN expires_at SET NOT NULL;
