-- Run ONLY against Batch 04 Preview. Every fixture and write rolls back.
BEGIN;
CREATE TEMP TABLE prebid_test_results(name text,pass boolean);
GRANT ALL ON prebid_test_results TO authenticated,service_role;
CREATE FUNCTION pg_temp.check_true(name text,ok boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',name; END IF;
 INSERT INTO prebid_test_results VALUES(name,true);
END $$;
CREATE FUNCTION pg_temp.reject(name text,statement text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE rejected boolean:=false; BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN rejected:=true; END;
 PERFORM pg_temp.check_true(name,rejected);
END $$;

INSERT INTO public.empresas(id,nombre,plan) VALUES
 ('bbbbbbbb-1111-4111-8111-111111111111','Batch04 rollback A','caterpillar'),
 ('bbbbbbbb-2222-4222-8222-222222222222','Batch04 rollback B','caterpillar');
INSERT INTO auth.users(id,email) VALUES
 ('aaaaaaaa-1111-4111-8111-111111111111','batch04-a@example.invalid'),
 ('aaaaaaaa-2222-4222-8222-222222222222','batch04-b@example.invalid');
INSERT INTO public.profiles(id,email,full_name,role,empresa_id) VALUES
 ('aaaaaaaa-1111-4111-8111-111111111111','batch04-a@example.invalid','Test A','admin','bbbbbbbb-1111-4111-8111-111111111111'),
 ('aaaaaaaa-2222-4222-8222-222222222222','batch04-b@example.invalid','Test B','admin','bbbbbbbb-2222-4222-8222-222222222222')
 ON CONFLICT(id) DO UPDATE SET empresa_id=excluded.empresa_id,role='admin';
INSERT INTO public.licitaciones(id,empresa_id,dncp_nro,ocid,titulo) VALUES
 ('cccccccc-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111','b04-a','b04-a','Tender A'),
 ('cccccccc-2222-4222-8222-222222222222','bbbbbbbb-2222-4222-8222-222222222222','b04-b','b04-b','Tender B'),
 ('cccccccc-3333-4333-8333-333333333333','bbbbbbbb-1111-4111-8111-111111111111','b04-lost','b04-lost','Tender lost');
INSERT INTO public.licitacion_items(licitacion_id,empresa_id,descripcion,cantidad,unidad) VALUES
 ('cccccccc-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111','Measured wall',10,'m2');
INSERT INTO public.productos(id,empresa_id,nombre,unidad) VALUES
 ('dddddddd-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111','Material A','u'),
 ('dddddddd-2222-4222-8222-222222222222','bbbbbbbb-2222-4222-8222-222222222222','Material B','u');
INSERT INTO public.productos(id,empresa_id,nombre,unidad) VALUES('dddddddd-3333-4333-8333-333333333333','bbbbbbbb-1111-4111-8111-111111111111','Other material A','u');
INSERT INTO public.providers(id,empresa_id,name) VALUES ('eeeeeeee-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111','Supplier A');
INSERT INTO storage.objects(bucket_id,name) VALUES('bim-models','tenders/cccccccc-1111-4111-8111-111111111111/rollback.ifc');
CREATE TEMP TABLE prebid_ids(key text PRIMARY KEY,id uuid);
GRANT ALL ON prebid_ids TO authenticated,service_role;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
INSERT INTO public.licitacion_ofertas(licitacion_id,empresa_id,created_by) VALUES
 ('cccccccc-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111'),
 ('cccccccc-3333-4333-8333-333333333333','bbbbbbbb-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111');
SELECT pg_temp.check_true('compute import without project',public.prebid_import_computo('cccccccc-1111-4111-8111-111111111111')=1);
SELECT pg_temp.check_true('compute import idempotent',public.prebid_import_computo('cccccccc-1111-4111-8111-111111111111')=0);
INSERT INTO prebid_ids SELECT 'budget',id FROM public.budget_items WHERE tender_id='cccccccc-1111-4111-8111-111111111111';
SELECT pg_temp.check_true('budget has tender and no project',(SELECT project_id IS NULL FROM public.budget_items WHERE id=(SELECT id FROM prebid_ids WHERE key='budget')));
SELECT pg_temp.reject('cross tenant workspace','select public.prebid_workspace(''cccccccc-2222-4222-8222-222222222222'')');
SELECT pg_temp.reject('cross tenant compute import','select public.prebid_import_computo(''cccccccc-2222-4222-8222-222222222222'')');
SELECT pg_temp.reject('fake project owner','insert into public.budget_items(project_id,code,description) values(''cccccccc-1111-4111-8111-111111111111'',''fake'',''fake'')');
SELECT pg_temp.reject('material cross tenant rejected',format('insert into public.budget_item_materials(empresa_id,tender_id,budget_item_id,producto_id,cantidad_por_unidad_ejecutada) values(''bbbbbbbb-1111-4111-8111-111111111111'',''cccccccc-1111-4111-8111-111111111111'',%L,''dddddddd-2222-4222-8222-222222222222'',1)',(SELECT id FROM prebid_ids WHERE key='budget')));
SELECT pg_temp.reject('null margin settings rejected','update public.licitacion_ofertas set cost_settings=''{"indirectPct":0,"generalPct":0,"financingPct":0,"riskPct":0,"marginPct":null}'' where licitacion_id=''cccccccc-1111-4111-8111-111111111111''');
INSERT INTO prebid_ids SELECT 'bim',public.workspace_register_bim('{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}','rollback.ifc','tenders/cccccccc-1111-4111-8111-111111111111/rollback.ifc','IFC4',
 '[{"ifcGuid":"wall-a","ifcType":"IfcWall","expressId":1,"name":"wall","properties":{},"quantityType":"area","quantityValue":10,"quantityUnit":"m2","quantitySource":"IFC_QTO","quantityProperty":"NetSideArea"}]');
INSERT INTO prebid_ids SELECT 'element',id FROM public.bim_elements WHERE bim_model_id=(SELECT id FROM prebid_ids WHERE key='bim');
SELECT pg_temp.check_true('BIM tender registration',(SELECT tender_id='cccccccc-1111-4111-8111-111111111111' AND project_id IS NULL FROM public.bim_models WHERE id=(SELECT id FROM prebid_ids WHERE key='bim')));
SELECT pg_temp.check_true('BIM factual quantity human confirmation',public.workspace_apply_bim_quantity('{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}',(SELECT id FROM prebid_ids WHERE key='budget'),ARRAY[(SELECT id FROM prebid_ids WHERE key='element')],(SELECT updated_at FROM public.budget_items WHERE id=(SELECT id FROM prebid_ids WHERE key='budget')),10)=10);
UPDATE public.budget_items SET unit='metros cuadrados' WHERE id=(SELECT id FROM prebid_ids WHERE key='budget');
SELECT pg_temp.check_true('BIM canonical unit aliases accepted',public.workspace_apply_bim_quantity('{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}',(SELECT id FROM prebid_ids WHERE key='budget'),ARRAY[(SELECT id FROM prebid_ids WHERE key='element')],(SELECT updated_at FROM public.budget_items WHERE id=(SELECT id FROM prebid_ids WHERE key='budget')),10)=10);
UPDATE public.budget_items SET unit='m2' WHERE id=(SELECT id FROM prebid_ids WHERE key='budget');
SELECT pg_temp.reject('BIM manipulated quantity rejected',format('select public.workspace_apply_bim_quantity(''{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}'',%L,ARRAY[%L::uuid],%L::timestamptz,999)',(SELECT id FROM prebid_ids WHERE key='budget'),(SELECT id FROM prebid_ids WHERE key='element'),(SELECT updated_at FROM public.budget_items WHERE id=(SELECT id FROM prebid_ids WHERE key='budget'))));
SELECT pg_temp.reject('BIM other context rejected',format('select public.workspace_apply_bim_quantity(''{"kind":"TENDER","id":"cccccccc-3333-4333-8333-333333333333"}'',%L,ARRAY[%L::uuid],%L::timestamptz,10)',(SELECT id FROM prebid_ids WHERE key='budget'),(SELECT id FROM prebid_ids WHERE key='element'),(SELECT updated_at FROM public.budget_items WHERE id=(SELECT id FROM prebid_ids WHERE key='budget'))));
INSERT INTO public.planillas(id,empresa_id,usuario_id,modulo,contexto,snapshot,base_versions)
 SELECT '99999999-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111','computo_presupuesto','{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}',
 jsonb_build_object('rows',jsonb_build_array(jsonb_build_object('_rowId',b.id,'code',b.code,'description',b.description,'unit',b.unit,'quantity',b.quantity))),jsonb_build_object(b.id::text,b.updated_at) FROM public.budget_items b WHERE id=(SELECT id FROM prebid_ids WHERE key='budget');
SELECT pg_temp.check_true('same atomic computo engine works in tender',(public.planilla_confirmar_computo('99999999-1111-4111-8111-111111111111')->'result'->>'updated')::integer=1);
INSERT INTO public.budget_item_materials(empresa_id,tender_id,budget_item_id,producto_id,cantidad_por_unidad_ejecutada)
 VALUES('bbbbbbbb-1111-4111-8111-111111111111','cccccccc-1111-4111-8111-111111111111',(SELECT id FROM prebid_ids WHERE key='budget'),'dddddddd-1111-4111-8111-111111111111',2);
SELECT pg_temp.reject('quote id mandatory','select public.workspace_adopt_price(''{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}'',''dddddddd-1111-4111-8111-111111111111'',''COTIZACION'',999,null)');
SELECT pg_temp.reject('manual zero','select public.workspace_adopt_price(''{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}'',''dddddddd-1111-4111-8111-111111111111'',''MANUAL'',0,null)');
SELECT pg_temp.reject('manual NaN','select public.workspace_adopt_price(''{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}'',''dddddddd-1111-4111-8111-111111111111'',''MANUAL'',''NaN''::numeric,null)');
SELECT pg_temp.reject('manual Infinity','select public.workspace_adopt_price(''{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}'',''dddddddd-1111-4111-8111-111111111111'',''MANUAL'',''Infinity''::numeric,null)');
SELECT pg_temp.reject('manual negative','select public.workspace_adopt_price(''{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}'',''dddddddd-1111-4111-8111-111111111111'',''MANUAL'',-1,null)');
SELECT pg_temp.check_true('manual positive',public.workspace_adopt_price('{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}','dddddddd-1111-4111-8111-111111111111','MANUAL',50,'ffffffff-1111-4111-8111-111111111111')=50);
SELECT pg_temp.check_true('manual quote forced null',(SELECT quote_version_item_id IS NULL FROM public.project_cost_prices WHERE tender_id='cccccccc-1111-4111-8111-111111111111'));
INSERT INTO prebid_ids VALUES('rfq',(public.rfq_create('{"tender_id":"cccccccc-1111-4111-8111-111111111111","purpose":"COST_DISCOVERY","product":"Material A"}',
 '[{"producto_id":"dddddddd-1111-4111-8111-111111111111","descripcion":"Material A","cantidad":20,"unidad":"u"}]',ARRAY['eeeeeeee-1111-4111-8111-111111111111'::uuid])->>'id')::uuid);
SELECT pg_temp.check_true('discovery keeps tender provenance',(SELECT project_id IS NULL AND purpose='COST_DISCOVERY' FROM public.rfqs WHERE id=(SELECT id FROM prebid_ids WHERE key='rfq')));
SELECT pg_temp.reject('tender procurement rejected','select public.rfq_create(''{"tender_id":"cccccccc-1111-4111-8111-111111111111","purpose":"PROCUREMENT","product":"Forbidden"}'',''[{"descripcion":"x","cantidad":1,"unidad":"u"}]'')');
SELECT pg_temp.reject('discovery allocation rejected',format('select public.rfq_save_allocation(%L,''[]'',''human review no procurement'')',(SELECT id FROM prebid_ids WHERE key='rfq')));
INSERT INTO prebid_ids SELECT 'invitation',id FROM public.rfq_providers WHERE rfq_id=(SELECT id FROM prebid_ids WHERE key='rfq');
INSERT INTO prebid_ids SELECT 'rfq_item',id FROM public.rfq_items WHERE rfq_id=(SELECT id FROM prebid_ids WHERE key='rfq');
RESET ROLE;
INSERT INTO public.attachments(id,empresa_id,rfq_provider_id,bucket,path,file_name,original_sha256) VALUES
 ('ffffffff-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111',(SELECT id FROM prebid_ids WHERE key='invitation'),'quote-pdfs','rollback-test.pdf','rollback-test.pdf',repeat('a',64));
SET LOCAL ROLE service_role;
INSERT INTO prebid_ids SELECT 'version',(public.rfq_submit_version((SELECT token FROM public.rfq_providers WHERE id=(SELECT id FROM prebid_ids WHERE key='invitation')),
 jsonb_build_object('valid_until',now()+interval '7 days','freight',0,'payment_terms','30 days','budget_number','Q-1','currency','PYG','invoice_available',true,'vat_included',true),
 jsonb_build_array(jsonb_build_object('rfq_item_id',(SELECT id FROM prebid_ids WHERE key='rfq_item'),'precio_unitario',73,'available_quantity',20,'tax_rate',10,'lead_time_days',2)),
 'ffffffff-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111')->>'versionId')::uuid;
INSERT INTO prebid_ids SELECT 'quote_item',id FROM public.quote_version_items WHERE quote_version_id=(SELECT id FROM prebid_ids WHERE key='version');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('quote client price ignored',public.workspace_adopt_price('{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}','dddddddd-1111-4111-8111-111111111111','COTIZACION',999999,(SELECT id FROM prebid_ids WHERE key='quote_item'))=73);
SELECT pg_temp.reject('quote other product rejected',format('select public.workspace_adopt_price(''{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}'',''dddddddd-2222-4222-8222-222222222222'',''COTIZACION'',1,%L)',(SELECT id FROM prebid_ids WHERE key='quote_item')));
SELECT pg_temp.reject('quote wrong same tenant product rejected',format('select public.workspace_adopt_price(''{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}'',''dddddddd-3333-4333-8333-333333333333'',''COTIZACION'',1,%L)',(SELECT id FROM prebid_ids WHERE key='quote_item')));
SELECT pg_temp.reject('quote other tender rejected',format('select public.workspace_adopt_price(''{"kind":"TENDER","id":"cccccccc-3333-4333-8333-333333333333"}'',''dddddddd-1111-4111-8111-111111111111'',''COTIZACION'',1,%L)',(SELECT id FROM prebid_ids WHERE key='quote_item')));
SELECT pg_temp.reject('quote nonexistent rejected','select public.workspace_adopt_price(''{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}'',''dddddddd-1111-4111-8111-111111111111'',''COTIZACION'',1,''ffffffff-3333-4333-8333-333333333333'')');
RESET ROLE;
SELECT pg_temp.reject('original IFC storage immutable','delete from storage.objects where bucket_id=''bim-models'' and name=''tenders/cccccccc-1111-4111-8111-111111111111/rollback.ifc''');
SELECT set_config('request.jwt.claim.sub','',true);
SET LOCAL ROLE service_role;
SELECT pg_temp.reject('service without human cannot change tender budget',format('update public.budget_items set quantity=999 where id=%L',(SELECT id FROM prebid_ids WHERE key='budget')));
SELECT public.rfq_submit_version((SELECT token FROM public.rfq_providers WHERE id=(SELECT id FROM prebid_ids WHERE key='invitation')),
 jsonb_build_object('valid_until',now()+interval '7 days','freight',0,'payment_terms','30 days','budget_number','Q-2','currency','PYG','invoice_available',true,'vat_included',true),
 jsonb_build_array(jsonb_build_object('rfq_item_id',(SELECT id FROM prebid_ids WHERE key='rfq_item'),'precio_unitario',74,'available_quantity',20,'tax_rate',10,'lead_time_days',2)),
 'ffffffff-1111-4111-8111-111111111111',NULL);
SELECT pg_temp.check_true('supplier quote permit preserves no-session submission',(SELECT count(*)=2 FROM public.quote_versions WHERE quote_id IN (SELECT q.id FROM public.quotes q WHERE q.rfq_provider_id=(SELECT id FROM prebid_ids WHERE key='invitation'))));
RESET ROLE;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-1111-4111-8111-111111111111',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject('superseded quote version cannot be newly adopted',format('select public.workspace_adopt_price(''{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}'',''dddddddd-1111-4111-8111-111111111111'',''COTIZACION'',999,%L)',(SELECT id FROM prebid_ids WHERE key='quote_item')));
SELECT pg_temp.check_true('new supplier version does not auto adopt',(SELECT precio_unitario=73 FROM public.project_cost_prices WHERE tender_id='cccccccc-1111-4111-8111-111111111111'));
SELECT pg_temp.reject('stale presentation CAS','select public.prebid_save_version(''cccccccc-1111-4111-8111-111111111111'',true,''stale'',1460)');
INSERT INTO prebid_ids SELECT 'draft',(public.prebid_save_version('cccccccc-1111-4111-8111-111111111111',false,public.prebid_workspace('cccccccc-1111-4111-8111-111111111111')->>'hash',1460)->>'id')::uuid;
SELECT pg_temp.check_true('draft version does not freeze',(SELECT estado='BORRADOR' FROM public.licitacion_ofertas WHERE licitacion_id='cccccccc-1111-4111-8111-111111111111'));
INSERT INTO prebid_ids SELECT 'submitted',(public.prebid_save_version('cccccccc-1111-4111-8111-111111111111',true,public.prebid_workspace('cccccccc-1111-4111-8111-111111111111')->>'hash',1460)->>'id')::uuid;
SELECT pg_temp.check_true('canonical PRESENTADA',(SELECT estado='PRESENTADA' FROM public.licitacion_ofertas WHERE licitacion_id='cccccccc-1111-4111-8111-111111111111'));
SELECT pg_temp.check_true('snapshot contains quote provenance',(SELECT snapshot->'facts'->'prices'->0->>'quote_version_item_id'=(SELECT id::text FROM prebid_ids WHERE key='quote_item') FROM public.licitacion_oferta_versions WHERE id=(SELECT id FROM prebid_ids WHERE key='submitted')));
SELECT pg_temp.reject('submitted budget frozen',format('update public.budget_items set quantity=999 where id=%L',(SELECT id FROM prebid_ids WHERE key='budget')));
SELECT pg_temp.reject('submitted BIM frozen',format('update public.bim_elements set quantity_value=999 where id=%L',(SELECT id FROM prebid_ids WHERE key='element')));
SELECT pg_temp.reject('submitted RFQ frozen',format('update public.rfqs set observations=''changed'' where id=%L',(SELECT id FROM prebid_ids WHERE key='rfq')));
SELECT pg_temp.reject('submitted APU frozen','delete from public.budget_item_materials where tender_id=''cccccccc-1111-4111-8111-111111111111''');
SELECT pg_temp.reject('submitted price frozen','select public.workspace_adopt_price(''{"kind":"TENDER","id":"cccccccc-1111-4111-8111-111111111111"}'',''dddddddd-1111-4111-8111-111111111111'',''MANUAL'',99,null)');
SELECT pg_temp.reject('snapshot direct mutation rejected',format('update public.licitacion_oferta_versions set snapshot=''{}'' where id=%L',(SELECT id FROM prebid_ids WHERE key='submitted')));
SELECT pg_temp.reject('direct outcome bypass rejected','update public.licitacion_ofertas set estado=''GANADA'' where licitacion_id=''cccccccc-1111-4111-8111-111111111111''');
SELECT pg_temp.reject('legacy tender decision bypass rejected','update public.licitaciones set decision=''GANADA'' where id=''cccccccc-1111-4111-8111-111111111111''');
SELECT pg_temp.reject('award zero rejected','select public.prebid_record_outcome(''cccccccc-1111-4111-8111-111111111111'',''GANADA'',0)');
SELECT pg_temp.check_true('human award handoff ready',(public.prebid_record_outcome('cccccccc-1111-4111-8111-111111111111','GANADA',1500)->>'readyForProjectHandoff')::boolean);
SELECT pg_temp.check_true('winning snapshot preserved',(SELECT winning_version_id=submitted_version_id AND awarded_amount=1500 AND awarded_confirmed_by=auth.uid() FROM public.licitacion_ofertas WHERE licitacion_id='cccccccc-1111-4111-8111-111111111111'));
SELECT pg_temp.check_true('no project created',NOT EXISTS(SELECT 1 FROM public.projects WHERE empresa_id='bbbbbbbb-1111-4111-8111-111111111111'));
SELECT pg_temp.check_true('handoff exposes immutable winning baseline',(public.prebid_handoff_snapshot('cccccccc-1111-4111-8111-111111111111')->>'winningVersionId')::uuid=(SELECT id FROM prebid_ids WHERE key='submitted'));
SELECT pg_temp.check_true('handoff exposes confirmed award',(public.prebid_handoff_snapshot('cccccccc-1111-4111-8111-111111111111')->>'awardedAmount')::numeric=1500);
SELECT pg_temp.check_true('outcome retains competition and submitted source',(SELECT outcome_snapshot->>'estado'='GANADA' AND outcome_snapshot->>'submittedVersionId'=submitted_version_id::text AND outcome_snapshot->'competition' IS NOT NULL FROM public.licitacion_ofertas WHERE licitacion_id='cccccccc-1111-4111-8111-111111111111'));
SELECT pg_temp.check_true('rfq history never reparented',(SELECT project_id IS NULL AND tender_id='cccccccc-1111-4111-8111-111111111111' FROM public.rfqs WHERE id=(SELECT id FROM prebid_ids WHERE key='rfq')));
INSERT INTO public.budget_items(tender_id,code,description,quantity,unit) VALUES('cccccccc-3333-4333-8333-333333333333','1','Lost tender item',1,'u');
INSERT INTO public.budget_item_subcontracts(empresa_id,tender_id,budget_item_id,descripcion,precio_por_unidad)
 SELECT 'bbbbbbbb-1111-4111-8111-111111111111','cccccccc-3333-4333-8333-333333333333',id,'Subcontract',100 FROM public.budget_items WHERE tender_id='cccccccc-3333-4333-8333-333333333333';
SELECT public.prebid_save_version('cccccccc-3333-4333-8333-333333333333',true,public.prebid_workspace('cccccccc-3333-4333-8333-333333333333')->>'hash',100);
SELECT pg_temp.check_true('human loss no handoff',NOT (public.prebid_record_outcome('cccccccc-3333-4333-8333-333333333333','PERDIDA')->>'readyForProjectHandoff')::boolean);
SELECT pg_temp.check_true('lost snapshot preserved',(SELECT estado='PERDIDA' AND submitted_version_id IS NOT NULL AND winning_version_id IS NULL FROM public.licitacion_ofertas WHERE licitacion_id='cccccccc-3333-4333-8333-333333333333'));
SELECT pg_temp.reject('lost workspace immutable','delete from public.budget_items where tender_id=''cccccccc-3333-4333-8333-333333333333''');
SELECT pg_temp.reject('lost offer cannot provide project handoff','select public.prebid_handoff_snapshot(''cccccccc-3333-4333-8333-333333333333'')');
SELECT pg_temp.reject('outcome cannot be reversed','select public.prebid_record_outcome(''cccccccc-3333-4333-8333-333333333333'',''GANADA'',100)');
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-2222-4222-8222-222222222222',true);
SELECT pg_temp.check_true('other tenant cannot read budget',NOT EXISTS(SELECT 1 FROM public.budget_items WHERE tender_id='cccccccc-1111-4111-8111-111111111111'));
SELECT pg_temp.check_true('other tenant cannot read snapshots',NOT EXISTS(SELECT 1 FROM public.licitacion_oferta_versions WHERE tender_id='cccccccc-1111-4111-8111-111111111111'));
SELECT pg_temp.reject('other tenant cannot mark outcome','select public.prebid_record_outcome(''cccccccc-1111-4111-8111-111111111111'',''PERDIDA'')');
SELECT count(*) as assertions,bool_and(pass) as passed FROM prebid_test_results;
ROLLBACK;
