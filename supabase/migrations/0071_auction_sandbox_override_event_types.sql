-- 0071_auction_sandbox_override_event_types.sql
--
-- Widens the auction_sandbox_events.type CHECK with the two human-override
-- audit labels (HUMAN_OVERRIDE_AUTHORIZED / HUMAN_OVERRIDE_DECLINED).
-- Additive only: the 10 existing labels are preserved verbatim, so all
-- historical rows keep validating. No RPC, RLS, grant, or sequence change.
--
-- WHY: override authorizations/declines are first-class audit events written
-- through the existing append_sandbox_event allocator (no new write path).
-- Without this widening those appends would fail the CHECK and the audit
-- trail would go dark (the money path is unaffected: BID_ACCEPTED is
-- written atomically by submit_sandbox_bid).
--
-- DEPLOY NOTE: apply with `supabase db push` (one transaction per file).
-- Static pins live in
-- lib/auction-sandbox/__tests__/migration-audit.spec.ts (0071 describe).

alter table public.auction_sandbox_events
  drop constraint if exists auction_sandbox_events_type_check;

alter table public.auction_sandbox_events
  add constraint auction_sandbox_events_type_check check (type in (
    'ROOM_CREATED', 'AUCTION_STARTED', 'RANDOM_PHASE_STARTED',
    'BID_ACCEPTED', 'BID_REJECTED', 'BOT_DECISION',
    'POLICY_AUTHORIZED', 'BOT_STOPPED',
    'HUMAN_OVERRIDE_AUTHORIZED', 'HUMAN_OVERRIDE_DECLINED',
    'AUCTION_CLOSED', 'WINNER_DECLARED'));
