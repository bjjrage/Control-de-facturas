-- 20260920060000_attachments_unique_storage_object.sql
-- Garantía de integridad a nivel de DB: unicidad estricta para (bucket, path) en attachments
-- Previene ataques de replay concurrentes (carreras TOCTOU) al asociar documentos de Control Scanner

do $$
declare
  v_duplicate_count integer;
begin
  select count(*)
  into v_duplicate_count
  from (
    select bucket, path
    from public.attachments
    group by bucket, path
    having count(*) > 1
  ) dups;

  if v_duplicate_count > 0 then
    raise exception 'No se puede crear idx_attachments_bucket_path_unique: existen % grupos de duplicados históricos en attachments (bucket, path). Revisión manual requerida sin borrado automático.', v_duplicate_count;
  end if;
end $$;

create unique index if not exists idx_attachments_bucket_path_unique
  on public.attachments (bucket, path);
