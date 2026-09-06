-- Agrega policy DELETE a payment_orders.
-- La tabla ya tiene SELECT/INSERT/UPDATE pero faltaba DELETE, lo que impedía
-- que administracion/admin pudieran anular o eliminar OPs desde el panel de Pagos.

CREATE POLICY payment_orders_delete ON public.payment_orders
  FOR DELETE USING (
    empresa_id = public.current_empresa_id()
    AND public.is_internal_role(ARRAY['administracion','admin']::public.user_role[])
  );
