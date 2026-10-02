-- This file is executed ONLY on the disposable loopback Supabase database.
-- Empty-table reads compile application-relevant columns without production data.
BEGIN;
DO $$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY[
 'empresas','projects','budget_items','rfqs','rfq_items','rfq_providers',
 'quotes','quote_versions','quote_version_items','project_cost_prices',
 'inventory_locations','project_weekly_plans','project_weather_forecast_snapshots',
 'certificate_workbooks','cuentas_financieras','cost_observations'
 ] LOOP
   IF to_regclass('public.'||name) IS NULL THEN RAISE EXCEPTION 'Missing representative relation: %', name; END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY[
 'update_updated_at_column','set_updated_at','save_weekly_plan_atomic',
 'inventory_post_movement','inventory_post_manual_movement',
 'select_and_authorize_offer_atomically','current_empresa_id','is_internal_role'
 ] LOOP
   IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname=name)
   THEN RAISE EXCEPTION 'Missing critical function: %',name; END IF;
 END LOOP;
 IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 1
 THEN RAISE EXCEPTION 'Expected baseline-only migration ledger'; END IF;
 IF (SELECT count(*) FROM public.empresas) <> 0
 THEN RAISE EXCEPTION 'Clean environment contains company data'; END IF;
END $$;
SELECT id, empresa_id, project_id, producto_id, precio_unitario, fuente, quote_version_item_id, updated_by, updated_at FROM public.project_cost_prices LIMIT 0;
SELECT id, precio_unitario, rfq_item_id, quote_version_id FROM public.quote_version_items LIMIT 0;
SELECT id, project_id, empresa_id FROM public.rfqs LIMIT 0;
SELECT id, empresa_id, project_id FROM public.project_weekly_plans LIMIT 0;
SELECT id, empresa_id, moneda_original, precio_unitario_original FROM public.cost_observations LIMIT 0;
CREATE TEMP TABLE baseline_trigger_probe(id integer PRIMARY KEY, updated_at timestamptz);
CREATE TRIGGER baseline_trigger_probe_updated BEFORE UPDATE ON baseline_trigger_probe FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO baseline_trigger_probe VALUES (1,NULL);
UPDATE baseline_trigger_probe SET id=1;
DO $$ BEGIN IF (SELECT updated_at IS NULL FROM baseline_trigger_probe WHERE id=1) THEN RAISE EXCEPTION 'Production timestamp trigger did not execute'; END IF; END $$;
ROLLBACK;
SELECT 'APP/DB SMOKE: PASS' AS result;

