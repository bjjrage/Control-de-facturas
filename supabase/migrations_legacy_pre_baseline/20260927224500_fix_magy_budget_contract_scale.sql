-- =============================================================================
-- 20260927224500_fix_magy_budget_contract_scale.sql
--
-- Corrección de datos de UNA obra (MAGY, Paquete 05 / ID 14 / SIPP 3458),
-- creada antes del fix de escala (commit 62d765c): el presupuesto quedó con
-- las cantidades de UNA vivienda (hoja base, 94.129.500 Gs) en vez de las del
-- contrato de 37 viviendas (3.482.791.500 Gs, hoja CERTIFICADO). Verificado
-- antes de aplicar: las 53 partidas están vinculadas a su línea del
-- Certificado N°6 y en TODAS qty_contractual = cantidad × 37, mismo precio.
--
-- Idempotente: solo toca partidas cuya cantidad ×37 es exactamente la
-- contractual del certificado (una segunda corrida ya no encuentra ninguna),
-- y el monto de contrato solo si sigue en el valor de una vivienda. En
-- cualquier otra base (sin esta obra) no hace nada.
-- =============================================================================

DO $$
DECLARE
  v_project uuid := '0ddd005f-434d-45be-ba86-75eac5edb4aa';
  v_certificate uuid := '3286eeed-69c0-4013-904c-03ded8e2d7a9';
  v_updated int;
  v_new_total numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id = v_project) THEN
    RETURN;
  END IF;

  UPDATE public.budget_items b
  SET quantity = ci.qty_contractual
  FROM public.project_certificate_items ci
  WHERE ci.certificate_id = v_certificate
    AND ci.budget_item_id = b.id
    AND b.project_id = v_project
    AND ci.precio_unitario = b.unit_price
    AND abs(ci.qty_contractual - b.quantity * 37) < 0.0001;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT sum(quantity * unit_price) INTO v_new_total FROM public.budget_items WHERE project_id = v_project;

  UPDATE public.projects
  SET budget_total = v_new_total, contract_amount = v_new_total
  WHERE id = v_project AND contract_amount = 94129500 AND v_new_total = 3482791500;

  IF v_updated > 0 THEN
    INSERT INTO public.audit_logs (actor_type, actor_label, action, empresa_id, detail)
    SELECT 'system', 'migración 20260927224500', 'project.budget_scale_corrected', p.empresa_id,
      jsonb_build_object(
        'project_id', v_project,
        'budget_items_updated', v_updated,
        'factor', 37,
        'budget_total_before', 94129500,
        'budget_total_after', v_new_total,
        'reason', 'Presupuesto importado a escala de una vivienda; el contrato es por 37 (verificado partida por partida contra el Certificado N°6).'
      )
    FROM public.projects p WHERE p.id = v_project;
  END IF;
END $$;
