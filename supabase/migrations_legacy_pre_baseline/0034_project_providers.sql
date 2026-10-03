-- Proveedores asociados a un proyecto (shortlist), independiente de tener
-- una OC todavía. La pestaña Proveedores del proyecto solo mostraba los
-- derivados de OCs ya autorizadas — no había forma de dejar cargado "con
-- quién planeo trabajar en esta obra" antes de comprar nada.

CREATE TABLE IF NOT EXISTS public.project_providers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  provider_id uuid NOT NULL REFERENCES public.providers(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (project_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_project_providers_project ON public.project_providers(project_id);

ALTER TABLE public.project_providers ENABLE ROW LEVEL SECURITY;

-- Mismo patrón que budget_items (0028_construccion_pro.sql): scoped via
-- project_id -> projects.empresa_id.
CREATE POLICY project_providers_select ON public.project_providers
  FOR SELECT USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY project_providers_insert ON public.project_providers
  FOR INSERT WITH CHECK (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
CREATE POLICY project_providers_delete ON public.project_providers
  FOR DELETE USING (
    project_id IN (SELECT id FROM public.projects WHERE empresa_id = public.current_empresa_id())
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[]));
