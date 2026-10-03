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

-- The production enum contains only the three allowed roles. A rollback-only
-- NULL role fixture tests a real same-tenant profile lacking any authorized role;
-- TypeScript tests additionally inject an unknown role. No enum/schema change persists.
ALTER TABLE public.profiles ALTER COLUMN role DROP NOT NULL;
CREATE TEMP TABLE prebid_hash(hash text);
GRANT ALL ON prebid_hash TO authenticated,service_role;
CREATE FUNCTION pg_temp.reject_42501(name text,statement text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN insufficient_privilege THEN rejected:=true; END;
 PERFORM pg_temp.check_true(name,rejected);
END $$;
INSERT INTO public.empresas(id,nombre,plan) VALUES
 ('bbbbbbbb-1111-4111-8111-111111111111','Batch04 rollback A','caterpillar'),
 ('bbbbbbbb-2222-4222-8222-222222222222','Batch04 rollback B','caterpillar');
INSERT INTO auth.users(id,email) VALUES
 ('aaaaaaaa-1111-4111-8111-111111111111','batch04-a@example.invalid'),
 ('aaaaaaaa-2222-4222-8222-222222222222','batch04-b@example.invalid'),
 ('aaaaaaaa-3333-4333-8333-333333333333','batch04-no-role@example.invalid');
INSERT INTO public.profiles(id,email,full_name,role,empresa_id) VALUES
 ('aaaaaaaa-1111-4111-8111-111111111111','batch04-a@example.invalid','Test A','admin','bbbbbbbb-1111-4111-8111-111111111111'),
 ('aaaaaaaa-2222-4222-8222-222222222222','batch04-b@example.invalid','Test B','admin','bbbbbbbb-2222-4222-8222-222222222222')
 ON CONFLICT(id) DO UPDATE SET empresa_id=excluded.empresa_id,role='admin';
INSERT INTO public.profiles(id,email,full_name,role,empresa_id)
 VALUES('aaaaaaaa-3333-4333-8333-333333333333','batch04-no-role@example.invalid','No commercial role',NULL,'bbbbbbbb-1111-4111-8111-111111111111');
INSERT INTO public.licitaciones(id,empresa_id,dncp_nro,ocid,titulo) VALUES
 ('cccccccc-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111','b04-a','b04-a','Tender A'),
 ('cccccccc-2222-4222-8222-222222222222','bbbbbbbb-2222-4222-8222-222222222222','b04-b','b04-b','Tender B'),
 ('cccccccc-3333-4333-8333-333333333333','bbbbbbbb-1111-4111-8111-111111111111','b04-lost','b04-lost','Tender lost'),
 ('cccccccc-4444-4444-8444-444444444444','bbbbbbbb-1111-4111-8111-111111111111','b04-new','b04-new','Tender unauthorized insert');
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
SELECT pg_temp.reject('draft direct GANADA bypass rejected','update public.licitaciones set decision=''GANADA'' where id=''cccccccc-1111-4111-8111-111111111111''');
SELECT pg_temp.reject('draft direct PERDIDA bypass rejected','update public.licitaciones set decision=''PERDIDA'' where id=''cccccccc-1111-4111-8111-111111111111''');
UPDATE public.licitaciones SET decision='EN_PREPARACION' WHERE id='cccccccc-1111-4111-8111-111111111111';
SELECT pg_temp.check_true('legacy commercial analysis preserved',(SELECT decision='EN_PREPARACION' FROM public.licitaciones WHERE id='cccccccc-1111-4111-8111-111111111111'));
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-3333-4333-8333-333333333333',true);
SELECT pg_temp.check_true('same tenant existing read policy preserved',(SELECT count(*)=2 FROM public.licitacion_ofertas WHERE empresa_id='bbbbbbbb-1111-4111-8111-111111111111'));
SELECT pg_temp.reject_42501('unauthorized same tenant cost settings','update public.licitacion_ofertas set cost_settings=''{"indirectPct":10,"generalPct":0,"financingPct":0,"riskPct":0,"marginPct":0}'' where licitacion_id=''cccccccc-1111-4111-8111-111111111111''');
SELECT pg_temp.reject_42501('unauthorized same tenant create offer','insert into public.licitacion_ofertas(licitacion_id,empresa_id,created_by) values(''cccccccc-4444-4444-8444-444444444444'',''bbbbbbbb-1111-4111-8111-111111111111'',''aaaaaaaa-3333-4333-8333-333333333333'')');
SELECT pg_temp.reject_42501('unauthorized same tenant delete draft','delete from public.licitacion_ofertas where licitacion_id=''cccccccc-1111-4111-8111-111111111111''');
SELECT pg_temp.reject_42501('unauthorized same tenant state','update public.licitacion_ofertas set estado=''GANADA'' where licitacion_id=''cccccccc-1111-4111-8111-111111111111''');
SELECT pg_temp.reject_42501('unauthorized same tenant outcome','select public.prebid_record_outcome(''cccccccc-1111-4111-8111-111111111111'',''GANADA'',1500)');
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-1111-4111-8111-111111111111',true);
SELECT pg_temp.check_true('compute import without project',public.prebid_import_computo('cccccccc-1111-4111-8111-111111111111')=1);
SELECT pg_temp.check_true('compute import idempotent',public.prebid_import_computo('cccccccc-1111-4111-8111-111111111111')=0);
INSERT INTO prebid_ids SELECT 'budget',id FROM public.budget_items WHERE tender_id='cccccccc-1111-4111-8111-111111111111';
SELECT pg_temp.check_true('budget has tender and no project',(SELECT project_id IS NULL FROM public.budget_items WHERE id=(SELECT id FROM prebid_ids WHERE key='budget')));
SELECT pg_temp.reject('cross tenant workspace','select public.prebid_workspace(''cccccccc-2222-4222-8222-222222222222'')');
SELECT pg_temp.reject('cross tenant compute import','select public.prebid_import_computo(''cccccccc-2222-4222-8222-222222222222'')');
SELECT pg_temp.reject('fake project owner','insert into public.budget_items(project_id,code,description) values(''cccccccc-1111-4111-8111-111111111111'',''fake'',''fake'')');
SELECT pg_temp.reject('material cross tenant rejected',format('insert into public.budget_item_materials(empresa_id,tender_id,budget_item_id,producto_id,cantidad_por_unidad_ejecutada) values(''bbbbbbbb-1111-4111-8111-111111111111'',''cccccccc-1111-4111-8111-111111111111'',%L,''dddddddd-2222-4222-8222-222222222222'',1)',(SELECT id FROM prebid_ids WHERE key='budget')));
-- V2 persistence accepts explicit modes and named concepts; V1 is restored
-- before the exact 1460 finalizer fixture, without touching archived snapshots.
UPDATE public.licitacion_ofertas SET cost_settings='{"schemaVersion":2,"indirect":{"mode":"FIXED","value":37},"financing":{"mode":"FIXED","value":11},"risk":{"mode":"FIXED","value":5},"generalItems":[{"id":"office","concept":"Oficina","mode":"FIXED","value":25},{"id":"insurance","concept":"Seguros","mode":"PERCENT","value":3}],"marginPct":20}' WHERE licitacion_id='cccccccc-1111-4111-8111-111111111111';
SELECT pg_temp.check_true('V2 settings persisted without flattening concepts',(SELECT cost_settings->'schemaVersion'='2'::jsonb AND jsonb_array_length(cost_settings->'generalItems')=2 FROM public.licitacion_ofertas WHERE licitacion_id='cccccccc-1111-4111-8111-111111111111'));
SELECT pg_temp.reject('invalid V2 null mode rejected','update public.licitacion_ofertas set cost_settings=jsonb_set(cost_settings,''{indirect,mode}'',''null'') where licitacion_id=''cccccccc-1111-4111-8111-111111111111''');
SELECT pg_temp.reject('invalid V2 percentage rejected','update public.licitacion_ofertas set cost_settings=jsonb_set(cost_settings,''{generalItems,1,value}'',''101'') where licitacion_id=''cccccccc-1111-4111-8111-111111111111''');
SELECT pg_temp.reject('invalid V2 empty concept rejected','update public.licitacion_ofertas set cost_settings=jsonb_set(cost_settings,''{generalItems,0,concept}'',''""'') where licitacion_id=''cccccccc-1111-4111-8111-111111111111''');
SELECT pg_temp.reject('invalid V2 duplicate ids rejected','update public.licitacion_ofertas set cost_settings=jsonb_set(cost_settings,''{generalItems,1,id}'',''"office"'') where licitacion_id=''cccccccc-1111-4111-8111-111111111111''');
UPDATE public.licitacion_ofertas SET cost_settings='{"indirectPct":0,"generalPct":0,"financingPct":0,"riskPct":0,"marginPct":0}' WHERE licitacion_id='cccccccc-1111-4111-8111-111111111111';
RESET ROLE;
UPDATE public.profiles SET active=false WHERE id='aaaaaaaa-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject_42501('inactive same tenant offer actor rejected','update public.licitacion_ofertas set monto_total=123 where licitacion_id=''cccccccc-1111-4111-8111-111111111111''');
RESET ROLE;
UPDATE public.profiles SET active=true WHERE id='aaaaaaaa-1111-4111-8111-111111111111';
UPDATE public.empresas SET active=false WHERE id='bbbbbbbb-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject_42501('inactive company offer actor rejected','update public.licitacion_ofertas set monto_total=123 where licitacion_id=''cccccccc-1111-4111-8111-111111111111''');
RESET ROLE;
UPDATE public.empresas SET active=true WHERE id='bbbbbbbb-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
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
SELECT pg_temp.check_true('unsafe browser finalizer ACL revoked',NOT has_function_privilege('authenticated','public.prebid_save_version(uuid,boolean,text,numeric)','EXECUTE'));
SELECT pg_temp.check_true('server finalizer ACL denies browser',NOT has_function_privilege('authenticated','public.prebid_commit_version(uuid,uuid,uuid,boolean,text,numeric)','EXECUTE'));
SELECT pg_temp.reject_42501('tampered offer 999999 with canonical facts 1460',format('select public.prebid_save_version(''cccccccc-1111-4111-8111-111111111111'',true,%L,999999)',public.prebid_workspace('cccccccc-1111-4111-8111-111111111111')->>'hash'));
SELECT pg_temp.reject_42501('browser cannot bypass via server RPC',format('select public.prebid_commit_version(''cccccccc-1111-4111-8111-111111111111'',''aaaaaaaa-1111-4111-8111-111111111111'',''bbbbbbbb-1111-4111-8111-111111111111'',true,%L,999999)',public.prebid_workspace('cccccccc-1111-4111-8111-111111111111')->>'hash'));
RESET ROLE;
INSERT INTO prebid_hash SELECT public.prebid_workspace('cccccccc-1111-4111-8111-111111111111')->>'hash';
SET LOCAL ROLE service_role;
SELECT pg_temp.reject('server finalizer stale CAS','select public.prebid_commit_version(''cccccccc-1111-4111-8111-111111111111'',''aaaaaaaa-1111-4111-8111-111111111111'',''bbbbbbbb-1111-4111-8111-111111111111'',true,''stale'',1460)');
SELECT pg_temp.reject_42501('server finalizer unauthorized actor',format('select public.prebid_commit_version(''cccccccc-1111-4111-8111-111111111111'',''aaaaaaaa-3333-4333-8333-333333333333'',''bbbbbbbb-1111-4111-8111-111111111111'',true,%L,1460)',(SELECT hash FROM prebid_hash)));
SELECT pg_temp.reject_42501('server finalizer wrong tenant actor',format('select public.prebid_commit_version(''cccccccc-1111-4111-8111-111111111111'',''aaaaaaaa-2222-4222-8222-222222222222'',''bbbbbbbb-2222-4222-8222-222222222222'',true,%L,1460)',(SELECT hash FROM prebid_hash)));
INSERT INTO prebid_ids SELECT 'draft',(public.prebid_commit_version('cccccccc-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111',false,(SELECT hash FROM prebid_hash),1460)->>'id')::uuid;
SELECT pg_temp.check_true('draft version does not freeze',(SELECT estado='BORRADOR' FROM public.licitacion_ofertas WHERE licitacion_id='cccccccc-1111-4111-8111-111111111111'));
INSERT INTO prebid_ids SELECT 'submitted',(public.prebid_commit_version('cccccccc-1111-4111-8111-111111111111','aaaaaaaa-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111',true,(SELECT hash FROM prebid_hash),1460)->>'id')::uuid;
SELECT pg_temp.check_true('exact canonical amount 1460 persists',(SELECT monto_total=1460 FROM public.licitacion_ofertas WHERE licitacion_id='cccccccc-1111-4111-8111-111111111111'));
RESET ROLE;
SET LOCAL ROLE authenticated;
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
RESET ROLE;
UPDATE prebid_hash SET hash=public.prebid_workspace('cccccccc-3333-4333-8333-333333333333')->>'hash';
SET LOCAL ROLE service_role;
SELECT public.prebid_commit_version('cccccccc-3333-4333-8333-333333333333','aaaaaaaa-1111-4111-8111-111111111111','bbbbbbbb-1111-4111-8111-111111111111',true,(SELECT hash FROM prebid_hash),100);
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('human loss no handoff',NOT (public.prebid_record_outcome('cccccccc-3333-4333-8333-333333333333','PERDIDA')->>'readyForProjectHandoff')::boolean);
SELECT pg_temp.check_true('lost snapshot preserved',(SELECT estado='PERDIDA' AND submitted_version_id IS NOT NULL AND winning_version_id IS NULL FROM public.licitacion_ofertas WHERE licitacion_id='cccccccc-3333-4333-8333-333333333333'));
SELECT pg_temp.reject('lost workspace immutable','delete from public.budget_items where tender_id=''cccccccc-3333-4333-8333-333333333333''');
SELECT pg_temp.reject('lost offer cannot provide project handoff','select public.prebid_handoff_snapshot(''cccccccc-3333-4333-8333-333333333333'')');
SELECT pg_temp.reject('outcome cannot be reversed','select public.prebid_record_outcome(''cccccccc-3333-4333-8333-333333333333'',''GANADA'',100)');

