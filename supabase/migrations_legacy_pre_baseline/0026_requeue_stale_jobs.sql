-- Recovery de invoice_jobs huérfanos.
--
-- claim_invoice_job() marca status='processing' + locked_at=now(). Si el worker
-- muere antes de llamar finish(), el job queda bloqueado indefinidamente.
-- Esta función los detecta por timeout de locked_at y los devuelve a 'queued'
-- (o a 'failed' si ya agotaron los intentos).
--
-- Parámetros:
--   timeout_minutes  int  (default 15) — cuántos minutos sin actualizar para
--                         considerar el job abandonado
--   max_attempts     int  (default 3)  — mismo valor que MAX_ATTEMPTS del worker;
--                         se pasa como argumento para tener una sola fuente de verdad
--
-- Retorna: cantidad de jobs afectados (para loggear en el worker).

create or replace function public.requeue_stale_invoice_jobs(
  timeout_minutes int default 15,
  max_attempts    int default 3
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
begin
  with affected as (
    update public.invoice_jobs
    set
      status    = case
                    when attempts >= max_attempts then 'failed'::public.invoice_job_status
                    else 'queued'::public.invoice_job_status
                  end,
      locked_at = null,
      message   = case
                    when attempts >= max_attempts
                    then 'Abandonado tras ' || attempts || ' intentos (timeout de worker).'
                    else message
                  end,
      error     = case
                    when attempts >= max_attempts
                    then coalesce(error, 'Worker crash — locked_at expiró sin finish()')
                    else error
                  end
    where status = 'processing'
      and locked_at < now() - (timeout_minutes || ' minutes')::interval
    returning id
  )
  select count(*) into v_count from affected;

  return coalesce(v_count, 0);
end;
$$;

-- El worker llama esta función con service role; no se expone a usuarios.
-- No se agrega política RLS porque la función ya es SECURITY DEFINER.
