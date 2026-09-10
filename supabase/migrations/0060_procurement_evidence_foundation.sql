-- ===========================================================================
-- GATE 2: PROCUREMENT EVIDENCE FOUNDATION
-- Separación canónica de hechos públicos globales vs decisiones privadas de tenant.
-- Ingestión idempotente, versionado append-only y normalización de RUC/entidades.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Funciones auxiliares de normalización canónica (RUC, texto, checksum)
-- ---------------------------------------------------------------------------

create or replace function public.normalizar_ruc(p_ruc text)
returns text language plpgsql immutable as $$
declare
  v_clean text;
begin
  if p_ruc is null or trim(p_ruc) = '' then
    return null;
  end if;
  v_clean := regexp_replace(trim(p_ruc), '\s+', '', 'g');
  if position('-' in v_clean) > 0 then
    v_clean := split_part(v_clean, '-', 1);
  end if;
  v_clean := regexp_replace(v_clean, '[^a-zA-Z0-9]', '', 'g');
  if length(v_clean) = 0 then
    return null;
  end if;
  return upper(v_clean);
end;
$$;

create or replace function public.extraer_dv_ruc(p_ruc text)
returns text language plpgsql immutable as $$
declare
  v_clean text;
begin
  if p_ruc is null or trim(p_ruc) = '' then
    return null;
  end if;
  v_clean := regexp_replace(trim(p_ruc), '\s+', '', 'g');
  if position('-' in v_clean) > 0 then
    return split_part(v_clean, '-', 2);
  end if;
  return null;
end;
$$;

create or replace function public.calcular_dv_ruc_py(p_ruc text)
returns text language plpgsql immutable as $$
declare
  v_base text;
  v_total int := 0;
  v_k int := 2;
  v_i int;
  v_char char;
  v_digit int;
  v_resto int;
begin
  v_base := public.normalizar_ruc(p_ruc);
  if v_base is null or length(v_base) = 0 then
    return null;
  end if;

  for v_i in reverse length(v_base)..1 loop
    v_char := substr(v_base, v_i, 1);
    if v_char between '0' and '9' then
      v_digit := ascii(v_char) - 48;
    else
      v_digit := ascii(upper(v_char));
    end if;
    v_total := v_total + (v_digit * v_k);
    v_k := v_k + 1;
    if v_k > 11 then
      v_k := 2;
    end if;
  end loop;

  v_resto := v_total % 11;
  if v_resto > 1 then
    return (11 - v_resto)::text;
  else
    return '0';
  end if;
end;
$$;

create or replace function public.normalizar_texto(p_text text)
returns text language plpgsql immutable as $$
begin
  if p_text is null then
    return null;
  end if;
  -- Quitar acentos y dobles espacios, convertir a mayúsculas
  return upper(trim(regexp_replace(
    translate(p_text, 'áéíóúÁÉÍÓÚñÑüÜ', 'aeiouAEIOUnNuU'),
    '\s+', ' ', 'g'
  )));
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Esquema Global de Hechos Públicos (sin empresa_id)
-- ---------------------------------------------------------------------------

