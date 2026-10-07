BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.providers
  ADD COLUMN payment_terms text,
  ADD CONSTRAINT providers_payment_terms_length CHECK (char_length(payment_terms) <= 500);

COMMENT ON COLUMN public.providers.payment_terms IS
  'Optional supplier master payment terms. Informational only; does not set or modify document due dates or quotation terms.';

NOTIFY pgrst, 'reload schema';
COMMIT;
