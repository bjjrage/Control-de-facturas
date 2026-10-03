-- RFQ 2.0 final hardening. The six previously applied RFQ migrations stay immutable.
-- jsonb text is canonical for object keys; aggregate arrays are explicitly ordered
-- by provider/currency and item/version IDs in rfq_preview_orders.
BEGIN;

CREATE OR REPLACE FUNCTION public.rfq_preview_orders(p_allocation_id uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE p public.profiles:=private.rfq_actor(); r public.rfqs; a public.rfq_allocations; resolved jsonb; orders jsonb; hash text;
BEGIN
 SELECT * INTO a FROM public.rfq_allocations WHERE id=p_allocation_id AND empresa_id=p.empresa_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Asignación ajena'; END IF;
 SELECT * INTO r FROM public.rfqs WHERE id=a.rfq_id AND empresa_id=p.empresa_id FOR UPDATE;
 IF a.authorized_at IS NULL OR a.confirmed_at IS NOT NULL OR a.revision<>(SELECT max(revision) FROM public.rfq_allocations WHERE rfq_id=r.id) THEN RAISE EXCEPTION 'Asignación no autorizada/vigente'; END IF;
 resolved:=private.rfq_resolve_allocation(r,a.lines);
 IF resolved IS DISTINCT FROM a.lines THEN RAISE EXCEPTION 'Oferta cambió'; END IF;
 SELECT jsonb_agg(x.doc ORDER BY x.doc->>'provider_id',x.doc->>'currency') INTO orders FROM (
 SELECT jsonb_build_object('provider_id',l->>'provider_id','provider_name',max(l->>'provider_name'),'currency',l->>'currency',
  'quote_version_id',max(l->>'quote_version_id'),'vat_included',bool_and((l->>'vat_included')::boolean),
  'freight',max((l->>'freight')::numeric),'payment_terms',max(l->>'payment_terms'),'valid_until',min(l->>'valid_until'),
  'rfq_id',r.id,'allocation_id',a.id,'project_id',r.project_id,'items',jsonb_agg(l ORDER BY l->>'rfq_item_id',l->>'quote_version_item_id'),
  'line_total',sum((l->>'total')::numeric),'tax_total',sum((l->>'tax')::numeric),
  'total',sum((l->>'total')::numeric)+max((l->>'freight')::numeric)) AS doc
 FROM jsonb_array_elements(resolved) l GROUP BY l->>'provider_id',l->>'currency') x;
 IF orders IS NULL OR jsonb_typeof(orders)<>'array' THEN RAISE EXCEPTION 'Preview vacío/inválido'; END IF;
 hash:=encode(extensions.digest(convert_to(orders::text,'UTF8'),'sha256'),'hex');
 UPDATE public.rfq_allocations SET preview=orders,preview_hash=hash WHERE id=a.id;
 PERFORM private.rfq_audit(p.empresa_id,r.id,p.id,'rfq.orders.previewed',jsonb_build_object('allocation_id',a.id,'hash',hash));
 RETURN jsonb_build_object('allocationId',a.id,'hash',hash,'orders',orders);
END $$;

REVOKE ALL ON FUNCTION public.rfq_preview_orders(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.rfq_preview_orders(uuid) TO authenticated;
COMMENT ON FUNCTION public.rfq_preview_orders(uuid) IS
 'Builds and stores a deterministic RFQ order preview with SHA-256 over canonical jsonb text; rfq_confirm_orders recomputes this hash before writing orders.';

COMMIT;
