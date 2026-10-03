# BATCH 08 — MANIFEST

Branch: batch/08-weekly-plan-mrp
Base: 2ac7da742cacf67acd2fd1ffe1d43f08b45c023b
PR target: main; NO MERGE.
Production: read only. Preview: xddlzgjwufskgasomval, ledger 36 → 43 → 44.

## Expected diff (33 files)

- BATCH-08-MANIFEST.md
- IMPLEMENTATION_REPORT-BATCH-08.md
- app/(internal)/orders/direct-purchase-actions.ts
- app/(internal)/orders/order-dialog.tsx
- app/(internal)/projects/[id]/mrp-result-panel.tsx
- app/(internal)/projects/[id]/need-to-buy.tsx
- app/(internal)/projects/[id]/weekly-plan-section.tsx
- app/(internal)/projects/production-recipe-actions.ts
- app/(internal)/projects/weekly-plan-actions.ts
- app/(internal)/projects/weekly-plan-need-actions.ts
- app/(internal)/rfqs/actions.ts
- app/(internal)/rfqs/rfq-dialog.tsx
- lib/procurement/__tests__/weekly-needs-procurement-actions.spec.ts
- lib/procurement/__tests__/weekly-needs.spec.ts
- lib/procurement/__tests__/weekly-plan-stock.spec.ts
- lib/procurement/mrp-coverage.ts
- lib/procurement/need-origin.ts
- lib/procurement/weekly-plan-coverage.ts
- lib/procurement/weekly-plan-engine.ts
- lib/procurement/weekly-plan-shared.ts
- lib/procurement/weekly-plan-validation.ts
- scripts/batch-08-audit-regressions.cjs
- scripts/batch-08-preview.cjs
- supabase/migrations/20261003172735_weekly_plan_need_provenance.sql
- supabase/migrations/20261003173918_weekly_plan_atomic_boundaries.sql
- supabase/migrations/20261003175511_weekly_need_boundary_hardening.sql
- supabase/migrations/20261003185132_weekly_need_direct_retry_contract.sql
- supabase/migrations/20261003185848_weekly_need_residual_and_read_permissions.sql
- supabase/migrations/20261003191155_weekly_plan_commit_source_gate.sql
- supabase/migrations/20261003193500_weekly_plan_retry_target_order.sql
- supabase/migrations/20261003195245_weekly_need_audit_capping_and_rfq_residual.sql
- test/mrp-coverage.test.ts
- test/weekly-plan-ux-preview.test.ts

## Migration SHA-256 (applied files preserved)

- 20261003172735_weekly_plan_need_provenance.sql: 319a29bf86873498874479f06cb78e5b16b7239679e0f8a2ff6cb5be3338c52b
- 20261003173918_weekly_plan_atomic_boundaries.sql: 9955eaea873c697934b7dfbfae275644f5fa55c9226d13bdc03a4379a153c987
- 20261003175511_weekly_need_boundary_hardening.sql: caf4517d85966a8eb61f4f582e471483724a369d2c3b218987938710f52b39d9
- 20261003185132_weekly_need_direct_retry_contract.sql: 35102f505493bbbeb92bf21b34513fa6737c7c63b3ae51ff272a75e9e764c4cb
- 20261003185848_weekly_need_residual_and_read_permissions.sql: 809ee144983d268085de27a7bd2df7b84866881db165b4f192c4a0805ae0beb4
- 20261003191155_weekly_plan_commit_source_gate.sql: 4d09ac868cac9d0c524ca7739630b4ead9078dc9d70df30f23165095ac0f1bab
- 20261003193500_weekly_plan_retry_target_order.sql: e441858152767d7d4d61696da1c2340b543df05b71d1b72a2eb0ade3ad764512

- 20261003195245_weekly_need_audit_capping_and_rfq_residual.sql: eff80b5a72dd9c86e7ac74534fc477ba3af17c2a7b3f1173c53d3e65186cb3d7

## Commits

Initial combined commit: 49c21b44e99aa3982218edbe9e51fe4d14d4b855 — fix(mrp): persist weekly needs and guard human procurement.
Additional correction commit: fix(mrp): align certificate capping and release RFQ residuals. Its exact SHA is the published PR head (manifest cannot embed its own hash). No changes to historical migrations.

## Validation

170 focused PASS; 37 real Preview DB PASS; 29 B05 DB regression PASS; 1465 full PASS / 16 skipped; tsc PASS. Final build result recorded in implementation report. No production test data, merges, tags or main changes.

## External audit correction

Old audited HEAD: 49c21b44e99aa3982218edbe9e51fe4d14d4b855. Same PR #28. One additional fix commit for P1-A canonical certificate capping and P1-B RFQ residual lifecycle, tests and reports. Existing seven migrations unchanged. 55 real DB PASS; focused + RFQ 226 PASS; B05 29 PASS. Correction regression final results are in the report. No production mutation, merge, main change or 71x2 reconciliation.
