-- =============================================================================
-- 0068_auction_sandbox.sql — Auction Lab / Sandbox multiplayer SBE (V0)
--
-- Bounded context nuevo: salas de subasta SIMULADA para demo comercial y
-- banco de pruebas del Auction Bot. NO toca DNCP/SBE real, ni Cost Engine,
-- ni Procurement. NO replica SICP: sólo simula el mundo y alimenta
-- AuctionState al Core (lib/auction-bot, intocado).
--
-- Multi-tenant: las salas pertenecen a una empresa (empresa_id NOT NULL, como
-- el resto del dominio). RLS para roles internos con scope por empresa;
-- el acceso por token (competidor/observer, sin login) usa el cliente
-- service-role server-side con hash de token — mismo patrón que el portal
-- /cotizar/[token]. NO hay policies para anon: denegado por defecto.
--
-- PENDIENTE DE APLICAR: no se aplicó a ningún Supabase (local caído, remoto
-- es producción). Aplicar con `npx supabase db push` cuando haya acceso.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Salas
-- ---------------------------------------------------------------------------
create table if not exists public.auction_sandbox_rooms (
  id                      uuid primary key default gen_random_uuid(),
  empresa_id              uuid not null references public.empresas(id) on delete cascade,
  created_by              uuid references auth.users(id) on delete set null,
  title                   text not null,
  scope                   text not null check (scope in ('ITEM', 'LOT', 'TOTAL')),
  group_id                text not null,
  status                  text not null default 'DRAFT'
                          check (status in ('DRAFT', 'ACTIVE_NORMAL', 'ACTIVE_RANDOM', 'CLOSED')),
  opening_price_pyg       bigint not null check (opening_price_pyg > 0),
  minimum_decrement_pyg   bigint not null check (minimum_decrement_pyg > 0),
  normal_duration_seconds int  not null check (normal_duration_seconds > 0),
  random_min_seconds      int  not null check (random_min_seconds >= 0),
  random_max_seconds      int  not null check (random_max_seconds >= random_min_seconds),
  started_at              timestamptz,
  random_started_at       timestamptz,
  -- Secreto durante la subasta activa: NUNCA se envía a ningún cliente.
  random_close_at         timestamptz,
  closed_at               timestamptz,
  next_sequence           bigint not null default 1,
  bot_paused              boolean not null default false,
  bot_runtime             jsonb not null default '{}'::jsonb,
  competitor_token_hash   text not null,
  observer_token_hash     text not null,
  winner_participant_id   uuid,
  created_at              timestamptz not null default now()
);

create index if not exists idx_sandbox_rooms_empresa on public.auction_sandbox_rooms(empresa_id);
create index if not exists idx_sandbox_rooms_status on public.auction_sandbox_rooms(empresa_id, status);

-- ---------------------------------------------------------------------------
-- 2. Participantes (BOT + HUMAN, un asiento humano por sala en V0)
-- ---------------------------------------------------------------------------
create table if not exists public.auction_sandbox_participants (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.auction_sandbox_rooms(id) on delete cascade,
  kind          text not null check (kind in ('BOT', 'HUMAN')),
  display_alias text not null,
  created_at    timestamptz not null default now(),
  unique (room_id, kind)
);

create index if not exists idx_sandbox_participants_room on public.auction_sandbox_participants(room_id);

-- ---------------------------------------------------------------------------
-- 3. Ofertas (sólo aceptadas + rechazos registrados con accepted=false)
-- ---------------------------------------------------------------------------
create table if not exists public.auction_sandbox_bids (
  id                 uuid primary key default gen_random_uuid(),
  room_id            uuid not null references public.auction_sandbox_rooms(id) on delete cascade,
  participant_id     uuid not null references public.auction_sandbox_participants(id) on delete cascade,
  price_pyg          bigint not null check (price_pyg > 0),
  server_sequence    bigint not null,
  server_received_at timestamptz not null default now(),
  idempotency_key    text unique,
  accepted           boolean not null default true,
  rejection_reason   text,
  created_at         timestamptz not null default now(),
  unique (room_id, server_sequence)
);

create index if not exists idx_sandbox_bids_room_seq on public.auction_sandbox_bids(room_id, server_sequence);
create index if not exists idx_sandbox_bids_room_price on public.auction_sandbox_bids(room_id, price_pyg) where accepted;

