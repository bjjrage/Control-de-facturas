# Batch 10 manifest — Sales / Post-OT

## Git and release target

- Repository: bjjrage/Control-de-facturas
- Branch: batch/10-sales-post-ot
- Base commit: 4b7896025fa01d45a87b71fe132f331ee303ca89
- Target: pull request to main; do not merge or deploy
- Production DB mutations: prohibited; none performed
- Database migrations in this batch: 1 (Preview only)
- Preview project migrated and tested: xddlzgjwufskgasomval
- Preview ledger after correction: 47; Production ledger: 46

## Discovered module map

| Stage | Existing surface | Batch 10 connection |
| --- | --- | --- |
| Customer | app/(internal)/clientes | Existing tenant-scoped client record |
| Quotation | app/(internal)/proformas and app/(internal)/ventas/[id] | Accepted PROFORMA remains the source authority |
| Customer acceptance | app/(public)/cotizacion/[token], app/(public)/cotizar/[token] | Existing electronic acceptance contract reused unchanged |
| Work order | app/(internal)/ordenes-trabajo and accept_quotation | Exact work order and immutable acceptance snapshot verified |
| Delivery document | app/(internal)/remisiones/nueva | Existing SalesForm prefills a draft from the accepted OT/source |
| Invoice | app/(internal)/facturas-venta/nueva | Existing SalesForm prefills a draft from the accepted OT or remisión |
| Credit note | app/(internal)/ventas/nueva-nc and app/(internal)/notas-credito | Existing source_document_id use retained |
| Collections | app/(internal)/cobros and app/(internal)/ventas/[id]/receipt-dialog.tsx | Existing atomic receipt and reversal RPCs retained |
| Cash flow / treasury | lib/cashflow and app/(internal)/tesoreria | Read-only discovery; no change |
| Sales integrations | lib/tools/erp/manage-sales-document.ts and related overview tools | Discovery only; no change |

## Schema facts

- sales_documents.source_document_id already exists as a self-reference; the audit correction replaces SET NULL with RESTRICT and adds an authoritative provenance trigger.
- sales_quotation_acceptances and work_orders each enforce a single accepted record/order per quotation.
- Acceptance snapshots customer, amount, currency, version, and item details; work_order_items copies accepted items.
- Project-certificate billing is a separate certificate_id flow and was not conflated with post-OT sales documents.
- The existing schema allows multiple downstream documents. It has no item-level delivery/invoicing allocation, balance, or idempotency field.
- NOTA_VENTA exists in the database and B09 read paths. It is now represented in the TypeScript read model and labels but remains unavailable as a new form type.
- Exactly one new migration: 20261004041015_sales_provenance_guard.sql. Applied historical migrations remain unchanged.

## Changed files

- app/(internal)/ordenes-trabajo/[id]/page.tsx
- app/(internal)/ordenes-trabajo/page.tsx
- app/(internal)/ventas/sales-source-form-page.tsx
- app/(internal)/ventas/sales-form.tsx
- app/(internal)/ventas/actions.ts
- app/(internal)/ventas/[id]/page.tsx
- app/(internal)/remisiones/nueva/page.tsx
- app/(internal)/facturas-venta/nueva/page.tsx
- lib/sales-post-ot.ts
- lib/sales.ts
- lib/types.ts
- lib/template-gen.ts
- lib/__tests__/sales-post-ot.spec.ts
- IMPLEMENTATION_REPORT-BATCH-10.md
- BATCH-10-MANIFEST.md

## Original checks (current correction results in BATCH-10-AUDIT-CORRECTION.md)

- Focused tests: passed
- Full Vitest suite: one complete run passed (1,546 passed, 16 skipped). A final repeat timed out only in the unrelated schedule-import PGlite test (1,545 passed, 16 skipped); that file passed 20/20 in isolation.
- TypeScript: passed
- Production build: passed with next build --webpack; Turbopack could not resolve the node_modules shared outside the worktree. Placeholder public Supabase values were used for build only.
- Preview SQL smoke: blocked by missing authenticated JWT context in the SQL runner; retry status and post-run ledger/fixture counts are in the implementation report
- Authenticated visual smoke: unavailable
- Production reads/writes: none
- Merge/deploy: not performed
