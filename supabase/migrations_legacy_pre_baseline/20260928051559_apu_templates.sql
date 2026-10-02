-- Plantillas de APU a nivel empresa: la receta que la constructora ya tiene
-- (materiales/mano de obra/equipo por tipo de ítem), cargada UNA VEZ y
-- reutilizable en cualquier obra, matcheando por descripción normalizada de
-- la partida contra el nombre de la plantilla.
-- Aplicada en producción el 2026-09-28 vía MCP; archivo agregado después
-- para reconciliar repo ↔ producción (mismo SQL, misma versión).

CREATE TABLE IF NOT EXISTS public.apu_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  codigo TEXT,
  nombre TEXT NOT NULL,
  unidad TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empresa_id, nombre)
);
ALTER TABLE public.apu_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apu_templates_empresa_isolation" ON public.apu_templates
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());
REVOKE ALL ON public.apu_templates FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apu_templates TO authenticated;

CREATE TABLE IF NOT EXISTS public.apu_template_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.apu_templates(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES public.productos(id) ON DELETE RESTRICT,
  cantidad_por_unidad_ejecutada NUMERIC(14,4) NOT NULL CHECK (cantidad_por_unidad_ejecutada > 0),
  desperdicio_pct NUMERIC(5,2) NOT NULL DEFAULT 0.00 CHECK (desperdicio_pct >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, producto_id)
);
CREATE INDEX IF NOT EXISTS idx_apu_template_materials_lookup ON public.apu_template_materials(template_id);
ALTER TABLE public.apu_template_materials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apu_template_materials_empresa_isolation" ON public.apu_template_materials
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());
REVOKE ALL ON public.apu_template_materials FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apu_template_materials TO authenticated;

CREATE TABLE IF NOT EXISTS public.apu_template_labor (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.apu_templates(id) ON DELETE CASCADE,
  rol TEXT NOT NULL,
  horas_por_unidad_ejecutada NUMERIC(14,4) NOT NULL CHECK (horas_por_unidad_ejecutada > 0),
  costo_hora NUMERIC(14,2) NOT NULL CHECK (costo_hora >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, rol)
);
CREATE INDEX IF NOT EXISTS idx_apu_template_labor_lookup ON public.apu_template_labor(template_id);
ALTER TABLE public.apu_template_labor ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apu_template_labor_empresa_isolation" ON public.apu_template_labor
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());
REVOKE ALL ON public.apu_template_labor FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apu_template_labor TO authenticated;

CREATE TABLE IF NOT EXISTS public.apu_template_equipment (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.apu_templates(id) ON DELETE CASCADE,
  tipo_equipo TEXT NOT NULL,
  horas_por_unidad_ejecutada NUMERIC(14,4) NOT NULL CHECK (horas_por_unidad_ejecutada > 0),
  costo_hora NUMERIC(14,2) NOT NULL CHECK (costo_hora >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_id, tipo_equipo)
);
CREATE INDEX IF NOT EXISTS idx_apu_template_equipment_lookup ON public.apu_template_equipment(template_id);
ALTER TABLE public.apu_template_equipment ENABLE ROW LEVEL SECURITY;
CREATE POLICY "apu_template_equipment_empresa_isolation" ON public.apu_template_equipment
  FOR ALL TO authenticated
  USING (empresa_id = public.current_empresa_id())
  WITH CHECK (empresa_id = public.current_empresa_id());
REVOKE ALL ON public.apu_template_equipment FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apu_template_equipment TO authenticated;
