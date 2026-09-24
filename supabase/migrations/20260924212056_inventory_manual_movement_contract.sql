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
