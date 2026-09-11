-- ==============================================================================
-- MIGRACIÓN 0067: CANONICAL COST CONTRACT & COMPLETE CONTRACT HISTORY MODEL
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. CANONICAL COST_OBSERVATIONS CONTRACT & LEGACY DATA RECONCILIATION
-- ------------------------------------------------------------------------------

-- 1.1 Eliminar defaults peligrosos que inventan unidades, fechas o tasas
ALTER TABLE public.cost_observations 
  ALTER COLUMN unidad DROP DEFAULT,
  ALTER COLUMN fecha_observacion DROP DEFAULT,
  ALTER COLUMN tipo_cambio DROP DEFAULT;

-- 1.2 Añadir estado de evidencia auditable
ALTER TABLE public.cost_observations
  ADD COLUMN IF NOT EXISTS estado_evidencia TEXT NOT NULL DEFAULT 'VALIDA'
  CHECK (estado_evidencia IN ('VALIDA', 'REVISION_REQUERIDA', 'OBSOLETA', 'DESCARTADA'));

-- 1.3 Clasificación segura de filas preexistentes ANTES de aplicar restricciones
-- A. Filas en USD con tipo de cambio verificado: convertir a PYG canónico
UPDATE public.cost_observations
SET 
  precio_unitario = ROUND(precio_unitario * tipo_cambio),
  moneda = 'PYG',
  estado_evidencia = 'VALIDA'
WHERE moneda = 'USD' AND tipo_cambio IS NOT NULL AND tipo_cambio > 0;

-- B. Filas ambiguas (USD sin tipo de cambio verificado, o especificaciones corruptas)
UPDATE public.cost_observations
SET 
  moneda = 'PYG',
  estado_evidencia = 'REVISION_REQUERIDA'
WHERE (moneda <> 'PYG' AND (tipo_cambio IS NULL OR tipo_cambio <= 0))
   OR unidad IS NULL 
   OR trim(unidad) = ''
   OR cantidad IS NULL 
   OR cantidad <= 0
   OR precio_unitario < 0;

-- 1.4 Invariante de moneda canónica: siempre normalizada a PYG
ALTER TABLE public.cost_observations 
  DROP CONSTRAINT IF EXISTS cost_observations_moneda_check;

ALTER TABLE public.cost_observations 
  ADD CONSTRAINT cost_observations_moneda_check CHECK (moneda = 'PYG');

ALTER TABLE public.cost_observations 
  DROP CONSTRAINT IF EXISTS cost_observations_tipo_cambio_check;

ALTER TABLE public.cost_observations 
  ADD CONSTRAINT cost_observations_tipo_cambio_check CHECK (tipo_cambio IS NULL OR tipo_cambio > 0);

-- 1.5 Corrección y Preservación de Claves Foráneas Canónicas (productos, projects, providers)
DO $$ 
BEGIN
  -- Re-enlazar producto_id a public.productos(id)
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'cost_observations_producto_id_fkey') THEN
    ALTER TABLE public.cost_observations DROP CONSTRAINT cost_observations_producto_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'productos') THEN
    ALTER TABLE public.cost_observations 
      ADD CONSTRAINT cost_observations_producto_id_fkey 
      FOREIGN KEY (producto_id) REFERENCES public.productos(id) ON DELETE SET NULL;
  END IF;

  -- Re-enlazar project_id a public.projects(id)
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'cost_observations_project_id_fkey') THEN
    ALTER TABLE public.cost_observations DROP CONSTRAINT cost_observations_project_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'projects') THEN
    ALTER TABLE public.cost_observations 
      ADD CONSTRAINT cost_observations_project_id_fkey 
      FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
  END IF;

  -- Re-enlazar proveedor_id a public.providers(id)
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'cost_observations_proveedor_id_fkey') THEN
    ALTER TABLE public.cost_observations DROP CONSTRAINT cost_observations_proveedor_id_fkey;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'providers') THEN
    ALTER TABLE public.cost_observations 
      ADD CONSTRAINT cost_observations_proveedor_id_fkey 
      FOREIGN KEY (proveedor_id) REFERENCES public.providers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 2. RECONCILIACIÓN DEL ESQUEMA CANÓNICO DE PROCUREMENT_ITEMS
-- ------------------------------------------------------------------------------

-- Añadir únicamente la columna de identidad de origen mínima requerida para idempotencia
ALTER TABLE public.procurement_items
  ADD COLUMN IF NOT EXISTS item_dncp_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_proc_items_process_dncp_id 
  ON public.procurement_items(process_id, item_dncp_id)
  WHERE item_dncp_id IS NOT NULL;

-- ------------------------------------------------------------------------------
-- 3. TRAZABILIDAD ECONÓMICA DE CONTRATOS PÚBLICOS Y ADENDAS REALES DNCP
-- ------------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 3.1 Ampliar procurement_contracts
ALTER TABLE public.procurement_contracts
  ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'PYG',
  ADD COLUMN IF NOT EXISTS monto_contrato_original NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS monto_contrato_vigente NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS duracion_dias_original INTEGER,
  ADD COLUMN IF NOT EXISTS duracion_dias_vigente INTEGER,
  ADD COLUMN IF NOT EXISTS amendment_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_amendment_amount_delta NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS total_amendment_duration_delta_days INTEGER,
  ADD COLUMN IF NOT EXISTS has_unresolved_amendments BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_unresolved_amount BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_unresolved_duration BOOLEAN NOT NULL DEFAULT false;

-- Ampliar procurement_processes para metadatos de releases
ALTER TABLE public.procurement_processes
  ADD COLUMN IF NOT EXISTS releases_metadata JSONB;

-- Inicializar montos originales y vigentes existentes
UPDATE public.procurement_contracts
SET 
  monto_contrato_original = COALESCE(monto_contrato_original, monto_contrato),
  monto_contrato_vigente = COALESCE(monto_contrato_vigente, monto_contrato)
WHERE monto_contrato_original IS NULL OR monto_contrato_vigente IS NULL;

-- 3.2 Tabla canónica de Adendas y Modificaciones Contractuales (DNCP Real Model)
CREATE TABLE IF NOT EXISTS public.procurement_contract_amendments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id UUID REFERENCES public.procurement_contracts(id) ON DELETE CASCADE,
  process_id UUID NOT NULL REFERENCES public.procurement_processes(id) ON DELETE CASCADE,
  amendment_dncp_id TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN (
    'AMOUNT_INCREASE', 'AMOUNT_DECREASE', 'PRICE_ADJUSTMENT',
    'SCOPE_MODIFICATION', 'TERM_EXTENSION', 'TERM_REDUCTION',
    'OTHER', 'UNKNOWN'
  )),
  dncp_amendment_type_raw TEXT, -- Evidencia primaria oficial de la DNCP
  extends_contract_id TEXT,     -- Referencia a contrato original en releases de adenda
  dncp_contract_code TEXT,
  source_type TEXT NOT NULL DEFAULT 'EMBEDDED_AMENDMENT', -- 'EMBEDDED_AMENDMENT' | 'EXTENDS_CONTRACT'
  numero TEXT,
  fecha TIMESTAMPTZ,
  descripcion TEXT,
  moneda TEXT NOT NULL DEFAULT 'PYG',
  monto_previo NUMERIC(18,2),
  monto_delta NUMERIC(18,2), -- NULL si es desconocido / incalculable (UNKNOWN != DEFAULT 0)
  monto_posterior NUMERIC(18,2),
  duracion_prevista_dias_previo INTEGER,
  duracion_dias_delta INTEGER, -- NULL si es desconocido / incalculable (UNKNOWN != DEFAULT 0)
  duracion_prevista_dias_posterior INTEGER,
  financial_code TEXT,
  is_orphan BOOLEAN NOT NULL DEFAULT false,
  source_release_info JSONB,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (process_id, amendment_dncp_id)
);

