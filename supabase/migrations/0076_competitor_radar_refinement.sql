-- ===========================================================================
-- 0076_competitor_radar_refinement.sql
--
-- REFINAMIENTO DE RADAR DE COMPETIDORES:
-- 1. Tabla de exclusiones privadas de tenant (empresa_competitor_exclusions).
--    - Invariante de datos: NINGÚN dato de procurement_suppliers, bids, awards
--      o procesos se elimina.
--    - Exclusión por tenant: reversible, privada y protegida por RLS.
-- 2. Índices de aceleración para filtrado por período e id de proveedor.
-- 3. Función RPC set-based para paginación y agregación temporal consistente.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Tabla de exclusiones privadas por empresa
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.empresa_competitor_exclusions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.procurement_suppliers(id) ON DELETE CASCADE,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (empresa_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS idx_empresa_comp_excl_empresa
  ON public.empresa_competitor_exclusions(empresa_id);

CREATE INDEX IF NOT EXISTS idx_empresa_comp_excl_supplier
  ON public.empresa_competitor_exclusions(supplier_id);

-- RLS: Tenant Isolation
ALTER TABLE public.empresa_competitor_exclusions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "empresa_comp_excl_select" ON public.empresa_competitor_exclusions;
CREATE POLICY "empresa_comp_excl_select" ON public.empresa_competitor_exclusions
  FOR SELECT USING (empresa_id = public.current_empresa_id());

DROP POLICY IF EXISTS "empresa_comp_excl_insert" ON public.empresa_competitor_exclusions;
CREATE POLICY "empresa_comp_excl_insert" ON public.empresa_competitor_exclusions
  FOR INSERT WITH CHECK (empresa_id = public.current_empresa_id());

DROP POLICY IF EXISTS "empresa_comp_excl_delete" ON public.empresa_competitor_exclusions;
CREATE POLICY "empresa_comp_excl_delete" ON public.empresa_competitor_exclusions
  FOR DELETE USING (empresa_id = public.current_empresa_id());

-- ---------------------------------------------------------------------------
-- 2. Índices para acelerar el agrupamiento temporal en procurement_processes y bids
-- ---------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_proc_processes_pub_date
  ON public.procurement_processes (fecha_publicacion)
  WHERE fecha_publicacion IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_proc_awards_date_amount
  ON public.procurement_awards (supplier_id, fecha_adjudicacion, monto_adjudicado)
  WHERE supplier_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. RPC Set-Based de Radar con Métricas Reales por Período
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_competitor_radar_page(
  p_empresa_id UUID,
  p_months INT DEFAULT 24,            -- 0 = Todo el histórico
  p_min_bids INT DEFAULT 1,           -- >= 1, 3, 5, 10
  p_evidence TEXT DEFAULT 'CON_EVIDENCIA', -- 'CON_EVIDENCIA', 'ACTIVOS', 'TODOS'
  p_certainty TEXT DEFAULT 'TODAS',   -- 'TODAS', 'ALTA', 'MEDIA', 'BAJA', 'INSUFICIENTE'
  p_outcome TEXT DEFAULT 'TODOS',     -- 'TODOS', 'CON_ADJUDICACIONES', 'SIN_ADJUDICACIONES'
  p_include_excluded BOOLEAN DEFAULT FALSE,
  p_search TEXT DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cutoff_date TIMESTAMPTZ := NULL;
  v_total_historical BIGINT := 0;
  v_filtered_count BIGINT := 0;
  v_rows JSONB := '[]'::jsonb;
  v_search_clean TEXT := NULL;
BEGIN
  -- 1. Validar aislamiento tenant del caller
  IF auth.uid() IS NOT NULL THEN
    IF p_empresa_id IS NULL OR p_empresa_id IS DISTINCT FROM public.current_empresa_id() THEN
      RAISE EXCEPTION 'Acceso denegado: tenant mismatch';
    END IF;
  END IF;

  -- 2. Calcular fecha de corte
  IF p_months IS NOT NULL AND p_months > 0 THEN
    v_cutoff_date := now() - (p_months || ' months')::interval;
  END IF;

  -- 3. Limpieza de término de búsqueda
  IF p_search IS NOT NULL AND trim(p_search) <> '' THEN
    v_search_clean := '%' || trim(p_search) || '%';
  END IF;

  -- 4. Total de proveedores históricos globales
  SELECT count(*) INTO v_total_historical FROM public.procurement_suppliers;

  -- 5. Query set-based con CTEs para agregación fiel por período
  WITH
  -- Ofertas en el período seleccionado
  period_bids AS (
    SELECT
      b.supplier_id,
      b.process_id,
      b.monto_ofertado,
      (b.gano = true OR b.estado_oferta = 'GANADORA') AS gano,
      p.monto_referencial,
      p.fecha_publicacion
    FROM public.procurement_bids b
    JOIN public.procurement_processes p ON p.id = b.process_id
    WHERE (v_cutoff_date IS NULL OR p.fecha_publicacion >= v_cutoff_date)
  ),
  -- Métricas agregadas de ofertas por proveedor en el período
  bids_agg AS (
    SELECT
      supplier_id,
      count(*) AS total_bids,
      count(*) FILTER (WHERE gano) AS total_wins,
      coalesce(sum(monto_ofertado) FILTER (WHERE gano), 0) AS total_awarded_from_bids,
      round(avg(
        CASE
          WHEN monto_referencial > 0 AND monto_ofertado > 0 THEN
            ((monto_referencial - monto_ofertado) / monto_referencial) * 100
          ELSE NULL
        END
      ), 2) AS avg_discount_pct,
      max(fecha_publicacion) AS last_bid_at
    FROM period_bids
    GROUP BY supplier_id
  ),
  -- Adjudicaciones oficiales en el período
  period_awards AS (
    SELECT
      supplier_id,
      count(*) AS total_awards,
      coalesce(sum(monto_adjudicado), 0) AS total_awarded_amount,
      max(fecha_adjudicacion) AS last_award_at
    FROM public.procurement_awards
    WHERE supplier_id IS NOT NULL
      AND (v_cutoff_date IS NULL OR fecha_adjudicacion >= v_cutoff_date)
    GROUP BY supplier_id
  ),
  -- Exclusiones privadas del tenant
  tenant_exclusions AS (
    SELECT
      supplier_id,
      reason,
      created_at AS excluded_at
    FROM public.empresa_competitor_exclusions
    WHERE empresa_id = p_empresa_id
  ),
  -- Consolidación por proveedor
  consolidated AS (
    SELECT
      s.id AS supplier_id,
      s.nombre,
      s.ruc_clean,
      s.dv,
      s.tipo_entidad,
      s.tamano,
      coalesce(b.total_bids, 0) AS total_bids,
      coalesce(b.total_wins, 0) AS total_wins,
      CASE
        WHEN coalesce(b.total_bids, 0) > 0 THEN
          round((coalesce(b.total_wins, 0)::numeric / b.total_bids::numeric) * 100, 1)
        ELSE 0.0
      END AS win_rate_pct,
      -- Monto adjudicado: priorizar suma de awards oficiales; si es 0, suma de bids ganadas
      CASE
        WHEN coalesce(a.total_awarded_amount, 0) > 0 THEN a.total_awarded_amount
        ELSE coalesce(b.total_awarded_from_bids, 0)
      END AS total_awarded_amount,
      coalesce(b.avg_discount_pct, 0.0) AS avg_discount_pct,
      CASE
        WHEN coalesce(b.total_bids, 0) >= 15 THEN 'ALTA'
        WHEN coalesce(b.total_bids, 0) >= 5  THEN 'MEDIA'
        WHEN coalesce(b.total_bids, 0) >= 2  THEN 'BAJA'
        ELSE 'INSUFICIENTE'
      END AS certainty_tier,
      (e.supplier_id IS NOT NULL) AS is_excluded,
      e.reason AS exclusion_reason,
      e.excluded_at,
      greatest(b.last_bid_at, a.last_award_at) AS last_activity_at
    FROM public.procurement_suppliers s
    LEFT JOIN bids_agg b ON b.supplier_id = s.id
    LEFT JOIN period_awards a ON a.supplier_id = s.id
    LEFT JOIN tenant_exclusions e ON e.supplier_id = s.id
    WHERE
      -- Exclusión: si p_include_excluded es false, ocultar los excluidos
      (p_include_excluded OR e.supplier_id IS NULL)
      -- Búsqueda
      AND (
        v_search_clean IS NULL
        OR s.nombre ILIKE v_search_clean
        OR s.ruc_clean ILIKE v_search_clean
      )
      -- Filtro de Actividad / Evidencia
      AND (
        CASE p_evidence
          WHEN 'CON_EVIDENCIA' THEN (coalesce(b.total_bids, 0) > 0 OR coalesce(a.total_awards, 0) > 0)
          WHEN 'ACTIVOS' THEN (coalesce(b.total_bids, 0) > 0)
          ELSE TRUE
        END
      )
      -- Filtro de Ofertas Mínimas
      AND (coalesce(b.total_bids, 0) >= coalesce(p_min_bids, 0))
      -- Filtro de Certeza
      AND (
        p_certainty IS NULL
        OR p_certainty = 'TODAS'
        OR (
          CASE
            WHEN coalesce(b.total_bids, 0) >= 15 THEN 'ALTA'
            WHEN coalesce(b.total_bids, 0) >= 5  THEN 'MEDIA'
            WHEN coalesce(b.total_bids, 0) >= 2  THEN 'BAJA'
            ELSE 'INSUFICIENTE'
          END = p_certainty
        )
      )
      -- Filtro de Resultado
      AND (
        CASE p_outcome
          WHEN 'CON_ADJUDICACIONES' THEN (coalesce(b.total_wins, 0) > 0 OR coalesce(a.total_awards, 0) > 0)
          WHEN 'SIN_ADJUDICACIONES' THEN (coalesce(b.total_wins, 0) = 0 AND coalesce(a.total_awards, 0) = 0)
          ELSE TRUE
        END
      )
  )
  SELECT count(*) INTO v_filtered_count FROM consolidated;

  -- 6. Paginación y Serialización
  SELECT coalesce(jsonb_agg(r), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT *
    FROM consolidated
    ORDER BY total_bids DESC, total_awarded_amount DESC, nombre ASC
    LIMIT p_limit
    OFFSET p_offset
  ) r;

  RETURN jsonb_build_object(
    'total_historical', v_total_historical,
    'total_filtered', v_filtered_count,
    'limit', p_limit,
    'offset', p_offset,
    'competitors', v_rows
  );
END;
$$;
