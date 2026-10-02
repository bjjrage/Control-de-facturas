-- =============================================================================
-- 0081_agent_approvals_execution_states.sql
--
-- BATCH 3 — Agent Actions + Approval Execution
--
-- Amplía la restricción CHECK de agent_approvals.status para soportar el ciclo de vida
-- completo de consumo atómico preservando todos los estados de BATCH 1 (incluido EXPIRED):
--   REQUESTED -> APPROVED -> EXECUTING -> EXECUTED (o FAILED)
--   Terminales adicionales / no-ejecutables: REJECTED, EXPIRED, CANCELLED
-- =============================================================================

alter table public.agent_approvals
  drop constraint if exists agent_approvals_status_check;

alter table public.agent_approvals
  add constraint agent_approvals_status_check
  check (status in ('REQUESTED','APPROVED','EXECUTING','EXECUTED','REJECTED','EXPIRED','CANCELLED','FAILED'));

-- ---------------------------------------------------------------------------
-- RPC Atómico: issue_purchase_order_atomic
-- Ejecuta en una única transacción PostgreSQL:
--   1. Validar tenant y estado DRAFT del borrador
--   2. Validar que tenga ítems
--   3. Crear cabecera en authorized_orders
--   4. Crear ítems en authorized_order_items
--   5. Marcar borrador como ISSUED
--   6. Si cualquier paso falla, ROLLBACK total.
-- ---------------------------------------------------------------------------
create or replace function public.issue_purchase_order_atomic(
  p_empresa_id uuid,
  p_user_id uuid,
  p_po_draft_id uuid,
  p_confirm_issuance boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft record;
  v_draft_item record;
  v_first_item record;
  v_items_count integer := 0;
  v_order_id uuid;
  v_order_code text;
  v_grand_total numeric;
  v_idx integer := 0;
begin
  if not coalesce(p_confirm_issuance, false) then
    raise exception 'confirm_issuance debe ser true para emitir la Orden de Compra';
  end if;

  -- 1. Validar y bloquear borrador en la misma transacción (FOR UPDATE)
  select * into v_draft
  from public.purchase_order_drafts
  where id = p_po_draft_id and empresa_id = p_empresa_id
  for update;

  if not found then
    raise exception 'Borrador de Orden de Compra no encontrado o no pertenece a tu empresa (id=%)', p_po_draft_id;
  end if;

  if v_draft.status = 'ISSUED' then
    raise exception 'La Orden de Compra ya fue emitida previamente para este borrador (id=%)', p_po_draft_id;
  end if;

  if v_draft.status = 'CANCELLED' then
    raise exception 'El borrador de Orden de Compra se encuentra CANCELADO (id=%)', p_po_draft_id;
  end if;

  if v_draft.status <> 'DRAFT' then
    raise exception 'Estado invalido para emision: % (requiere DRAFT)', v_draft.status;
  end if;

  -- 2. Validar ítems
  select count(*) into v_items_count
  from public.purchase_order_draft_items
  where purchase_order_draft_id = p_po_draft_id;

  if v_items_count = 0 then
    raise exception 'El borrador de Orden de Compra no tiene items para emitir';
  end if;

  select * into v_first_item
  from public.purchase_order_draft_items
  where purchase_order_draft_id = p_po_draft_id
  order by created_at asc
  limit 1;

  v_grand_total := coalesce(v_draft.total_price_pyg, 0);

  -- 3. Crear cabecera authorized_orders
  insert into public.authorized_orders (
    empresa_id,
    provider_id,
    provider_name,
    product,
    quantity,
    unit,
    unit_price,
    total_price,
    currency,
    vat_included,
    authorized_by,
    is_cheapest,
    created_from,
    rfq_id,
    project_id,
    status
  ) values (
    p_empresa_id,
    v_draft.supplier_id,
    v_draft.supplier_nombre,
    coalesce(v_first_item.description, 'Material de Orden'),
    coalesce(v_first_item.quantity, 1),
    coalesce(v_first_item.unit, 'u'),
    coalesce(v_first_item.price_pyg, v_grand_total),
    v_grand_total,
    case when v_draft.currency = 'USD' then 'USD'::public.currency_code else 'PYG'::public.currency_code end,
    true,
    p_user_id,
    true,
    'rfq',
    v_draft.rfq_id,
    v_draft.project_id,
    'AUTORIZADO'
  )
  returning id, code into v_order_id, v_order_code;

  -- 4. Crear ítems en authorized_order_items
  v_idx := 0;
  for v_draft_item in
    select *
    from public.purchase_order_draft_items
    where purchase_order_draft_id = p_po_draft_id
    order by created_at asc
  loop
    insert into public.authorized_order_items (
      order_id,
      empresa_id,
      product,
      quantity,
      unit,
      unit_price,
      total_price,
      sort_order
    ) values (
      v_order_id,
      p_empresa_id,
      v_draft_item.description,
      v_draft_item.quantity,
      coalesce(v_draft_item.unit, 'u'),
      coalesce(v_draft_item.price_pyg, 0),
      coalesce(v_draft_item.price_pyg, 0) * coalesce(v_draft_item.quantity, 1),
      v_idx
    );
    v_idx := v_idx + 1;
  end loop;

  -- 5. Transicionar borrador a ISSUED
  update public.purchase_order_drafts
  set status = 'ISSUED'
  where id = p_po_draft_id and empresa_id = p_empresa_id;

  -- 6. Retornar resultado estructurado
  return jsonb_build_object(
    'orderId', v_order_id,
    'orderCode', v_order_code,
    'poDraftId', p_po_draft_id,
    'rfqId', v_draft.rfq_id,
    'providerId', v_draft.supplier_id,
    'providerName', v_draft.supplier_nombre,
    'totalPrice', v_grand_total,
    'currency', v_draft.currency,
    'itemsCount', v_items_count,
    'status', 'AUTORIZADO'
  );
end;
$$;

revoke all on function public.issue_purchase_order_atomic(uuid, uuid, uuid, boolean) from public, anon;
grant execute on function public.issue_purchase_order_atomic(uuid, uuid, uuid, boolean) to authenticated, service_role;
