-- ===========================================================================
-- GATE 5A: COMPETITOR INTELLIGENCE V1 (HUELLA COMPETITIVA CONTEXTUAL)
-- Análisis contextual de competidores: Empresa × Convocante × Rubro × Tamaño.
-- Fallback jerárquico, cálculo de agresividad de descuentos y certezas estadísticas.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Función para categorizar tamaño de contrato
-- ---------------------------------------------------------------------------
create or replace function public.categorizar_tamano_contrato(p_monto numeric)
returns text language sql immutable as $$
  select case
    when p_monto is null then 'DESCONOCIDO'
    when p_monto < 2000000000 then 'SMALL'      -- < 2.000 Millones PYG (~$270k USD)
    when p_monto <= 15000000000 then 'MEDIUM'  -- 2.000M a 15.000M PYG (~$2M USD)
    else 'LARGE'                               -- > 15.000 Millones PYG
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Vista Analítica de Huellas Competitivas Contextuales
-- ---------------------------------------------------------------------------
create or replace view public.v_procurement_competitor_contextual as
select
  b.supplier_id,
  s.nombre as supplier_nombre,
  s.ruc_clean,
  coalesce(p.comitente_nombre, 'DESCONOCIDO') as comitente_nombre,
  coalesce(p.categoria, 'OBRAS') as categoria,
  public.categorizar_tamano_contrato(coalesce(p.monto_referencial, b.monto_ofertado)) as size_bracket,
  count(b.id) as total_participaciones,
  count(b.id) filter (where b.gano = true or b.estado_oferta = 'GANADORA') as total_ganadas,
  case
    when count(b.id) > 0 then
      round((count(b.id) filter (where b.gano = true or b.estado_oferta = 'GANADORA')::numeric / count(b.id)::numeric) * 100, 1)
    else 0.0
  end as win_rate_pct,
  coalesce(sum(b.monto_ofertado) filter (where b.gano = true or b.estado_oferta = 'GANADORA'), 0) as total_monto_ganado,
  -- Cálculo de descuento medio respecto al precio referencial: (monto_ref - monto_ofertado) / monto_ref
  round(avg(
    case
      when p.monto_referencial > 0 and b.monto_ofertado > 0 then
        ((p.monto_referencial - b.monto_ofertado) / p.monto_referencial) * 100
      else null
    end
  ), 2) as avg_discount_pct,
  round(stddev_pop(
    case
      when p.monto_referencial > 0 and b.monto_ofertado > 0 then
        ((p.monto_referencial - b.monto_ofertado) / p.monto_referencial) * 100
      else null
    end
  ), 2) as stddev_discount_pct,
  count(b.id) filter (where p.monto_referencial > 0 and b.monto_ofertado > 0) as sample_size_with_price,
  case
    when count(b.id) >= 15 then 'ALTA'
    when count(b.id) >= 5  then 'MEDIA'
    when count(b.id) >= 2  then 'BAJA'
    else 'INSUFICIENTE'
  end as certainty_tier
from public.procurement_bids b
join public.procurement_suppliers s on s.id = b.supplier_id
join public.procurement_processes p on p.id = b.process_id
group by
  b.supplier_id,
  s.nombre,
  s.ruc_clean,
  coalesce(p.comitente_nombre, 'DESCONOCIDO'),
  coalesce(p.categoria, 'OBRAS'),
  public.categorizar_tamano_contrato(coalesce(p.monto_referencial, b.monto_ofertado));

-- ---------------------------------------------------------------------------
-- 3. Vista de Resumen Global por Proveedor / Competidor
-- ---------------------------------------------------------------------------
create or replace view public.v_procurement_competitor_global as
select
  s.id as supplier_id,
  s.nombre,
  s.nombre_normalizado,
  s.ruc_clean,
  s.ruc_raw,
  s.dv,
  s.tipo_entidad,
  s.tamano,
  count(b.id) as total_bids,
  count(b.id) filter (where b.gano = true or b.estado_oferta = 'GANADORA') as total_wins,
  case
    when count(b.id) > 0 then
      round((count(b.id) filter (where b.gano = true or b.estado_oferta = 'GANADORA')::numeric / count(b.id)::numeric) * 100, 1)
    else 0.0
  end as global_win_rate_pct,
  coalesce(sum(b.monto_ofertado) filter (where b.gano = true or b.estado_oferta = 'GANADORA'), 0) as total_awarded_amount,
  round(avg(
    case
      when p.monto_referencial > 0 and b.monto_ofertado > 0 then
        ((p.monto_referencial - b.monto_ofertado) / p.monto_referencial) * 100
      else null
    end
  ), 2) as global_avg_discount_pct,
  case
    when count(b.id) >= 15 then 'ALTA'
    when count(b.id) >= 5  then 'MEDIA'
    when count(b.id) >= 2  then 'BAJA'
    else 'INSUFICIENTE'
  end as certainty_tier,
  min(p.fecha_publicacion) as first_seen_at,
  max(p.fecha_publicacion) as last_seen_at
