-- ============================================================================
-- 0088_planillas.sql
--
-- Motor de planilla embebida tipo Excel — sesiones de trabajo transversales
-- al ERP. Este batch solo agrega el adaptador de cómputo/presupuesto.
--
-- 1. budget_items.updated_at — no existía; es el mecanismo de concurrencia
--    (comparado contra planillas.base_versions al confirmar). Mismo patrón
--    set_updated_at() ya usado en invoices/otros (ver 0003_functions.sql).
-- 2. Tabla planillas: sesión + snapshot (borrador) + metadata de concurrencia.
--    NO es una segunda fuente de verdad de cómputo — solo persiste el
--    borrador mientras se edita; confirmar escribe en budget_items (la
--    fuente canónica) y ahí termina la vida útil de esa fila del snapshot.
-- 3. RPC planilla_confirmar_computo: único punto de escritura sobre
--    budget_items desde la planilla. Atómica (una función = una
--    transacción implícita), idempotente (estado 'confirmed' corta antes
--    de reaplicar), fail-closed en concurrencia (compara updated_at contra
--    base_versions, aborta con ERRCODE 'P0409' si alguna fila fuente
--    cambió desde que se abrió la planilla).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Concurrencia en budget_items
-- ---------------------------------------------------------------------------
ALTER TABLE public.budget_items
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DROP TRIGGER IF EXISTS trg_budget_items_updated_at ON public.budget_items;
CREATE TRIGGER trg_budget_items_updated_at
  BEFORE UPDATE ON public.budget_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Sesiones de planilla
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.planilla_estado AS ENUM ('draft', 'confirmed', 'cancelled');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.planillas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id    uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  usuario_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  modulo        text NOT NULL,
  -- Identifica el recurso de origen (ej. { "projectId": "..." }) — cada
  -- adaptador define su propia forma; el motor no interpreta este jsonb.
  contexto      jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- Borrador actual: { "rows": [ { "_rowId", "_version"?, ...campos } ] }.
  snapshot      jsonb NOT NULL DEFAULT '{"rows":[]}'::jsonb,
  -- Captura de updated_at por fila fuente al crear la planilla — base para
  -- detectar cambios concurrentes al confirmar. { [budget_item_id]: iso }.
  base_versions jsonb NOT NULL DEFAULT '{}'::jsonb,
  estado        public.planilla_estado NOT NULL DEFAULT 'draft',
  applied_result jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_at  timestamptz,
  confirmed_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_planillas_empresa_modulo
  ON public.planillas(empresa_id, modulo, estado);
CREATE INDEX IF NOT EXISTS idx_planillas_usuario
  ON public.planillas(usuario_id);

DROP TRIGGER IF EXISTS trg_planillas_updated_at ON public.planillas;
CREATE TRIGGER trg_planillas_updated_at
  BEFORE UPDATE ON public.planillas
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — mismo patrón que computo_imports/budget_items (0075/0028):
-- empresa_id = current_empresa_id() + is_internal_role. No hay política de
-- DELETE a propósito: una planilla se cancela (estado), no se borra.
-- ---------------------------------------------------------------------------
ALTER TABLE public.planillas ENABLE ROW LEVEL SECURITY;

CREATE POLICY planillas_select ON public.planillas
  FOR SELECT USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY planillas_insert ON public.planillas
  FOR INSERT WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY planillas_update ON public.planillas
  FOR UPDATE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]))
  WITH CHECK (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));

REVOKE ALL ON TABLE public.planillas FROM anon;

