-- 0068: P1 PLANNING CURRENCY FALLBACK & RECOVERY
CREATE OR REPLACE FUNCTION public.ingestar_proceso_ocds_global(
  p_cr JSONB,
  p_fuente TEXT DEFAULT 'DNCP_OCDS'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
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
  v_award_supplier_ids UUID[];
  v_contract_supplier_ids UUID[];
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
  -- Compatibilidad Canónica P0: p_cr permanece como parámetro con nombre.
  -- Si p_cr contiene compiledRelease, normalizar internamente y preservar el paquete completo en raw_json.
  -- Si p_cr es bare compiledRelease, soportarlo de forma transparente.
  IF p_cr ? 'compiledRelease' THEN
    v_cr := p_cr->'compiledRelease';
    IF p_cr ? 'releases' AND jsonb_typeof(p_cr->'releases') = 'array' THEN
      v_releases := p_cr->'releases';
      -- Extraer metadatos cronológicos de releases con semántica honesta (RELEASE_INDEX / RELEASE_REFERENCE)
      SELECT jsonb_agg(jsonb_build_object(
        'id', COALESCE(rel->>'id', rel->>'url'),
        'date', rel->>'date',
        'tag', rel->'tag',
        'url', rel->>'url',
        'initiationType', rel->>'initiationType',
        'release_type', CASE 
          WHEN rel ? 'tender' OR rel ? 'contracts' OR rel ? 'awards' THEN 'FULL_RELEASE'
          ELSE 'RELEASE_REFERENCE'
        END,
        'payload_sha256', encode(digest(rel::TEXT, 'sha256'), 'hex')
      )) INTO v_releases_metadata
      FROM jsonb_array_elements(v_releases) AS rel;
    END IF;
  ELSE
    v_cr := p_cr;
  END IF;

  v_ocid := v_cr->>'ocid';
  IF v_ocid IS NULL OR trim(v_ocid) = '' THEN
    RAISE EXCEPTION 'compiledRelease no contiene ocid válido';
  END IF;

  v_tender := COALESCE(v_cr->'tender', '{}'::JSONB);
  v_planning := COALESCE(v_cr->'planning', '{}'::JSONB);
  v_dncp_nro := COALESCE(v_tender->>'id', split_part(v_ocid, '-', 3));
  v_titulo := COALESCE(v_tender->>'title', v_planning->'budget'->>'description', 'Sin título');
  v_buyer_name := COALESCE(v_cr->'buyer'->>'name', v_tender->'procuringEntity'->>'name');
  v_buyer_id := COALESCE(v_cr->'buyer'->>'id', v_tender->'procuringEntity'->>'id');

  -- 9. HASH SEMANTICS: SHA-256 CANÓNICO (NO MD5)
  v_sha := encode(digest(p_cr::TEXT, 'sha256'), 'hex');

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

  -- 2. Calcular montos (sin forzar PYG si no está verificado en evidencia)
  v_monto_disp := (v_planning->'budget'->'amount'->>'amount')::NUMERIC;
  v_monto_ref := (v_tender->'value'->>'amount')::NUMERIC;
  -- 2. Precedencia autorizada de moneda:
  -- 1. tender.value.currency
  -- 2. planning.budget.amount.currency
  -- 3. NULL -> fail closed
  v_moneda := COALESCE(v_tender->'value'->>'currency', v_planning->'budget'->'amount'->>'currency');
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
      v_estado, v_tender->>'statusDetails', p_cr, v_sha, p_fuente,
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
      raw_json = p_cr,
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

  -- 7. Ingestar Adjudicaciones (Multi-supplier semantics: join table is canonical)
  IF jsonb_typeof(v_cr->'awards') = 'array' THEN
    FOR v_award IN SELECT * FROM jsonb_array_elements(v_cr->'awards') LOOP
      IF v_award->>'status' <> 'unsuccessful' THEN
        v_award_dncp_id := COALESCE(v_award->>'id', '1');
        v_award_supplier_ids := ARRAY[]::UUID[];

        -- Recolectar todos los proveedores verificados de la adjudicación
        IF jsonb_typeof(v_award->'suppliers') = 'array' THEN
          FOR v_party IN SELECT * FROM jsonb_array_elements(v_award->'suppliers') LOOP
            v_ruc_clean := public.normalizar_ruc(v_party->>'id');
            IF v_ruc_clean IS NOT NULL THEN
              SELECT id INTO v_supplier_id FROM public.procurement_suppliers WHERE ruc_clean = v_ruc_clean;
              IF v_supplier_id IS NOT NULL AND NOT (v_supplier_id = ANY(v_award_supplier_ids)) THEN
                v_award_supplier_ids := array_append(v_award_supplier_ids, v_supplier_id);
              END IF;
            END IF;
          END LOOP;
        END IF;

        -- Semántica Multi-Proveedor Canónica:
        -- Exactamente 1 proveedor verificado -> supplier_id = ese ID
        -- Más de 1 proveedor verificado -> supplier_id = NULL
        -- Cero proveedores verificados -> supplier_id = NULL
        IF array_length(v_award_supplier_ids, 1) = 1 THEN
          v_supplier_id := v_award_supplier_ids[1];
        ELSE
          v_supplier_id := NULL;
        END IF;

        INSERT INTO public.procurement_awards (
          process_id, award_dncp_id, supplier_id, monto_adjudicado,
          moneda, fecha_adjudicacion, status, raw_payload
        ) VALUES (
          v_process_id,
          v_award_dncp_id,
          v_supplier_id,
          (v_award->'value'->>'amount')::NUMERIC,
          COALESCE(v_award->'value'->>'currency', v_moneda),
          (v_award->>'date')::TIMESTAMPTZ,
          v_award->>'status',
          v_award
        )
        ON CONFLICT (process_id, award_dncp_id) DO UPDATE SET
          supplier_id = EXCLUDED.supplier_id,
          monto_adjudicado = EXCLUDED.monto_adjudicado,
          moneda = COALESCE(EXCLUDED.moneda, procurement_awards.moneda),
          status = EXCLUDED.status,
          raw_payload = EXCLUDED.raw_payload
        RETURNING id INTO v_award_db_id;

        -- Ingestar TODOS los proveedores adjudicados en la tabla join procurement_award_suppliers
        IF array_length(v_award_supplier_ids, 1) > 0 THEN
          FOREACH v_supplier_id IN ARRAY v_award_supplier_ids LOOP
            INSERT INTO public.procurement_award_suppliers (award_id, supplier_id)
            VALUES (v_award_db_id, v_supplier_id)
            ON CONFLICT (award_id, supplier_id) DO NOTHING;

            INSERT INTO public.procurement_bids (process_id, supplier_id, gano, fuente)
            VALUES (v_process_id, v_supplier_id, true, 'API')
            ON CONFLICT (process_id, supplier_id) DO UPDATE SET gano = true;
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
        v_contract_moneda := COALESCE(v_contract->'value'->>'currency', v_moneda);
        v_fecha_inicio := (v_contract->'period'->>'startDate')::TIMESTAMPTZ;
        v_fecha_fin := (v_contract->'period'->>'endDate')::TIMESTAMPTZ;
        v_duracion_dias_orig := NULL;

        IF v_fecha_inicio IS NOT NULL AND v_fecha_fin IS NOT NULL THEN
          v_duracion_dias_orig := extract(day from (v_fecha_fin - v_fecha_inicio))::INTEGER;
        END IF;

        -- CONTRACT -> AWARD -> SUPPLIER CHAIN:
        v_contract_award_id := NULL;
        v_contract_supplier_id := NULL;
        v_contract_supplier_ids := ARRAY[]::UUID[];

        IF v_contract->>'awardID' IS NOT NULL THEN
          SELECT id INTO v_contract_award_id
          FROM public.procurement_awards
          WHERE process_id = v_process_id AND award_dncp_id = (v_contract->>'awardID');
        END IF;

        -- 1. Si el contrato trae suppliers directamente, recolectar proveedores verificados
        IF jsonb_typeof(v_contract->'suppliers') = 'array' AND jsonb_array_length(v_contract->'suppliers') > 0 THEN
          FOR v_party IN SELECT * FROM jsonb_array_elements(v_contract->'suppliers') LOOP
            v_ruc_clean := public.normalizar_ruc(v_party->>'id');
            IF v_ruc_clean IS NOT NULL THEN
              SELECT id INTO v_supplier_id FROM public.procurement_suppliers WHERE ruc_clean = v_ruc_clean;
              IF v_supplier_id IS NOT NULL AND NOT (v_supplier_id = ANY(v_contract_supplier_ids)) THEN
                v_contract_supplier_ids := array_append(v_contract_supplier_ids, v_supplier_id);
              END IF;
            END IF;
          END LOOP;
        ELSIF v_contract_award_id IS NOT NULL THEN
          -- 2. Si el contrato no trae suppliers, heredar proveedores de la adjudicación vinculada
          SELECT ARRAY_AGG(DISTINCT supplier_id) INTO v_contract_supplier_ids
          FROM public.procurement_award_suppliers
          WHERE award_id = v_contract_award_id;
        END IF;

        -- Semántica Multi-Proveedor Canónica:
        -- Exactamente 1 proveedor verificado -> supplier_id = ese ID
        -- Más de 1 proveedor verificado -> supplier_id = NULL
        -- Cero proveedores verificados -> supplier_id = NULL
        IF v_contract_supplier_ids IS NOT NULL AND array_length(v_contract_supplier_ids, 1) = 1 THEN
          v_contract_supplier_id := v_contract_supplier_ids[1];
        ELSE
          v_contract_supplier_id := NULL;
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
          supplier_id = EXCLUDED.supplier_id,
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
        IF v_contract_supplier_ids IS NOT NULL AND array_length(v_contract_supplier_ids, 1) > 0 THEN
          FOREACH v_supplier_id IN ARRAY v_contract_supplier_ids LOOP
            INSERT INTO public.procurement_contract_suppliers (contract_id, supplier_id)
            VALUES (v_contract_db_id, v_supplier_id)
            ON CONFLICT (contract_id, supplier_id) DO NOTHING;
          END LOOP;
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
            v_amendment_moneda := COALESCE(v_amendment->'amendsAmount'->>'currency', v_contract_moneda);

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
        v_amendment_moneda := COALESCE(v_contract->'value'->>'currency', v_moneda);

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
