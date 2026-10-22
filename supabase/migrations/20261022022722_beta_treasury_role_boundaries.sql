-- Preserve existing per-operation policies; add a role boundary that they cannot OR away.
DO $migration$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['cuentas_financieras','movimientos_tesoreria','gastos_recurrentes'] LOOP
    EXECUTE format('CREATE POLICY beta_treasury_internal_role ON public.%I AS RESTRICTIVE FOR ALL TO PUBLIC USING (empresa_id = (SELECT public.current_empresa_id()) AND (SELECT public.is_internal_role(ARRAY[''administracion'',''admin'']::public.user_role[]))) WITH CHECK (empresa_id = (SELECT public.current_empresa_id()) AND (SELECT public.is_internal_role(ARRAY[''administracion'',''admin'']::public.user_role[])))', relation_name);
  END LOOP;
END
$migration$;
