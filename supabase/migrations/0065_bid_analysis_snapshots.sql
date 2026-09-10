-- ==============================================================================
-- MIGRACIÓN 0065: BID ANALYSIS SNAPSHOTS (GATE 18)
-- Congelamiento inmutable append-only de corridas de análisis y decisiones comerciales:
-- Preserva fielmente el estado exacto de costos, pliegos, riesgos y simulación
-- al momento en que el usuario o el directorio tomó una decisión.
-- Cero recálculos silenciosos que alteren la historia.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.bid_analysis_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    tender_id TEXT NOT NULL,
    titulo_licitacion TEXT NOT NULL,
    convocante TEXT NOT NULL,
    decision TEXT NOT NULL CHECK (decision IN ('COMPETIR', 'REVISAR', 'NO_COMPETIR')),
    overall_score NUMERIC(5, 2) NOT NULL,
    monto_referencial_pyg NUMERIC(18, 2) NOT NULL,
    precio_oferta_recomendado_pyg NUMERIC(18, 2) NOT NULL,
    margen_neto_estimado_pct NUMERIC(6, 2) NOT NULL,
    probabilidad_ganar_pct NUMERIC(5, 2) NOT NULL,
    
    -- Snapshots inmutables de los inputs en formato JSONB
    compliance_snapshot JSONB NOT NULL,
    institution_snapshot JSONB NOT NULL,
    financial_snapshot JSONB NOT NULL,
    simulation_snapshot JSONB NOT NULL,
    pillars_snapshot JSONB NOT NULL,
    justifications JSONB DEFAULT '[]'::jsonb NOT NULL,
    blockers JSONB DEFAULT '[]'::jsonb NOT NULL,
    
    -- Hash criptográfico SHA-256 para garantizar inmutabilidad
    snapshot_hash TEXT NOT NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- RLS multi-tenant estricto
ALTER TABLE public.bid_analysis_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY bid_analysis_runs_tenant_isolation ON public.bid_analysis_runs
    FOR ALL
    USING (empresa_id = public.current_empresa_id())
    WITH CHECK (empresa_id = public.current_empresa_id());

-- Índices de consulta histórica
CREATE INDEX IF NOT EXISTS idx_bid_runs_empresa_tender 
    ON public.bid_analysis_runs (empresa_id, tender_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bid_runs_decision 
    ON public.bid_analysis_runs (empresa_id, decision, created_at DESC);

-- Trigger para bloquear updates y deletes (inmutabilidad estricta append-only)
CREATE OR REPLACE FUNCTION public.bloquear_modificacion_snapshot()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Los snapshots de análisis de licitación son estrictamente inmutables (append-only) y no pueden ser modificados ni eliminados.';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_bid_analysis_runs_inmutable
    BEFORE UPDATE OR DELETE ON public.bid_analysis_runs
    FOR EACH ROW
    EXECUTE FUNCTION public.bloquear_modificacion_snapshot();

COMMENT ON TABLE public.bid_analysis_runs IS 'Registro histórico inmutable append-only de análisis de decisión comercial (Gate 18)';
