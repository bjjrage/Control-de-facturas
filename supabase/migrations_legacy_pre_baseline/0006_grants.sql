-- Newer Supabase projects no longer auto-expose public schema tables to the
-- Data API roles (anon/authenticated/service_role) with default GRANTs; RLS
-- policies alone don't matter if the role can't touch the table at all. This
-- restores the standard behaviour these migrations were written against.
grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

alter default privileges in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

grant usage, select on all sequences in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

grant execute on all functions in schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant execute on functions to anon, authenticated, service_role;
