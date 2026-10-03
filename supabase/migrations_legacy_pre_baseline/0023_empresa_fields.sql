-- Datos comerciales de la empresa (para documentos imprimibles)
alter table public.empresas
  add column if not exists ruc          text,
  add column if not exists direccion    text,
  add column if not exists telefono     text,
  add column if not exists email_empresa text,
  -- Plantillas HTML generadas por IA, una por tipo de documento
  add column if not exists template_proforma text,
  add column if not exists template_remision text,
  add column if not exists template_factura  text;

-- Política UPDATE: el admin de cada empresa puede actualizar sus propios datos
create policy "admin actualiza su empresa"
  on public.empresas for update
  using (
    id = current_empresa_id()
    and exists (
      select 1 from public.profiles
      where id = auth.uid() and role = 'admin'
    )
  )
  with check (id = current_empresa_id());
