-- RUN ONLY on the dedicated RFQ Preview. All synthetic records roll back.
BEGIN;
DO $$
DECLARE e uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); vendor uuid:=gen_random_uuid(); vendor2 uuid:=gen_random_uuid();
 r jsonb; item uuid; token text; token2 text; invitation uuid; document uuid; version jsonb; version2 jsonb;
 vi uuid; vi2 uuid; allocation jsonb; preview jsonb; confirmed jsonb; direct jsonb; oid uuid; unexpected integer;
BEGIN
 INSERT INTO public.empresas(id,nombre) VALUES(e,'RFQ 2 preview smoke');
 INSERT INTO auth.users(id,email) VALUES(actor,actor::text||'@rfq-smoke.invalid');
 INSERT INTO public.profiles(id,empresa_id,email,full_name,role,active) VALUES(actor,e,actor::text||'@rfq-smoke.invalid','Synthetic human','admin',true)
 ON CONFLICT(id) DO UPDATE SET empresa_id=e,role='admin',active=true;
 PERFORM set_config('request.jwt.claim.sub',actor::text,true);
 INSERT INTO public.providers(id,empresa_id,name) VALUES(vendor,e,'Synthetic supplier A'),(vendor2,e,'Synthetic supplier B');
 r:=public.rfq_create(jsonb_build_object('purpose','PROCUREMENT','product','Synthetic material'),
  jsonb_build_array(jsonb_build_object('descripcion','Synthetic material','cantidad',10,'unidad','kg')),ARRAY[vendor,vendor2]);
 SELECT id INTO item FROM public.rfq_items WHERE rfq_id=(r->>'id')::uuid;
 SELECT rp.token,rp.id INTO token,invitation FROM public.rfq_providers rp WHERE rp.rfq_id=(r->>'id')::uuid AND provider_id=vendor;
 INSERT INTO public.attachments(empresa_id,bucket,path,file_name,rfq_provider_id) VALUES(e,'quote-pdfs',gen_random_uuid()::text,'synthetic.pdf',invitation) RETURNING id INTO document;
 version:=public.rfq_submit_version(token,jsonb_build_object('budget_number','Q-A','currency','PYG','vat_included',false,'invoice_available',true,'valid_until','2099-01-01T00:00:00Z','freight',20,'payment_terms','30 days'),
  jsonb_build_array(jsonb_build_object('rfq_item_id',item,'precio_unitario',90,'available_quantity',10,'tax_rate',10,'lead_time_days',5)),document);
 SELECT id INTO vi FROM public.quote_version_items WHERE quote_version_id=(version->>'versionId')::uuid;
 SELECT rp.token,rp.id INTO token2,invitation FROM public.rfq_providers rp WHERE rp.rfq_id=(r->>'id')::uuid AND provider_id=vendor2;
 INSERT INTO public.attachments(empresa_id,bucket,path,file_name,rfq_provider_id) VALUES(e,'quote-pdfs',gen_random_uuid()::text,'synthetic-b.pdf',invitation) RETURNING id INTO document;
 version2:=public.rfq_submit_version(token2,jsonb_build_object('budget_number','Q-B','currency','PYG','vat_included',false,'invoice_available',true,'valid_until','2099-01-01T00:00:00Z','freight',20,'payment_terms','cash'),
  jsonb_build_array(jsonb_build_object('rfq_item_id',item,'precio_unitario',95,'available_quantity',10,'tax_rate',10,'lead_time_days',2)),document);
 SELECT id INTO vi2 FROM public.quote_version_items WHERE quote_version_id=(version2->>'versionId')::uuid;
 PERFORM public.rfq_review_quote((version->>'versionId')::uuid,'{"test":"synthetic"}','{"test":"synthetic"}','Synthetic human reviewed document');
 PERFORM public.rfq_review_quote((version2->>'versionId')::uuid,'{"test":"synthetic"}','{"test":"synthetic"}','Synthetic human reviewed document');
 allocation:=public.rfq_save_allocation((r->>'id')::uuid,jsonb_build_array(jsonb_build_object('quote_version_item_id',vi,'quantity',4),jsonb_build_object('quote_version_item_id',vi2,'quantity',5)),'Synthetic human partial split',0);
 SELECT count(*) INTO unexpected FROM public.authorized_orders WHERE empresa_id=e;
 IF unexpected<>0 THEN RAISE EXCEPTION 'Allocation created orders'; END IF;
 PERFORM public.rfq_authorize_allocation((allocation->>'id')::uuid,true);
 SELECT count(*) INTO unexpected FROM public.authorized_orders WHERE empresa_id=e;
 IF unexpected<>0 THEN RAISE EXCEPTION 'Authorization created orders'; END IF;
 preview:=public.rfq_preview_orders((allocation->>'id')::uuid);
 IF jsonb_array_length(preview->'orders')<>2 THEN RAISE EXCEPTION 'Expected two exact previews'; END IF;
 confirmed:=public.rfq_confirm_orders((allocation->>'id')::uuid,preview->>'hash',true);
 IF jsonb_array_length(confirmed->'orderIds')<>2 THEN RAISE EXCEPTION 'Expected two orders'; END IF;
 PERFORM public.rfq_confirm_orders((allocation->>'id')::uuid,preview->>'hash',true);
 SELECT count(*) INTO unexpected FROM public.authorized_orders WHERE empresa_id=e;
 IF unexpected<>2 THEN RAISE EXCEPTION 'Duplicate orders'; END IF;
 IF EXISTS(SELECT 1 FROM public.authorized_orders o WHERE o.empresa_id=e AND o.total_price<>(o.procurement_snapshot->>'total')::numeric) THEN RAISE EXCEPTION 'Snapshot differs from order'; END IF;
 direct:=public.direct_purchase_preview(jsonb_build_object('provider_id',vendor,'currency','USD','freight',5,'vat_included',false,'payment_terms','cash'),
  '[{"product":"Direct material","quantity":0.1234,"unit":"kg","unit_price":100,"tax_rate":10}]');
 oid:=public.direct_purchase_confirm((direct->>'id')::uuid,direct->>'hash',true);
 IF NOT EXISTS(SELECT 1 FROM public.authorized_orders WHERE id=oid AND rfq_id IS NULL AND quantity=0.1234 AND total_price=18.57) THEN RAISE EXCEPTION 'Direct preview mismatch'; END IF;
 r:=public.rfq_create(jsonb_build_object('purpose','COST_DISCOVERY','product','Discovery'), '[{"descripcion":"Signal","cantidad":1,"unidad":"un"}]','{}');
 BEGIN
  PERFORM public.rfq_save_allocation((r->>'id')::uuid,jsonb_build_array(jsonb_build_object('quote_version_item_id',vi,'quantity',1)),'Must reject discovery',0);
  RAISE EXCEPTION 'Cost discovery accepted allocation';
 EXCEPTION WHEN OTHERS THEN IF SQLERRM='Cost discovery accepted allocation' THEN RAISE; END IF; END;
 RAISE NOTICE 'RFQ 2 real Preview smoke: PASS. All synthetic rows roll back.';
END $$;
ROLLBACK;
SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version;
