-- Link mágico para que el capataz/residente de obra cargue avance de
-- ejecución sin login — mismo patrón que subcontractor_contracts.public_token
-- (0030_construccion_caterpillar.sql), pero a nivel proyecto en vez de
-- contrato, porque el manual describe "el capataz carga el avance" para
-- CUALQUIER plan Pro (no solo Caterpillar) y hoy esa pantalla estaba
-- restringida a admin/administración logueados.
--
-- La ruta pública /avance/[token] usa el service role (createAdminClient),
-- no RLS con este token — igual que /certificados/[token] — así que no hace
-- falta política nueva acá, solo el token en sí.

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS execution_token uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;

CREATE INDEX IF NOT EXISTS idx_projects_execution_token ON public.projects(execution_token);

-- Igual que subcontractor_certificates.submitted_by_portal: para saber en
-- auditoría/soporte si una entrada la cargó el capataz desde el link o un
-- usuario interno desde el panel.
ALTER TABLE public.execution_entries
  ADD COLUMN IF NOT EXISTS submitted_by_portal boolean NOT NULL DEFAULT false;