from public.procurement_suppliers s
left join public.procurement_bids b on b.supplier_id = s.id
left join public.procurement_processes p on p.id = b.process_id
group by s.id, s.nombre, s.nombre_normalizado, s.ruc_clean, s.ruc_raw, s.dv, s.tipo_entidad, s.tamano;

-- ---------------------------------------------------------------------------
-- 4. Función de Fallback Jerárquico de Huella Competitiva
-- ---------------------------------------------------------------------------
create or replace function public.get_competitor_contextual_fingerprint(
  p_supplier_id uuid,
  p_comitente text default null,
  p_categoria text default null,
  p_monto numeric default null
)
returns jsonb
language plpgsql
stable
as $$
declare
  v_bracket text;
  v_rec record;
  v_result jsonb;
begin
  v_bracket := public.categorizar_tamano_contrato(p_monto);

  -- Nivel 1: Match Exacto (Empresa × Convocante × Rubro × Tamaño)
  if p_comitente is not null and p_categoria is not null and p_monto is not null then
    select * into v_rec
    from public.v_procurement_competitor_contextual
    where supplier_id = p_supplier_id
      and comitente_nombre ilike ('%' || p_comitente || '%')
      and categoria ilike ('%' || p_categoria || '%')
      and size_bracket = v_bracket
      and certainty_tier in ('ALTA', 'MEDIA');

    if found then
      return jsonb_build_object(
        'level', 'EXACT_CONTEXT',
        'supplier_id', v_rec.supplier_id,
        'win_rate_pct', v_rec.win_rate_pct,
        'avg_discount_pct', v_rec.avg_discount_pct,
        'stddev_discount_pct', v_rec.stddev_discount_pct,
        'sample_size', v_rec.sample_size_with_price,
        'certainty_tier', v_rec.certainty_tier,
        'fallback_applied', false
      );
    end if;
  end if;

  -- Nivel 2: Fallback Rubro + Tamaño (Empresa × Rubro × Tamaño)
  if p_categoria is not null then
    select
      round(avg(win_rate_pct), 1) as win_rate_pct,
      round(avg(avg_discount_pct), 2) as avg_discount_pct,
      sum(sample_size_with_price) as sample_size,
      count(*) as entries_count
    into v_rec
    from public.v_procurement_competitor_contextual
    where supplier_id = p_supplier_id
      and categoria ilike ('%' || p_categoria || '%');

    if found and v_rec.sample_size >= 2 then
      return jsonb_build_object(
        'level', 'FALLBACK_CATEGORY',
        'supplier_id', p_supplier_id,
        'win_rate_pct', coalesce(v_rec.win_rate_pct, 0),
        'avg_discount_pct', coalesce(v_rec.avg_discount_pct, 0),
        'sample_size', v_rec.sample_size,
        'certainty_tier', case when v_rec.sample_size >= 10 then 'MEDIA' else 'BAJA' end,
        'fallback_applied', true
      );
    end if;
  end if;

  -- Nivel 3: Fallback Global de la Empresa
  select * into v_rec
  from public.v_procurement_competitor_global
  where supplier_id = p_supplier_id;

  if found then
    return jsonb_build_object(
      'level', 'FALLBACK_GLOBAL',
      'supplier_id', p_supplier_id,
      'win_rate_pct', v_rec.global_win_rate_pct,
      'avg_discount_pct', coalesce(v_rec.global_avg_discount_pct, 0),
      'sample_size', v_rec.total_bids,
      'certainty_tier', v_rec.certainty_tier,
      'fallback_applied', true
    );
  end if;

  return jsonb_build_object(
    'level', 'UNKNOWN',
    'supplier_id', p_supplier_id,
    'win_rate_pct', 0,
    'avg_discount_pct', 0,
    'sample_size', 0,
    'certainty_tier', 'INSUFICIENTE',
    'fallback_applied', true
  );
end;
$$;
