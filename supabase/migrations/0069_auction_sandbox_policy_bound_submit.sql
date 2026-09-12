-- 0069_auction_sandbox_policy_bound_submit.sql
--
-- Binds bot/assisted submits to the authorizing policy version, closing the
-- refresh→submit race at the AUTHORITY (not just best-effort in app code):
-- a candidate computed off a superseded policy (e.g. a tighter autoLimit
-- the RPC itself does not enforce) is rejected even if the version lands
-- between the app's last re-read and the submit.
--
-- Additive + backward compatible: p_expected_policy_version defaults NULL
-- (human path passes nothing — humans are not policy-bound). Signature
-- change requires DROP + CREATE (CREATE OR REPLACE cannot alter args);
-- grants are re-applied for the new signature below.
--
-- Residual (documented, accepted): the check is one EXISTS predicate inside
-- the submit transaction. An authorize COMMIT landing after the gate SELECT
-- but before the bid/event INSERTs (same transaction: gate → seq bump →
-- 2 inserts → commit) is invisible under READ COMMITTED — the window is
-- intra-transaction (sub-millisecond, same backend), reachable only by a
-- MANAGE insider committing a tighter policy at that exact instant, and the
-- next tick converges under the new version. Full serializability would
-- additionally require the authorize path to take the room lock (tracked,
-- out of scope for the V0 simulation).
--
-- ROLLOUT CHECKLIST (order matters, each step verified before the next):
--   1. `supabase db push` applies this file atomically (one transaction per
--      file — never apply statement-wise: the CREATE must never be visible
--      without the REVOKE below).
--   2. Verify live: `submit_sandbox_bid(uuid,uuid,bigint,text,integer)`
--      exists and a superseded-version call returns POLICY_SUPERSEDED.
--      Reload the PostgREST schema cache if 5-arg calls miss (fail-closed
--      stall, never corruption).
--   3. Deploy app code. Skew behavior (by design, never worse than baseline):
--      old-code + new-DB behaves exactly as pre-0069 (param defaults NULL);
--      new-code + old-DB fails closed on bot submits (unknown-arg error is
--      caught → no write) until the DB migrates. Ship DB first, then app.
--
-- DEPLOY NOTE: cannot be verified from CI (no DB here); static pins live in
-- lib/auction-sandbox/__tests__/migration-audit.spec.ts (0069 describe).

-- Signature change: DROP first (grants die with the old signature).
drop function if exists public.submit_sandbox_bid(uuid, uuid, bigint, text);

create function public.submit_sandbox_bid(
  p_room_id uuid,
  p_participant_id uuid,
  p_price_pyg bigint,
  p_idempotency_key text default null,
  p_expected_policy_version integer default null
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

  -- Policy binding (0069): the caller passes the version its candidate was
  -- authorized under. A newer persisted version aborts — the candidate was
  -- computed off a superseded policy and could breach the CURRENT autoLimit
  -- (which this RPC does not enforce). NULL skips (human path).
  if p_expected_policy_version is not null
     and exists (select 1
                 from public.auction_sandbox_policy_versions
                 where room_id = p_room_id
                   and version > p_expected_policy_version) then
    return jsonb_build_object(
      'accepted', false, 'rejection_code', 'POLICY_SUPERSEDED',
      'rejection_message', 'La policy cambió durante el envío. Reintentá con la versión actual.');
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

-- SECURITY DEFINER nunca libre para authenticated: sólo service_role.
-- (New signature: revoke/grant the 5-arg form; the DROP above removed the
-- 4-arg grants with the old function.)
revoke all on function public.submit_sandbox_bid(uuid, uuid, bigint, text, integer) from public, anon, authenticated;
grant execute on function public.submit_sandbox_bid(uuid, uuid, bigint, text, integer) to service_role;
