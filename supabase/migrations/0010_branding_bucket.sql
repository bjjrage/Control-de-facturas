-- Public bucket for the company logo shown in the sidebar. Unlike the other
-- buckets this one is genuinely public (it's just branding, not sensitive
-- data) so the logo <img> can hit its URL directly without going through a
-- signed-URL round trip. Writes still require the service role (uploaded via
-- an admin-gated server action), so only admins can change it.
insert into storage.buckets (id, name, public)
values ('branding', 'branding', true)
on conflict (id) do nothing;
