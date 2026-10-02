-- ============================================================================
-- 0089_planillas_grants_hardening.sql
--
-- 0088_planillas.sql solo revocó de `anon` (REVOKE ALL ON TABLE planillas
-- FROM anon); nunca tocó `PUBLIC` ni `authenticated`, así que ambos
-- conservaron los privilegios por defecto que Supabase otorga a las tablas
-- nuevas del schema public (incluye DELETE y TRUNCATE). RLS filtra filas en
-- SELECT/UPDATE/DELETE, pero TRUNCATE ignora RLS por completo — cualquier
-- usuario autenticado podía truncar la tabla de planillas de todas las
-- empresas. Mismo patrón de hardening ya aplicado en 0087 para las tablas
-- de weather forecast.
--
-- También: planilla_confirmar_computo quedó con EXECUTE para `anon`
-- (privilegio por defecto sobre funciones nuevas, nunca revocado
-- explícitamente — el REVOKE ALL ... FROM PUBLIC de 0088 no alcanza a
-- `anon` como rol propio).
-- ============================================================================

-- 1. Tabla planillas: revocar todo de anon/PUBLIC/authenticated y re-otorgar
--    solo lo necesario. Sin DELETE ni TRUNCATE para authenticated a
--    propósito (una planilla se cancela via estado, nunca se borra ni se
--    trunca — ver comentario de RLS en 0088).
REVOKE ALL ON TABLE public.planillas FROM anon;
REVOKE ALL ON TABLE public.planillas FROM PUBLIC;
REVOKE ALL ON TABLE public.planillas FROM authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.planillas TO authenticated;
GRANT ALL ON TABLE public.planillas TO service_role;

-- 2. RPC: revocar EXECUTE de anon explícitamente (REVOKE ALL FROM PUBLIC en
--    0088 no cubre el grant propio de anon sobre funciones nuevas).
REVOKE ALL ON FUNCTION public.planilla_confirmar_computo(uuid) FROM anon;
