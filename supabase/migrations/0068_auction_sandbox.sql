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
  -- random_close_at NO vive acá: ver auction_sandbox_room_private (F6).
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
-- 1b. Secretos server-only por sala (F6: random_close_at realmente secreto)
--
-- RLS protege FILAS, no columnas: por eso el instante de cierre aleatorio
-- vive en esta tabla privada SIN policies para authenticated/anon (denegado
-- por defecto). Sólo service_role (server actions / RPCs autoritativos) la
-- lee. Ninguna vista expone jamás random_close_at: sólo phase + closeRisk.
-- ---------------------------------------------------------------------------
create table if not exists public.auction_sandbox_room_private (
  room_id         uuid primary key references public.auction_sandbox_rooms(id) on delete cascade,
  random_close_at timestamptz,
  updated_at      timestamptz not null default now()
);

alter table public.auction_sandbox_room_private enable row level security;
-- Sin policies: ningún rol autenticado/anon puede leer ni escribir.
-- Acceso exclusivo vía service_role y RPCs SECURITY DEFINER de abajo.

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

-- Hijas: scope por empresa a través de la sala. SELECT separado de escritura:
-- comercial puede LEER participantes pero nunca mutarlos por accidente.
create policy sandbox_participants_select on public.auction_sandbox_participants
  for select using (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['comercial', 'administracion', 'admin']::public.user_role[]))
  );

create policy sandbox_participants_write on public.auction_sandbox_participants
  for insert with check (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['administracion', 'admin']::public.user_role[]))
  );

create policy sandbox_participants_update on public.auction_sandbox_participants
  for update
  using (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['administracion', 'admin']::public.user_role[]))
  )
  with check (
    exists (select 1 from public.auction_sandbox_rooms r
            where r.id = room_id and r.empresa_id = public.current_empresa_id()
            and public.is_internal_role(array['administracion', 'admin']::public.user_role[]))
  );

