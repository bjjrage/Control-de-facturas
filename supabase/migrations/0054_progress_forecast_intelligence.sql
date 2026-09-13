-- ============================================================================
-- 0054_progress_forecast_intelligence.sql
-- Inteligencia de Proyección de Avance de Obra + Materiales + Impacto Financiero
-- ============================================================================

-- 1. Coordenadas geográficas en projects para consulta meteorológica exacta
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS latitude NUMERIC(10, 7),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(10, 7);

-- 2. Lista de Materiales por Partida (Bill of Materials / APU desglosado)
CREATE TABLE IF NOT EXISTS budget_item_materials (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    budget_item_id UUID NOT NULL REFERENCES budget_items(id) ON DELETE CASCADE,
    producto_id UUID NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
    cantidad_por_unidad_ejecutada NUMERIC(14, 4) NOT NULL CHECK (cantidad_por_unidad_ejecutada > 0),
    desperdicio_pct NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (desperdicio_pct >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (budget_item_id, producto_id)
);

CREATE INDEX IF NOT EXISTS idx_budget_item_materials_lookup
  ON budget_item_materials(project_id, budget_item_id);

CREATE INDEX IF NOT EXISTS idx_budget_item_materials_producto
  ON budget_item_materials(producto_id);

-- Habilitar RLS en budget_item_materials
ALTER TABLE budget_item_materials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "budget_item_materials_empresa_isolation"
  ON budget_item_materials
  FOR ALL
  USING (empresa_id = current_setting('app.current_empresa_id', true)::uuid)
  WITH CHECK (empresa_id = current_setting('app.current_empresa_id', true)::uuid);

-- 3. Snapshots de Pronóstico Meteorológico diario por proyecto
CREATE TABLE IF NOT EXISTS project_weather_forecast_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    forecast_date DATE NOT NULL,
    precipitation_sum_mm NUMERIC(8, 2) NOT NULL DEFAULT 0,
    precipitation_hours NUMERIC(4, 1) NOT NULL DEFAULT 0,
    precipitation_probability_max INTEGER,
    wind_gusts_max_kmh NUMERIC(8, 2) NOT NULL DEFAULT 0,
    temperature_max_c NUMERIC(5, 1),
    temperature_min_c NUMERIC(5, 1),
    weather_code INTEGER,
    source TEXT NOT NULL DEFAULT 'open-meteo',
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (project_id, forecast_date)
);

CREATE INDEX IF NOT EXISTS idx_weather_forecast_snapshots_proj_date
  ON project_weather_forecast_snapshots(project_id, forecast_date);

ALTER TABLE project_weather_forecast_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "weather_forecast_snapshots_empresa_isolation"
  ON project_weather_forecast_snapshots
  FOR ALL
  USING (empresa_id = current_setting('app.current_empresa_id', true)::uuid)
  WITH CHECK (empresa_id = current_setting('app.current_empresa_id', true)::uuid);

-- 4. Cabecera de Corridas de Proyección de Avance
CREATE TABLE IF NOT EXISTS project_progress_forecast_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
    project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    horizon_days INTEGER NOT NULL CHECK (horizon_days > 0),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    total_projected_physical_value NUMERIC(16, 2) NOT NULL DEFAULT 0,
    total_material_consumption_value NUMERIC(16, 2) NOT NULL DEFAULT 0,
    total_additional_cash_required NUMERIC(16, 2) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'PYG',
    days_in_horizon INTEGER NOT NULL,
    workable_days_count NUMERIC(5, 2) NOT NULL DEFAULT 0,
    partially_blocked_days_count NUMERIC(5, 2) NOT NULL DEFAULT 0,
    fully_blocked_days_count NUMERIC(5, 2) NOT NULL DEFAULT 0,
    llm_analysis_used BOOLEAN NOT NULL DEFAULT false,
    llm_summary TEXT,
    created_by UUID REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_progress_forecast_runs_proj
  ON project_progress_forecast_runs(project_id, created_at DESC);

ALTER TABLE project_progress_forecast_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "progress_forecast_runs_empresa_isolation"
  ON project_progress_forecast_runs
  FOR ALL
  USING (empresa_id = current_setting('app.current_empresa_id', true)::uuid)
  WITH CHECK (empresa_id = current_setting('app.current_empresa_id', true)::uuid);

-- 5. Detalle de Proyección por Partida y Material
CREATE TABLE IF NOT EXISTS project_progress_forecast_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES project_progress_forecast_runs(id) ON DELETE CASCADE,
    budget_item_id UUID NOT NULL REFERENCES budget_items(id) ON DELETE CASCADE,
    item_code TEXT NOT NULL,
    item_description TEXT NOT NULL,
    unit TEXT NOT NULL,
    remaining_quantity NUMERIC(14, 4) NOT NULL DEFAULT 0,
    projected_quantity NUMERIC(14, 4) NOT NULL DEFAULT 0,
    base_velocity_per_day NUMERIC(14, 4) NOT NULL DEFAULT 0,
    effective_velocity_per_day NUMERIC(14, 4) NOT NULL DEFAULT 0,
    workability_factor NUMERIC(4, 3) NOT NULL DEFAULT 1.000,
    operational_status TEXT NOT NULL, -- 'NORMAL' | 'PARTIAL' | 'BLOCKED'
    operational_reasoning TEXT,
    materials_breakdown JSONB, -- Array de materiales: demanda, stock_disp, oc_inbound, deficit, costo, valor_consumo, caja_requerida
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_progress_forecast_items_run
  ON project_progress_forecast_items(run_id);

ALTER TABLE project_progress_forecast_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "progress_forecast_items_empresa_isolation"
  ON project_progress_forecast_items
  FOR ALL
  USING (
    run_id IN (
      SELECT id FROM project_progress_forecast_runs
      WHERE empresa_id = current_setting('app.current_empresa_id', true)::uuid
    )
  );
