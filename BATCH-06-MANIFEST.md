# Batch 06 manifest

Branch: batch/06-tender-project-handoff
Base: cda349aaff7ebe31467fafa95e39002e90c3b55b
PR base: batch/05-inventory-canonical
Migrations: 20261003142900, 20261003143645
Preview: xddlzgjwufskgasomval; ledger27
DB:104 assertions PASS + concurrent handoff PASS
Focused:123 PASS +4 new adapter PASS
Full Vitest:1408 PASS /16 skipped; serial maxWorkers1/testTimeout30000
Typecheck:PASS
Build:PASS (Next16.3.1 Webpack)
Production/main/merge: unchanged

Files: 19

app/(internal)/licitaciones/[id]/prebid/workspace.tsx
app/(internal)/licitaciones/[id]/reimportar-button.tsx
app/(internal)/licitaciones/actions.ts
app/(internal)/projects/[id]/certificados-table.tsx
app/(internal)/projects/[id]/edit-project-dialog.tsx
app/(internal)/projects/[id]/page.tsx
app/(internal)/projects/actions.ts
app/(internal)/projects/certificado-actions.ts
lib/procurement/tender-to-project.ts
lib/tools/erp/manage-tender.ts
lib/types.ts
lib/workspace/actions.ts
IMPLEMENTATION_REPORT-BATCH-06.md
lib/procurement/__tests__/tender-handoff-preview.sql
lib/procurement/__tests__/winning-handoff.spec.ts
scripts/batch-06-concurrency.cjs
supabase/migrations/20261003142900_tender_project_contractual_handoff.sql
supabase/migrations/20261003143645_handoff_contract_parameters_guard.sql
BATCH-06-MANIFEST.md

