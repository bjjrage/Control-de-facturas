-- Allow attachments to hang off an RFQ directly (spec sheets / reference PDFs
-- uploaded by the internal team when creating the request, shared with every
-- invited provider), not just off a specific rfq_provider or quote_version.
alter table public.attachments
  add column rfq_id uuid references public.rfqs(id) on delete cascade;

create index idx_attachments_rfq on public.attachments(rfq_id);
