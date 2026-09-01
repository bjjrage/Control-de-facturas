-- Rollback de 0015_invoice_jobs.sql.
begin;

drop policy if exists "internal write invoice-files" on storage.objects;

alter publication supabase_realtime drop table public.invoice_jobs;

drop function if exists public.claim_invoice_job();
drop table if exists public.invoice_jobs;
drop type if exists public.invoice_job_status;

commit;
