-- Recuperar jobs huérfanos: si un runner muere a mitad (timeout serverless,
-- deploy, crash) el job queda en 'processing' con locked_at viejo y nadie lo
-- vuelve a tomar. Ahora claim_invoice_job también reclama esos, respetando
-- MAX_ATTEMPTS (3) — pasados los intentos, queda 'failed'.
create or replace function public.claim_invoice_job()
returns public.invoice_jobs
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.invoice_jobs;
begin
  update public.invoice_jobs
    set status = 'processing', locked_at = now(), attempts = attempts + 1
    where id = (
      select id from public.invoice_jobs
      where status = 'queued'
         or (status = 'processing' and locked_at < now() - interval '3 minutes' and attempts < 3)
      order by created_at
      limit 1
      for update skip locked
    )
    returning * into v_job;

  -- Job colgado que ya agotó los intentos: marcarlo failed y no devolverlo.
  update public.invoice_jobs
    set status = 'failed', locked_at = null,
        error = coalesce(error, 'El procesamiento se cortó y se agotaron los reintentos.'),
        message = 'No se pudo procesar tras varios intentos — cargala a mano.'
    where status = 'processing' and locked_at < now() - interval '3 minutes' and attempts >= 3;

  return v_job;
end;
$$;
