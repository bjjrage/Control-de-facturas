-- Extend the immutable B09 snapshot with existing actual sales cash facts.
ALTER FUNCTION public.cashflow_read_sources(date,date) RENAME TO cashflow_read_sources_base;
REVOKE ALL ON FUNCTION public.cashflow_read_sources_base(date,date) FROM PUBLIC,anon,authenticated;
CREATE FUNCTION public.cashflow_read_sources(p_from date,p_until date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; tenant uuid; actor public.profiles; company public.empresas;
BEGIN
 -- The base guard validates current active profile, role, tenant and horizon.
 result:=public.cashflow_read_sources_base(p_from,p_until);
 tenant:=(result->>'empresa_id')::uuid;
 SELECT * INTO actor FROM public.profiles WHERE id=auth.uid();
 SELECT * INTO company FROM public.empresas WHERE id=tenant;
 RETURN result||jsonb_build_object(
 'receipts',coalesce((SELECT jsonb_agg(to_jsonb(r)||jsonb_build_object('currency',d.currency,'project_id',p.id) ORDER BY r.id)
  FROM public.sales_receipts r JOIN public.sales_documents d ON d.id=r.sales_document_id AND d.empresa_id=tenant
  LEFT JOIN public.project_certificates c ON c.id=d.certificate_id
  LEFT JOIN public.projects p ON p.id=c.project_id AND p.empresa_id=tenant
  WHERE r.empresa_id=tenant AND (company.modulo_ventas OR actor.is_super_admin) AND r.reversed_at IS NULL),'[]'::jsonb),
 'movements',coalesce((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('currency',c.moneda) ORDER BY m.id)
  FROM public.movimientos_tesoreria m JOIN public.cuentas_financieras c ON c.id=m.cuenta_id AND c.empresa_id=tenant
  WHERE m.empresa_id=tenant AND (m.fecha BETWEEN p_from AND p_until OR m.payment_order_id IS NOT NULL OR m.sales_receipt_id IS NOT NULL)),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.cashflow_read_sources(date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cashflow_read_sources(date,date) TO authenticated;
COMMENT ON FUNCTION public.cashflow_read_sources(date,date) IS 'B09 guarded STABLE statement snapshot: planned, committed, actual. Receipts and treasury deduplicated by factual FK.';
