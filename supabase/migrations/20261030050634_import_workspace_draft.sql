-- Operational review is separate from the immutable source workbook.
-- Existing company RLS and working_revision protect this draft too.
ALTER TABLE public.workbook_import_sessions
  ADD COLUMN workspace_draft jsonb NOT NULL DEFAULT '{}'::jsonb
  CHECK (jsonb_typeof(workspace_draft) = 'object');
