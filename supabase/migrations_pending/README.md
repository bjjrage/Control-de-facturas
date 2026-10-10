# Migraciones pendientes y propuestas superseded

`supabase/migrations_pending/20261010000000_invoice_item_match_atomic_PENDING.sql` es una propuesta histórica revisada y reemplazada por la migración CLI activa:

- `supabase/migrations/20261010040051_invoice_item_match_integrity.sql`

Supabase CLI solo aplica `supabase/migrations/`. La propuesta PENDING no se debe aplicar manualmente; contiene las versiones antiguas de las RPC y no incluye los guards, el preflight ni la firma actualizada.

La migración activa aborta si encuentra drift de tenant, relación, topes o contador. No repara datos existentes. La prueba de concurrencia y el procedimiento de deploy/rollback están descritos por el release plan del PR.
