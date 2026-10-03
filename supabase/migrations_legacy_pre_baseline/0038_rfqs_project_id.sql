-- ---------------------------------------------------------------------------
-- Vincular cotizaciones/RFQs a proyectos (columna nueva en tabla existente).
-- El código ya inserta rfqs.project_id (app/(internal)/rfqs/actions.ts) pero
-- la columna nunca se creó, por lo que PostgREST responde:
--   "Could not find the 'project_id' column of 'rfqs' in the schema cache".
-- El scoping multi-tenant sigue siendo por rfqs.empresa_id; project_id es
-- opcional y solo enlaza la solicitud con un proyecto de la misma empresa.
-- ---------------------------------------------------------------------------
ALTER TABLE public.rfqs
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rfqs_project ON public.rfqs(project_id);
