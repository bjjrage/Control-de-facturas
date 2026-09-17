-- ============================================================================
-- 0094_budget_items_row_style.sql
--
-- Formato visual por fila para budget_items (negrita/alineación/color de
-- texto/color de resaltado), pedido explícito para que la planilla embebida
-- se sienta como Excel de verdad y no solo como datos crudos: poder marcar
-- en negrita las filas de encabezado de sección ("MOVIMIENTO DE SUELOS",
-- "FUNDACIONES", etc.).
--
-- Formato por FILA, no por celda — coincide con el caso de uso real (marcar
-- toda la fila de un título de sección) y evita un modelo de datos mucho más
-- pesado (estilo por celda individual) para un beneficio marginal.
-- ============================================================================

ALTER TABLE public.budget_items
  ADD COLUMN IF NOT EXISTS style jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.budget_items.style IS
  'Formato visual de la fila en la planilla embebida: {bold?: boolean, align?: "left"|"center"|"right", color?: string (hex), bg?: string (hex)}. Puramente presentacional, no afecta ningún cálculo.';

-- ---------------------------------------------------------------------------
-- Reemplaza planilla_confirmar_computo (0088) para que además lea/escriba
-- "style" en updates e inserts. Único cambio respecto a la versión anterior:
-- v_style + su uso en el UPDATE y el INSERT — el resto del cuerpo es idéntico
-- (misma atomicidad, idempotencia, chequeo de concurrencia y jerarquía por
-- código punteado).
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
  v_style          jsonb;
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
      v_style       := coalesce(v_row->'_style', '{}'::jsonb);

      IF v_code IS NULL OR trim(v_code) = '' THEN
        RAISE EXCEPTION 'La partida % no puede quedar sin código.', v_row_id;
      END IF;
      IF v_description IS NULL OR trim(v_description) = '' THEN
        RAISE EXCEPTION 'La partida % no puede quedar sin descripción.', v_row_id;
      END IF;

      UPDATE public.budget_items
      SET code = v_code, description = v_description, unit = v_unit,
          quantity = v_quantity, unit_price = v_unit_price, style = v_style
      WHERE id = v_existing_id AND project_id = v_project_id;
      v_updated := v_updated + 1;

      v_code_to_id := v_code_to_id || jsonb_build_object(v_code, v_existing_id::text);
    END IF;
  END LOOP;

  SELECT coalesce(max(sort_order), 0) INTO v_max_sort
  FROM public.budget_items WHERE project_id = v_project_id;

  FOR v_row IN SELECT * FROM jsonb_array_elements(v_planilla.snapshot->'rows')
  LOOP
    v_row_id := v_row->>'_rowId';
    CONTINUE WHEN v_row_id IS NULL OR left(v_row_id, 4) <> 'new:';
    CONTINUE WHEN coalesce((v_row->>'_deleted')::boolean, false);

    v_code        := v_row->>'code';
    v_description := v_row->>'description';
    v_unit        := NULLIF(v_row->>'unit', '');
    v_quantity    := NULLIF(v_row->>'quantity', '')::numeric;
    v_unit_price  := NULLIF(v_row->>'unit_price', '')::numeric;
    v_style       := coalesce(v_row->'_style', '{}'::jsonb);

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
    END IF;

    v_max_sort := v_max_sort + 1;
    INSERT INTO public.budget_items (
      project_id, parent_id, code, description, unit, quantity, unit_price, sort_order, style
    ) VALUES (
      v_project_id, v_parent_id, v_code, v_description, v_unit, v_quantity, v_unit_price, v_max_sort, v_style
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
