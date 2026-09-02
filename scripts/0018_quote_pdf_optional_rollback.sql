-- Revierte 0018: vuelve a exigir PDF en cada versión de cotización.
-- Falla si existen filas con pdf_attachment_id null.
alter table public.quote_versions
  alter column pdf_attachment_id set not null;
