# Batch07 manifest

Branch: batch/07-forecast-bim-execution
Base: f65790b6c4c76f6b5dd8e8e09779d10fb0f41232
PR base: batch/06-tender-project-handoff
Preview: xddlzgjwufskgasomval ACTIVE_HEALTHY; ledger36
DB:145 assertions PASS + concurrent BIM creation/CAS PASS
Focused:207 PASS/12 skipped
Full:1427 PASS/16 skipped (serial maxWorkers1/testTimeout30000)
Typecheck:PASS
Build:PASS Next16.3.1 Webpack
Browser:NOT VERIFIED
Production ledger:20;142 INITIAL_STOCK CONFIRMED remain read-only
Main/production/merge:unchanged
New migrations:9
Files:27

BATCH-07-MANIFEST.md
IMPLEMENTATION_REPORT-BATCH-07.md
app/(internal)/projects/[id]/bim-actions.ts
app/(internal)/projects/[id]/reports.tsx
app/(internal)/projects/actions.ts
app/(internal)/projects/progress-forecast-actions.ts
lib/costing/project-prices.ts
lib/procurement/__tests__/execution-boundaries.spec.ts
lib/procurement/__tests__/execution-preview.sql
lib/procurement/climate-evaluation-runner.ts
lib/procurement/climate-metrics.ts
lib/procurement/climate-workdays.ts
lib/procurement/progress-forecast-engine.ts
lib/procurement/weather-client.ts
lib/procurement/weather-provider.ts
lib/projects/schedule.ts
scripts/batch-07-concurrency.cjs
supabase/migrations/20261003150104_execution_climate_contract_restore.sql
supabase/migrations/20261003150147_execution_snapshot_and_bim_boundaries.sql
supabase/migrations/20261003150909_execution_schedule_and_decision_guards.sql
supabase/migrations/20261003151619_execution_bim_live_permissions.sql
supabase/migrations/20261003151935_execution_observation_provenance.sql
supabase/migrations/20261003152452_execution_bim_computo_atomic.sql
supabase/migrations/20261003153235_execution_forecast_input_provenance.sql
supabase/migrations/20261003153432_execution_climate_history_guard.sql
supabase/migrations/20261003153954_execution_ifc_revision_identity.sql
test/progress-forecast.test.ts
