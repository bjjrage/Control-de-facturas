# DEV migration history

Source: read-only query of `supabase_migrations.schema_migrations` on project `mjbvxyvpojnpyrkiyujk`.

The table contains only committed migrations. It has no failure, error or applied-at timestamp column.

| Version | Name | Created by | Statements | Statement length (chars) | Statement MD5 |
|---|---|---|---:|---:|---|
| `0080` | `security_invoker_and_forecast_hash` | — | 3 | — | — |
| `0081` | `stock_por_proyecto_security_invoker` | — | 1 | — | — |
| `0082` | `project_weekly_plans` | — | 10 | — | — |
| `0083` | `weekly_plans_hardening_and_canonical_oc` | — | 7 | — | — |
| `0084` | `weekly_plan_rpc_percentage_and_security` | — | — | — | — |
| `0085` | `weather_forecast_batches_and_snapshot_immutability` | — | — | — | — |
| `20260914025729` | `inventory_panol_baseline_7caa643` | `marceloechauri@gmail.com` | 1 | 80587 | `3f161be927b4b4f9a455a74a53ef3e6f` |
| `20260914031557` | `inventory_p1_hardening_20260913235000` | `marceloechauri@gmail.com` | 1 | 46893 | `99ff1833d5ecd1d663e35c81d9bfed21` |
| `20260914033114` | `inventory_p1_transfer_fix_20260914001000` | `marceloechauri@gmail.com` | 1 | 23716 | `1853ce656f8bde522cddde818e622a89` |

The three remote statement MD5s match the local migration contents.

## Local checksums

| File | SHA256 canonical LF | SHA256 raw checkout | MD5 |
|---|---|---|---|
| `supabase/migrations/0080_inventory_panol.sql` | `2c06bc420aea263d52cb627291e8d0e037c74b3ec18e72424275b6e66fcae787` | `2bcac21f793f5ecb03034f01ecb1e2ac50d1f79a13f476ae612a095515d609d3` | `3f161be927b4b4f9a455a74a53ef3e6f` |
| `supabase/migrations/20260913235000_inventory_p1_hardening.sql` | `28fc57bfc4f46b5589d73b8ffc4f7c2b4e628564cd5f8660de5010c8ca8eb8e1` | same | `99ff1833d5ecd1d663e35c81d9bfed21` |
| `supabase/migrations/20260914001000_inventory_p1_transfer_fix.sql` | `c9f085e8692ad1d9130c8f46e3e6255cfd7aeb8f7cfea5895ab46ae9ea5bee26` | same | `1853ce656f8bde522cddde818e622a89` |

The numeric `0080` in `main` is a different migration (`security_invoker_and_forecast_hash`); the local inventory baseline was therefore applied to DEV under the unique name `inventory_panol_baseline_7caa643`.
