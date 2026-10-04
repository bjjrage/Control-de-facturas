# Batch 09 manifest

Branch: `batch/09-cashflow-dashboard`
Base: `6db18552eab235933c55503d3d774775dbceea58`
Target: `main`; merge forbidden.
Initial publication: one commit, `fix(cashflow): unify financial projections and dashboard sources` (`c0cf6fab40b4a8f9261872642b6193eb5384acfc`).
External audit correction: an additional commit on the same branch/PR; no merge or production deployment.
The immutable commit SHA is recorded by Git and the PR.

## Expected diff from frozen base: 28 files
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
- `lib/procurement/mrp-coverage.ts`
- `lib/procurement/weekly-plan-coverage.ts`
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
Post-audit focused: 129 PASS. Canonical cases: 70 PASS, including 15 new audit cases.
Procurement/Weekly Plan-MRP: 181 PASS (96 procurement, 85 Weekly Plan).
DB matrix rerun: 18 PASS with ROLLBACK; no persistent synthetic fixtures. Full serial suite: 1,535 PASS / 16 skipped.
Typecheck/build/diff: PASS.
Frozen base and branch identity checked before publication.
PR must remain open; external audit and production deploy remain pending.

## Explicit limitations
No invented FX, due dates or linkage. Undated commitments are visible outside dated net. Late/undated OC do not cover a plan's shortage; timely coverage shares B08's exact eligibility predicate. Draft/cancelled sales documents retain certificate fallback; issued/partially collected/collected documents supersede it.
Equipment/recurrence facts without settlement FK remain explicit planned forecasts.
Historical B1B project labor cost metric and legacy Security Advisor notices are documented in the report.
No Batch 10 implementation.
