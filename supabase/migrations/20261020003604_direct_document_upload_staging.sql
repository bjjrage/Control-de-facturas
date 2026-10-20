-- Temporary private transport only. Business objects remain in their existing buckets.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('direct-document-uploads', 'direct-document-uploads', false, 20971520,
  array['application/pdf','image/jpeg','image/png','image/webp','image/heic',
    'application/octet-stream'])
on conflict (id) do nothing;

do $$ begin
  if not exists (select 1 from storage.buckets where id = 'direct-document-uploads'
    and public = false and file_size_limit = 20971520) then
    raise exception 'direct-document-uploads exists with incompatible configuration';
  end if;
end $$;
-- No anon/authenticated policies: upload requires a server-issued signed URL.
