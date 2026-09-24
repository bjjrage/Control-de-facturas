CREATE OR REPLACE FUNCTION public.enforce_manual_inventory_movement_contract()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_reason text;
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.movement_type = 'ADJUSTMENT' THEN
    v_reason := nullif(pg_catalog.btrim(NEW.metadata->>'reason'), '');
    IF v_reason IS NULL OR pg_catalog.char_length(v_reason) > 500 THEN
      RAISE EXCEPTION 'Los ajustes de inventario requieren un motivo de hasta 500 caracteres';
    END IF;
    NEW.metadata := pg_catalog.jsonb_set(
      coalesce(NEW.metadata, '{}'::jsonb),
      '{reason}',
      pg_catalog.to_jsonb(v_reason),
      true
    );
  END IF;

  IF v_actor IS NOT NULL
     AND NEW.movement_type IN ('TRANSFER', 'RETURN', 'ADJUSTMENT')
     AND NEW.source_type <> 'MANUAL' THEN
    RAISE EXCEPTION 'Los movimientos humanos deben registrarse con origen MANUAL';
  END IF;

  IF NEW.source_type = 'MANUAL'
     AND NEW.movement_type IN ('TRANSFER', 'RETURN', 'ADJUSTMENT') THEN
    IF NEW.source_id IS NULL OR NEW.source_line_id IS NOT NULL
       OR NEW.idempotency_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'Un movimiento manual necesita una clave UUID estable como origen';
    END IF;
    IF NEW.source_id IS DISTINCT FROM NEW.idempotency_key::uuid THEN
      RAISE EXCEPTION 'El origen manual debe coincidir con la clave de idempotencia';
    END IF;
    IF v_actor IS NOT NULL AND NEW.created_by IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'El creador del movimiento manual debe ser el usuario autenticado';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_manual_inventory_movement_contract()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_enforce_manual_inventory_movement_contract
  ON public.inventory_movements;
CREATE TRIGGER trg_enforce_manual_inventory_movement_contract
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_manual_inventory_movement_contract();

CREATE OR REPLACE FUNCTION public.require_fx_for_foreign_currency_inventory_adjustment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.movement_type = 'ADJUSTMENT'
     AND NEW.quantity > 0
     AND NEW.cost_currency IS NOT NULL
     AND NEW.cost_currency <> 'PYG'
     AND NEW.exchange_rate_to_company IS NULL THEN
    RAISE EXCEPTION 'El ajuste de entrada en moneda extranjera requiere tipo de cambio a PYG';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_fx_for_foreign_currency_inventory_adjustment()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_require_fx_for_foreign_currency_inventory_adjustment
  ON public.inventory_movements;
CREATE TRIGGER trg_require_fx_for_foreign_currency_inventory_adjustment
  BEFORE UPDATE OF cost_currency, exchange_rate_to_company ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.require_fx_for_foreign_currency_inventory_adjustment();

-- The low-level posting RPC is internal to the canonical receipt/submission
-- confirmers. Browser and agent callers can only use the restricted manual RPC.
REVOKE ALL ON FUNCTION public.inventory_post_movement(
  uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid, text, uuid, uuid,
  text, public.currency_code, numeric, numeric, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_post_movement(
  uuid, uuid, numeric, text, text, uuid, uuid, uuid, uuid, text, uuid, uuid,
  text, public.currency_code, numeric, numeric, uuid, jsonb
) TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_inventory_company_pro_plan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_plan text;
BEGIN
  IF auth.role() = 'service_role' OR v_actor IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.plan INTO v_plan
  FROM public.empresas e
  WHERE e.id = NEW.empresa_id;
  IF v_plan IS NULL OR v_plan NOT IN ('pro', 'caterpillar') THEN
    RAISE EXCEPTION 'Los movimientos canónicos de inventario requieren plan Pro';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_inventory_company_pro_plan()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_enforce_inventory_company_pro_plan
  ON public.inventory_movements;
CREATE TRIGGER trg_enforce_inventory_company_pro_plan
  BEFORE INSERT ON public.inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_inventory_company_pro_plan();

CREATE OR REPLACE FUNCTION public.inventory_post_manual_movement(
  p_empresa_id uuid,
  p_producto_id uuid,
  p_quantity numeric,
  p_unit text,
  p_movement_type text,
  p_from_location_id uuid DEFAULT NULL,
  p_to_location_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_cost_currency public.currency_code DEFAULT NULL,
  p_unit_cost numeric DEFAULT NULL,
  p_exchange_rate_to_company numeric DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan text;
  v_actor uuid := auth.uid();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    IF public.current_empresa_id() IS DISTINCT FROM p_empresa_id
       OR NOT public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]) THEN
      RAISE EXCEPTION 'Acceso denegado para registrar movimientos manuales';
    END IF;
    SELECT e.plan INTO v_plan
    FROM public.empresas e
    WHERE e.id = p_empresa_id;
    IF v_plan IS NULL OR v_plan NOT IN ('pro', 'caterpillar') THEN
      RAISE EXCEPTION 'Los movimientos canónicos de inventario requieren plan Pro';
    END IF;
    IF p_created_by IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'El creador del movimiento debe ser el usuario autenticado';
    END IF;
  END IF;

  IF upper(trim(p_movement_type)) NOT IN ('TRANSFER', 'RETURN', 'ADJUSTMENT') THEN
    RAISE EXCEPTION 'Este RPC solo admite transferencias, devoluciones y ajustes';
  END IF;
  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION 'El movimiento manual requiere una clave UUID estable';
  END IF;

  RETURN public.inventory_post_movement(
    p_empresa_id => p_empresa_id,
    p_producto_id => p_producto_id,
    p_quantity => p_quantity,
    p_unit => p_unit,
    p_movement_type => p_movement_type,
    p_from_location_id => p_from_location_id,
    p_to_location_id => p_to_location_id,
    p_project_id => p_project_id,
    p_source_type => 'MANUAL',
    p_source_id => p_idempotency_key::uuid,
    p_source_line_id => NULL,
    p_idempotency_key => p_idempotency_key,
    p_cost_currency => p_cost_currency,
    p_unit_cost => p_unit_cost,
    p_exchange_rate_to_company => p_exchange_rate_to_company,
    p_created_by => p_created_by,
    p_metadata => coalesce(p_metadata, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.inventory_post_manual_movement(
  uuid, uuid, numeric, text, text, uuid, uuid, uuid, text,
  public.currency_code, numeric, numeric, uuid, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.inventory_post_manual_movement(
  uuid, uuid, numeric, text, text, uuid, uuid, uuid, text,
  public.currency_code, numeric, numeric, uuid, jsonb
) TO authenticated, service_role;