RESET ROLE;
CREATE FUNCTION pg_temp.handoff_missing_fact(t uuid,field text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE rejected boolean:=false;
BEGIN
 BEGIN
  INSERT INTO private.prebid_permits VALUES(txid_current(),t) ON CONFLICT DO NOTHING;
  IF field='award' THEN UPDATE public.licitacion_ofertas SET awarded_amount=NULL WHERE licitacion_id=t;
  ELSE UPDATE public.licitacion_ofertas SET winning_version_id=NULL WHERE licitacion_id=t; END IF;
  BEGIN PERFORM public.prebid_create_project(t,true); EXCEPTION WHEN OTHERS THEN rejected:=true; END;
  RAISE EXCEPTION USING ERRCODE='ZZ001';
 EXCEPTION WHEN SQLSTATE 'ZZ001' THEN NULL;
 END;
 RETURN rejected;
END $$;
SET LOCAL ROLE authenticated;
SELECT pg_temp.check_true('missing award rejected',pg_temp.handoff_missing_fact('cccccccc-1111-4111-8111-111111111111','award'));
SELECT pg_temp.check_true('missing winning snapshot rejected',pg_temp.handoff_missing_fact('cccccccc-1111-4111-8111-111111111111','winner'));
-- Batch06 human handoff, against the same actual submitted/awarded fixtures.
SELECT pg_temp.reject('handoff requires explicit human confirm','select public.prebid_create_project(''cccccccc-1111-4111-8111-111111111111'',false)');
SELECT pg_temp.reject('lost handoff rejected','select public.prebid_create_project(''cccccccc-3333-4333-8333-333333333333'',true)');
SELECT pg_temp.reject('missing offer/snapshot rejected','select public.prebid_create_project(''cccccccc-4444-4444-8444-444444444444'',true)');
INSERT INTO prebid_ids SELECT 'execution_project',(public.prebid_create_project('cccccccc-1111-4111-8111-111111111111',true)->>'project_id')::uuid;
SELECT pg_temp.check_true('handoff retry returns same project',(public.prebid_create_project('cccccccc-1111-4111-8111-111111111111',true)->>'project_id')::uuid=(SELECT id FROM prebid_ids WHERE key='execution_project'));
SELECT pg_temp.check_true('award is contractual authority',(SELECT contract_amount=1500 AND budget_total=1460 AND anticipo_pct IS NULL AND retencion_pct IS NULL AND iva_pct IS NULL FROM public.projects WHERE id=(SELECT id FROM prebid_ids WHERE key='execution_project')));
SELECT pg_temp.check_true('baseline equals winning snapshot',(SELECT b.winning_snapshot=v.snapshot AND b.snapshot_sha256=v.snapshot_sha256 AND b.awarded_amount=1500 FROM public.project_contract_baselines b JOIN public.licitacion_oferta_versions v ON v.id=b.winning_version_id WHERE b.project_id=(SELECT id FROM prebid_ids WHERE key='execution_project')));
SELECT pg_temp.check_true('copied budget factual quantities',(SELECT bool_and(e.quantity=t.quantity AND e.unit=t.unit AND e.description=t.description AND e.unit_price IS NOT DISTINCT FROM t.unit_price) FROM public.budget_items e JOIN public.budget_items t ON t.tender_id='cccccccc-1111-4111-8111-111111111111' AND t.code=e.code WHERE e.project_id=(SELECT id FROM prebid_ids WHERE key='execution_project')));
SELECT pg_temp.check_true('APU copied to project',(SELECT count(*)>0 FROM public.budget_item_materials WHERE project_id=(SELECT id FROM prebid_ids WHERE key='execution_project')));
SELECT pg_temp.check_true('adopted price retains original quote provenance',(SELECT precio_unitario=73 AND quote_version_item_id=(SELECT id FROM prebid_ids WHERE key='quote_item') FROM public.project_cost_prices WHERE project_id=(SELECT id FROM prebid_ids WHERE key='execution_project')));
SELECT pg_temp.check_true('no tender reparenting',(SELECT project_id IS NULL AND decision='GANADA' AND NOT coalesce(raw_json,'{}'::jsonb) ? 'obra_vinculada' FROM public.licitaciones WHERE id='cccccccc-1111-4111-8111-111111111111'));
SELECT pg_temp.check_true('no RFQ reparenting',(SELECT project_id IS NULL AND tender_id='cccccccc-1111-4111-8111-111111111111' FROM public.rfqs WHERE id=(SELECT id FROM prebid_ids WHERE key='rfq')));
SELECT pg_temp.check_true('no automatic procurement stock certificate forecast',NOT EXISTS(SELECT 1 FROM public.authorized_orders WHERE project_id=(SELECT id FROM prebid_ids WHERE key='execution_project')) AND NOT EXISTS(SELECT 1 FROM public.inventory_movements WHERE project_id=(SELECT id FROM prebid_ids WHERE key='execution_project')) AND NOT EXISTS(SELECT 1 FROM public.project_certificates WHERE project_id=(SELECT id FROM prebid_ids WHERE key='execution_project')));
SELECT pg_temp.reject('project origin immutable',format('update public.projects set source_tender_id=NULL where id=%L',(SELECT id FROM prebid_ids WHERE key='execution_project')));
SELECT pg_temp.reject('baseline mutation denied',format('update public.project_contract_baselines set awarded_amount=1 where project_id=%L',(SELECT id FROM prebid_ids WHERE key='execution_project')));
SELECT pg_temp.check_true('legacy budget-input bypass inaccessible',NOT has_function_privilege('authenticated','public.convertir_licitacion_a_proyecto_atomico(uuid,text,text,text,text,text,numeric,numeric,integer,numeric,numeric,date,date,text,uuid,uuid,jsonb,text)','EXECUTE'));
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-2222-4222-8222-222222222222',true);
SELECT pg_temp.check_true('other tenant cannot read budget',NOT EXISTS(SELECT 1 FROM public.budget_items WHERE tender_id='cccccccc-1111-4111-8111-111111111111'));
SELECT pg_temp.check_true('other tenant cannot read snapshots',NOT EXISTS(SELECT 1 FROM public.licitacion_oferta_versions WHERE tender_id='cccccccc-1111-4111-8111-111111111111'));
SELECT pg_temp.reject('other tenant cannot mark outcome','select public.prebid_record_outcome(''cccccccc-1111-4111-8111-111111111111'',''PERDIDA'')');
SELECT pg_temp.reject('foreign tenant handoff rejected','select public.prebid_create_project(''cccccccc-1111-4111-8111-111111111111'',true)');
SELECT pg_temp.check_true('foreign tenant baseline hidden',NOT EXISTS(SELECT 1 FROM public.project_contract_baselines));

-- Batch07 real execution boundaries, sharing the actual winning handoff fixture.
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-1111-4111-8111-111111111111',true);
CREATE TEMP TABLE execution_test_ids(key text PRIMARY KEY,id uuid); GRANT ALL ON execution_test_ids TO authenticated;
INSERT INTO execution_test_ids SELECT 'project',id FROM prebid_ids WHERE key='execution_project';
INSERT INTO execution_test_ids SELECT 'budget',id FROM public.budget_items WHERE project_id=(SELECT id FROM execution_test_ids WHERE key='project') ORDER BY sort_order LIMIT 1;
CREATE FUNCTION pg_temp.run_payload() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object(
 'horizon_days',7,'days_in_horizon',7,'start_date','2026-10-03','end_date','2026-10-09','currency','PYG',
 'total_projected_physical_value',0,'total_material_consumption_value',0,'total_additional_cash_required',0,
 'workable_days_count',0,'partially_blocked_days_count',0,'fully_blocked_days_count',0,'llm_analysis_used',false,
 'calendar_days_elapsed',0,'workable_days_elapsed',0,'rain_lost_days',0,'rain_effect_lost_days',0,'other_lost_days',0,
 'effective_available_days',0,'gross_schedule_variance',0,'weather_adjusted_variance',0, 'input_snapshot', jsonb_build_object('mode','PLANNING','projectId',(SELECT id FROM execution_test_ids WHERE key='project'),'startDate','2026-10-03','horizonDays',7)) $$;
CREATE FUNCTION pg_temp.item_payload(b uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_array(jsonb_build_object(
 'budget_item_id',b,'item_code','execution','item_description','Measured execution forecast','unit','m2',
 'remaining_quantity',10,'projected_quantity',1,'base_velocity_per_day',1,'effective_velocity_per_day',1,
 'workability_factor',1,'operational_status','NORMAL','materials_breakdown','[]'::jsonb)) $$;
INSERT INTO execution_test_ids SELECT 'run',public.execution_save_forecast((SELECT id FROM execution_test_ids WHERE key='project'),pg_temp.run_payload(),pg_temp.item_payload((SELECT id FROM execution_test_ids WHERE key='budget')));
SELECT pg_temp.check_true('forecast run and item persisted atomically',(SELECT count(*)=1 FROM public.project_progress_forecast_items WHERE run_id=(SELECT id FROM execution_test_ids WHERE key='run')));
SELECT pg_temp.check_true('forecast actor and tenant server owned',(SELECT created_by=auth.uid() AND empresa_id='bbbbbbbb-1111-4111-8111-111111111111' FROM public.project_progress_forecast_runs WHERE id=(SELECT id FROM execution_test_ids WHERE key='run')));
SELECT pg_temp.reject('forecast invalid item rolls back run',format('select public.execution_save_forecast(%L,pg_temp.run_payload(),pg_temp.item_payload(%L))',(SELECT id FROM execution_test_ids WHERE key='project'),'99999999-1111-4111-8111-111111111111'));
SELECT pg_temp.check_true('no orphan forecast after failed transaction',(SELECT count(*)=1 FROM public.project_progress_forecast_runs WHERE project_id=(SELECT id FROM execution_test_ids WHERE key='project')));
SELECT pg_temp.reject('forecast invalid date range',format('select public.execution_save_forecast(%L,pg_temp.run_payload()||''{"end_date":"2026-10-10"}'', ''[]'')',(SELECT id FROM execution_test_ids WHERE key='project')));
SELECT pg_temp.reject('forecast factor over one',format('select public.execution_save_forecast(%L,pg_temp.run_payload(),jsonb_set(pg_temp.item_payload(%L),''{0,workability_factor}'',''2''))',(SELECT id FROM execution_test_ids WHERE key='project'),(SELECT id FROM execution_test_ids WHERE key='budget')));
SELECT pg_temp.reject('forecast direct table bypass',format('insert into public.project_progress_forecast_runs(project_id,empresa_id,horizon_days,start_date,end_date,days_in_horizon) values(%L,%L,7,current_date,current_date+6,7)',(SELECT id FROM execution_test_ids WHERE key='project'),'bbbbbbbb-1111-4111-8111-111111111111'));
SELECT pg_temp.reject('forecast immutable',format('update public.project_progress_forecast_runs set total_additional_cash_required=1 where id=%L',(SELECT id FROM execution_test_ids WHERE key='run')));
SELECT pg_temp.check_true('forecast RPC anon denied',NOT has_function_privilege('anon','public.execution_save_forecast(uuid,jsonb,jsonb)','EXECUTE'));
-- Physical weather evidence. Automated observations remain proposals until a human confirms.
INSERT INTO public.climate_events(project_id,event_date,source,external_precipitation_mm,contract_threshold_mm,threshold_exceeded,status)
 SELECT id,current_date,'ROLLBACK_TEST',20,15,true,'PROPOSED' FROM execution_test_ids WHERE key='project';
INSERT INTO execution_test_ids SELECT 'event',id FROM public.climate_events WHERE project_id=(SELECT id FROM execution_test_ids WHERE key='project');
INSERT INTO public.project_workday_status(project_id,work_date,classification,source,decision_status,climate_event_id)
 SELECT (SELECT id FROM execution_test_ids WHERE key='project'),current_date,'NON_WORKABLE_RAIN','AUTOMATIC','PROPOSED',(SELECT id FROM execution_test_ids WHERE key='event');
INSERT INTO execution_test_ids SELECT 'workday',id FROM public.project_workday_status WHERE project_id=(SELECT id FROM execution_test_ids WHERE key='project');
UPDATE public.project_workday_status SET decision_status='CONFIRMED' WHERE id=(SELECT id FROM execution_test_ids WHERE key='workday');
SELECT pg_temp.check_true('workday human actor and timestamp',(SELECT confirmed_by=auth.uid() AND confirmed_at IS NOT NULL FROM public.project_workday_status WHERE id=(SELECT id FROM execution_test_ids WHERE key='workday')));
SELECT pg_temp.reject('automation cannot replace human decision',format('update public.project_workday_status set classification=''WORKABLE'' where id=%L',(SELECT id FROM execution_test_ids WHERE key='workday')));
SELECT pg_temp.reject('future workday rejected',format('insert into public.project_workday_status(project_id,work_date,classification,source,decision_status) values(%L,current_date+1,''WORKABLE'',''MANUAL'',''CONFIRMED'')',(SELECT id FROM execution_test_ids WHERE key='project')));
SELECT pg_temp.reject('unverified storage evidence rejected',format('insert into public.climate_evidence(project_id,climate_event_id,evidence_type,storage_bucket,storage_path) values(%L,%L,''RAIN_GAUGE_PHOTO'',''execution-photos'',%L)',(SELECT id FROM execution_test_ids WHERE key='project'),(SELECT id FROM execution_test_ids WHERE key='event'),(SELECT id::text||'/climate/missing.jpg' FROM execution_test_ids WHERE key='project')));
INSERT INTO public.climate_evidence(project_id,climate_event_id,evidence_type,uploaded_by) SELECT (SELECT id FROM execution_test_ids WHERE key='project'),id,'RESIDENT_NOTE',auth.uid() FROM execution_test_ids WHERE key='event';
SELECT pg_temp.reject('climate evidence append only','update public.climate_evidence set metadata=''{}''');
-- Register IFC atomically with scoped object provenance.
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name) SELECT 'bim-models',id::text||'/execution-test.ifc' FROM execution_test_ids WHERE key='project';
SET LOCAL ROLE authenticated;
INSERT INTO execution_test_ids SELECT 'model',public.workspace_register_bim(jsonb_build_object('kind','PROJECT','id',(SELECT id FROM execution_test_ids WHERE key='project')),'execution-test.ifc',(SELECT id::text||'/execution-test.ifc' FROM execution_test_ids WHERE key='project'),'IFC4',
 '[{"ifcGuid":"exec-wall","ifcType":"IfcWall","expressId":1,"quantityType":"area","quantityValue":4,"quantityUnit":"m2","quantitySource":"IFC_QTO","quantityProperty":"NetSideArea"}]');
INSERT INTO execution_test_ids SELECT 'element',id FROM public.bim_elements WHERE bim_model_id=(SELECT id FROM execution_test_ids WHERE key='model');
INSERT INTO public.bim_element_groups(bim_model_id,project_id,ifc_type,normalized_name,quantity_unit,total_quantity,element_count)
 SELECT (SELECT id FROM execution_test_ids WHERE key='model'),id,'IfcWall','Measured wall','m2',999,1 FROM execution_test_ids WHERE key='project';
INSERT INTO execution_test_ids SELECT 'group',id FROM public.bim_element_groups WHERE bim_model_id=(SELECT id FROM execution_test_ids WHERE key='model');
UPDATE public.bim_elements SET group_id=(SELECT id FROM execution_test_ids WHERE key='group') WHERE id=(SELECT id FROM execution_test_ids WHERE key='element');
SELECT public.execution_confirm_bim_group((SELECT id FROM execution_test_ids WHERE key='project'),(SELECT id FROM execution_test_ids WHERE key='group'),(SELECT id FROM execution_test_ids WHERE key='budget'),true,(SELECT updated_at FROM public.budget_items WHERE id=(SELECT id FROM execution_test_ids WHERE key='budget')));
SELECT pg_temp.check_true('group adopts factual element sum ignoring fake cached total',(SELECT quantity=4 FROM public.budget_items WHERE id=(SELECT id FROM execution_test_ids WHERE key='budget')));
SELECT pg_temp.check_true('single element match confirmed',(SELECT count(*)=1 FROM public.bim_budget_matches WHERE bim_element_id=(SELECT id FROM execution_test_ids WHERE key='element') AND status='CONFIRMADO'));
SELECT pg_temp.reject('confirmed group cannot be regroup deleted',format('delete from public.bim_element_groups where id=%L',(SELECT id FROM execution_test_ids WHERE key='group')));
SELECT pg_temp.reject('confirmed IFC model cannot be deleted',format('delete from public.bim_models where id=%L',(SELECT id FROM execution_test_ids WHERE key='model')));
SELECT pg_temp.reject('confirmed IFC measurement cannot be rewritten',format('update public.bim_elements set quantity_value=999 where id=%L',(SELECT id FROM execution_test_ids WHERE key='element')));
SELECT pg_temp.reject('stale budget CAS rejected',format('select public.workspace_apply_bim_quantity(jsonb_build_object(''kind'',''PROJECT'',''id'',%L),%L,ARRAY[%L]::uuid[],''2020-01-01''::timestamptz,4)',(SELECT id FROM execution_test_ids WHERE key='project'),(SELECT id FROM execution_test_ids WHERE key='budget'),(SELECT id FROM execution_test_ids WHERE key='element')));
SELECT pg_temp.reject('unknown schedule dependency rejected',format('update public.budget_items set depends_on=%L where id=%L','99999999-1111-4111-8111-111111111111',(SELECT id FROM execution_test_ids WHERE key='budget')));
SELECT pg_temp.reject('self dependency rejected',format('update public.budget_items set depends_on=id::text where id=%L',(SELECT id FROM execution_test_ids WHERE key='budget')));
SELECT pg_temp.reject('incomplete schedule dates rejected',format('update public.budget_items set start_date=current_date,end_date=NULL where id=%L',(SELECT id FROM execution_test_ids WHERE key='budget')));
SELECT pg_temp.check_true('winning baseline unchanged after execution edit',(SELECT b.snapshot_sha256=v.snapshot_sha256 AND b.winning_snapshot=v.snapshot FROM public.project_contract_baselines b JOIN public.licitacion_oferta_versions v ON v.id=b.winning_version_id WHERE b.project_id=(SELECT id FROM execution_test_ids WHERE key='project')));

INSERT INTO public.execution_entries(project_id,budget_item_id,entry_date,quantity_executed,recorded_by)
 SELECT (SELECT id FROM execution_test_ids WHERE key='project'),id,current_date,1,auth.uid() FROM execution_test_ids WHERE key='budget';
SELECT pg_temp.check_true('real execution accepted and scoped',(SELECT sum(quantity_executed)=1 FROM public.execution_entries WHERE project_id=(SELECT id FROM execution_test_ids WHERE key='project')));
SELECT pg_temp.reject('future execution rejected',format('insert into public.execution_entries(project_id,budget_item_id,entry_date,quantity_executed) values(%L,%L,current_date+1,1)',(SELECT id FROM execution_test_ids WHERE key='project'),(SELECT id FROM execution_test_ids WHERE key='budget')));
SELECT pg_temp.reject('negative execution rejected',format('insert into public.execution_entries(project_id,budget_item_id,entry_date,quantity_executed) values(%L,%L,current_date,-1)',(SELECT id FROM execution_test_ids WHERE key='project'),(SELECT id FROM execution_test_ids WHERE key='budget')));
SELECT pg_temp.reject('foreign budget actual execution rejected',format('insert into public.execution_entries(project_id,budget_item_id,entry_date,quantity_executed) values(%L,%L,current_date,1)',(SELECT id FROM execution_test_ids WHERE key='project'),(SELECT id FROM prebid_ids WHERE key='budget')));
SELECT pg_temp.reject('negative external rain rejected',format('update public.climate_events set external_precipitation_mm=-1 where id=%L',(SELECT id FROM execution_test_ids WHERE key='event')));
SELECT pg_temp.reject('fake photo reference rejected',format('update public.execution_entries set photo_paths=ARRAY[''other-project/fake.jpg''] where project_id=%L',(SELECT id FROM execution_test_ids WHERE key='project')));


RESET ROLE;
INSERT INTO public.bim_models(project_id,file_name,storage_path,status,element_count) SELECT id,'revision.ifc',id::text||'/revision.ifc','LISTO',1 FROM execution_test_ids WHERE key='project';
INSERT INTO execution_test_ids SELECT 'revision_model',id FROM public.bim_models WHERE file_name='revision.ifc' AND project_id=(SELECT id FROM execution_test_ids WHERE key='project');
INSERT INTO public.bim_elements(bim_model_id,project_id,ifc_guid,ifc_type,express_id,quantity_value,quantity_unit,quantity_source)
 SELECT (SELECT id FROM execution_test_ids WHERE key='revision_model'),id,'exec-wall','IfcWall',1,4,'m2','IFC_QTO' FROM execution_test_ids WHERE key='project';
INSERT INTO execution_test_ids SELECT 'revision_element',id FROM public.bim_elements WHERE bim_model_id=(SELECT id FROM execution_test_ids WHERE key='revision_model');
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject('duplicate physical GUID across revisions rejected',format('select public.workspace_apply_bim_quantity(jsonb_build_object(''kind'',''PROJECT'',''id'',%L),%L,ARRAY[%L,%L]::uuid[],%L,8)',(SELECT id FROM execution_test_ids WHERE key='project'),(SELECT id FROM execution_test_ids WHERE key='budget'),(SELECT id FROM execution_test_ids WHERE key='element'),(SELECT id FROM execution_test_ids WHERE key='revision_element'),(SELECT updated_at FROM public.budget_items WHERE id=(SELECT id FROM execution_test_ids WHERE key='budget'))));
SELECT pg_temp.check_true('duplicate model cannot change factual execution quantity',(SELECT quantity=4 FROM public.budget_items WHERE id=(SELECT id FROM execution_test_ids WHERE key='budget')));
SELECT pg_temp.check_true('forecast input hash server derived',(SELECT length(input_snapshot_sha256)=64 AND input_snapshot_sha256=encode(extensions.digest(input_snapshot::text,'sha256'),'hex') FROM public.project_progress_forecast_runs WHERE id=(SELECT id FROM execution_test_ids WHERE key='run')));
SELECT pg_temp.reject('confirmed workday deletion rejected',format('delete from public.project_workday_status where id=%L',(SELECT id FROM execution_test_ids WHERE key='workday')));
SELECT pg_temp.check_true('climate evidence actor server derived',(SELECT bool_and(uploaded_by=auth.uid()) FROM public.climate_evidence WHERE project_id=(SELECT id FROM execution_test_ids WHERE key='project')));
INSERT INTO public.budget_items(project_id,code,description,unit,quantity) SELECT id,'cycle-child','Cycle fixture','m2',1 FROM execution_test_ids WHERE key='project';
INSERT INTO execution_test_ids SELECT 'cycle',id FROM public.budget_items WHERE code='cycle-child' AND project_id=(SELECT id FROM execution_test_ids WHERE key='project');
UPDATE public.budget_items SET depends_on=(SELECT id::text FROM execution_test_ids WHERE key='cycle') WHERE id=(SELECT id FROM execution_test_ids WHERE key='budget');
SELECT pg_temp.reject('cyclic schedule rejected',format('update public.budget_items set depends_on=%L where id=%L',(SELECT id::text FROM execution_test_ids WHERE key='budget'),(SELECT id FROM execution_test_ids WHERE key='cycle')));
RESET ROLE;
UPDATE public.profiles SET active=false WHERE id='aaaaaaaa-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject('inactive actor forecast denied',format('select public.execution_save_forecast(%L,pg_temp.run_payload(),''[]'')',(SELECT id FROM execution_test_ids WHERE key='project')));
RESET ROLE;
UPDATE public.profiles SET active=true WHERE id='aaaaaaaa-1111-4111-8111-111111111111';
UPDATE public.empresas SET plan='pro' WHERE id='bbbbbbbb-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject('BIM plan bypass denied',format('select public.execution_confirm_bim_group(%L,%L,%L,false,NULL)',(SELECT id FROM execution_test_ids WHERE key='project'),(SELECT id FROM execution_test_ids WHERE key='group'),(SELECT id FROM execution_test_ids WHERE key='budget')));
RESET ROLE;
UPDATE public.empresas SET plan='caterpillar' WHERE id='bbbbbbbb-1111-4111-8111-111111111111';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-2222-4222-8222-222222222222',true);
SELECT pg_temp.reject('foreign tenant forecast RPC denied',format('select public.execution_save_forecast(%L,pg_temp.run_payload(),''[]'')',(SELECT id FROM execution_test_ids WHERE key='project')));
SELECT pg_temp.reject('foreign tenant BIM RPC denied',format('select public.execution_confirm_bim_group(%L,%L,%L,false,NULL)',(SELECT id FROM execution_test_ids WHERE key='project'),(SELECT id FROM execution_test_ids WHERE key='group'),(SELECT id FROM execution_test_ids WHERE key='budget')));
SELECT pg_temp.check_true('foreign climate and evidence hidden',NOT EXISTS(SELECT 1 FROM public.climate_events) AND NOT EXISTS(SELECT 1 FROM public.project_workday_status) AND NOT EXISTS(SELECT 1 FROM public.climate_evidence));
SELECT count(*) as assertions,bool_and(pass) as passed FROM prebid_test_results;
ROLLBACK;