-- 2.1 Convocantes / Entidades Compradoras Canónicas
create table if not exists public.procurement_entities (
  id                  uuid primary key default gen_random_uuid(),
  dncp_id             text unique,                    -- Código SICP de la DNCP
  ruc                 text,
  nombre              text not null,
  nombre_normalizado  text not null,
  siglas              text,
  nivel_gobierno      text,                           -- CENTRAL / DESCENTRALIZADO / MUNICIPAL / DEPARTAMENTAL
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_procurement_entities_dncp on public.procurement_entities(dncp_id);
create index if not exists idx_procurement_entities_norm on public.procurement_entities(nombre_normalizado);

-- 2.2 Procesos de Contratación Públicos Globales
create table if not exists public.procurement_processes (
  id                          uuid primary key default gen_random_uuid(),
  ocid                        text not null unique,   -- "ocds-03ad3f-391731"
  dncp_nro                    text not null,          -- "391731"
  titulo                      text not null,
  entity_id                   uuid references public.procurement_entities(id) on delete set null,
  comitente_nombre            text,
  comitente_id                text,                   -- DNCP-SICP-CODE crudo
  categoria                   text,                   -- works / goods / services
  categoria_detalle           text,
  procurement_method          text,
  procurement_method_detalle  text,
  award_criteria_detalle      text,
  monto_referencial           numeric(18,2),
  monto_disponible            numeric(18,2),
  moneda                      text not null default 'PYG',
  fecha_publicacion           timestamptz,
  fecha_consultas_fin         timestamptz,
  fecha_entrega_ofertas       timestamptz,
  fecha_apertura              timestamptz,
  lugar_apertura              text,
  estado                      text,                   -- CONVOCATORIA / ADJUDICADA / CANCELADA / DESIERTA
  estado_detalle              text,
  raw_json                    jsonb,
  payload_sha256              text,
  fuente                      text not null default 'DNCP_OCDS',
  sync_count                  int not null default 1,
  first_synced_at             timestamptz not null default now(),
  last_synced_at              timestamptz not null default now(),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index if not exists idx_proc_processes_nro on public.procurement_processes(dncp_nro);
create index if not exists idx_proc_processes_ocid on public.procurement_processes(ocid);
create index if not exists idx_proc_processes_estado on public.procurement_processes(estado);
create index if not exists idx_proc_processes_fecha_apertura on public.procurement_processes(fecha_apertura);
create index if not exists idx_proc_processes_entity on public.procurement_processes(entity_id);

-- 2.3 Historial Append-Only de Cambios (Versionado de estados y adendas)
create table if not exists public.procurement_process_history (
  id              uuid primary key default gen_random_uuid(),
  process_id      uuid not null references public.procurement_processes(id) on delete cascade,
  estado_anterior text,
  estado_nuevo    text,
  fecha_cambio    timestamptz not null default now(),
  change_diff     jsonb,
  payload_sha256  text,
  observed_at     timestamptz not null default now()
);
create index if not exists idx_proc_hist_proc on public.procurement_process_history(process_id, observed_at);

-- 2.4 Lotes Globales
create table if not exists public.procurement_lots (
  id                uuid primary key default gen_random_uuid(),
  process_id        uuid not null references public.procurement_processes(id) on delete cascade,
  lote_dncp_id      text not null,
  numero            int,
  titulo            text,
  monto_referencial numeric(18,2),
  created_at        timestamptz not null default now(),
  unique (process_id, lote_dncp_id)
);
create index if not exists idx_proc_lots_proc on public.procurement_lots(process_id);

-- 2.5 Ítems de la Planilla Referencial Globales
create table if not exists public.procurement_items (
  id                          uuid primary key default gen_random_uuid(),
  process_id                  uuid not null references public.procurement_processes(id) on delete cascade,
  lot_id                      uuid references public.procurement_lots(id) on delete set null,
  codigo_catalogo             text,                   -- N5 DNCP
  codigo_unspsc               text,
  descripcion                 text not null,
  cantidad                    numeric(18,4),
  unidad                      text,
  precio_unitario_referencial numeric(18,2),
  sort_order                  int not null default 0,
  created_at                  timestamptz not null default now()
);
create index if not exists idx_proc_items_proc on public.procurement_items(process_id);
create index if not exists idx_proc_items_cat on public.procurement_items(codigo_catalogo) where codigo_catalogo is not null;

-- 2.6 Proveedores / Oferentes Canónicos Globales
create table if not exists public.procurement_suppliers (
  id                  uuid primary key default gen_random_uuid(),
  ruc_clean           text not null unique,           -- "80012345"
  ruc_raw             text,                           -- "80012345-6"
  dv                  text,                           -- "6"
  nombre              text not null,
  nombre_normalizado  text not null,
  tamano              text,
  tipo_entidad        text not null default 'EMPRESA',-- PERSONA_FISICA / SA / SRL / CONSORCIO
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_proc_suppliers_clean on public.procurement_suppliers(ruc_clean);
create index if not exists idx_proc_suppliers_norm on public.procurement_suppliers(nombre_normalizado);

-- 2.7 Ofertas / Participaciones Públicas en el Proceso
create table if not exists public.procurement_bids (
  id              uuid primary key default gen_random_uuid(),
  process_id      uuid not null references public.procurement_processes(id) on delete cascade,
  supplier_id     uuid not null references public.procurement_suppliers(id) on delete cascade,
  monto_ofertado  numeric(18,2),
  gano            boolean not null default false,
  lotes_ganados   text[] not null default '{}',
  fuente          text not null default 'API'
                  check (fuente in ('API', 'ACTA_PDF', 'CUADRO_PDF', 'MANUAL')),
  payload_sha256  text,
  created_at      timestamptz not null default now(),
  unique (process_id, supplier_id)
);
create index if not exists idx_proc_bids_proc on public.procurement_bids(process_id);
create index if not exists idx_proc_bids_supp on public.procurement_bids(supplier_id);

-- 2.8 Adjudicaciones Oficiales Globales
create table if not exists public.procurement_awards (
  id                  uuid primary key default gen_random_uuid(),
  process_id          uuid not null references public.procurement_processes(id) on delete cascade,
  award_dncp_id       text not null,
  supplier_id         uuid references public.procurement_suppliers(id) on delete set null,
  monto_adjudicado    numeric(18,2),
  moneda              text not null default 'PYG',
  fecha_adjudicacion  timestamptz,
  status              text,
  raw_payload         jsonb,
  created_at          timestamptz not null default now(),
  unique (process_id, award_dncp_id)
);
create index if not exists idx_proc_awards_proc on public.procurement_awards(process_id);
create index if not exists idx_proc_awards_supp on public.procurement_awards(supplier_id);

-- 2.9 Contratos Formales Globales
create table if not exists public.procurement_contracts (
  id                  uuid primary key default gen_random_uuid(),
  process_id          uuid not null references public.procurement_processes(id) on delete cascade,
  award_id            uuid references public.procurement_awards(id) on delete set null,
  supplier_id         uuid references public.procurement_suppliers(id) on delete set null,
  contract_dncp_id    text not null,
  numero_contrato     text,
  monto_contrato      numeric(18,2),
  fecha_firma         timestamptz,
  fecha_inicio        timestamptz,
  fecha_fin           timestamptz,
  status              text,
  created_at          timestamptz not null default now(),
  unique (process_id, contract_dncp_id)
);
create index if not exists idx_proc_contracts_proc on public.procurement_contracts(process_id);

-- 2.10 Documentos Públicos de la Licitación
create table if not exists public.procurement_documents (
  id              uuid primary key default gen_random_uuid(),
  process_id      uuid not null references public.procurement_processes(id) on delete cascade,
  tipo            text,
  tipo_detalle    text,
  titulo          text,
  url_dncp        text,
  format          text,
  storage_path    text,
  file_sha256     text,
  is_scanned      boolean,
  created_at      timestamptz not null default now()
);
create index if not exists idx_proc_docs_proc on public.procurement_documents(process_id);

-- ---------------------------------------------------------------------------
-- 3. Esquema Privado del Tenant (Decisiones, GO/NO-GO y Seguimiento Interno)
-- ---------------------------------------------------------------------------

create table if not exists public.empresa_licitacion_seguimiento (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references public.empresas(id) on delete cascade,
  process_id          uuid not null references public.procurement_processes(id) on delete cascade,
  decision            text not null default 'SIN_REVISAR'
                      check (decision in ('SIN_REVISAR', 'SELECCIONADA', 'EN_PREPARACION',
                                          'PRESENTADA', 'GANADA', 'PERDIDA', 'DESCARTADA')),
  decision_notas      text,
  go_no_go_score      numeric(5,2),
  go_no_go_evaluacion jsonb,
  invitada            boolean not null default false,
  project_id          uuid references public.projects(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (empresa_id, process_id)
);
create index if not exists idx_empresa_seg_empresa on public.empresa_licitacion_seguimiento(empresa_id);
create index if not exists idx_empresa_seg_proc on public.empresa_licitacion_seguimiento(process_id);
create index if not exists idx_empresa_seg_decision on public.empresa_licitacion_seguimiento(empresa_id, decision);

-- ---------------------------------------------------------------------------
-- 4. Puente de Retrocompatibilidad No Destructivo con public.licitaciones
-- ---------------------------------------------------------------------------

-- Añadir process_id a la tabla existente public.licitaciones si no existe
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'licitaciones') then
    if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'licitaciones' and column_name = 'process_id') then
      alter table public.licitaciones add column process_id uuid references public.procurement_processes(id) on delete set null;
      create index if not exists idx_licitaciones_process_id on public.licitaciones(process_id);
    end if;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RPC Transaccional e Idempotente de Ingestión Global OCDS
-- ---------------------------------------------------------------------------

create or replace function public.ingestar_proceso_ocds_global(
  p_cr jsonb,
  p_fuente text default 'DNCP_OCDS'
)
returns uuid
language plpgsql
security definer
as $$
declare
  v_tender jsonb;
  v_planning jsonb;
  v_ocid text;
  v_dncp_nro text;
  v_titulo text;
  v_buyer_name text;
  v_buyer_id text;
  v_entity_id uuid;
  v_process_id uuid;
  v_sha text;
  v_estado text;
  v_estado_anterior text;
  v_monto_ref numeric(18,2);
  v_monto_disp numeric(18,2);
  v_moneda text;
  v_item jsonb;
  v_subitem jsonb;
  v_lot jsonb;
  v_lot_id uuid;
  v_party jsonb;
  v_award jsonb;
  v_contract jsonb;
  v_doc jsonb;
  v_ruc_clean text;
  v_supplier_id uuid;
  v_supplier_name text;
  v_supplier_scale text;
begin
  v_ocid := p_cr->>'ocid';
  if v_ocid is null or trim(v_ocid) = '' then
    raise exception 'compiledRelease no contiene ocid válido';
  end if;

  v_tender := coalesce(p_cr->'tender', '{}'::jsonb);
  v_planning := coalesce(p_cr->'planning', '{}'::jsonb);
  v_sha := encode(digest(p_cr::text, 'sha256'), 'hex');

  -- Extraer dncp_nro
  v_dncp_nro := substring(v_ocid from '^ocds-[^-]+-(\d+)');
  if v_dncp_nro is null then
    v_dncp_nro := substring(v_tender->>'id' from '(\d+)');
  end if;
  if v_dncp_nro is null then
    v_dncp_nro := v_ocid;
  end if;

  v_titulo := coalesce(v_tender->>'title', '(sin título)');
  v_buyer_name := v_tender->'procuringEntity'->>'name';
  v_buyer_id := v_tender->'procuringEntity'->>'id';

  -- 1. Upsert Convocante Canónico
  if v_buyer_name is not null and trim(v_buyer_name) <> '' then
    insert into public.procurement_entities (dncp_id, nombre, nombre_normalizado)
    values (
      v_buyer_id,
      v_buyer_name,
      public.normalizar_texto(v_buyer_name)
    )
    on conflict (dncp_id) do update set
      nombre = excluded.nombre,
      nombre_normalizado = excluded.nombre_normalizado,
      updated_at = now()
    returning id into v_entity_id;
  end if;

  -- 2. Calcular montos
  v_monto_disp := (v_planning->'budget'->'amount'->>'amount')::numeric;
  v_monto_ref := (v_tender->'value'->>'amount')::numeric;
  v_moneda := coalesce(v_tender->'value'->>'currency', 'PYG');
  v_estado := upper(coalesce(v_tender->>'status', 'PLANNING'));

  -- 3. Upsert Proceso Global
  select id, estado into v_process_id, v_estado_anterior
  from public.procurement_processes
  where ocid = v_ocid;

  if v_process_id is null then
    insert into public.procurement_processes (
      ocid, dncp_nro, titulo, entity_id, comitente_nombre, comitente_id,
      categoria, categoria_detalle, procurement_method, procurement_method_detalle,
      award_criteria_detalle, monto_referencial, monto_disponible, moneda,
      fecha_publicacion, fecha_consultas_fin, fecha_entrega_ofertas, fecha_apertura,
      lugar_apertura, estado, estado_detalle, raw_json, payload_sha256, fuente,
      sync_count, first_synced_at, last_synced_at
    ) values (
      v_ocid, v_dncp_nro, v_titulo, v_entity_id, v_buyer_name, v_buyer_id,
      v_tender->>'mainProcurementCategory', v_tender->>'mainProcurementCategoryDetails',
      v_tender->>'procurementMethod', v_tender->>'procurementMethodDetails',
      v_tender->>'awardCriteriaDetails', v_monto_ref, v_monto_disp, v_moneda,
      (v_tender->>'datePublished')::timestamptz,
      (v_tender->'enquiryPeriod'->>'endDate')::timestamptz,
      (v_tender->'tenderPeriod'->>'endDate')::timestamptz,
      (v_tender->'bidOpening'->>'date')::timestamptz,
      coalesce(v_tender->'bidOpening'->'address'->>'streetAddress', v_tender->>'submissionMethodDetails'),
      v_estado, v_tender->>'statusDetails', p_cr, v_sha, p_fuente,
      1, now(), now()
    ) returning id into v_process_id;
  else
    -- Registrar en historial si el estado cambió
    if v_estado_anterior is distinct from v_estado then
      insert into public.procurement_process_history (
        process_id, estado_anterior, estado_nuevo, payload_sha256, change_diff
      ) values (
        v_process_id, v_estado_anterior, v_estado, v_sha,
        jsonb_build_object('prev_status', v_estado_anterior, 'new_status', v_estado, 'date', now())
      );
    end if;

    update public.procurement_processes set
      titulo = v_titulo,
      entity_id = coalesce(v_entity_id, procurement_processes.entity_id),
      comitente_nombre = v_buyer_name,
      comitente_id = v_buyer_id,
      categoria = v_tender->>'mainProcurementCategory',
      categoria_detalle = v_tender->>'mainProcurementCategoryDetails',
      procurement_method = v_tender->>'procurementMethod',
      procurement_method_detalle = v_tender->>'procurementMethodDetails',
      award_criteria_detalle = v_tender->>'awardCriteriaDetails',
      monto_referencial = coalesce(v_monto_ref, procurement_processes.monto_referencial),
      monto_disponible = coalesce(v_monto_disp, procurement_processes.monto_disponible),
      moneda = v_moneda,
      fecha_publicacion = coalesce((v_tender->>'datePublished')::timestamptz, procurement_processes.fecha_publicacion),
      fecha_consultas_fin = (v_tender->'enquiryPeriod'->>'endDate')::timestamptz,
      fecha_entrega_ofertas = (v_tender->'tenderPeriod'->>'endDate')::timestamptz,
      fecha_apertura = (v_tender->'bidOpening'->>'date')::timestamptz,
      lugar_apertura = coalesce(v_tender->'bidOpening'->'address'->>'streetAddress', v_tender->>'submissionMethodDetails'),
      estado = v_estado,
      estado_detalle = v_tender->>'statusDetails',
      raw_json = p_cr,
      payload_sha256 = v_sha,
      sync_count = procurement_processes.sync_count + 1,
      last_synced_at = now(),
      updated_at = now()
    where id = v_process_id;
  end if;

  -- 4. Ingestar Lotes
  if jsonb_typeof(v_tender->'lots') = 'array' then
    for v_lot in select * from jsonb_array_elements(v_tender->'lots') loop
      insert into public.procurement_lots (
        process_id, lote_dncp_id, numero, titulo, monto_referencial
      ) values (
        v_process_id,
        coalesce(v_lot->>'id', '1'),
        (v_lot->>'numero')::int,
        v_lot->>'title',
        (v_lot->'value'->>'amount')::numeric
      )
      on conflict (process_id, lote_dncp_id) do update set
        titulo = excluded.titulo,
        monto_referencial = excluded.monto_referencial;
    end loop;
  end if;

  -- 5. Ingestar Ítems Referenciales
  if jsonb_typeof(v_tender->'items') = 'array' then
    -- Si ya existen ítems, limpiamos para re-insertar ordenados
    delete from public.procurement_items where process_id = v_process_id;
    for v_item in select * from jsonb_array_elements(v_tender->'items') loop
      select id into v_lot_id from public.procurement_lots
      where process_id = v_process_id and lote_dncp_id = (v_item->>'relatedLot');

      if jsonb_typeof(v_item->'subItems') = 'array' and jsonb_array_length(v_item->'subItems') > 0 then
        for v_subitem in select * from jsonb_array_elements(v_item->'subItems') loop
          insert into public.procurement_items (
            process_id, lot_id, codigo_catalogo, codigo_unspsc, descripcion,
            cantidad, unidad, precio_unitario_referencial
          ) values (
            v_process_id, v_lot_id,
            v_item->'classification'->>'id',
            v_item->'additionalClassifications'->0->>'id',
            coalesce(v_subitem->>'description', '(sin descripción)'),
            (v_subitem->>'quantity')::numeric,
            v_subitem->'unit'->>'name',
            (v_subitem->'unit'->'value'->>'amount')::numeric
          );
        end loop;
      else
        insert into public.procurement_items (
          process_id, lot_id, codigo_catalogo, codigo_unspsc, descripcion,
          cantidad, unidad, precio_unitario_referencial
        ) values (
          v_process_id, v_lot_id,
          v_item->'classification'->>'id',
          v_item->'additionalClassifications'->0->>'id',
          coalesce(v_item->>'description', v_item->'classification'->>'description', '(sin descripción)'),
          (v_item->>'quantity')::numeric,
          v_item->'unit'->>'name',
          (v_item->'unit'->'value'->>'amount')::numeric
        );
      end if;
    end loop;
  end if;

  -- 6. Ingestar Proveedores y Participaciones / Ofertas
  if jsonb_typeof(p_cr->'parties') = 'array' then
    for v_party in select * from jsonb_array_elements(p_cr->'parties') loop
      v_ruc_clean := public.normalizar_ruc(coalesce(v_party->'identifier'->>'id', v_party->>'id'));
      if v_ruc_clean is not null then
        v_supplier_name := coalesce(v_party->>'name', v_ruc_clean);
        v_supplier_scale := v_party->'details'->>'scale';

        insert into public.procurement_suppliers (
          ruc_clean, ruc_raw, dv, nombre, nombre_normalizado, tamano
        ) values (
          v_ruc_clean,
          coalesce(v_party->'identifier'->>'id', v_party->>'id'),
          public.extraer_dv_ruc(coalesce(v_party->'identifier'->>'id', v_party->>'id')),
          v_supplier_name,
          public.normalizar_texto(v_supplier_name),
          v_supplier_scale
        )
        on conflict (ruc_clean) do update set
          nombre = excluded.nombre,
          nombre_normalizado = excluded.nombre_normalizado,
          tamano = coalesce(excluded.tamano, procurement_suppliers.tamano),
          updated_at = now()
        returning id into v_supplier_id;
      end if;
    end loop;
  end if;

  if jsonb_typeof(v_tender->'tenderers') = 'array' then
    for v_party in select * from jsonb_array_elements(v_tender->'tenderers') loop
      v_ruc_clean := public.normalizar_ruc(v_party->>'id');
      if v_ruc_clean is not null then
        select id into v_supplier_id from public.procurement_suppliers where ruc_clean = v_ruc_clean;
        if v_supplier_id is not null then
          insert into public.procurement_bids (
            process_id, supplier_id, fuente
          ) values (
            v_process_id, v_supplier_id, 'API'
          )
          on conflict (process_id, supplier_id) do nothing;
        end if;
      end if;
    end loop;
  end if;

  -- 7. Ingestar Adjudicaciones
  if jsonb_typeof(p_cr->'awards') = 'array' then
    for v_award in select * from jsonb_array_elements(p_cr->'awards') loop
      if v_award->>'status' <> 'unsuccessful' then
        v_ruc_clean := public.normalizar_ruc(v_award->'suppliers'->0->>'id');
        v_supplier_id := null;
        if v_ruc_clean is not null then
          select id into v_supplier_id from public.procurement_suppliers where ruc_clean = v_ruc_clean;
        end if;

        insert into public.procurement_awards (
          process_id, award_dncp_id, supplier_id, monto_adjudicado,
          moneda, fecha_adjudicacion, status, raw_payload
        ) values (
          v_process_id,
          coalesce(v_award->>'id', '1'),
          v_supplier_id,
          (v_award->'value'->>'amount')::numeric,
          coalesce(v_award->'value'->>'currency', 'PYG'),
          (v_award->>'date')::timestamptz,
          v_award->>'status',
          v_award
        )
        on conflict (process_id, award_dncp_id) do update set
          supplier_id = excluded.supplier_id,
          monto_adjudicado = excluded.monto_adjudicado,
          status = excluded.status;

        -- Marcar ganador en bids
        if v_supplier_id is not null then
          insert into public.procurement_bids (process_id, supplier_id, gano, fuente)
          values (v_process_id, v_supplier_id, true, 'API')
          on conflict (process_id, supplier_id) do update set gano = true;
        end if;
      end if;
    end loop;
  end if;

  -- 8. Ingestar Contratos
  if jsonb_typeof(p_cr->'contracts') = 'array' then
    for v_contract in select * from jsonb_array_elements(p_cr->'contracts') loop
      insert into public.procurement_contracts (
        process_id, contract_dncp_id, numero_contrato, monto_contrato,
        fecha_firma, fecha_inicio, fecha_fin, status
      ) values (
        v_process_id,
        coalesce(v_contract->>'id', '1'),
        v_contract->>'title',
        (v_contract->'value'->>'amount')::numeric,
        (v_contract->>'dateSigned')::timestamptz,
        (v_contract->'period'->>'startDate')::timestamptz,
        (v_contract->'period'->>'endDate')::timestamptz,
        v_contract->>'status'
      )
      on conflict (process_id, contract_dncp_id) do update set
        monto_contrato = excluded.monto_contrato,
        status = excluded.status;
    end loop;
  end if;

  -- 9. Ingestar Documentos (Tender + Awards)
  if jsonb_typeof(v_tender->'documents') = 'array' then
    for v_doc in select * from jsonb_array_elements(v_tender->'documents') loop
      insert into public.procurement_documents (
        process_id, tipo, tipo_detalle, titulo, url_dncp, format
      ) values (
        v_process_id,
        v_doc->>'documentType',
        v_doc->>'documentTypeDetails',
        v_doc->>'title',
        v_doc->>'url',
        v_doc->>'format'
      );
    end loop;
  end if;

  return v_process_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Migración de Datos Existentes (0058 -> 0060)
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
  v_proc_id uuid;
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'licitaciones') then
    for r in select * from public.licitaciones loop
      if r.raw_json is not null then
        begin
          v_proc_id := public.ingestar_proceso_ocds_global(r.raw_json, 'LEGACY_MIGRATION');
          
          -- Enlazar en licitaciones legacy
          update public.licitaciones set process_id = v_proc_id where id = r.id;

          -- Registrar seguimiento privado del tenant
          insert into public.empresa_licitacion_seguimiento (
            empresa_id, process_id, decision, decision_notas, invitada, project_id, created_at, updated_at
          ) values (
            r.empresa_id, v_proc_id,
            coalesce(r.decision, 'SIN_REVISAR'),
            r.decision_notas,
            coalesce(r.invitada, false),
            r.project_id,
            r.created_at,
            r.updated_at
          )
          on conflict (empresa_id, process_id) do update set
            decision = excluded.decision,
            decision_notas = excluded.decision_notas,
            project_id = excluded.project_id;
        exception when others then
          -- Ignorar fallas individuales en datos corruptos legacy
          null;
        end;
      end if;
    end loop;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Políticas RLS (Aislamiento de Hechos Públicos vs Decisiones Privadas)
-- ---------------------------------------------------------------------------

alter table public.procurement_entities         enable row level security;
alter table public.procurement_processes        enable row level security;
alter table public.procurement_process_history  enable row level security;
alter table public.procurement_lots             enable row level security;
alter table public.procurement_items            enable row level security;
alter table public.procurement_suppliers        enable row level security;
alter table public.procurement_bids             enable row level security;
alter table public.procurement_awards           enable row level security;
alter table public.procurement_contracts        enable row level security;
alter table public.procurement_documents        enable row level security;
alter table public.empresa_licitacion_seguimiento enable row level security;

-- Hechos públicos: Lectura para usuarios autenticados
create policy "proc_entities_read" on public.procurement_entities for select to authenticated using (true);
create policy "proc_processes_read" on public.procurement_processes for select to authenticated using (true);
create policy "proc_history_read" on public.procurement_process_history for select to authenticated using (true);
create policy "proc_lots_read" on public.procurement_lots for select to authenticated using (true);
create policy "proc_items_read" on public.procurement_items for select to authenticated using (true);
create policy "proc_suppliers_read" on public.procurement_suppliers for select to authenticated using (true);
create policy "proc_bids_read" on public.procurement_bids for select to authenticated using (true);
create policy "proc_awards_read" on public.procurement_awards for select to authenticated using (true);
create policy "proc_contracts_read" on public.procurement_contracts for select to authenticated using (true);
create policy "proc_documents_read" on public.procurement_documents for select to authenticated using (true);

-- Decisiones del tenant: Aislamiento estricto por empresa
create policy "empresa_seg_select" on public.empresa_licitacion_seguimiento
  for select using (empresa_id = public.current_empresa_id());

create policy "empresa_seg_insert" on public.empresa_licitacion_seguimiento
  for insert with check (empresa_id = public.current_empresa_id());

create policy "empresa_seg_update" on public.empresa_licitacion_seguimiento
  for update using (empresa_id = public.current_empresa_id())
  with check (empresa_id = public.current_empresa_id());

create policy "empresa_seg_delete" on public.empresa_licitacion_seguimiento
  for delete using (empresa_id = public.current_empresa_id());
