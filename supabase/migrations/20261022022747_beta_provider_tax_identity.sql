-- Historical duplicates remain linked to their original invoices/orders.
-- Only their internal index exemption is recorded; no business fields are changed.
ALTER TABLE public.providers ADD COLUMN tax_id_dedup_exempt boolean NOT NULL DEFAULT false;
WITH ranked AS (
  SELECT id,row_number() OVER (PARTITION BY empresa_id,regexp_replace(upper(tax_id),'[^A-Z0-9]','','g') ORDER BY created_at,id) AS position
  FROM public.providers WHERE nullif(regexp_replace(upper(tax_id),'[^A-Z0-9]','','g'),'') IS NOT NULL
)
UPDATE public.providers p SET tax_id_dedup_exempt=true FROM ranked r WHERE p.id=r.id AND r.position>1;

CREATE UNIQUE INDEX providers_empresa_tax_id_identity ON public.providers
(empresa_id,(regexp_replace(upper(tax_id),'[^A-Z0-9]','','g')))
WHERE NOT tax_id_dedup_exempt AND nullif(regexp_replace(upper(tax_id),'[^A-Z0-9]','','g'),'') IS NOT NULL;

CREATE FUNCTION private.beta_guard_provider_tax_identity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE identity_key text := nullif(regexp_replace(upper(NEW.tax_id),'[^A-Z0-9]','','g'),'');
BEGIN
  IF TG_OP='UPDATE' THEN
    IF NEW.empresa_id IS NOT DISTINCT FROM OLD.empresa_id AND identity_key IS NOT DISTINCT FROM nullif(regexp_replace(upper(OLD.tax_id),'[^A-Z0-9]','','g'),'') THEN
      -- A caller cannot grant itself an exemption; legacy non-identity edits remain possible.
      NEW.tax_id_dedup_exempt:=OLD.tax_id_dedup_exempt;
      RETURN NEW;
    END IF;
  END IF;
  NEW.tax_id_dedup_exempt:=false;
  IF identity_key IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.providers p WHERE p.empresa_id=NEW.empresa_id AND p.id IS DISTINCT FROM NEW.id
      AND regexp_replace(upper(p.tax_id),'[^A-Z0-9]','','g')=identity_key
  ) THEN
    RAISE EXCEPTION 'Ya existe un proveedor con ese RUC en esta empresa.' USING ERRCODE='23505',CONSTRAINT='providers_empresa_tax_id_identity';
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION private.beta_guard_provider_tax_identity() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER beta_provider_tax_identity BEFORE INSERT OR UPDATE ON public.providers
FOR EACH ROW EXECUTE FUNCTION private.beta_guard_provider_tax_identity();
