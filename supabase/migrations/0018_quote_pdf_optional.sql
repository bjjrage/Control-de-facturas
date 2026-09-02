-- El PDF del presupuesto pasa a ser opcional: el proveedor puede enviar la
-- cotización solo con los datos del formulario (precio, plazo, validez, etc.).
alter table public.quote_versions
  alter column pdf_attachment_id drop not null;
