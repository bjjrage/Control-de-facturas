-- B09: ONLY xddlzgjwufskgasomval. Synthetic application fixtures roll back.
BEGIN;
CREATE TEMP TABLE b09_results(name text,pass boolean);
GRANT ALL ON b09_results TO authenticated;
CREATE FUNCTION pg_temp.check_true(name text,ok boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',name; END IF;
 INSERT INTO b09_results VALUES(name,true);
END $$;
CREATE FUNCTION pg_temp.reject(name text,statement text) RETURNS void LANGUAGE plpgsql AS $$ DECLARE rejected boolean:=false; BEGIN
 BEGIN EXECUTE statement; EXCEPTION WHEN OTHERS THEN rejected:=true; END;
 PERFORM pg_temp.check_true(name,rejected);
END $$;
INSERT INTO public.empresas(id,nombre,plan,modulo_compras,modulo_ventas) VALUES
 ('b0900000-0000-4000-8000-000000000001','B09 rollback tenant A','caterpillar',true,true),
 ('b0900000-0000-4000-8000-000000000002','B09 rollback tenant B','caterpillar',true,true);
INSERT INTO auth.users(id,email) VALUES
 ('a0900000-0000-4000-8000-000000000001','b09-a@example.invalid'),
 ('a0900000-0000-4000-8000-000000000002','b09-b@example.invalid');
INSERT INTO public.profiles(id,email,full_name,role,empresa_id) VALUES
 ('a0900000-0000-4000-8000-000000000001','b09-a@example.invalid','B09 admin A','admin','b0900000-0000-4000-8000-000000000001'),
 ('a0900000-0000-4000-8000-000000000002','b09-b@example.invalid','B09 admin B','admin','b0900000-0000-4000-8000-000000000002')
 ON CONFLICT(id) DO UPDATE SET role=excluded.role,empresa_id=excluded.empresa_id;
INSERT INTO public.projects(id,empresa_id,name,code) VALUES
 ('c0900000-0000-4000-8000-000000000001','b0900000-0000-4000-8000-000000000001','B09 A','B09-A'),
 ('c0900000-0000-4000-8000-000000000002','b0900000-0000-4000-8000-000000000002','B09 B','B09-B');
INSERT INTO public.productos(id,empresa_id,nombre,unidad,costo_promedio) VALUES
 ('d0900000-0000-4000-8000-000000000001','b0900000-0000-4000-8000-000000000001','B09 bricks','u',10);
INSERT INTO public.budget_items(id,project_id,code,description,unit,quantity,material_requirement) VALUES
 ('e0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','1','Wall','u',1000,'REQUIRES_BOM');
INSERT INTO public.budget_item_materials(empresa_id,project_id,budget_item_id,producto_id,cantidad_por_unidad_ejecutada) VALUES
 ('b0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001','e0900000-0000-4000-8000-000000000001','d0900000-0000-4000-8000-000000000001',1);
INSERT INTO public.project_weekly_plans(id,empresa_id,project_id,start_date,end_date,status)
 SELECT ('f0900000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'b0900000-0000-4000-8000-000000000001','c0900000-0000-4000-8000-000000000001',date '2026-10-03'+n*7,date '2026-10-09'+n*7,'DRAFT' FROM generate_series(0,14) n;
INSERT INTO public.project_weekly_plan_items(plan_id,budget_item_id,input_mode,input_value,target_quantity,unit)
 SELECT id,'e0900000-0000-4000-8000-000000000001','QUANTITY',10,10,'u' FROM public.project_weekly_plans WHERE empresa_id='b0900000-0000-4000-8000-000000000001';
CREATE TEMP TABLE b09_snapshot(data jsonb);
GRANT ALL ON b09_snapshot TO authenticated;
SELECT set_config('request.jwt.claim.sub','a0900000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
INSERT INTO b09_snapshot SELECT public.cashflow_read_sources('2026-10-03','2027-03-31');
SELECT pg_temp.check_true('tenant source',(SELECT data->>'empresa_id'='b0900000-0000-4000-8000-000000000001' FROM b09_snapshot));
SELECT pg_temp.check_true('one scoped project',(SELECT jsonb_array_length(data->'projects')=1 FROM b09_snapshot));
SELECT pg_temp.check_true('15 plans without cap',(SELECT jsonb_array_length(data->'planning'->0->'plans')=15 FROM b09_snapshot));
SELECT pg_temp.check_true('canonical BOM included',(SELECT jsonb_array_length(data->'planning'->0->'facts'->'bom')=1 FROM b09_snapshot));
SELECT pg_temp.check_true('saved targets included',(SELECT jsonb_array_length(data->'planning'->0->'plans'->0->'targets')=1 FROM b09_snapshot));
SELECT pg_temp.check_true('no project execution token exposed',(SELECT NOT (data->'projects'->0 ? 'execution_portal_token') FROM b09_snapshot));
SELECT pg_temp.reject('null range','select public.cashflow_read_sources(null,''2027-03-31'')');
SELECT pg_temp.reject('reversed range','select public.cashflow_read_sources(''2027-03-31'',''2026-10-03'')');
SELECT pg_temp.reject('unbounded range','select public.cashflow_read_sources(''2026-10-03'',''2030-01-01'')');
SELECT set_config('request.jwt.claim.sub','a0900000-0000-4000-8000-000000000002',true);
SELECT pg_temp.check_true('other tenant never sees A',(SELECT jsonb_array_length(public.cashflow_read_sources('2026-10-03','2027-03-31')->'planning')=0));
RESET ROLE;
UPDATE public.profiles SET active=false WHERE id='a0900000-0000-4000-8000-000000000001';
SELECT set_config('request.jwt.claim.sub','a0900000-0000-4000-8000-000000000001',true);
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject('inactive profile','select public.cashflow_read_sources(''2026-10-03'',''2027-03-31'')');
RESET ROLE;
UPDATE public.profiles SET active=true,role='comercial' WHERE id='a0900000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject('nonadministrative role','select public.cashflow_read_sources(''2026-10-03'',''2027-03-31'')');
RESET ROLE;
UPDATE public.profiles SET role='admin' WHERE id='a0900000-0000-4000-8000-000000000001';
UPDATE public.empresas SET active=false WHERE id='b0900000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
SELECT pg_temp.reject('inactive empresa','select public.cashflow_read_sources(''2026-10-03'',''2027-03-31'')');
RESET ROLE;
UPDATE public.empresas SET active=true WHERE id='b0900000-0000-4000-8000-000000000001';
SELECT pg_temp.check_true('anonymous cannot execute',NOT has_function_privilege('anon','public.cashflow_read_sources(date,date)','EXECUTE'));
SELECT pg_temp.check_true('base implementation cannot be invoked directly',NOT has_function_privilege('authenticated','public.cashflow_read_sources_base(date,date)','EXECUTE'));
SELECT pg_temp.check_true('actual receipts source explicit',(SELECT jsonb_typeof(public.cashflow_read_sources('2026-10-03','2027-03-31')->'receipts')='array'));
SELECT pg_temp.check_true('single stable snapshot',(SELECT provolatile='s' FROM pg_proc WHERE oid='public.cashflow_read_sources(date,date)'::regprocedure));
SELECT pg_temp.check_true('viewing never creates requirements',(SELECT count(*)=0 FROM public.weekly_plan_need_snapshots WHERE empresa_id='b0900000-0000-4000-8000-000000000001'));
SELECT jsonb_build_object('tests',(SELECT jsonb_agg(to_jsonb(t)) FROM b09_results t),'snapshot',(SELECT data FROM b09_snapshot)) AS result;
ROLLBACK;