-- ---------------------------------------------------------------------------
-- 4. Eventos (timeline auditable de la sala)
-- ---------------------------------------------------------------------------
create table if not exists public.auction_sandbox_events (
  id              uuid primary key default gen_random_uuid(),
  room_id         uuid not null references public.auction_sandbox_rooms(id) on delete cascade,
  type            text not null check (type in (
                    'ROOM_CREATED', 'AUCTION_STARTED', 'RANDOM_PHASE_STARTED',
                    'BID_ACCEPTED', 'BID_REJECTED', 'BOT_DECISION',
                    'POLICY_AUTHORIZED', 'BOT_STOPPED', 'AUCTION_CLOSED',
                    'WINNER_DECLARED')),
  payload         jsonb not null default '{}'::jsonb,
  server_sequence bigint not null,
  created_at      timestamptz not null default now()
);

create index if not exists idx_sandbox_events_room on public.auction_sandbox_events(room_id, server_sequence);

-- ---------------------------------------------------------------------------
-- 5. Versiones de policy persistidas (inmutables, unique por sala+versión)
-- ---------------------------------------------------------------------------
create table if not exists public.auction_sandbox_policy_versions (
  room_id       uuid not null references public.auction_sandbox_rooms(id) on delete cascade,
  version       int  not null check (version >= 1),
  policy_id     text not null,
  snapshot      jsonb not null,
  fingerprint   text not null,
  authorized_by text not null,
  authorized_at timestamptz not null default now(),
  primary key (room_id, version)
);

-- ---------------------------------------------------------------------------
-- 6. RLS (roles internos con scope por empresa; anon denegado por defecto)
-- ---------------------------------------------------------------------------
alter table public.auction_sandbox_rooms             enable row level security;
alter table public.auction_sandbox_participants     enable row level security;
alter table public.auction_sandbox_bids             enable row level security;
alter table public.auction_sandbox_events           enable row level security;
alter table public.auction_sandbox_policy_versions  enable row level security;

-- Salas: lectura para roles internos de la empresa, escritura sólo admin/administracion.
create policy sandbox_rooms_select on public.auction_sandbox_rooms
  for select using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['comercial', 'administracion', 'admin']::public.user_role[])
  );
create policy sandbox_rooms_insert on public.auction_sandbox_rooms
  for insert with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion', 'admin']::public.user_role[])
  );
create policy sandbox_rooms_update on public.auction_sandbox_rooms
  for update
  using (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion', 'admin']::public.user_role[])
  )
  with check (
    empresa_id = public.current_empresa_id()
    and public.is_internal_role(array['administracion', 'admin']::public.user_role[])
  );

-- Hijas: scope por empresa a través de la sala.
create policy sandbox_participants_all on public.auction_sandbox_participants
  for all using (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['comercial', 'administracion', 'admin']::public.user_role[]))
  )
  with check (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['administracion', 'admin']::public.user_role[]))
  );

create policy sandbox_bids_select on public.auction_sandbox_bids
  for select using (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['comercial', 'administracion', 'admin']::public.user_role[]))
  );

create policy sandbox_events_select on public.auction_sandbox_events
  for select using (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['comercial', 'administracion', 'admin']::public.user_role[]))
  );

create policy sandbox_policies_select on public.auction_sandbox_policy_versions
  for select using (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['comercial', 'administracion', 'admin']::public.user_role[]))
  );

-- NOTA: inserts/updates de bids/events/policies desde server actions usan el
-- RPC atómico (bids) o policies de escritura de operador (events/policies).
-- El portal público por token usa service-role con gate por hash de token en
-- código (patrón /cotizar/[token]).

-- Escritura operador (admin/administracion de la empresa) para eventos,
-- policies y updates de sala ya cubiertos arriba.
create policy sandbox_events_insert on public.auction_sandbox_events
  for insert with check (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['administracion', 'admin']::public.user_role[]))
  );

create policy sandbox_policies_insert on public.auction_sandbox_policy_versions
  for insert with check (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['administracion', 'admin']::public.user_role[]))
  );

create policy sandbox_participants_insert on public.auction_sandbox_participants
  for insert with check (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['administracion', 'admin']::public.user_role[]))
  );

