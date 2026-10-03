# Batch 09 manifest

Branch: `batch/09-cashflow-dashboard`
Base: `6db18552eab235933c55503d3d774775dbceea58`
Target: `main`; merge forbidden.
Expected publication: one commit, `fix(cashflow): unify financial projections and dashboard sources`.
The immutable commit SHA is recorded by Git and the PR.

## Expected diff: 26 files
- `app/(internal)/dashboard/dashboard-view.tsx`
- `app/(internal)/dashboard/data.ts`
- `app/(internal)/dashboard/page.tsx`
- `app/(internal)/flujo-caja/flujo-caja-section.tsx`
- `app/(internal)/flujo-caja/gastos-actions.ts`
- `app/(internal)/flujo-caja/page.tsx`
- `app/(internal)/projects/[id]/page.tsx`
- `app/(internal)/projects/portfolio-data.ts`
- `lib/dashboard/__tests__/batch5-admin-contract.spec.ts`
- `lib/dashboard/admin-kpis.ts`
- `lib/dashboard/cashflow.ts`
- `lib/flujo-caja.ts`
- `test/dashboard-workspace-separation.test.ts`
- `lib/cashflow/__tests__/canonical.spec.ts`
- `lib/cashflow/__tests__/preview-snapshot.json`
- `lib/cashflow/__tests__/preview.sql`
- `lib/cashflow/dates.ts`
- `lib/cashflow/load.ts`
- `lib/cashflow/model.ts`
- `lib/cashflow/planning.ts`
- `lib/cashflow/recurring-validation.ts`
- `lib/cashflow/types.ts`
- `supabase/migrations/20261003211113_cashflow_read_sources.sql`
- `supabase/migrations/20261003212845_cashflow_sales_actuals.sql`
- `IMPLEMENTATION_REPORT-BATCH-09.md`
- `BATCH-09-MANIFEST.md`

## Migration boundary
Exactly two new migrations; Preview only, ledger 46 (was 44).
Production ledger remains 44, latest `20261003195245`.
No historical migration edits, seed, production push, repair or reset.
Preview project `xddlzgjwufskgasomval`: ACTIVE_HEALTHY.
Synthetic SQL tests roll back; temporary browser smoke fixtures removed.
No production test data, stock reconciliation or main branch update.

## Audit evidence
See [implementation report](IMPLEMENTATION_REPORT-BATCH-09.md).
Focused: 114 PASS. Canonical cases: 55 PASS.
DB matrix: 18 PASS. Full serial suite: 1,520 PASS / 16 skipped.
Typecheck/build/diff: PASS.
Frozen base and branch identity checked before publication.
PR must remain open; external audit and production deploy remain pending.

## Explicit limitations
No invented FX, due dates or linkage. Undated commitments are visible outside dated net.
Equipment/recurrence facts without settlement FK remain explicit planned forecasts.
Historical B1B project labor cost metric and legacy Security Advisor notices are documented in the report.
No Batch 10 implementation.
