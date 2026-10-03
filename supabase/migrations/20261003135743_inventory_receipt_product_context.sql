-- Missing product linkage is nullable for historical drafts; never infer/backfill it.
ALTER TABLE public.oc_recepcion_items ADD COLUMN producto_id uuid REFERENCES public.productos(id) ON DELETE RESTRICT;
DROP VIEW public.oc_order_item_recibido;
ALTER TABLE public.oc_recepcion_items ALTER COLUMN cantidad_recibida TYPE numeric(20,4);
CREATE VIEW public.oc_order_item_recibido WITH (security_invoker=true) AS
SELECT ri.order_item_id,ri.empresa_id,sum(ri.cantidad_recibida) AS cantidad_recibida_total
FROM public.oc_recepcion_items ri JOIN public.oc_recepciones r ON r.id=ri.recepcion_id AND r.empresa_id=ri.empresa_id
WHERE r.status='CONFIRMED' GROUP BY ri.order_item_id,ri.empresa_id;
GRANT SELECT ON public.oc_order_item_recibido TO authenticated,service_role;
CREATE FUNCTION private.inventory_receipt_context_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.oc_recepciones; item public.authorized_order_items;
BEGIN
 SELECT * INTO r FROM public.oc_recepciones WHERE id=NEW.recepcion_id AND empresa_id=NEW.empresa_id;
 SELECT * INTO item FROM public.authorized_order_items WHERE id=NEW.order_item_id AND order_id=r.order_id AND empresa_id=NEW.empresa_id;
 IF r.id IS NULL OR item.id IS NULL THEN RAISE EXCEPTION 'Receipt line tenant/order mismatch'; END IF;
 IF NEW.cantidad_recibida IS NULL OR NEW.cantidad_recibida::text IN ('NaN','Infinity','-Infinity') OR NEW.cantidad_recibida<=0 THEN RAISE EXCEPTION 'Positive finite received quantity required'; END IF;
 IF NEW.producto_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.productos p WHERE p.id=NEW.producto_id AND p.empresa_id=NEW.empresa_id AND trim(p.unidad)=trim(item.unit)) THEN RAISE EXCEPTION 'Receipt product tenant/unit mismatch'; END IF;
 IF item.producto_id IS NOT NULL AND NEW.producto_id IS DISTINCT FROM item.producto_id THEN RAISE EXCEPTION 'Receipt product differs from ordered product'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.inventory_receipt_context_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER inventory_receipt_context_guard BEFORE INSERT OR UPDATE ON public.oc_recepcion_items FOR EACH ROW EXECUTE FUNCTION private.inventory_receipt_context_guard();

CREATE FUNCTION private.inventory_receipt_actor_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles p JOIN public.empresas e ON e.id=p.empresa_id WHERE p.id=NEW.created_by AND p.empresa_id=NEW.empresa_id AND p.active AND e.active AND p.role IN ('comercial','administracion','admin')) THEN RAISE EXCEPTION 'Active receipt actor required'; END IF;
 IF TG_OP='UPDATE' AND OLD.status='CONFIRMED' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Confirmed receipt immutable'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.inventory_receipt_actor_guard() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER inventory_receipt_actor_guard BEFORE INSERT OR UPDATE ON public.oc_recepciones FOR EACH ROW EXECUTE FUNCTION private.inventory_receipt_actor_guard();
DO $$
DECLARE d text;
BEGIN
 SELECT pg_get_functiondef(p.oid) INTO d FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='inventory_create_receipt';
 d:=replace(d,$needle$round((entry.item->>'cantidad_recibida')::numeric, 2)$needle$,$needle$(entry.item->>'cantidad_recibida')::numeric$needle$);
 d:=replace(d,$needle$OR lower(entry.item->>'cantidad_recibida') IN ('nan', 'infinity', '-infinity')$needle$, $needle$OR lower(entry.item->>'cantidad_recibida') IN ('nan', 'infinity', '-infinity') OR (entry.item->>'cantidad_recibida')::numeric <> round((entry.item->>'cantidad_recibida')::numeric,4)$needle$);
 EXECUTE d;
END $$;
