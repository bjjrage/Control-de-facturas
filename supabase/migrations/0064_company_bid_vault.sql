-- ==============================================================================
-- MIGRACIÓN 0064: COMPANY BID VAULT (GATE 9)
-- Bóveda documental multi-tenant estructurada y versionada para licitaciones:
-- 1. Documentos legales (Estatutos, Poderes, RUC, Cédulas)
-- 2. Cumplimiento fiscal y seguridad social (DNIT, IPS, Constancia No Inhabilitado)
-- 3. Capacidad financiera (Balances auditados, Ratios, Líneas de crédito)
-- 4. Experiencia técnica de la empresa (Certificados de obras ejecutadas con montos y m2/km)
-- 5. Personal técnico clave (Títulos, Matrículas profesionales, CVs firmados)
-- 6. Maquinaria y equipos pesados (Títulos de propiedad, Contratos de leasing, Facturas)
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.company_bid_vault_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id UUID NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    categoria TEXT NOT NULL CHECK (categoria IN ('LEGAL', 'FISCAL', 'FINANCIERO', 'EXPERIENCIA', 'PERSONAL', 'MAQUINARIA', 'OTRO')),
    tipo_documento TEXT NOT NULL,
    titulo TEXT NOT NULL,
    descripcion TEXT,
    archivo_url TEXT,
    archivo_storage_path TEXT,
    archivo_nombre TEXT,
    archivo_mime_type TEXT,
    archivo_tamano_bytes BIGINT,
    
    -- Control de vigencia
    fecha_emision DATE,
    fecha_vencimiento DATE,
    es_vencible BOOLEAN DEFAULT false,
    
    -- Metadatos estructurados para matching automático de pliegos
    -- Ej: para EXPERIENCIA: { "monto_contrato": 12000000000, "km_pavimento": 25, "convocante": "MOPC" }
    -- Ej: para PERSONAL: { "profesion": "Ingeniero Civil", "anios_experiencia": 12, "matricula": "12345" }
    -- Ej: para MAQUINARIA: { "tipo": "Motoniveladora", "potencia_hp": 140, "anio": 2021, "chasis": "..." }
    metadatos JSONB DEFAULT '{}'::jsonb NOT NULL,
    
    -- Estados de validez
    estado TEXT NOT NULL DEFAULT 'VIGENTE' CHECK (estado IN ('VIGENTE', 'POR_VENCER', 'VENCIDO', 'EN_TRAMITE', 'OBSOLETO')),
    version INTEGER NOT NULL DEFAULT 1,
    documento_padre_id UUID REFERENCES public.company_bid_vault_items(id) ON DELETE SET NULL,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- RLS multi-tenant estricto
ALTER TABLE public.company_bid_vault_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY bid_vault_tenant_isolation ON public.company_bid_vault_items
    FOR ALL
    USING (empresa_id = public.current_empresa_id())
    WITH CHECK (empresa_id = public.current_empresa_id());

-- Índices de consulta rápida
CREATE INDEX IF NOT EXISTS idx_bid_vault_empresa_cat 
    ON public.company_bid_vault_items (empresa_id, categoria, estado);

CREATE INDEX IF NOT EXISTS idx_bid_vault_vencimiento 
    ON public.company_bid_vault_items (empresa_id, fecha_vencimiento);

CREATE INDEX IF NOT EXISTS idx_bid_vault_metadatos 
    ON public.company_bid_vault_items USING GIN (metadatos);

-- Trigger de updated_at
CREATE OR REPLACE TRIGGER trg_company_bid_vault_updated_at
    BEFORE UPDATE ON public.company_bid_vault_items
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Función para evaluar automáticamente el estado de vencimiento
CREATE OR REPLACE FUNCTION public.evaluar_estado_documento_boveda(
    p_fecha_vencimiento DATE,
    p_es_vencible BOOLEAN,
    p_dias_alerta INTEGER DEFAULT 30
) RETURNS TEXT AS $$
BEGIN
    IF NOT p_es_vencible OR p_fecha_vencimiento IS NULL THEN
        RETURN 'VIGENTE';
    END IF;

    IF p_fecha_vencimiento < CURRENT_DATE THEN
        RETURN 'VENCIDO';
    ELSIF p_fecha_vencimiento <= (CURRENT_DATE + p_dias_alerta) THEN
        RETURN 'POR_VENCER';
    ELSE
        RETURN 'VIGENTE';
    END IF;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