create policy sandbox_participants_delete on public.auction_sandbox_participants
  for delete using (
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

-- Escritura operador (admin/administracion de la empresa) para policies y
-- participantes. Los EVENTOS sólo se escriben vía append_sandbox_event (F4):
-- no hay policy de insert directa para que ningún código pueda saltear el
-- allocator monótono. Los BIDS sólo entran vía submit_sandbox_bid.
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
-- 7. RPCs autoritativos (F3/F4: reloj DB, locks, secuencia monotónica)
-- ---------------------------------------------------------------------------
-- Todos SECURITY DEFINER con EXECUTE revocado a public/anon/authenticated y
-- otorgado SÓLO a service_role. Ningún browser los invoca: siempre desde
-- Server Actions (operador autenticado + empresa verificada ANTES, o token
-- gate ANTES para competidor/observer). Nunca service-role en browser.
--
-- Convivencia segura: los 4 RPCs toman SELECT … FOR UPDATE sobre la sala y
-- bumpan next_sequence en la misma transacción → dos clientes simultáneos
-- jamás reciben la misma sequence y next_sequence jamás retrocede. No queda
-- en app ningún read-modify-write de next_sequence.

-- ---------------------------------------------------------------------------
-- 7a. submit_sandbox_bid — oferta atómica con reloj del servidor.
-- Sin p_now_iso: se usa clock_timestamp() (server-authoritative).
-- ---------------------------------------------------------------------------
create or replace function public.submit_sandbox_bid(
  p_room_id uuid,
  p_participant_id uuid,
  p_price_pyg bigint,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room        public.auction_sandbox_rooms%rowtype;
  v_now         timestamptz := clock_timestamp();
  v_best        bigint;
  v_own_last    bigint;
  v_seq         bigint;
  v_bid_id      uuid;
  v_effective   text;
begin
  -- Idempotencia DESPUÉS del lock (dos submits concurrentes con la misma
  -- key se serializan: el segundo ve la fila del primero, sin excepción).
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

  -- Re-chequear idempotencia bajo lock (serializa duplicados concurrentes).
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

  -- Fase efectiva por RELOJ DEL SERVIDOR (nunca client timestamp).
  v_effective := v_room.status;
  if v_room.status = 'ACTIVE_NORMAL' and v_room.started_at is not null
     and v_now >= v_room.started_at + (v_room.normal_duration_seconds || ' seconds')::interval then
    v_effective := 'ACTIVE_RANDOM';
  end if;
  if v_effective = 'ACTIVE_RANDOM' then
    declare v_close timestamptz;
    begin
      select random_close_at into v_close
      from public.auction_sandbox_room_private where room_id = p_room_id;
      if v_close is not null and v_now >= v_close then
        v_effective := 'CLOSED';
      end if;
    end;
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
    (p_room_id, p_participant_id, p_price_pyg, v_seq, v_now,
     p_idempotency_key, true)
  returning id into v_bid_id;

  -- Evento hermanado con la MISMA secuencia (un solo bump por oferta).
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

-- ---------------------------------------------------------------------------
-- 7b. append_sandbox_event — único allocator de secuencias para eventos.
-- ---------------------------------------------------------------------------
create or replace function public.append_sandbox_event(
  p_room_id uuid,
  p_type text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_seq bigint;
begin
  select next_sequence into v_seq
  from public.auction_sandbox_rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'UNKNOWN_ROOM');
  end if;

  update public.auction_sandbox_rooms
  set next_sequence = next_sequence + 1
  where id = p_room_id;

  insert into public.auction_sandbox_events (room_id, type, payload, server_sequence)
  values (p_room_id, p_type, coalesce(p_payload, '{}'::jsonb), v_seq);

  return jsonb_build_object('ok', true, 'sequence', v_seq);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7c. advance_sandbox_room — transiciones de fase atómicas.
-- NORMAL→RANDOM rolla random_close_at UNA SOLA VEZ (INSERT … ON CONFLICT
-- DO NOTHING en la tabla privada: una única llamada gana). RANDOM→CLOSED
-- computa el ganador (mejor precio; empate: menor secuencia) y emite
-- AUCTION_CLOSED + WINNER_DECLARED en la misma transacción.
-- ---------------------------------------------------------------------------
create or replace function public.advance_sandbox_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room      public.auction_sandbox_rooms%rowtype;
  v_now       timestamptz := clock_timestamp();
  v_seq       bigint;
  v_close     timestamptz;
  v_offset    double precision;
  v_winner_id uuid;
  v_winner_alias text;
  v_winner_price bigint;
begin
  select * into v_room
  from public.auction_sandbox_rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('transitioned', false, 'reason', 'UNKNOWN_ROOM');
  end if;

  if v_room.status = 'DRAFT' or v_room.status = 'CLOSED' then
    return jsonb_build_object('transitioned', false, 'status', v_room.status);
  end if;

  -- NORMAL → RANDOM
  if v_room.status = 'ACTIVE_NORMAL' then
    if v_room.started_at is null
       or v_now < v_room.started_at + (v_room.normal_duration_seconds || ' seconds')::interval then
      return jsonb_build_object('transitioned', false, 'status', 'ACTIVE_NORMAL');
    end if;

    v_offset := v_room.random_min_seconds
                + random() * greatest(0, v_room.random_max_seconds - v_room.random_min_seconds);

    -- Una sola llamada gana el roll; las demás reusan el valor existente.
    insert into public.auction_sandbox_room_private (room_id, random_close_at, updated_at)
    values (p_room_id, v_now + make_interval(secs => v_offset), v_now)
    on conflict (room_id) do nothing;

    update public.auction_sandbox_rooms
    set status = 'ACTIVE_RANDOM',
        random_started_at = coalesce(random_started_at, v_now),
        next_sequence = next_sequence + 1
    where id = p_room_id
    returning next_sequence - 1 into v_seq;

    insert into public.auction_sandbox_events (room_id, type, payload, server_sequence)
    values (p_room_id, 'RANDOM_PHASE_STARTED',
            jsonb_build_object('at', v_now), v_seq);

    return jsonb_build_object('transitioned', true, 'status', 'ACTIVE_RANDOM');
  end if;

  -- ACTIVE_RANDOM → CLOSED
  select random_close_at into v_close
  from public.auction_sandbox_room_private where room_id = p_room_id;

  if v_close is null then
    -- Backstop: si el roll nunca ocurrió, generarlo ahora (una sola vez).
    v_offset := v_room.random_min_seconds
                + random() * greatest(0, v_room.random_max_seconds - v_room.random_min_seconds);
    insert into public.auction_sandbox_room_private (room_id, random_close_at, updated_at)
    values (p_room_id, v_now + make_interval(secs => v_offset), v_now)
    on conflict (room_id) do nothing
    returning random_close_at into v_close;
    if v_close is null then
      select random_close_at into v_close
      from public.auction_sandbox_room_private where room_id = p_room_id;
    end if;
    return jsonb_build_object('transitioned', false, 'status', 'ACTIVE_RANDOM');
  end if;

  if v_now < v_close then
    -- closeRisk se deriva en app desde random_started_at + min (público).
    return jsonb_build_object('transitioned', false, 'status', 'ACTIVE_RANDOM');
  end if;

  -- Ganador: mejor precio; empate entre participantes: menor secuencia.
  select b.participant_id, b.price_pyg, p.display_alias
    into v_winner_id, v_winner_price, v_winner_alias
  from public.auction_sandbox_bids b
  join public.auction_sandbox_participants p on p.id = b.participant_id
  where b.room_id = p_room_id and b.accepted
  order by b.price_pyg asc, b.server_sequence asc
  limit 1;

  update public.auction_sandbox_rooms
  set status = 'CLOSED',
      closed_at = v_now,
      winner_participant_id = v_winner_id,
      next_sequence = next_sequence + 2
  where id = p_room_id
  returning next_sequence - 2 into v_seq;

  insert into public.auction_sandbox_events (room_id, type, payload, server_sequence)
  values
    (p_room_id, 'AUCTION_CLOSED',
     jsonb_build_object('at', v_now, 'total_bids',
       (select count(*) from public.auction_sandbox_bids where room_id = p_room_id and accepted)),
     v_seq),
    (p_room_id, 'WINNER_DECLARED',
     case when v_winner_id is null
       then jsonb_build_object('participant_id', null)
       else jsonb_build_object('participant_id', v_winner_id, 'alias', v_winner_alias, 'price_pyg', v_winner_price)
     end,
     v_seq + 1);

  return jsonb_build_object('transitioned', true, 'status', 'CLOSED',
                            'winner_participant_id', v_winner_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- 7d. force_close_sandbox_room — FINALIZAR DEMO manual del operador.
-- ---------------------------------------------------------------------------
create or replace function public.force_close_sandbox_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room      public.auction_sandbox_rooms%rowtype;
  v_now       timestamptz := clock_timestamp();
  v_seq       bigint;
  v_winner_id uuid;
  v_winner_alias text;
  v_winner_price bigint;
begin
  select * into v_room
  from public.auction_sandbox_rooms
  where id = p_room_id
  for update;

  if not found then
    return jsonb_build_object('closed', false, 'reason', 'UNKNOWN_ROOM');
  end if;

  if v_room.status = 'CLOSED' then
    return jsonb_build_object('closed', true, 'already', true);
  end if;

  select b.participant_id, b.price_pyg, p.display_alias
    into v_winner_id, v_winner_price, v_winner_alias
  from public.auction_sandbox_bids b
  join public.auction_sandbox_participants p on p.id = b.participant_id
  where b.room_id = p_room_id and b.accepted
  order by b.price_pyg asc, b.server_sequence asc
  limit 1;

  update public.auction_sandbox_rooms
  set status = 'CLOSED',
      closed_at = v_now,
      winner_participant_id = v_winner_id,
      next_sequence = next_sequence + 2
  where id = p_room_id
  returning next_sequence - 2 into v_seq;

  insert into public.auction_sandbox_events (room_id, type, payload, server_sequence)
  values
    (p_room_id, 'AUCTION_CLOSED',
     jsonb_build_object('at', v_now, 'manual', true, 'total_bids',
       (select count(*) from public.auction_sandbox_bids where room_id = p_room_id and accepted)),
     v_seq),
    (p_room_id, 'WINNER_DECLARED',
     case when v_winner_id is null
       then jsonb_build_object('participant_id', null)
       else jsonb_build_object('participant_id', v_winner_id, 'alias', v_winner_alias, 'price_pyg', v_winner_price)
     end,
     v_seq + 1);

  return jsonb_build_object('closed', true, 'winner_participant_id', v_winner_id);
end;
$$;

-- SECURITY DEFINER nunca libre para authenticated: sólo service_role.
-- (Las Server Actions autentican/autorizan ANTES y usan admin client.)
revoke all on function public.submit_sandbox_bid(uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.submit_sandbox_bid(uuid, uuid, bigint, text) to service_role;
revoke all on function public.append_sandbox_event(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.append_sandbox_event(uuid, text, jsonb) to service_role;
revoke all on function public.advance_sandbox_room(uuid) from public, anon, authenticated;
grant execute on function public.advance_sandbox_room(uuid) to service_role;
revoke all on function public.force_close_sandbox_room(uuid) from public, anon, authenticated;
grant execute on function public.force_close_sandbox_room(uuid) to service_role;
