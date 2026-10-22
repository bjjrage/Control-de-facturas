-- Keep legacy records intact. Reject new over-certification at every write path.
CREATE FUNCTION private.beta_guard_certificate_quantity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE project_key uuid; previous_quantity numeric := 0;
BEGIN
  SELECT project_id INTO project_key FROM public.project_certificates WHERE id=NEW.certificate_id FOR UPDATE;
  PERFORM id FROM public.projects WHERE id=project_key FOR UPDATE;
  IF NEW.budget_item_id IS NOT NULL THEN
    SELECT coalesce(sum(i.qty_presente),0) INTO previous_quantity
    FROM public.project_certificate_items i JOIN public.project_certificates c ON c.id=i.certificate_id
    WHERE c.project_id=project_key AND c.id<>NEW.certificate_id
      AND c.status::text IN ('ELABORADO','VERIFICADO','APROBADO','FACTURADO')
      AND i.budget_item_id=NEW.budget_item_id;
  END IF;
  IF NEW.qty_contractual IS NULL OR NEW.qty_anterior IS NULL OR NEW.qty_presente IS NULL
     OR NEW.qty_contractual::text IN ('NaN','Infinity','-Infinity')
     OR NEW.qty_anterior::text IN ('NaN','Infinity','-Infinity')
     OR NEW.qty_presente::text IN ('NaN','Infinity','-Infinity')
     OR NEW.qty_contractual<0 OR NEW.qty_anterior<0 OR NEW.qty_presente<0
     OR greatest(NEW.qty_anterior,previous_quantity)+NEW.qty_presente>NEW.qty_contractual THEN
    RAISE EXCEPTION 'El avance acumulado supera la cantidad contratada o contiene cantidades inválidas.' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.beta_guard_certificate_quantity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER beta_certificate_quantity BEFORE INSERT OR UPDATE OF qty_contractual,qty_anterior,qty_presente,budget_item_id
ON public.project_certificate_items FOR EACH ROW EXECUTE FUNCTION private.beta_guard_certificate_quantity();

CREATE FUNCTION private.beta_guard_certificate_submission() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $fn$
BEGIN
  IF NEW.status::text='ELABORADO' AND OLD.status IS DISTINCT FROM NEW.status THEN
    -- Serialize submissions from different drafts of the same project.
    PERFORM id FROM public.projects WHERE id=NEW.project_id FOR UPDATE;
    IF EXISTS (
      SELECT 1 FROM public.project_certificate_items i WHERE i.certificate_id=NEW.id AND (
        i.qty_anterior+i.qty_presente>i.qty_contractual OR
        greatest(i.qty_anterior,coalesce((
          SELECT sum(other_i.qty_presente)
          FROM public.project_certificate_items other_i JOIN public.project_certificates c ON c.id=other_i.certificate_id
          WHERE c.project_id=NEW.project_id AND c.id<>NEW.id
            AND c.status::text IN ('ELABORADO','VERIFICADO','APROBADO','FACTURADO')
            AND other_i.budget_item_id=i.budget_item_id
        ),0))+i.qty_presente>i.qty_contractual
      )
    ) THEN
      RAISE EXCEPTION 'No se puede elaborar: el avance acumulado supera la cantidad contratada.' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.beta_guard_certificate_submission() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER beta_certificate_submission BEFORE UPDATE OF status ON public.project_certificates
FOR EACH ROW EXECUTE FUNCTION private.beta_guard_certificate_submission();
