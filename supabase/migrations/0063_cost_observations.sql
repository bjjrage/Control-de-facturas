-- ==============================================================================
-- MIGRACIÓN 0063: OBSERVACIONES DE COSTO REAL & MOTOR DE COSTOS V1
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.cost_observations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    producto_id UUID REFERENCES public.materiales(id) ON DELETE SET NULL,
    project_id UUID REFERENCES public.proyectos(id) ON DELETE SET NULL,
    proveedor_id UUID REFERENCES public.proveedores(id) ON DELETE SET NULL,
    fuente TEXT NOT NULL CHECK (fuente IN ('FACTURA', 'RECEPCION', 'ORDEN_COMPRA', 'COTIZACION', 'MANUAL')),
    documento_id TEXT, -- ID de referencia a la factura, orden de compra, remisión o cotización
    descripcion_item TEXT NOT NULL,
    categoria_insumo TEXT DEFAULT 'MATERIAL' CHECK (categoria_insumo IN ('MATERIAL', 'MANO_OBRA', 'EQUIPO', 'SUBCONTRATO', 'COMBUSTIBLE', 'OTRO')),
    cantidad NUMERIC(15, 4) NOT NULL CHECK (cantidad > 0),
    unidad TEXT NOT NULL DEFAULT 'UN',
    precio_unitario NUMERIC(18, 4) NOT NULL CHECK (precio_unitario >= 0),
    moneda TEXT NOT NULL DEFAULT 'PYG' CHECK (moneda IN ('PYG', 'USD')),
    tipo_cambio NUMERIC(10, 4) DEFAULT 1.0, -- Factor multiplicador a PYG
    fecha_observacion DATE NOT NULL DEFAULT CURRENT_DATE,
    es_volatil BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Habilitar Row Level Security (RLS) estricto por tenant
ALTER TABLE public.cost_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY cost_observations_tenant_isolation ON public.cost_observations
    FOR ALL
    USING (empresa_id = public.current_empresa_id())
    WITH CHECK (empresa_id = public.current_empresa_id());

-- Índices de consulta rápida y análisis de series temporales
CREATE INDEX IF NOT EXISTS idx_cost_obs_empresa_producto_fecha 
    ON public.cost_observations (empresa_id, producto_id, fecha_observacion DESC);

CREATE INDEX IF NOT EXISTS idx_cost_obs_empresa_descripcion 
    ON public.cost_observations (empresa_id, descripcion_item, fecha_observacion DESC);

CREATE INDEX IF NOT EXISTS idx_cost_obs_empresa_fecha 
    ON public.cost_observations (empresa_id, fecha_observacion DESC);

CREATE INDEX IF NOT EXISTS idx_cost_obs_empresa_categoria 
    ON public.cost_observations (empresa_id, categoria_insumo, fecha_observacion DESC);

-- Trigger de updated_at
CREATE OR REPLACE TRIGGER trg_cost_observations_updated_at
    BEFORE UPDATE ON public.cost_observations
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.cost_observations IS 'Historial auditable de observaciones de costo real para el Cost Engine (Gate 5B)';