-- ---------------------------------------------------------------------------
-- 7. RPC atómico: submit_sandbox_bid
-- ---------------------------------------------------------------------------
-- Inserta una oferta con server_sequence correlativo por sala, en una sola
-- transacción (SELECT … FOR UPDATE sobre la sala). Valida fase por server
-- time (now_iso provisto por el caller server-side), participante, precio
-- entero > 0, decrecimiento propio y minimum decrement contra el mejor.
-- Devuelve { accepted, rejection_code, rejection_message, bid_id, sequence }.
-- Nunca tira por rechazo de negocio (sólo por errores infrastructurales).
-- ---------------------------------------------------------------------------
create or replace function public.submit_sandbox_bid(
  p_room_id uuid,
  p_participant_id uuid,
  p_price_pyg bigint,
  p_now_iso timestamptz,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room        public.auction_sandbox_rooms%rowtype;
  v_best        bigint;
  v_own_last    bigint;
  v_seq         bigint;
  v_bid_id      uuid;
  v_effective   text;
begin
  -- Idempotencia: si la key ya existe, devolver la oferta original.
  if p_idempotency_key is not null then
    select id, server_sequence into v_bid_id, v_seq
    from public.auction_sandbox_bids
    where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'accepted', true, 'duplicate', true,
        'bid_id', v_bid_id, 'sequence', v_seq);
    end if;
  end if;

  select * into v_room
  from public.auction_sandbox_rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object(
      'accepted', false, 'rejection_code', 'UNKNOWN_ROOM',
      'rejection_message', 'Sala inexistente.');
  end if;

  -- Fase efectiva por server time (sin mutar la sala acá: el avance lo
  -- persiste advance/close por separado; acá sólo se decide aceptar o no).
  v_effective := v_room.status;
  if v_room.status = 'ACTIVE_NORMAL' and v_room.started_at is not null
     and p_now_iso >= v_room.started_at + (v_room.normal_duration_seconds || ' seconds')::interval then
    v_effective := 'ACTIVE_RANDOM';
  end if;
  if v_effective = 'ACTIVE_RANDOM' and v_room.random_close_at is not null
     and p_now_iso >= v_room.random_close_at then
    v_effective := 'CLOSED';
  end if;

  if v_effective <> 'ACTIVE_NORMAL' and v_effective <> 'ACTIVE_RANDOM' then
    return jsonb_build_object(
      'accepted', false, 'rejection_code', 'ROOM_NOT_ACTIVE',
      'rejection_message', 'La subasta no está activa.');
  end if;

  if not exists (select 1 from public.auction_sandbox_participants
                 where id = p_participant_id and room_id = p_room_id) then
    return jsonb_build_object(
      'accepted', false, 'rejection_code', 'UNKNOWN_PARTICIPANT',
      'rejection_message', 'Participante desconocido en esta sala.');
  end if;

  if p_price_pyg is null or p_price_pyg <= 0 then
    return jsonb_build_object(
      'accepted', false, 'rejection_code', 'INVALID_PRICE',
      'rejection_message', 'El precio debe ser un entero positivo en guaraníes.');
  end if;

  select min(price_pyg) into v_own_last
  from public.auction_sandbox_bids
  where room_id = p_room_id and participant_id = p_participant_id and accepted;

  if v_own_last is not null and p_price_pyg >= v_own_last then
    return jsonb_build_object(
      'accepted', false, 'rejection_code', 'NOT_DECREASING',
      'rejection_message', 'La nueva oferta debe ser menor a tu última oferta.');
  end if;

  select min(price_pyg) into v_best
  from public.auction_sandbox_bids
  where room_id = p_room_id and accepted;

  if v_best is null then
    if p_price_pyg >= v_room.opening_price_pyg then
      return jsonb_build_object(
        'accepted', false, 'rejection_code', 'NOT_BELOW_OPENING',
        'rejection_message', 'La primera oferta debe ser menor al precio de apertura.');
    end if;
  elsif v_best - p_price_pyg < v_room.minimum_decrement_pyg then
    return jsonb_build_object(
      'accepted', false, 'rejection_code', 'BELOW_MINIMUM_DECREMENT',
      'rejection_message', 'No alcanza la mejora mínima sobre el mejor precio.');
  end if;

  v_seq := v_room.next_sequence;
  update public.auction_sandbox_rooms
  set next_sequence = next_sequence + 1
  where id = p_room_id;

  insert into public.auction_sandbox_bids
    (room_id, participant_id, price_pyg, server_sequence, server_received_at,
     idempotency_key, accepted)
  values
    (p_room_id, p_participant_id, p_price_pyg, v_seq, p_now_iso,
     p_idempotency_key, true)
  returning id into v_bid_id;

  insert into public.auction_sandbox_events (room_id, type, payload, server_sequence)
  values (p_room_id, 'BID_ACCEPTED',
          jsonb_build_object('bid_id', v_bid_id, 'participant_id', p_participant_id,
                             'price_pyg', p_price_pyg, 'sequence', v_seq),
          v_seq);

  return jsonb_build_object(
    'accepted', true, 'duplicate', false,
    'bid_id', v_bid_id, 'sequence', v_seq);
end;
$$;

-- El RPC es SECURITY DEFINER pero sólo lo invocan roles autenticados
-- (server actions de operador) y service-role (server actions por token).
revoke all on function public.submit_sandbox_bid(uuid, uuid, bigint, timestamptz, text) from public, anon;
grant execute on function public.submit_sandbox_bid(uuid, uuid, bigint, timestamptz, text) to authenticated, service_role;
