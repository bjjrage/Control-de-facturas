-- Recodifica las OCs que heredaron el prefijo "RFQ-" del circuito anterior.
-- Usa next_doc_code(empresa_id) para asignarles un código OC-YYYY-NNNN correcto,
-- procesando por empresa de forma determinista (orden por created_at).

do $$
declare
  r record;
  v_new_code text;
begin
  for r in
    select id, empresa_id
    from public.authorized_orders
    where code like 'RFQ-%'
    order by empresa_id, created_at
  loop
    v_new_code := public.next_doc_code(r.empresa_id, 'OC');
    update public.authorized_orders
    set code = v_new_code
    where id = r.id;
  end loop;
end;
$$;