-- ---------------------------------------------------------------------------
-- 3. Confirmación atómica del adaptador cómputo/presupuesto
--
-- SECURITY INVOKER a propósito: las policies de budget_items (ya existentes,
-- 0028) siguen aplicando dentro de la función — administracion/admin,
-- proyecto de la empresa del invocador. La función agrega encima: aislamiento
-- de planilla, chequeo de estado, idempotencia y concurrencia por fila.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.planilla_confirmar_computo(p_planilla_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_empresa_id     uuid;
  v_planilla       record;
  v_project_id     uuid;
  v_row            jsonb;
  v_row_id         text;
  v_deleted        boolean;
  v_code           text;
  v_description    text;
  v_unit           text;
  v_quantity       numeric;
  v_unit_price     numeric;
  v_existing_id    uuid;
  v_base_updated   timestamptz;
  v_current_updated timestamptz;
  v_max_sort       integer;
  v_new_id         uuid;
  v_inserted       integer := 0;
  v_updated        integer := 0;
  v_deleted_count  integer := 0;
  v_code_to_id     jsonb := '{}'::jsonb;
  v_parent_code    text;
  v_parent_id      uuid;
  v_dot_idx        integer;
BEGIN
  v_empresa_id := public.current_empresa_id();
  IF v_empresa_id IS NULL THEN
    RAISE EXCEPTION 'No se pudo determinar la empresa del usuario autenticado.';
  END IF;

  -- Lock de fila: serializa doble-click / retries concurrentes sobre la
  -- MISMA planilla (el segundo espera al primero y luego ve estado ya
  -- 'confirmed', cortando por idempotencia más abajo).
  SELECT * INTO v_planilla
  FROM public.planillas
  WHERE id = p_planilla_id AND empresa_id = v_empresa_id
  FOR UPDATE;

  IF v_planilla IS NULL THEN
    RAISE EXCEPTION 'Planilla % no encontrada o sin permisos.', p_planilla_id;
  END IF;

  IF v_planilla.modulo <> 'computo_presupuesto' THEN
    RAISE EXCEPTION 'Esta función solo confirma planillas de cómputo/presupuesto.';
  END IF;

  -- Idempotencia: una planilla ya confirmada nunca se vuelve a aplicar.
  IF v_planilla.estado = 'confirmed' THEN
    RETURN jsonb_build_object(
      'already_confirmed', true,
      'planilla_id', v_planilla.id,
      'result', v_planilla.applied_result
    );
  END IF;

  IF v_planilla.estado = 'cancelled' THEN
    RAISE EXCEPTION 'La planilla % está cancelada y no puede confirmarse.', p_planilla_id;
  END IF;

  v_project_id := (v_planilla.contexto->>'projectId')::uuid;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'La planilla no tiene projectId en su contexto.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = v_project_id AND empresa_id = v_empresa_id
  ) THEN
    RAISE EXCEPTION 'Proyecto % no encontrado o no pertenece a la empresa.', v_project_id;
  END IF;

  -- ---- Paso 1: concurrencia + updates + deletes sobre filas existentes ----
  FOR v_row IN SELECT * FROM jsonb_array_elements(v_planilla.snapshot->'rows')
  LOOP
    v_row_id := v_row->>'_rowId';
    CONTINUE WHEN v_row_id IS NULL OR left(v_row_id, 4) = 'new:';

    v_existing_id := v_row_id::uuid;
    v_deleted := coalesce((v_row->>'_deleted')::boolean, false);

    SELECT updated_at INTO v_current_updated
    FROM public.budget_items
    WHERE id = v_existing_id AND project_id = v_project_id;

    v_base_updated := NULLIF(v_planilla.base_versions->>v_row_id, '')::timestamptz;

    IF v_current_updated IS NULL THEN
      -- La fila fuente ya no existe (otro usuario la borró desde que se
      -- abrió la planilla) — conflicto explícito, no hay nada que reconciliar.
      RAISE EXCEPTION 'CONFLICTO_CONCURRENCIA: la partida % ya no existe (fue eliminada).', v_row_id
        USING ERRCODE = 'P0409';
    END IF;

    IF v_base_updated IS NULL OR v_current_updated <> v_base_updated THEN
      RAISE EXCEPTION 'CONFLICTO_CONCURRENCIA: la partida % cambió desde que se abrió la planilla.', v_row_id
        USING ERRCODE = 'P0409';
    END IF;

    IF v_deleted THEN
      DELETE FROM public.budget_items WHERE id = v_existing_id AND project_id = v_project_id;
      v_deleted_count := v_deleted_count + 1;
    ELSE
      v_code        := v_row->>'code';
      v_description := v_row->>'description';
      v_unit        := NULLIF(v_row->>'unit', '');
      v_quantity    := NULLIF(v_row->>'quantity', '')::numeric;
      v_unit_price  := NULLIF(v_row->>'unit_price', '')::numeric;

      IF v_code IS NULL OR trim(v_code) = '' THEN
        RAISE EXCEPTION 'La partida % no puede quedar sin código.', v_row_id;
      END IF;
      IF v_description IS NULL OR trim(v_description) = '' THEN
        RAISE EXCEPTION 'La partida % no puede quedar sin descripción.', v_row_id;
      END IF;

      UPDATE public.budget_items
      SET code = v_code, description = v_description, unit = v_unit,
          quantity = v_quantity, unit_price = v_unit_price
      WHERE id = v_existing_id AND project_id = v_project_id;
      v_updated := v_updated + 1;

      v_code_to_id := v_code_to_id || jsonb_build_object(v_code, v_existing_id::text);
    END IF;
  END LOOP;

  -- ---- Paso 2: inserts de filas nuevas (parent_id por jerarquía de código,
  --      igual criterio que importBudgetItems: "1.1" cuelga de "1") ----
  SELECT coalesce(max(sort_order), 0) INTO v_max_sort
  FROM public.budget_items WHERE project_id = v_project_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_planilla.snapshot->'rows')
  LOOP
    v_row_id := v_row->>'_rowId';
    CONTINUE WHEN v_row_id IS NULL OR left(v_row_id, 4) <> 'new:';
    CONTINUE WHEN coalesce((v_row->>'_deleted')::boolean, false); -- fila nueva borrada antes de confirmar: no-op

    v_code        := v_row->>'code';
    v_description := v_row->>'description';
    v_unit        := NULLIF(v_row->>'unit', '');
    v_quantity    := NULLIF(v_row->>'quantity', '')::numeric;
    v_unit_price  := NULLIF(v_row->>'unit_price', '')::numeric;

    IF v_code IS NULL OR trim(v_code) = '' THEN
      RAISE EXCEPTION 'Una fila nueva no puede quedar sin código.';
    END IF;
    IF v_description IS NULL OR trim(v_description) = '' THEN
      RAISE EXCEPTION 'Una fila nueva no puede quedar sin descripción.';
    END IF;

    v_parent_id := NULL;
    v_dot_idx := length(v_code) - position('.' in reverse(v_code));
    IF position('.' in v_code) > 0 THEN
      v_parent_code := left(v_code, v_dot_idx);
      v_parent_id := NULLIF(v_code_to_id->>v_parent_code, '')::uuid;
      IF v_parent_id IS NULL THEN
        SELECT id INTO v_parent_id FROM public.budget_items
        WHERE project_id = v_project_id AND code = v_parent_code;
      END IF;
      -- Si el padre tampoco existe, la fila se inserta plana (parent_id
      -- NULL) en vez de fallar todo el confirm por un código huérfano.
    END IF;

    v_max_sort := v_max_sort + 1;
    INSERT INTO public.budget_items (
      project_id, parent_id, code, description, unit, quantity, unit_price, sort_order
    ) VALUES (
      v_project_id, v_parent_id, v_code, v_description, v_unit, v_quantity, v_unit_price, v_max_sort
    ) RETURNING id INTO v_new_id;
    v_inserted := v_inserted + 1;

    v_code_to_id := v_code_to_id || jsonb_build_object(v_code, v_new_id::text);
  END LOOP;

  UPDATE public.planillas
  SET estado = 'confirmed',
      confirmed_at = now(),
      confirmed_by = auth.uid(),
      applied_result = jsonb_build_object(
        'inserted', v_inserted, 'updated', v_updated, 'deleted', v_deleted_count
      )
  WHERE id = p_planilla_id;

  RETURN jsonb_build_object(
    'already_confirmed', false,
    'planilla_id', p_planilla_id,
    'result', jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'deleted', v_deleted_count)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.planilla_confirmar_computo(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.planilla_confirmar_computo(uuid) TO authenticated;
