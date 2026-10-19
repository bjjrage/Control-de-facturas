-- #24: enforce matching tenants for manually adopted prices.
-- The single-column foreign keys do not establish tenant equality.
CREATE FUNCTION private.guard_project_cost_price_tenant()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = NEW.project_id AND p.empresa_id = NEW.empresa_id
  ) OR NOT EXISTS (
    SELECT 1 FROM public.productos p
    WHERE p.id = NEW.producto_id AND p.empresa_id = NEW.empresa_id
  ) THEN
    RAISE EXCEPTION 'La obra y el producto deben pertenecer a la misma empresa';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER guard_project_cost_price_tenant
  BEFORE INSERT OR UPDATE OF empresa_id, project_id, producto_id
  ON public.project_cost_prices
  FOR EACH ROW EXECUTE FUNCTION private.guard_project_cost_price_tenant();

REVOKE ALL ON FUNCTION private.guard_project_cost_price_tenant() FROM PUBLIC;
