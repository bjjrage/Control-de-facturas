-- Run only with explicit --project-ref kyiihlkncatojvlasoag.
-- Every synthetic invoice and its audit-side effects roll back.
BEGIN;
DO $guard$
BEGIN
  IF to_regclass('public.invoice_identity_evidence') IS NULL
     OR to_regprocedure('public.create_invoice_with_lines_atomico(uuid,uuid,jsonb,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Expected isolated preview schema is missing';
  END IF;
END;
$guard$;

SELECT
  set_config('request.jwt.claim.sub', p.id::text, true),
  set_config('request.jwt.claim.role', 'authenticated', true),
  set_config('request.jwt.claims', json_build_object('sub',p.id,'role','authenticated')::text, true),
  set_config('qa.invoice_provider_id', v.id::text, true)
FROM public.profiles p
JOIN public.providers v ON v.empresa_id=p.empresa_id
WHERE p.active AND p.role IN ('administracion','admin')
ORDER BY p.id,v.id LIMIT 1;

SET LOCAL ROLE authenticated;
SELECT set_config('qa.invoice_id',
  public.create_invoice_with_lines_atomico(
    public.current_empresa_id(), auth.uid(),
    jsonb_build_object(
      'provider_id',current_setting('qa.invoice_provider_id'),
      'invoice_number','QA-C07-ROLLBACK',
      'invoice_date',CURRENT_DATE::text,'currency','PYG',
      'subtotal',100,'vat',10,'total',110,'observations','QA rollback'
    ),
    '[{"description":"QA Material","quantity":"1","unit":"un","unit_price":100,"subtotal":100},
      {"description":"QA Servicio","quantity":"1","unit":"un","unit_price":0,"subtotal":0}]'::jsonb
  )::text, true);

DO $negative$
BEGIN
  BEGIN
    PERFORM public.create_invoice_with_lines_atomico(
      public.current_empresa_id(), auth.uid(),
      jsonb_build_object(
        'provider_id',current_setting('qa.invoice_provider_id'),
        'invoice_number','QA-C07-INVALID-ROLLBACK',
        'invoice_date',CURRENT_DATE::text,'currency','PYG','total',110
      ),
      '[{"description":"Valid","quantity":"1"},
        {"description":"Invalid","quantity":"0"}]'::jsonb
    );
    RAISE EXCEPTION 'The invalid invoice unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Linea de factura invalida%' THEN RAISE; END IF;
  END;
END;
$negative$;

SELECT
  (SELECT count(*) FROM public.invoices
   WHERE id=current_setting('qa.invoice_id')::uuid) AS valid_headers_in_transaction,
  (SELECT count(*) FROM public.invoice_items
   WHERE invoice_id=current_setting('qa.invoice_id')::uuid) AS valid_lines_in_transaction,
  (SELECT count(*) FROM public.invoices
   WHERE invoice_number='QA-C07-INVALID-ROLLBACK') AS invalid_headers;
ROLLBACK;
