-- Run only with an explicit --project-ref kyiihlkncatojvlasoag.
-- The entire proof rolls back, including counters and audit triggers.
BEGIN;
DO $guard$
BEGIN
  IF to_regclass('public.invoice_identity_evidence') IS NULL
     OR to_regprocedure('public.save_sales_document_atomico(uuid,uuid,uuid,text,date,date,text,text,uuid,uuid,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Expected isolated preview schema is missing';
  END IF;
END;
$guard$;

SELECT
  set_config('request.jwt.claim.sub', p.id::text, true),
  set_config('request.jwt.claim.role', 'authenticated', true),
  set_config('request.jwt.claims', json_build_object('sub',p.id,'role','authenticated')::text, true),
  set_config('qa.sales_client_id', c.id::text, true)
FROM public.profiles p
JOIN public.clients c ON c.empresa_id = p.empresa_id
WHERE p.active AND p.role IN ('administracion','admin')
ORDER BY p.id, c.id LIMIT 1;

SET LOCAL ROLE authenticated;
SELECT set_config('qa.sales_document_id',
  public.save_sales_document_atomico(
    public.current_empresa_id(), NULL,
    current_setting('qa.sales_client_id')::uuid,
    'FACTURA', CURRENT_DATE, NULL, 'PYG',
    'QA transaccional; ROLLBACK', NULL, auth.uid(),
    '[{"description":"QA ROLLBACK","quantity":1,"unit_price":1,"vat_rate":10}]'::jsonb
  )::text, true);
SELECT public.save_sales_document_atomico(
  public.current_empresa_id(), current_setting('qa.sales_document_id')::uuid,
  current_setting('qa.sales_client_id')::uuid,
  'FACTURA', CURRENT_DATE, NULL, 'PYG',
  'QA updated; ROLLBACK', NULL, auth.uid(),
  '[{"description":"QA UPDATE","quantity":2,"unit_price":1,"vat_rate":10}]'::jsonb
);
DO $negative$
BEGIN
  BEGIN
    PERFORM public.save_sales_document_atomico(
      public.current_empresa_id(), NULL,
      current_setting('qa.sales_client_id')::uuid,
      'FACTURA', CURRENT_DATE, NULL, 'PYG',
      'QA invalid; ROLLBACK', NULL, auth.uid(),
      '[{"description":"Valid","quantity":1,"unit_price":1,"vat_rate":10},
        {"description":"Invalid","quantity":0,"unit_price":1,"vat_rate":10}]'::jsonb
    );
    RAISE EXCEPTION 'The invalid line unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%nea de venta inv%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.save_sales_document_atomico(
      public.current_empresa_id(), current_setting('qa.sales_document_id')::uuid,
      current_setting('qa.sales_client_id')::uuid,
      'FACTURA', CURRENT_DATE, NULL, 'PYG',
      'QA invalid update; ROLLBACK', NULL, auth.uid(),
      '[{"description":"Valid","quantity":1,"unit_price":1,"vat_rate":10},
        {"description":"Invalid","quantity":0,"unit_price":1,"vat_rate":10}]'::jsonb
    );
    RAISE EXCEPTION 'The invalid update unexpectedly succeeded';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%nea de venta inv%' THEN RAISE; END IF;
  END;
END;
$negative$;
SELECT
  (SELECT count(*) FROM public.sales_documents
   WHERE id=current_setting('qa.sales_document_id')::uuid) AS headers_visible_in_transaction,
  (SELECT count(*) FROM public.sales_document_items
   WHERE sales_document_id=current_setting('qa.sales_document_id')::uuid
     AND description='QA UPDATE') AS preserved_updated_items,
  (SELECT count(*) FROM public.sales_documents
   WHERE id=current_setting('qa.sales_document_id')::uuid
     AND notes='QA updated; ROLLBACK') AS preserved_updated_header,
  (SELECT count(*) FROM public.sales_documents
   WHERE notes='QA invalid; ROLLBACK') AS invalid_headers;
ROLLBACK;