ALTER TABLE public.procurement_contract_amendments
  ADD COLUMN IF NOT EXISTS moneda TEXT NOT NULL DEFAULT 'PYG',
  ADD COLUMN IF NOT EXISTS is_orphan BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.procurement_contract_amendments
  ALTER COLUMN contract_id DROP NOT NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'procurement_contract_amendments' AND constraint_name = 'procurement_contract_amendments_contract_id_amendment_dnc_key') THEN
    ALTER TABLE public.procurement_contract_amendments DROP CONSTRAINT procurement_contract_amendments_contract_id_amendment_dnc_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'procurement_contract_amendments' AND constraint_name = 'proc_amendments_proc_amend_dncp_key') THEN
    ALTER TABLE public.procurement_contract_amendments ADD CONSTRAINT proc_amendments_proc_amend_dncp_key UNIQUE (process_id, amendment_dncp_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_proc_amendments_contract ON public.procurement_contract_amendments(contract_id);
CREATE INDEX IF NOT EXISTS idx_proc_amendments_process ON public.procurement_contract_amendments(process_id);
CREATE INDEX IF NOT EXISTS idx_proc_amendments_extends ON public.procurement_contract_amendments(extends_contract_id) WHERE extends_contract_id IS NOT NULL;

-- Tablas relacionales para múltiples proveedores en Adjudicaciones y Contratos (Consorcios)
CREATE TABLE IF NOT EXISTS public.procurement_award_suppliers (
  award_id UUID NOT NULL REFERENCES public.procurement_awards(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.procurement_suppliers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (award_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_proc_award_supp_award ON public.procurement_award_suppliers(award_id);
CREATE INDEX IF NOT EXISTS idx_proc_award_supp_supp ON public.procurement_award_suppliers(supplier_id);

CREATE TABLE IF NOT EXISTS public.procurement_contract_suppliers (
  contract_id UUID NOT NULL REFERENCES public.procurement_contracts(id) ON DELETE CASCADE,
  supplier_id UUID NOT NULL REFERENCES public.procurement_suppliers(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, supplier_id)
);
CREATE INDEX IF NOT EXISTS idx_proc_contract_supp_contract ON public.procurement_contract_suppliers(contract_id);
CREATE INDEX IF NOT EXISTS idx_proc_contract_supp_supp ON public.procurement_contract_suppliers(supplier_id);

ALTER TABLE public.procurement_contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_award_suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.procurement_contract_suppliers ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'procurement_contract_amendments' AND policyname = 'proc_amendments_read'
  ) THEN
    CREATE POLICY "proc_amendments_read" ON public.procurement_contract_amendments FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'procurement_award_suppliers' AND policyname = 'proc_award_supp_read'
  ) THEN
    CREATE POLICY "proc_award_supp_read" ON public.procurement_award_suppliers FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'procurement_contract_suppliers' AND policyname = 'proc_contract_supp_read'
  ) THEN
    CREATE POLICY "proc_contract_supp_read" ON public.procurement_contract_suppliers FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- ------------------------------------------------------------------------------
-- 4. IDEMPOTENCIA DETERMINÍSTICA CON ESCOPO DE DOCUMENTOS PÚBLICOS
-- ------------------------------------------------------------------------------

ALTER TABLE public.procurement_documents
  ADD COLUMN IF NOT EXISTS document_dncp_id TEXT,
  ADD COLUMN IF NOT EXISTS doc_key TEXT;

UPDATE public.procurement_documents
SET doc_key = COALESCE(doc_key, 'tender:' || COALESCE(document_dncp_id, url_dncp, id::TEXT))
WHERE doc_key IS NULL;

ALTER TABLE public.procurement_documents
  ALTER COLUMN doc_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_proc_documents_doc_key 
  ON public.procurement_documents(process_id, doc_key);

-- ------------------------------------------------------------------------------
-- 5. ENLACES RELACIONALES CANÓNICOS LICITACIÓN -> OBRA
-- ------------------------------------------------------------------------------

ALTER TABLE public.licitaciones
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_licitaciones_project_id ON public.licitaciones(project_id);

-- ------------------------------------------------------------------------------
-- 6. RPC GLOBAL OCDS: INGESTIÓN IDEMPOTENTE CON MODELO DNCP REAL
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.ingestar_proceso_ocds_global(
  p_payload JSONB,
  p_fuente TEXT DEFAULT 'DNCP_OCDS'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cr JSONB;
  v_releases JSONB := '[]'::JSONB;
  v_releases_metadata JSONB := '[]'::JSONB;
  v_tender JSONB;
  v_planning JSONB;
  v_ocid TEXT;
  v_dncp_nro TEXT;
  v_titulo TEXT;
  v_buyer_name TEXT;
  v_buyer_id TEXT;
  v_entity_id UUID;
  v_process_id UUID;
  v_sha TEXT;
  v_estado TEXT;
  v_estado_anterior TEXT;
  v_monto_ref NUMERIC(18,2);
  v_monto_disp NUMERIC(18,2);
  v_moneda TEXT;
  v_item JSONB;
  v_lot JSONB;
  v_lot_id UUID;
  v_lot_num INTEGER;
  v_parsed_order INTEGER;
  v_final_sort_order INTEGER;
  v_party JSONB;
  v_award JSONB;
  v_award_db_id UUID;
  v_award_dncp_id TEXT;
  v_contract JSONB;
  v_amendment JSONB;
  v_doc JSONB;
  v_ruc_clean TEXT;
  v_supplier_id UUID;
  v_supplier_name TEXT;
  v_supplier_scale TEXT;
  v_contract_db_id UUID;
  v_orig_contract_id UUID;
  v_contract_dncp_id TEXT;
  v_extends_contract_id TEXT;
  v_monto_contrato_orig NUMERIC(18,2);
  v_contract_moneda TEXT;
  v_contract_award_id UUID;
  v_contract_supplier_id UUID;
  v_fecha_inicio TIMESTAMPTZ;
  v_fecha_fin TIMESTAMPTZ;
  v_duracion_dias_orig INTEGER;
  v_amendment_dncp_id TEXT;
  v_amendment_fingerprint TEXT;
  v_amendment_desc TEXT;
  v_amendment_delta NUMERIC(18,2);
  v_amendment_moneda TEXT;
  v_duracion_delta INTEGER;
  v_amendment_tipo TEXT;
  v_dncp_raw_type TEXT;
  v_item_sort_order INTEGER := 1;
  v_doc_key TEXT;
  
  -- Variables de reconciliación de adendas independientes
  v_amend_count INTEGER;
  v_amend_total_delta NUMERIC(18,2);
  v_amend_dur_delta INTEGER;
  v_has_unres_amt BOOLEAN;
  v_has_unres_dur BOOLEAN;
  v_any_amount_amend BOOLEAN;
  v_any_dur_amend BOOLEAN;
  r_amend RECORD;
BEGIN
  -- 10. PRESERVAR HISTORIAL DE RELEASES Y COMPILED_RELEASE
  IF p_payload ? 'compiledRelease' THEN
    v_cr := p_payload->'compiledRelease';
    IF p_payload ? 'releases' AND jsonb_typeof(p_payload->'releases') = 'array' THEN
      v_releases := p_payload->'releases';
      -- Extraer metadatos cronológicos de releases
      SELECT jsonb_agg(jsonb_build_object(
        'id', rel->>'id',
        'date', rel->>'date',
        'tag', rel->'tag',
        'initiationType', rel->>'initiationType',
        'payload_sha256', encode(digest(rel::TEXT, 'sha256'), 'hex')
      )) INTO v_releases_metadata
      FROM jsonb_array_elements(v_releases) AS rel;
    END IF;
  ELSE
    v_cr := p_payload;
  END IF;

  v_ocid := v_cr->>'ocid';
  IF v_ocid IS NULL OR trim(v_ocid) = '' THEN
    RAISE EXCEPTION 'compiledRelease no contiene ocid válido';
  END IF;

  v_tender := COALESCE(v_cr->'tender', '{}'::JSONB);
  v_planning := COALESCE(v_cr->'planning', '{}'::JSONB);
  v_dncp_nro := COALESCE(v_tender->>'id', split_part(v_ocid, '-', 3));
  v_titulo := COALESCE(v_tender->>'title', 'Sin título');
  v_buyer_name := COALESCE(v_cr->'buyer'->>'name', v_tender->'procuringEntity'->>'name');
  v_buyer_id := COALESCE(v_cr->'buyer'->>'id', v_tender->'procuringEntity'->>'id');

  -- 9. HASH SEMANTICS: SHA-256 CANÓNICO (NO MD5)
  v_sha := encode(digest(p_payload::TEXT, 'sha256'), 'hex');

  -- 1. Resolver o Ingestar Entidad Compradora
  IF v_buyer_id IS NOT NULL AND v_buyer_name IS NOT NULL THEN
    INSERT INTO public.procurement_entities (
      dncp_id, nombre, nombre_normalizado
    ) VALUES (
      v_buyer_id,
      v_buyer_name,
      public.normalizar_texto(v_buyer_name)
    )
    ON CONFLICT (dncp_id) DO UPDATE SET
      nombre = EXCLUDED.nombre,
      nombre_normalizado = EXCLUDED.nombre_normalizado,
      updated_at = now()
    RETURNING id INTO v_entity_id;
  END IF;

  -- 2. Calcular montos
  v_monto_disp := (v_planning->'budget'->'amount'->>'amount')::NUMERIC;
  v_monto_ref := (v_tender->'value'->>'amount')::NUMERIC;
  v_moneda := COALESCE(v_tender->'value'->>'currency', 'PYG');
  v_estado := upper(COALESCE(v_tender->>'status', 'PLANNING'));

  -- 3. Upsert Proceso Global
  SELECT id, estado INTO v_process_id, v_estado_anterior
  FROM public.procurement_processes
  WHERE ocid = v_ocid;

  IF v_process_id IS NULL THEN
    INSERT INTO public.procurement_processes (
      ocid, dncp_nro, titulo, entity_id, comitente_nombre, comitente_id,
      categoria, categoria_detalle, procurement_method, procurement_method_detalle,
      award_criteria_detalle, monto_referencial, monto_disponible, moneda,
      fecha_publicacion, fecha_consultas_fin, fecha_entrega_ofertas, fecha_apertura,
      lugar_apertura, estado, estado_detalle, raw_json, payload_sha256, fuente,
      releases_metadata, sync_count, first_synced_at, last_synced_at
    ) VALUES (
      v_ocid, v_dncp_nro, v_titulo, v_entity_id, v_buyer_name, v_buyer_id,
      v_tender->>'mainProcurementCategory', v_tender->>'mainProcurementCategoryDetails',
      v_tender->>'procurementMethod', v_tender->>'procurementMethodDetails',
      v_tender->>'awardCriteriaDetails', v_monto_ref, v_monto_disp, v_moneda,
      (v_tender->>'datePublished')::TIMESTAMPTZ,
      (v_tender->'enquiryPeriod'->>'endDate')::TIMESTAMPTZ,
      (v_tender->'tenderPeriod'->>'endDate')::TIMESTAMPTZ,
      (v_tender->'bidOpening'->>'date')::TIMESTAMPTZ,
      COALESCE(v_tender->'bidOpening'->'address'->>'streetAddress', v_tender->>'submissionMethodDetails'),
      v_estado, v_tender->>'statusDetails', p_payload, v_sha, p_fuente,
      v_releases_metadata, 1, now(), now()
    ) RETURNING id INTO v_process_id;
  ELSE
    IF v_estado_anterior IS DISTINCT FROM v_estado THEN
      INSERT INTO public.procurement_process_history (
        process_id, estado_anterior, estado_nuevo, payload_sha256, change_diff
      ) VALUES (
        v_process_id, v_estado_anterior, v_estado, v_sha,
        jsonb_build_object('prev_status', v_estado_anterior, 'new_status', v_estado, 'date', now())
      );
    END IF;

    UPDATE public.procurement_processes SET
      titulo = v_titulo,
      entity_id = COALESCE(v_entity_id, procurement_processes.entity_id),
      comitente_nombre = v_buyer_name,
      comitente_id = v_buyer_id,
      categoria = v_tender->>'mainProcurementCategory',
      categoria_detalle = v_tender->>'mainProcurementCategoryDetails',
      procurement_method = v_tender->>'procurementMethod',
      procurement_method_detalle = v_tender->>'procurementMethodDetails',
      award_criteria_detalle = v_tender->>'awardCriteriaDetails',
      monto_referencial = v_monto_ref,
      monto_disponible = v_monto_disp,
      moneda = v_moneda,
      fecha_consultas_fin = (v_tender->'enquiryPeriod'->>'endDate')::TIMESTAMPTZ,
      fecha_entrega_ofertas = (v_tender->'tenderPeriod'->>'endDate')::TIMESTAMPTZ,
      fecha_apertura = (v_tender->'bidOpening'->>'date')::TIMESTAMPTZ,
      lugar_apertura = COALESCE(v_tender->'bidOpening'->'address'->>'streetAddress', v_tender->>'submissionMethodDetails'),
      estado = v_estado,
      estado_detalle = v_tender->>'statusDetails',
      raw_json = p_payload,
      payload_sha256 = v_sha,
      releases_metadata = COALESCE(v_releases_metadata, procurement_processes.releases_metadata),
      sync_count = sync_count + 1,
      last_synced_at = now(),
      updated_at = now()
    WHERE id = v_process_id;
  END IF;

  -- 4. Ingestar Lotes Globales (1. REAL DNCP IDS ARE NOT INTEGERS)
  IF jsonb_typeof(v_tender->'lots') = 'array' THEN
    FOR v_lot IN SELECT * FROM jsonb_array_elements(v_tender->'lots') LOOP
      v_lot_num := NULL;
      IF (v_lot->>'number') IS NOT NULL AND (v_lot->>'number') ~ '^[0-9]+$' THEN
        v_lot_num := (v_lot->>'number')::INTEGER;
      ELSIF (v_lot->>'numero') IS NOT NULL AND (v_lot->>'numero') ~ '^[0-9]+$' THEN
        v_lot_num := (v_lot->>'numero')::INTEGER;
      ELSIF (v_lot->>'id') IS NOT NULL AND (v_lot->>'id') ~ '^[0-9]+$' THEN
        v_lot_num := (v_lot->>'id')::INTEGER;
      END IF;

      INSERT INTO public.procurement_lots (
        process_id, lote_dncp_id, numero, titulo, monto_referencial
      ) VALUES (
        v_process_id,
        v_lot->>'id',
        v_lot_num,
        v_lot->>'title',
        (v_lot->'value'->>'amount')::NUMERIC
      )
      ON CONFLICT (process_id, lote_dncp_id) DO UPDATE SET
        numero = EXCLUDED.numero,
        titulo = EXCLUDED.titulo,
        monto_referencial = EXCLUDED.monto_referencial;
    END LOOP;
  END IF;

  -- 5. Ingestar Ítems Globales (1. REAL DNCP IDS ARE NOT INTEGERS: sort_order desde Orden o loop order)
  IF jsonb_typeof(v_tender->'items') = 'array' THEN
    v_item_sort_order := 1;
    FOR v_item IN SELECT * FROM jsonb_array_elements(v_tender->'items') LOOP
      v_lot_id := NULL;
      IF v_item->>'relatedLot' IS NOT NULL THEN
        SELECT id INTO v_lot_id FROM public.procurement_lots
        WHERE process_id = v_process_id AND lote_dncp_id = v_item->>'relatedLot';
      END IF;

      v_parsed_order := NULL;
      IF jsonb_typeof(v_item->'attributes') = 'array' THEN
        SELECT (attr->>'value')::INTEGER INTO v_parsed_order
        FROM jsonb_array_elements(v_item->'attributes') AS attr
        WHERE lower(trim(attr->>'name')) = 'orden' AND (attr->>'value') ~ '^[0-9]+$'
        LIMIT 1;
      END IF;
      IF v_parsed_order IS NULL AND (v_item->>'sort_order') ~ '^[0-9]+$' THEN
        v_parsed_order := (v_item->>'sort_order')::INTEGER;
      ELSIF v_parsed_order IS NULL AND (v_item->>'orden') ~ '^[0-9]+$' THEN
        v_parsed_order := (v_item->>'orden')::INTEGER;
      END IF;
      v_final_sort_order := COALESCE(v_parsed_order, v_item_sort_order);

      INSERT INTO public.procurement_items (
        process_id, lot_id, item_dncp_id, codigo_catalogo, codigo_unspsc,
        descripcion, cantidad, unidad, precio_unitario_referencial, sort_order
      ) VALUES (
        v_process_id,
        v_lot_id,
        v_item->>'id',
        v_item->'classification'->>'id',
        v_item->'additionalClassifications'->0->>'id',
        COALESCE(v_item->>'description', v_item->'classification'->>'description', '(sin descripción)'),
        (v_item->>'quantity')::NUMERIC,
        v_item->'unit'->>'name',
        (v_item->'unit'->'value'->>'amount')::NUMERIC,
        v_final_sort_order
      )
      ON CONFLICT (process_id, item_dncp_id) DO UPDATE SET
        lot_id = EXCLUDED.lot_id,
        codigo_catalogo = EXCLUDED.codigo_catalogo,
        codigo_unspsc = EXCLUDED.codigo_unspsc,
        descripcion = EXCLUDED.descripcion,
        cantidad = EXCLUDED.cantidad,
        unidad = EXCLUDED.unidad,
        precio_unitario_referencial = EXCLUDED.precio_unitario_referencial,
        sort_order = EXCLUDED.sort_order;

      v_item_sort_order := v_item_sort_order + 1;
    END LOOP;
  END IF;

  -- 6. Ingestar Proveedores y Participaciones / Ofertas
  IF jsonb_typeof(v_cr->'parties') = 'array' THEN
    FOR v_party IN SELECT * FROM jsonb_array_elements(v_cr->'parties') LOOP
      v_ruc_clean := public.normalizar_ruc(COALESCE(v_party->'identifier'->>'id', v_party->>'id'));
      IF v_ruc_clean IS NOT NULL THEN
        v_supplier_name := COALESCE(v_party->>'name', v_ruc_clean);
        v_supplier_scale := v_party->'details'->>'scale';

        INSERT INTO public.procurement_suppliers (
          ruc_clean, ruc_raw, dv, nombre, nombre_normalizado, tamano
        ) VALUES (
          v_ruc_clean,
          COALESCE(v_party->'identifier'->>'id', v_party->>'id'),
          public.extraer_dv_ruc(COALESCE(v_party->'identifier'->>'id', v_party->>'id')),
          v_supplier_name,
          public.normalizar_texto(v_supplier_name),
          v_supplier_scale
        )
        ON CONFLICT (ruc_clean) DO UPDATE SET
          nombre = EXCLUDED.nombre,
          nombre_normalizado = EXCLUDED.nombre_normalizado,
          tamano = COALESCE(EXCLUDED.tamano, procurement_suppliers.tamano),
          updated_at = now()
        RETURNING id INTO v_supplier_id;
      END IF;
    END LOOP;
  END IF;

  IF jsonb_typeof(v_tender->'tenderers') = 'array' THEN
    FOR v_party IN SELECT * FROM jsonb_array_elements(v_tender->'tenderers') LOOP
      v_ruc_clean := public.normalizar_ruc(v_party->>'id');
      IF v_ruc_clean IS NOT NULL THEN
        SELECT id INTO v_supplier_id FROM public.procurement_suppliers WHERE ruc_clean = v_ruc_clean;
        IF v_supplier_id IS NOT NULL THEN
          INSERT INTO public.procurement_bids (
            process_id, supplier_id, fuente
          ) VALUES (
            v_process_id, v_supplier_id, 'API'
          )
          ON CONFLICT (process_id, supplier_id) DO NOTHING;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 7. Ingestar Adjudicaciones (4. PRESERVAR TODOS LOS PROVEEDORES DE ADJUDICACIÓN)
  IF jsonb_typeof(v_cr->'awards') = 'array' THEN
    FOR v_award IN SELECT * FROM jsonb_array_elements(v_cr->'awards') LOOP
      IF v_award->>'status' <> 'unsuccessful' THEN
        v_supplier_id := NULL;
        v_award_dncp_id := COALESCE(v_award->>'id', '1');

        -- Proveedor primario
        IF jsonb_typeof(v_award->'suppliers') = 'array' AND jsonb_array_length(v_award->'suppliers') > 0 THEN
          v_ruc_clean := public.normalizar_ruc(v_award->'suppliers'->0->>'id');
          IF v_ruc_clean IS NOT NULL THEN
            SELECT id INTO v_supplier_id FROM public.procurement_suppliers WHERE ruc_clean = v_ruc_clean;
          END IF;
        END IF;

        INSERT INTO public.procurement_awards (
          process_id, award_dncp_id, supplier_id, monto_adjudicado,
          moneda, fecha_adjudicacion, status, raw_payload
        ) VALUES (
          v_process_id,
          v_award_dncp_id,
          v_supplier_id,
          (v_award->'value'->>'amount')::NUMERIC,
          COALESCE(v_award->'value'->>'currency', 'PYG'),
          (v_award->>'date')::TIMESTAMPTZ,
          v_award->>'status',
          v_award
        )
        ON CONFLICT (process_id, award_dncp_id) DO UPDATE SET
          supplier_id = EXCLUDED.supplier_id,
          monto_adjudicado = EXCLUDED.monto_adjudicado,
          moneda = EXCLUDED.moneda,
          status = EXCLUDED.status,
          raw_payload = EXCLUDED.raw_payload
        RETURNING id INTO v_award_db_id;

        -- Ingestar TODOS los proveedores adjudicados en procurement_award_suppliers
        IF jsonb_typeof(v_award->'suppliers') = 'array' THEN
          FOR v_party IN SELECT * FROM jsonb_array_elements(v_award->'suppliers') LOOP
            v_ruc_clean := public.normalizar_ruc(v_party->>'id');
            IF v_ruc_clean IS NOT NULL THEN
              SELECT id INTO v_supplier_id FROM public.procurement_suppliers WHERE ruc_clean = v_ruc_clean;
              IF v_supplier_id IS NOT NULL THEN
                INSERT INTO public.procurement_award_suppliers (award_id, supplier_id)
                VALUES (v_award_db_id, v_supplier_id)
                ON CONFLICT (award_id, supplier_id) DO NOTHING;

                INSERT INTO public.procurement_bids (process_id, supplier_id, gano, fuente)
                VALUES (v_process_id, v_supplier_id, true, 'API')
                ON CONFLICT (process_id, supplier_id) DO UPDATE SET gano = true;
              END IF;
            END IF;
          END LOOP;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 8. Ingestar Contratos y Adendas
  IF jsonb_typeof(v_cr->'contracts') = 'array' THEN
    -- 8.1 PRIMER PASO: Ingestar Contratos Originales (aquellos que NO extienden otro contrato)
    FOR v_contract IN SELECT * FROM jsonb_array_elements(v_cr->'contracts') LOOP
      v_extends_contract_id := trim(COALESCE(v_contract->>'extendsContractID', ''));

      IF v_extends_contract_id = '' THEN
        v_contract_dncp_id := COALESCE(v_contract->>'id', '1');
        v_monto_contrato_orig := (v_contract->'value'->>'amount')::NUMERIC;
        v_contract_moneda := COALESCE(v_contract->'value'->>'currency', v_moneda, 'PYG');
        v_fecha_inicio := (v_contract->'period'->>'startDate')::TIMESTAMPTZ;
        v_fecha_fin := (v_contract->'period'->>'endDate')::TIMESTAMPTZ;
        v_duracion_dias_orig := NULL;

        IF v_fecha_inicio IS NOT NULL AND v_fecha_fin IS NOT NULL THEN
          v_duracion_dias_orig := extract(day from (v_fecha_fin - v_fecha_inicio))::INTEGER;
        END IF;

        -- 4. CONTRACT -> AWARD -> SUPPLIER CHAIN: Resolver award_id y supplier_id desde evidencia DNCP
        v_contract_award_id := NULL;
        v_contract_supplier_id := NULL;
        IF v_contract->>'awardID' IS NOT NULL THEN
          SELECT id, supplier_id INTO v_contract_award_id, v_contract_supplier_id
          FROM public.procurement_awards
          WHERE process_id = v_process_id AND award_dncp_id = (v_contract->>'awardID');
        END IF;

        -- Si el contrato trae suppliers directamente, priorizarlo
        IF jsonb_typeof(v_contract->'suppliers') = 'array' AND jsonb_array_length(v_contract->'suppliers') > 0 THEN
          v_ruc_clean := public.normalizar_ruc(v_contract->'suppliers'->0->>'id');
          IF v_ruc_clean IS NOT NULL THEN
            SELECT id INTO v_supplier_id FROM public.procurement_suppliers WHERE ruc_clean = v_ruc_clean;
            IF v_supplier_id IS NOT NULL THEN
              v_contract_supplier_id := v_supplier_id;
            END IF;
          END IF;
        END IF;

        INSERT INTO public.procurement_contracts (
          process_id, award_id, supplier_id, contract_dncp_id, numero_contrato,
          monto_contrato, monto_contrato_original, monto_contrato_vigente,
          moneda, fecha_firma, fecha_inicio, fecha_fin, 
          duracion_dias_original, duracion_dias_vigente,
          status
        ) VALUES (
          v_process_id,
          v_contract_award_id,
          v_contract_supplier_id,
          v_contract_dncp_id,
          v_contract->>'title',
          v_monto_contrato_orig,
          v_monto_contrato_orig,
          v_monto_contrato_orig,
          v_contract_moneda,
          (v_contract->>'dateSigned')::TIMESTAMPTZ,
          v_fecha_inicio,
          v_fecha_fin,
          v_duracion_dias_orig,
          v_duracion_dias_orig,
          v_contract->>'status'
        )
        ON CONFLICT (process_id, contract_dncp_id) DO UPDATE SET
          award_id = COALESCE(EXCLUDED.award_id, procurement_contracts.award_id),
          supplier_id = COALESCE(EXCLUDED.supplier_id, procurement_contracts.supplier_id),
          numero_contrato = COALESCE(EXCLUDED.numero_contrato, procurement_contracts.numero_contrato),
          monto_contrato_original = COALESCE(procurement_contracts.monto_contrato_original, EXCLUDED.monto_contrato_original),
          moneda = COALESCE(EXCLUDED.moneda, procurement_contracts.moneda),
          fecha_firma = COALESCE(EXCLUDED.fecha_firma, procurement_contracts.fecha_firma),
          fecha_inicio = COALESCE(EXCLUDED.fecha_inicio, procurement_contracts.fecha_inicio),
          fecha_fin = COALESCE(EXCLUDED.fecha_fin, procurement_contracts.fecha_fin),
          duracion_dias_original = COALESCE(procurement_contracts.duracion_dias_original, EXCLUDED.duracion_dias_original),
          status = EXCLUDED.status
        RETURNING id INTO v_contract_db_id;

        -- Ingestar todos los proveedores del contrato en procurement_contract_suppliers
        IF jsonb_typeof(v_contract->'suppliers') = 'array' THEN
          FOR v_party IN SELECT * FROM jsonb_array_elements(v_contract->'suppliers') LOOP
            v_ruc_clean := public.normalizar_ruc(v_party->>'id');
            IF v_ruc_clean IS NOT NULL THEN
              SELECT id INTO v_supplier_id FROM public.procurement_suppliers WHERE ruc_clean = v_ruc_clean;
              IF v_supplier_id IS NOT NULL THEN
                INSERT INTO public.procurement_contract_suppliers (contract_id, supplier_id)
                VALUES (v_contract_db_id, v_supplier_id)
                ON CONFLICT (contract_id, supplier_id) DO NOTHING;
              END IF;
            END IF;
          END LOOP;
        ELSIF v_contract_award_id IS NOT NULL THEN
          -- Heredar proveedores de la adjudicación vinculada
          INSERT INTO public.procurement_contract_suppliers (contract_id, supplier_id)
          SELECT v_contract_db_id, supplier_id
          FROM public.procurement_award_suppliers
          WHERE award_id = v_contract_award_id
          ON CONFLICT (contract_id, supplier_id) DO NOTHING;
        END IF;

        -- Ingestar adendas embebidas en contracts[].amendments
        IF jsonb_typeof(v_contract->'amendments') = 'array' THEN
          FOR v_amendment IN SELECT * FROM jsonb_array_elements(v_contract->'amendments') LOOP
            -- 3. DETERMINISTIC AMENDMENT IDENTITY (SHA-256)
            v_amendment_fingerprint := encode(digest(
              v_process_id::TEXT || '|' ||
              COALESCE(v_contract_dncp_id, '') || '|' ||
              COALESCE(v_amendment->>'date', '') || '|' ||
              COALESCE(v_amendment->>'description', '') || '|' ||
              COALESCE(v_amendment->'amendsAmount'->>'amount', ''),
              'sha256'
            ), 'hex');

            v_amendment_dncp_id := COALESCE(
              v_amendment->>'id',
              v_amendment->>'financialCode',
              'amend-' || substring(v_amendment_fingerprint from 1 for 16)
            );

            v_amendment_desc := v_amendment->>'description';
            v_dncp_raw_type := COALESCE(v_amendment->>'dncpAmendmentType', v_amendment->>'amendmentType', v_amendment_desc);
            v_amendment_moneda := COALESCE(v_amendment->'amendsAmount'->>'currency', v_contract_moneda, 'PYG');

            -- Clasificación con prioridad a evidencia cruda DNCP
            v_amendment_tipo := 'OTHER';
            IF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%reajuste%' THEN
              v_amendment_tipo := 'PRICE_ADJUSTMENT';
            ELSIF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%ampliaci%monto%' OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%aumento%' THEN
              v_amendment_tipo := 'AMOUNT_INCREASE';
            ELSIF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%disminuci%monto%' OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%reducci%monto%' THEN
              v_amendment_tipo := 'AMOUNT_DECREASE';
            ELSIF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%pr%rroga%' OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%ampliaci%plazo%' THEN
              v_amendment_tipo := 'TERM_EXTENSION';
            ELSIF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%reducci%plazo%' THEN
              v_amendment_tipo := 'TERM_REDUCTION';
            ELSIF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%modificaci%' OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%alcance%' OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%item%' THEN
              v_amendment_tipo := 'SCOPE_MODIFICATION';
            END IF;

            -- 8. AMENDMENT DIMENSIONS: monto_delta y duracion_delta independientes
            v_amendment_delta := (v_amendment->'amendsAmount'->>'amount')::NUMERIC;
            v_duracion_delta := NULL;

            INSERT INTO public.procurement_contract_amendments (
              contract_id, process_id, amendment_dncp_id, tipo,
              dncp_amendment_type_raw, source_type,
              fecha, descripcion, moneda, monto_delta, duracion_dias_delta,
              financial_code, is_orphan, raw_payload
            ) VALUES (
              v_contract_db_id,
              v_process_id,
              v_amendment_dncp_id,
              v_amendment_tipo,
              v_dncp_raw_type,
              'EMBEDDED_AMENDMENT',
              (v_amendment->>'date')::TIMESTAMPTZ,
              v_amendment_desc,
              v_amendment_moneda,
              v_amendment_delta,
              v_duracion_delta,
              v_amendment->>'financialCode',
              false,
              v_amendment
            )
            ON CONFLICT (process_id, amendment_dncp_id) DO UPDATE SET
              contract_id = EXCLUDED.contract_id,
              tipo = EXCLUDED.tipo,
              dncp_amendment_type_raw = EXCLUDED.dncp_amendment_type_raw,
              fecha = EXCLUDED.fecha,
              descripcion = EXCLUDED.descripcion,
              moneda = EXCLUDED.moneda,
              monto_delta = EXCLUDED.monto_delta,
              duracion_dias_delta = EXCLUDED.duracion_dias_delta,
              financial_code = EXCLUDED.financial_code,
              is_orphan = false,
              raw_payload = EXCLUDED.raw_payload;
          END LOOP;
        END IF;
      END IF;
    END LOOP;

    -- 8.2 SEGUNDO PASO: Ingestar Registros de Adenda vinculados por extendsContractID
    FOR v_contract IN SELECT * FROM jsonb_array_elements(v_cr->'contracts') LOOP
      v_extends_contract_id := trim(COALESCE(v_contract->>'extendsContractID', ''));

      IF v_extends_contract_id <> '' THEN
        -- 2. NEVER GUESS AMENDMENT PARENT: Exact match only!
        SELECT id INTO v_orig_contract_id
        FROM public.procurement_contracts
        WHERE process_id = v_process_id AND contract_dncp_id = v_extends_contract_id;

        -- 3. DETERMINISTIC AMENDMENT IDENTITY (SHA-256)
        v_amendment_fingerprint := encode(digest(
          v_process_id::TEXT || '|' ||
          v_extends_contract_id || '|' ||
          COALESCE(v_contract->>'dncpContractCode', '') || '|' ||
          COALESCE(v_contract->>'dateSigned', '') || '|' ||
          COALESCE(v_contract->>'title', '') || '|' ||
          COALESCE(v_contract->'value'->>'amount', ''),
          'sha256'
        ), 'hex');

        v_amendment_dncp_id := COALESCE(
          v_contract->>'id',
          v_contract->>'dncpContractCode',
          'amend-' || substring(v_amendment_fingerprint from 1 for 16)
        );

        v_dncp_raw_type := COALESCE(v_contract->>'dncpAmendmentType', v_contract->>'amendmentType', v_contract->>'title', 'Adenda Contractual');
        v_amendment_moneda := COALESCE(v_contract->'value'->>'currency', v_moneda, 'PYG');

        v_amendment_tipo := 'OTHER';
        IF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%reajuste%' THEN
          v_amendment_tipo := 'PRICE_ADJUSTMENT';
        ELSIF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%ampliaci%monto%' OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%aumento%' THEN
          v_amendment_tipo := 'AMOUNT_INCREASE';
        ELSIF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%disminuci%monto%' OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%reducci%monto%' THEN
          v_amendment_tipo := 'AMOUNT_DECREASE';
        ELSIF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%pr%rroga%' OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%ampliaci%plazo%' THEN
          v_amendment_tipo := 'TERM_EXTENSION';
        ELSIF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%reducci%plazo%' THEN
          v_amendment_tipo := 'TERM_REDUCTION';
        ELSIF lower(COALESCE(v_dncp_raw_type, '')) LIKE '%modificaci%' OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%alcance%' OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%item%' THEN
          v_amendment_tipo := 'SCOPE_MODIFICATION';
        END IF;

        -- 8. AMENDMENT DIMENSIONS: Do not apply a monetary value to a term-only amendment merely because value exists
        v_amendment_delta := NULL;
        IF v_amendment_tipo IN ('AMOUNT_INCREASE', 'AMOUNT_DECREASE', 'PRICE_ADJUSTMENT', 'SCOPE_MODIFICATION')
           OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%monto%'
           OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%reajuste%' THEN
          v_amendment_delta := (v_contract->'value'->>'amount')::NUMERIC;
        END IF;

        -- Only apply a duration delta when official amendment represents a term modification
        v_duracion_delta := NULL;
        IF (v_amendment_tipo IN ('TERM_EXTENSION', 'TERM_REDUCTION', 'SCOPE_MODIFICATION')
            OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%plazo%'
            OR lower(COALESCE(v_dncp_raw_type, '')) LIKE '%pr%rroga%')
           AND v_contract->'period'->>'startDate' IS NOT NULL AND v_contract->'period'->>'endDate' IS NOT NULL THEN
          v_duracion_delta := extract(day from ((v_contract->'period'->>'endDate')::TIMESTAMPTZ - (v_contract->'period'->>'startDate')::TIMESTAMPTZ))::INTEGER;
        END IF;

        -- Insert amendment: if parent not found (v_orig_contract_id IS NULL), store as orphan evidence (contract_id = NULL, is_orphan = true)
        INSERT INTO public.procurement_contract_amendments (
          contract_id, process_id, amendment_dncp_id, tipo,
          dncp_amendment_type_raw, extends_contract_id, dncp_contract_code,
          source_type, fecha, descripcion, moneda, monto_delta, duracion_dias_delta,
          financial_code, is_orphan, raw_payload
        ) VALUES (
          v_orig_contract_id,
          v_process_id,
          v_amendment_dncp_id,
          v_amendment_tipo,
          v_dncp_raw_type,
          v_extends_contract_id,
          v_contract->>'dncpContractCode',
          'EXTENDS_CONTRACT',
          COALESCE((v_contract->>'dateSigned')::TIMESTAMPTZ, (v_contract->'period'->>'startDate')::TIMESTAMPTZ),
          v_contract->>'description',
          v_amendment_moneda,
          v_amendment_delta,
          v_duracion_delta,
          v_contract->>'financialCode',
          (v_orig_contract_id IS NULL),
          v_contract
        )
        ON CONFLICT (process_id, amendment_dncp_id) DO UPDATE SET
          contract_id = EXCLUDED.contract_id,
          tipo = EXCLUDED.tipo,
          dncp_amendment_type_raw = EXCLUDED.dncp_amendment_type_raw,
          extends_contract_id = EXCLUDED.extends_contract_id,
          dncp_contract_code = EXCLUDED.dncp_contract_code,
          fecha = EXCLUDED.fecha,
          descripcion = EXCLUDED.descripcion,
          moneda = EXCLUDED.moneda,
          monto_delta = EXCLUDED.monto_delta,
          duracion_dias_delta = EXCLUDED.duracion_dias_delta,
          financial_code = EXCLUDED.financial_code,
          is_orphan = EXCLUDED.is_orphan,
          raw_payload = EXCLUDED.raw_payload;
      END IF;
    END LOOP;

    -- 8.3 TERCER PASO: Reconciliar y computar estadísticas para cada contrato del proceso
    -- 8. AMENDMENT DIMENSIONS: Mantener incertidumbre de monto y duración INDEPENDIENTES
    FOR v_contract_db_id IN SELECT id FROM public.procurement_contracts WHERE process_id = v_process_id LOOP
      v_amend_count := 0;
      v_amend_total_delta := 0;
      v_amend_dur_delta := 0;
      v_has_unres_amt := false;
      v_has_unres_dur := false;
      v_any_amount_amend := false;
      v_any_dur_amend := false;

      -- Obtener moneda del contrato base
      SELECT moneda INTO v_contract_moneda FROM public.procurement_contracts WHERE id = v_contract_db_id;

      FOR r_amend IN SELECT tipo, monto_delta, duracion_dias_delta, moneda, dncp_amendment_type_raw, descripcion
                     FROM public.procurement_contract_amendments
                     WHERE contract_id = v_contract_db_id LOOP
        v_amend_count := v_amend_count + 1;

        -- Reconciliación de impacto en Monto
        IF r_amend.tipo IN ('AMOUNT_INCREASE', 'AMOUNT_DECREASE', 'PRICE_ADJUSTMENT', 'SCOPE_MODIFICATION')
           OR lower(COALESCE(r_amend.dncp_amendment_type_raw, r_amend.descripcion, '')) LIKE '%monto%'
           OR lower(COALESCE(r_amend.dncp_amendment_type_raw, r_amend.descripcion, '')) LIKE '%reajuste%' THEN
          v_any_amount_amend := true;
          -- 5. Moneda incompatible sin tipo de cambio verificado => efecto económico no resuelto
          IF r_amend.moneda IS DISTINCT FROM v_contract_moneda THEN
            v_has_unres_amt := true;
          ELSIF r_amend.monto_delta IS NULL THEN
            v_has_unres_amt := true;
          ELSE
            v_amend_total_delta := v_amend_total_delta + r_amend.monto_delta;
          END IF;
        ELSIF r_amend.monto_delta IS NOT NULL THEN
          IF r_amend.moneda IS DISTINCT FROM v_contract_moneda THEN
            v_has_unres_amt := true;
          ELSE
            v_amend_total_delta := v_amend_total_delta + r_amend.monto_delta;
          END IF;
        END IF;

        -- Reconciliación de impacto en Plazo
        IF r_amend.tipo IN ('TERM_EXTENSION', 'TERM_REDUCTION', 'SCOPE_MODIFICATION')
           OR lower(COALESCE(r_amend.dncp_amendment_type_raw, r_amend.descripcion, '')) LIKE '%plazo%'
           OR lower(COALESCE(r_amend.dncp_amendment_type_raw, r_amend.descripcion, '')) LIKE '%pr%rroga%' THEN
          v_any_dur_amend := true;
          IF r_amend.duracion_dias_delta IS NULL THEN
            v_has_unres_dur := true;
          ELSE
            v_amend_dur_delta := v_amend_dur_delta + r_amend.duracion_dias_delta;
          END IF;
        ELSIF r_amend.duracion_dias_delta IS NOT NULL THEN
          v_amend_dur_delta := v_amend_dur_delta + r_amend.duracion_dias_delta;
        END IF;
      END LOOP;

      UPDATE public.procurement_contracts SET
        amendment_count = v_amend_count,
        has_unresolved_amount = v_has_unres_amt,
        has_unresolved_duration = v_has_unres_dur,
        has_unresolved_amendments = (v_has_unres_amt OR v_has_unres_dur),
        total_amendment_amount_delta = CASE WHEN v_has_unres_amt AND v_any_amount_amend THEN NULL ELSE v_amend_total_delta END,
        total_amendment_duration_delta_days = CASE WHEN v_has_unres_dur AND v_any_dur_amend THEN NULL ELSE v_amend_dur_delta END,
        monto_contrato_vigente = CASE 
          WHEN v_has_unres_amt AND v_any_amount_amend THEN NULL 
          ELSE COALESCE(monto_contrato_original, monto_contrato) + v_amend_total_delta 
        END,
        duracion_dias_vigente = CASE 
          WHEN (v_has_unres_dur AND v_any_dur_amend) OR duracion_dias_original IS NULL THEN NULL 
          ELSE duracion_dias_original + v_amend_dur_delta 
        END
      WHERE id = v_contract_db_id;
    END LOOP;
  END IF;

  -- 9. Ingestar Documentos Públicos con ESCOPO DETERMINÍSTICO Y SHA-256
  IF jsonb_typeof(v_tender->'documents') = 'array' THEN
    FOR v_doc IN SELECT * FROM jsonb_array_elements(v_tender->'documents') LOOP
      v_doc_key := 'tender:' || COALESCE(v_doc->>'id', v_doc->>'url', encode(digest(COALESCE(v_doc->>'title', 'tender-doc'), 'sha256'), 'hex'));
      INSERT INTO public.procurement_documents (
        process_id, document_dncp_id, doc_key, tipo, tipo_detalle, titulo, url_dncp, format
      ) VALUES (
        v_process_id,
        v_doc->>'id',
        v_doc_key,
        v_doc->>'documentType',
        v_doc->>'documentTypeDetails',
        v_doc->>'title',
        v_doc->>'url',
        v_doc->>'format'
      )
      ON CONFLICT (process_id, doc_key) DO UPDATE SET
        tipo = COALESCE(EXCLUDED.tipo, procurement_documents.tipo),
        tipo_detalle = COALESCE(EXCLUDED.tipo_detalle, procurement_documents.tipo_detalle),
        url_dncp = COALESCE(EXCLUDED.url_dncp, procurement_documents.url_dncp),
        format = COALESCE(EXCLUDED.format, procurement_documents.format);
    END LOOP;
  END IF;

  IF jsonb_typeof(v_cr->'awards') = 'array' THEN
    FOR v_award IN SELECT * FROM jsonb_array_elements(v_cr->'awards') LOOP
      v_award_dncp_id := COALESCE(v_award->>'id', '1');
      IF jsonb_typeof(v_award->'documents') = 'array' THEN
        FOR v_doc IN SELECT * FROM jsonb_array_elements(v_award->'documents') LOOP
          v_doc_key := 'award:' || v_award_dncp_id || ':' || COALESCE(v_doc->>'id', v_doc->>'url', encode(digest(COALESCE(v_doc->>'title', 'award-doc'), 'sha256'), 'hex'));
          INSERT INTO public.procurement_documents (
            process_id, document_dncp_id, doc_key, tipo, tipo_detalle, titulo, url_dncp, format
          ) VALUES (
            v_process_id,
            v_doc->>'id',
            v_doc_key,
            v_doc->>'documentType',
            v_doc->>'documentTypeDetails',
            v_doc->>'title',
            v_doc->>'url',
            v_doc->>'format'
          )
          ON CONFLICT (process_id, doc_key) DO UPDATE SET
            tipo = COALESCE(EXCLUDED.tipo, procurement_documents.tipo),
            tipo_detalle = COALESCE(EXCLUDED.tipo_detalle, procurement_documents.tipo_detalle),
            url_dncp = COALESCE(EXCLUDED.url_dncp, procurement_documents.url_dncp),
            format = COALESCE(EXCLUDED.format, procurement_documents.format);
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  IF jsonb_typeof(v_cr->'contracts') = 'array' THEN
    FOR v_contract IN SELECT * FROM jsonb_array_elements(v_cr->'contracts') LOOP
      v_contract_dncp_id := COALESCE(v_contract->>'id', '1');
      IF jsonb_typeof(v_contract->'documents') = 'array' THEN
        FOR v_doc IN SELECT * FROM jsonb_array_elements(v_contract->'documents') LOOP
          v_doc_key := 'contract:' || v_contract_dncp_id || ':' || COALESCE(v_doc->>'id', v_doc->>'url', encode(digest(COALESCE(v_doc->>'title', 'contract-doc'), 'sha256'), 'hex'));
          INSERT INTO public.procurement_documents (
            process_id, document_dncp_id, doc_key, tipo, tipo_detalle, titulo, url_dncp, format
          ) VALUES (
            v_process_id,
            v_doc->>'id',
            v_doc_key,
            v_doc->>'documentType',
            v_doc->>'documentTypeDetails',
            v_doc->>'title',
            v_doc->>'url',
            v_doc->>'format'
          )
          ON CONFLICT (process_id, doc_key) DO UPDATE SET
            tipo = COALESCE(EXCLUDED.tipo, procurement_documents.tipo),
            tipo_detalle = COALESCE(EXCLUDED.tipo_detalle, procurement_documents.tipo_detalle),
            url_dncp = COALESCE(EXCLUDED.url_dncp, procurement_documents.url_dncp),
            format = COALESCE(EXCLUDED.format, procurement_documents.format);
        END LOOP;
      END IF;
    END LOOP;
  END IF;

  RETURN v_process_id;
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. SEGURIDAD DEL RPC GLOBAL DE INGESTIÓN (FINDING 5)
-- Revocar ejecución de clientes web/móvil y reservar exclusivamente a service_role
-- ------------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.ingestar_proceso_ocds_global(JSONB, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.ingestar_proceso_ocds_global(JSONB, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public.ingestar_proceso_ocds_global(JSONB, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.ingestar_proceso_ocds_global(JSONB, TEXT) TO service_role;

-- ------------------------------------------------------------------------------
-- 8. ACTUALIZACIÓN ATÓMICA DE CONVERSIÓN LICITACIÓN -> PROYECTO
-- ------------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.convertir_licitacion_a_proyecto_atomico(
  p_empresa_id UUID,
  p_name TEXT,
  p_code TEXT,
  p_client TEXT,
  p_comitente TEXT,
  p_contract_number TEXT,
  p_contract_amount NUMERIC,
  p_budget_total NUMERIC,
  p_plazo_dias INTEGER,
  p_anticipo_pct NUMERIC,
  p_retencion_pct NUMERIC,
  p_start_date DATE,
  p_end_date DATE,
  p_tender_id TEXT,
  p_bid_analysis_run_id UUID,
  p_created_by UUID,
  p_budget_items JSONB,
  p_nombre_deposito TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_current_empresa UUID;
  v_project_id UUID;
  v_existing_code TEXT;
  v_existing_tender_id TEXT;
  v_existing_deposito_proj UUID;
  v_item JSONB;
  v_sort_order INT := 1;
  v_lic_decision TEXT;
  v_lic_empresa UUID;
  v_lic_proj UUID;
  v_lic_db_id UUID;
  v_lic_proc_id UUID;
  v_run_empresa UUID;
  v_item_qty NUMERIC;
  v_item_price NUMERIC;
  v_item_desc TEXT;
  v_item_unit TEXT;
  v_calculated_budget_total NUMERIC(18,2) := 0;
BEGIN
  -- 8.1 Seguridad Multi-Tenant
  IF auth.uid() IS NOT NULL THEN
    v_current_empresa := public.current_empresa_id();
    IF v_current_empresa IS NULL OR v_current_empresa <> p_empresa_id THEN
      RAISE EXCEPTION 'Acceso denegado: el usuario autenticado no pertenece a la empresa especificada (%)', p_empresa_id;
    END IF;
  END IF;

  -- 8.2 Validación de Items de Presupuesto: estrictamente no vacío
  IF p_budget_items IS NULL OR jsonb_array_length(p_budget_items) = 0 THEN
    RAISE EXCEPTION 'No se puede convertir licitacion a proyecto sin items de presupuesto';
  END IF;

  -- 8.3 Verificación de la Licitación de origen
  IF p_tender_id IS NOT NULL AND trim(p_tender_id) <> '' THEN
    SELECT id, empresa_id, decision, project_id, process_id
    INTO v_lic_db_id, v_lic_empresa, v_lic_decision, v_lic_proj, v_lic_proc_id
    FROM public.licitaciones
    WHERE (id::TEXT = p_tender_id OR dncp_nro = p_tender_id)
      AND empresa_id = p_empresa_id;

    IF v_lic_empresa IS NULL THEN
      RAISE EXCEPTION 'Licitación % no encontrada para la empresa %', p_tender_id, p_empresa_id;
    END IF;

    IF COALESCE(v_lic_decision, '') <> 'GANADA' THEN
      RAISE EXCEPTION 'Integridad contractual violada: la licitación % no tiene decisión GANADA (estado actual: %)', p_tender_id, COALESCE(v_lic_decision, 'SIN_DECISION');
    END IF;

    -- Si la licitación ya tiene obra vinculada por FK
    IF v_lic_proj IS NOT NULL THEN
      SELECT id, code INTO v_project_id, v_existing_code
      FROM public.projects
      WHERE id = v_lic_proj AND empresa_id = p_empresa_id;

      IF v_project_id IS NOT NULL THEN
        RETURN jsonb_build_object(
          'success', true,
          'already_existed', true,
          'project_id', v_project_id,
          'project_code', v_existing_code
        );
      END IF;
    END IF;
  END IF;

  -- 8.4 Verificación de corrida de análisis comercial (si fue provista)
  IF p_bid_analysis_run_id IS NOT NULL THEN
    SELECT empresa_id INTO v_run_empresa
    FROM public.bid_analysis_runs
    WHERE id = p_bid_analysis_run_id;

    IF v_run_empresa IS NULL OR v_run_empresa <> p_empresa_id THEN
      RAISE EXCEPTION 'La corrida de análisis % no pertenece a la empresa %', p_bid_analysis_run_id, p_empresa_id;
    END IF;
  END IF;

  -- 8.5 Idempotencia y Prevención de Colisiones por Código de Obra
  SELECT id, code, tender_id INTO v_project_id, v_existing_code, v_existing_tender_id
  FROM public.projects
  WHERE empresa_id = p_empresa_id AND code = p_code;

  IF v_project_id IS NOT NULL THEN
    -- Si existe para la misma licitación, es idempotente
    IF v_existing_tender_id IS NOT NULL AND (v_existing_tender_id = p_tender_id OR (v_lic_db_id IS NOT NULL AND v_existing_tender_id = v_lic_db_id::TEXT)) THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_existed', true,
        'project_id', v_project_id,
        'project_code', v_existing_code
      );
    ELSE
      -- Colisión con otra licitación o proyecto diferente
      RAISE EXCEPTION 'Conflicto: el código de obra % ya existe para la empresa y pertenece a otro origen (%)', p_code, COALESCE(v_existing_tender_id, 'MANUAL');
    END IF;
  END IF;

  -- 8.6 Validar y calcular suma reconciliada de items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_budget_items) LOOP
    v_item_desc := trim(COALESCE(v_item->>'description', ''));
    v_item_unit := trim(COALESCE(v_item->>'unit', ''));
    v_item_qty := (v_item->>'quantity')::NUMERIC;
    v_item_price := (v_item->>'unit_price')::NUMERIC;

    IF v_item_desc = '' THEN
      RAISE EXCEPTION 'Ítem #% inválido: la descripción no puede estar vacía', v_sort_order;
    END IF;
    IF v_item_unit = '' THEN
      RAISE EXCEPTION 'Ítem "%" inválido: la unidad de medida es obligatoria y no puede inventarse', v_item_desc;
    END IF;
    IF v_item_qty IS NULL OR v_item_qty <= 0 THEN
      RAISE EXCEPTION 'Ítem "%" inválido: cantidad (%) debe ser estrictamente mayor a cero', v_item_desc, v_item_qty;
    END IF;
    IF v_item_price IS NULL OR v_item_price < 0 THEN
      RAISE EXCEPTION 'Ítem "%" inválido: precio unitario (%) no puede ser nulo ni negativo', v_item_desc, v_item_price;
    END IF;

    v_calculated_budget_total := v_calculated_budget_total + (v_item_qty * v_item_price);
    v_sort_order := v_sort_order + 1;
  END LOOP;

  -- Reconciliación: Si p_budget_total fue enviado y difiere significativamente del cálculo real de items
  IF p_budget_total IS NOT NULL AND p_budget_total > 0 THEN
    IF abs(p_budget_total - v_calculated_budget_total) > 1.0 THEN
      RAISE EXCEPTION 'Discrepancia en presupuesto: p_budget_total (%) no coincide con la suma calculada de ítems (%)', p_budget_total, v_calculated_budget_total;
    END IF;
  END IF;

  -- 8.7 Insertar Proyecto
  INSERT INTO public.projects (
    empresa_id,
    name,
    code,
    client,
    comitente,
    contract_number,
    contract_amount,
    budget_total,
    plazo_dias,
    anticipo_pct,
    retencion_pct,
    start_date,
    end_date,
    tender_id,
    bid_analysis_run_id,
    status,
    created_by
  ) VALUES (
    p_empresa_id,
    p_name,
    p_code,
    p_client,
    p_comitente,
    p_contract_number,
    p_contract_amount,
    v_calculated_budget_total,
    p_plazo_dias,
    p_anticipo_pct,
    p_retencion_pct,
    p_start_date,
    p_end_date,
    p_tender_id,
    p_bid_analysis_run_id,
    'ACTIVO',
    COALESCE(p_created_by, auth.uid())
  ) RETURNING id INTO v_project_id;

  -- 8.8 Insertar Budget Items de forma atómica
  v_sort_order := 1;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_budget_items) LOOP
    INSERT INTO public.budget_items (
      project_id,
      code,
      description,
      unit,
      quantity,
      unit_price,
      sort_order
    ) VALUES (
      v_project_id,
      COALESCE(v_item->>'code', 'ITM-' || LPAD(v_sort_order::TEXT, 3, '0')),
      trim(v_item->>'description'),
      trim(v_item->>'unit'),
      (v_item->>'quantity')::NUMERIC,
      (v_item->>'unit_price')::NUMERIC,
      COALESCE((v_item->>'sort_order')::INTEGER, v_sort_order)
    );
    v_sort_order := v_sort_order + 1;
  END LOOP;

  -- 8.9 Crear Depósito / Pañol de Obra vinculado
  IF p_nombre_deposito IS NOT NULL AND trim(p_nombre_deposito) <> '' THEN
    SELECT project_id INTO v_existing_deposito_proj
    FROM public.depositos
    WHERE empresa_id = p_empresa_id AND nombre = p_nombre_deposito;

    IF v_existing_deposito_proj IS NOT NULL AND v_existing_deposito_proj <> v_project_id THEN
      RAISE EXCEPTION 'Conflicto de pañol: el depósito "%" ya existe y pertenece a otra obra (%)', p_nombre_deposito, v_existing_deposito_proj;
    ELSIF v_existing_deposito_proj IS NULL THEN
      INSERT INTO public.depositos (
        empresa_id,
        nombre,
        es_principal,
        project_id,
        activo
      ) VALUES (
        p_empresa_id,
        p_nombre_deposito,
        false,
        v_project_id,
        true
      );
    END IF;
  END IF;

  -- 8.10 Actualizar Enlace Relacional Canónico en public.licitaciones
  IF p_tender_id IS NOT NULL AND trim(p_tender_id) <> '' THEN
    UPDATE public.licitaciones
    SET 
      project_id = v_project_id,
      raw_json = jsonb_set(
        COALESCE(raw_json, '{}'::JSONB),
        '{obra_vinculada}',
        jsonb_build_object(
          'project_id', v_project_id,
          'project_code', p_code,
          'converted_at', timezone('utc'::TEXT, now())
        )
      ),
      updated_at = timezone('utc'::TEXT, now())
    WHERE (id::TEXT = p_tender_id OR dncp_nro = p_tender_id)
      AND empresa_id = p_empresa_id;

    -- También actualizar seguimiento si existe
    IF v_lic_proc_id IS NOT NULL THEN
      UPDATE public.empresa_licitacion_seguimiento
      SET project_id = v_project_id, updated_at = now()
      WHERE empresa_id = p_empresa_id AND process_id = v_lic_proc_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_existed', false,
    'project_id', v_project_id,
    'project_code', p_code
  );
END;
$$;
