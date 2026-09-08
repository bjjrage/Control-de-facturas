-- Captura verificada para partes de avance de obra.
--
-- Hoy las fotos del avance entran por <input type="file" capture>, que en la
-- práctica permite elegir de la galería — o sea, una foto vieja de WhatsApp
-- pasa igual. Esta tabla guarda la metadata de verificación de cada foto
-- tomada con la cámara in-app:
--   - captured_at: hora del dispositivo al momento del disparo
--   - server_received_at: hora del servidor al recibir (ancla de confianza;
--     captured_at puede venir de un reloj manipulado)
--   - lat/lng/gps_accuracy_m: ubicación al disparar (para cotejar contra la obra)
--   - source: 'camara' (stream in-app, no galería) | 'archivo' (fallback)
--
-- execution_entries.photo_paths sigue siendo la lista canónica de rutas de
-- storage. Esta tabla es puramente aditiva: una fila por foto, con la misma
-- storage_path que aparece en photo_paths.

create table if not exists public.execution_entry_photos (
  id                 uuid primary key default gen_random_uuid(),
  entry_id           uuid not null references public.execution_entries(id) on delete cascade,
  project_id         uuid not null references public.projects(id) on delete cascade,
  storage_path       text not null,
  sort_order         integer not null default 0,
  source             text not null default 'camara' check (source in ('camara', 'archivo')),
  captured_at        timestamptz,
  server_received_at timestamptz not null default now(),
  lat                numeric(9,6),
  lng                numeric(9,6),
  gps_accuracy_m     numeric(8,2),
  created_at         timestamptz not null default now(),
  unique (entry_id, storage_path)
);

create index if not exists idx_exec_entry_photos_entry   on public.execution_entry_photos(entry_id);
create index if not exists idx_exec_entry_photos_project on public.execution_entry_photos(project_id);

alter table public.execution_entry_photos enable row level security;

-- Mismo patrón que execution_entries: scope vía project_id -> projects.empresa_id.
-- La ruta pública /avance/[token] usa service role, no pasa por RLS.
create policy exec_entry_photos_select on public.execution_entry_photos
  for select using (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
  );

create policy exec_entry_photos_insert on public.execution_entry_photos
  for insert with check (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
  );

create policy exec_entry_photos_delete on public.execution_entry_photos
  for delete using (
    project_id in (select id from public.projects where empresa_id = public.current_empresa_id())
  );
