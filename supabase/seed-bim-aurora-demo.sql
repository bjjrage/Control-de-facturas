-- =============================================================================
-- seed-bim-aurora-demo.sql
--
-- Seed EXCLUSIVO para test/local — "Proyecto Demo — Edificio Aurora". NO es
-- parte de supabase/migrations (no se aplica en ningún deploy) y NO está
-- referenciado por supabase/config.toml [db.seed] (no corre automáticamente
-- en `supabase db reset`) — hay que ejecutarlo a mano, a propósito, contra
-- una instancia local (`npx supabase start`) o un branch de Supabase de
-- prueba. NUNCA ejecutar esto contra el proyecto cloud productivo.
--
--   npx supabase start
--   psql "$(npx supabase status -o env | grep DB_URL | cut -d= -f2- | tr -d '\"')" \
--     -f supabase/seed-bim-aurora-demo.sql
--
-- Crea (si no existen) una empresa demo, un proyecto de obra, y el catálogo
-- de costos de la tabla del batch de certificación LLM del módulo BIM. La
-- cantidad de cada rubro queda NULL a propósito: la cantidad debe provenir
-- del IFC subido (ver lib/bim/__tests__/fixtures/aurora-mixed-elements.ifc),
-- nunca precargada en el presupuesto.
-- =============================================================================

DO $$
DECLARE
  v_empresa_id uuid;
  v_project_id uuid;
BEGIN
  SELECT id INTO v_empresa_id FROM public.empresas WHERE nombre = 'Demo BIM Aurora' LIMIT 1;
  IF v_empresa_id IS NULL THEN
    INSERT INTO public.empresas (nombre, plan)
    VALUES ('Demo BIM Aurora', 'caterpillar')
    RETURNING id INTO v_empresa_id;
  END IF;

  SELECT id INTO v_project_id FROM public.projects WHERE empresa_id = v_empresa_id AND code = 'AURORA-DEMO' LIMIT 1;
  IF v_project_id IS NULL THEN
    INSERT INTO public.projects (empresa_id, name, code, client, status)
    VALUES (v_empresa_id, 'Proyecto Demo — Edificio Aurora', 'AURORA-DEMO', 'Cliente Demo', 'ACTIVO')
    RETURNING id INTO v_project_id;
  END IF;

  -- budget_items no tiene UNIQUE(project_id, code) en el schema (0028), así
  -- que la idempotencia se resuelve con NOT EXISTS en vez de ON CONFLICT.
  INSERT INTO public.budget_items (project_id, code, description, unit, quantity, unit_price, sort_order)
  SELECT v_project_id, v.code, v.description, v.unit, NULL, v.unit_price, v.sort_order
  FROM (VALUES
    ('EST-001', 'Hormigón estructural H30',            'm3', 780000, 1),
    ('EST-002', 'Hormigón estructural H40',            'm3', 860000, 2),
    ('EST-003', 'Acero CA-50',                         'kg',   7200, 3),
    ('ALB-001', 'Mampostería cerámica 15 cm',          'm2', 185000, 4),
    ('ALB-002', 'Mampostería cerámica 10 cm',          'm2', 162000, 5),
    ('ALB-003', 'Mampostería de ladrillo común 15 cm', 'm2', 198000, 6),
    ('TER-001', 'Revoque interior',                    'm2',  58000, 7),
    ('TER-002', 'Pintura interior látex',               'm2',  42000, 8),
    ('PIS-001', 'Piso porcelanato 60x60',               'm2', 235000, 9),
    ('PIS-002', 'Piso porcelanato 80x80',               'm2', 290000, 10),
    ('PIS-003', 'Piso cerámico',                        'm2', 145000, 11)
  ) AS v(code, description, unit, unit_price, sort_order)
  WHERE NOT EXISTS (
    SELECT 1 FROM public.budget_items b WHERE b.project_id = v_project_id AND b.code = v.code
  );

  RAISE NOTICE 'Proyecto Demo Aurora listo: empresa_id=%, project_id=%', v_empresa_id, v_project_id;
END $$;
