-- This module is a simple provider/invoice reconciliation tool, not an ERP with
-- per-client job costing. "client_name" was collected on every RFQ but not
-- actually needed here; make it optional instead of dropping the column
-- outright, so nothing already on file is lost and it can still be filled in
-- manually if a future workflow wants it.
alter table public.rfqs alter column client_name drop not null;
alter table public.authorized_orders alter column client_name drop not null;
