-- RFQs get a 72h bidding window by default. Whether a request is still open
-- to new quotes is derived from (status, expires_at) at read/action time —
-- see lib/rfq-status.ts — rather than a separate enum value, so no cron job
-- is needed to "flip" anything. Reopening (see reopenRfq) just pushes
-- expires_at forward again.
alter table public.rfqs
  add column expires_at timestamptz not null default (now() + interval '72 hours');
