-- set_order_code() genera el código de la OC llamando a next_doc_code(empresa_id).
-- El trigger que lo ejecuta (trg_authorized_orders_code) corre ANTES que
-- trg_authorized_orders_empresa (orden alfabético de nombres de trigger), así
-- que cuando la OC se inserta sin empresa_id explícito, next_doc_code recibe
-- null y lanza excepción.
--
-- Fix defensivo: si new.empresa_id es null, resolverlo acá igual que hace el
-- otro trigger (rfq -> current_empresa_id) antes de pedir el código.

create or replace function public.set_order_code()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_eid uuid;
begin
  if new.code is null then
    v_eid := coalesce(
      new.empresa_id,
      (select empresa_id from public.rfqs where id = new.rfq_id),
      public.current_empresa_id()
    );
    new.code := public.next_doc_code(v_eid, 'OC');
  end if;
  return new;
end;
$$;
