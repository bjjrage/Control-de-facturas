-- B09: one READ-ONLY statement snapshot. No locks, refreshes or procurement writes.
CREATE FUNCTION public.cashflow_read_sources(p_from date, p_until date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.profiles; e public.empresas; result jsonb;
BEGIN
 SELECT * INTO a FROM public.profiles WHERE id=auth.uid() AND active;
 SELECT * INTO e FROM public.empresas WHERE id=a.empresa_id;
 IF a.id IS NULL OR coalesce(a.role::text,'') NOT IN ('administracion','admin') OR e.active IS DISTINCT FROM true THEN
  RAISE EXCEPTION 'Financial read denied' USING ERRCODE='42501';
 END IF;
 IF p_from IS NULL OR p_until IS NULL OR p_until<p_from OR p_until>p_from+730 THEN
  RAISE EXCEPTION 'Choose a financial window of at most 730 days';
 END IF;
 SELECT jsonb_build_object(
 'empresa_id',a.empresa_id,'read_at',statement_timestamp(),'from',p_from,'until',p_until,
 'accounts',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.id) FROM public.cuentas_financieras c WHERE c.empresa_id=a.empresa_id AND c.activo),'[]'::jsonb),
 'expenses',coalesce((SELECT jsonb_agg(to_jsonb(g) ORDER BY g.id) FROM public.gastos_recurrentes g WHERE g.empresa_id=a.empresa_id),'[]'::jsonb),
 'projects',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'empresa_id',p.empresa_id,'name',p.name,'code',p.code,'status',p.status,'comitente',p.comitente) ORDER BY p.id) FROM public.projects p WHERE p.empresa_id=a.empresa_id),'[]'::jsonb),
 'sales',coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id) FROM public.sales_documents d WHERE d.empresa_id=a.empresa_id AND (e.modulo_ventas OR a.is_super_admin) AND d.doc_type::text IN ('FACTURA','NOTA_VENTA') AND d.status::text IN ('EMITIDA','COBRADA_PARCIAL')),'[]'::jsonb),
 'certificates',coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('sales_documents',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'status',d.status)) FROM public.sales_documents d WHERE d.certificate_id=c.id AND d.empresa_id=a.empresa_id),'[]'::jsonb)) ORDER BY c.id) FROM public.project_certificates c JOIN public.projects p ON p.id=c.project_id WHERE p.empresa_id=a.empresa_id AND (e.modulo_ventas OR a.is_super_admin) AND c.status IN ('APROBADO','FACTURADO')),'[]'::jsonb),
 'orders',coalesce((SELECT jsonb_agg(to_jsonb(o)||jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(i)||jsonb_build_object('received',coalesce(r.cantidad_recibida_total,0)) ORDER BY i.id) FROM public.authorized_order_items i LEFT JOIN public.oc_order_item_recibido r ON r.order_item_id=i.id AND r.empresa_id=a.empresa_id WHERE i.order_id=o.id AND i.empresa_id=a.empresa_id),'[]'::jsonb)) ORDER BY o.id) FROM public.authorized_orders o WHERE o.empresa_id=a.empresa_id AND (e.modulo_compras OR a.is_super_admin)),'[]'::jsonb),
 'invoices',coalesce((SELECT jsonb_agg(to_jsonb(i) ORDER BY i.id) FROM public.invoices i WHERE i.empresa_id=a.empresa_id AND (e.modulo_compras OR a.is_super_admin)),'[]'::jsonb),
 'invoice_links',coalesce((SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id) FROM public.invoice_order_matches m JOIN public.invoices i ON i.id=m.invoice_id AND i.empresa_id=a.empresa_id JOIN public.authorized_orders o ON o.id=m.authorized_order_id AND o.empresa_id=a.empresa_id WHERE m.empresa_id=a.empresa_id AND (e.modulo_compras OR a.is_super_admin)),'[]'::jsonb),
 'payment_links',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.payment_order_invoices l JOIN public.invoices i ON i.id=l.invoice_id AND i.empresa_id=a.empresa_id JOIN public.payment_orders p ON p.id=l.payment_order_id AND p.empresa_id=a.empresa_id WHERE l.empresa_id=a.empresa_id AND (e.modulo_compras OR a.is_super_admin)),'[]'::jsonb),
 'payments',coalesce((SELECT jsonb_agg(to_jsonb(p) ORDER BY p.id) FROM public.payment_orders p WHERE p.empresa_id=a.empresa_id AND (e.modulo_compras OR a.is_super_admin)),'[]'::jsonb),
 'movements',coalesce((SELECT jsonb_agg(to_jsonb(m)||jsonb_build_object('currency',c.moneda) ORDER BY m.id) FROM public.movimientos_tesoreria m JOIN public.cuentas_financieras c ON c.id=m.cuenta_id AND c.empresa_id=a.empresa_id WHERE m.empresa_id=a.empresa_id AND (m.fecha BETWEEN p_from AND p_until OR m.payment_order_id IS NOT NULL)),'[]'::jsonb),
 'labor_payments',coalesce((SELECT jsonb_agg(to_jsonb(l) ORDER BY l.id) FROM public.labor_payments l JOIN public.projects p ON p.id=l.project_id AND p.empresa_id=a.empresa_id WHERE l.empresa_id=a.empresa_id AND (e.modulo_compras OR a.is_super_admin)),'[]'::jsonb),
 'subcontracts',coalesce((SELECT jsonb_agg((to_jsonb(c)-'public_token')||jsonb_build_object('certificates',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM public.subcontractor_certificates s WHERE s.contract_id=c.id AND s.project_id=c.project_id),'[]'::jsonb)) ORDER BY c.id) FROM public.subcontractor_contracts c JOIN public.projects p ON p.id=c.project_id AND p.empresa_id=a.empresa_id JOIN public.subcontractors s ON s.id=c.subcontractor_id AND s.empresa_id=a.empresa_id WHERE (e.modulo_compras OR a.is_super_admin)),'[]'::jsonb),
 'planning',coalesce((SELECT jsonb_agg(jsonb_build_object('project_id',p.id,'facts',private.weekly_plan_project_sources(p.id),'plans',coalesce((SELECT jsonb_agg(jsonb_build_object('plan',to_jsonb(w),'targets',coalesce((SELECT jsonb_agg(to_jsonb(t) ORDER BY t.position,t.created_at,t.id) FROM public.project_weekly_plan_items t WHERE t.plan_id=w.id),'[]'::jsonb)) ORDER BY w.start_date,w.id) FROM public.project_weekly_plans w WHERE w.project_id=p.id AND w.empresa_id=a.empresa_id AND w.status IN ('DRAFT','COMMITTED') AND w.start_date<=p_until AND w.end_date>=p_from-30),'[]'::jsonb)) ORDER BY p.id) FROM public.projects p WHERE p.empresa_id=a.empresa_id AND p.status IN ('ACTIVO','PAUSADO') AND (e.modulo_compras OR a.is_super_admin) AND (e.plan IN ('pro','caterpillar') OR a.is_super_admin) AND EXISTS(SELECT 1 FROM public.project_weekly_plans w WHERE w.project_id=p.id AND w.empresa_id=a.empresa_id AND w.status IN ('DRAFT','COMMITTED') AND w.start_date<=p_until AND w.end_date>=p_from-30)),'[]'::jsonb)
 ) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.cashflow_read_sources(date,date) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cashflow_read_sources(date,date) TO authenticated;
COMMENT ON FUNCTION public.cashflow_read_sources(date,date) IS 'B09 tenant/admin guarded read-only financial and canonical B08 source snapshot; no row limits or side effects.';
