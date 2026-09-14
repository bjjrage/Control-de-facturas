-- ============================================================================
-- 0087_weather_tables_append_only_privileges.sql
-- 1. Revoke ALL table privileges from 'anon' on:
--    - public.project_weather_forecast_batches
--    - public.project_weather_forecast_snapshots
-- 2. Restrict table privileges for 'authenticated' to strictly:
--    - SELECT
--    - INSERT
--    Revoking explicitly: UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
-- 3. Maintain administrative privileges for 'service_role'
-- ============================================================================

-- 1. Revoke ALL privileges from anon and PUBLIC
REVOKE ALL ON TABLE public.project_weather_forecast_batches FROM anon;
REVOKE ALL ON TABLE public.project_weather_forecast_snapshots FROM anon;
REVOKE ALL ON TABLE public.project_weather_forecast_batches FROM PUBLIC;
REVOKE ALL ON TABLE public.project_weather_forecast_snapshots FROM PUBLIC;

-- 2. Revoke destructive & unnecessary privileges from authenticated
REVOKE ALL ON TABLE public.project_weather_forecast_batches FROM authenticated;
REVOKE ALL ON TABLE public.project_weather_forecast_snapshots FROM authenticated;

-- Grant strictly SELECT and INSERT for append-only operations
GRANT SELECT, INSERT ON TABLE public.project_weather_forecast_batches TO authenticated;
GRANT SELECT, INSERT ON TABLE public.project_weather_forecast_snapshots TO authenticated;

-- 3. Maintain service_role capabilities
GRANT ALL ON TABLE public.project_weather_forecast_batches TO service_role;
GRANT ALL ON TABLE public.project_weather_forecast_snapshots TO service_role;
