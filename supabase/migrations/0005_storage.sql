-- Private storage buckets. Never public; all access via short-lived signed URLs
-- generated server-side (service role for the provider portal, authenticated
-- server actions for the internal panel).
insert into storage.buckets (id, name, public)
values ('quote-pdfs', 'quote-pdfs', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('invoice-files', 'invoice-files', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('rfq-attachments', 'rfq-attachments', false)
on conflict (id) do nothing;

-- Internal authenticated users (comercial/administracion/admin) can read all objects
-- in the buckets relevant to them. All writes from the browser happen through
-- server routes using the service role key, so no INSERT policies are required
-- for anon/authenticated roles; these SELECT policies exist for defense-in-depth
-- in case a client ever reads directly (still requires a valid session + role).
create policy "internal read quote-pdfs" on storage.objects
  for select using (
    bucket_id = 'quote-pdfs'
    and public.is_internal_role(array['comercial','admin']::public.user_role[])
  );

create policy "internal read invoice-files" on storage.objects
  for select using (
    bucket_id = 'invoice-files'
    and public.is_internal_role(array['administracion','admin']::public.user_role[])
  );

create policy "internal read rfq-attachments" on storage.objects
  for select using (
    bucket_id = 'rfq-attachments'
    and public.is_internal_role(array['comercial','administracion','admin']::public.user_role[])
  );
