-- #4: require a treasury account on executed payment orders.
-- Legacy executed rows remain readable until reconciled; new transitions
-- cannot create another payment without a ledger account.
ALTER TABLE public.payment_orders
  ADD CONSTRAINT payment_order_executed_account_required
  CHECK (status <> 'EJECUTADA' OR cuenta_id IS NOT NULL) NOT VALID;
