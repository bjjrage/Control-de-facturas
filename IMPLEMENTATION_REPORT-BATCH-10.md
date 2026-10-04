# Current authorized correction

See [BATCH-10-GOEKUA-CONTRACT-CORRECTION.md](BATCH-10-GOEKUA-CONTRACT-CORRECTION.md) for the current
provider contract, separate Goekua ID/CDC persistence, human NC motive and source-item choices,
Preview ledger 48 / Production 46 and final verification. It supersedes prior fiscal payload and
migration-count statements below. Main/production/71x2 remain unchanged; PR #31 stays open.

# Batch 10 — Sales / Post-OT implementation report

## Scope

Branch: batch/10-sales-post-ot
Base: 4b7896025fa01d45a87b71fe132f331ee303ca89
Production merge/deploy: not performed
Database migrations: two additive Preview-only migrations; Preview ledger 48 / Production 46 (see current correction report)

The change wires accepted quotations and their canonical work orders into the existing sales document editor. A user chooses whether to prepare a remisión or factura; submitting the existing SalesForm creates a draft for review. It does not emit documents, collect payments, create treasury entries, or trigger procurement, inventory, or SIFEN actions.

## Discovery findings

The relevant existing flow is:

1. A PROFORMA is sent through the existing electronic acceptance portal.
2. accept_quotation records an append-only sales_quotation_acceptances row and creates at most one work_orders row for that quotation.
3. work_order_items stores the accepted work snapshot.
4. Sales documents already have source_document_id, a self-reference used by the existing credit-note flow. The old “convert” buttons copied text/items but did not persist that relationship.
5. Existing cobro registration and reversal use registrar_cobro_atomico and revertir_cobro_atomico; those RPCs were not changed.

Relevant surfaces inspected:

- Clients and quotations: app/(internal)/clientes, app/(internal)/proformas, app/(internal)/ventas
- Sales editor, actions, detail, receipts, quotation acceptance: app/(internal)/ventas/sales-form.tsx, actions.ts, [id]/page.tsx, quotation-actions.ts, receipt-dialog.tsx
- Work orders: app/(internal)/ordenes-trabajo
- Remisiones and sales invoices: app/(internal)/remisiones, app/(internal)/facturas-venta
- Credit notes and collections: app/(internal)/ventas/nueva-nc, app/(internal)/notas-credito, app/(internal)/cobros
- Public quotation routes: app/(public)/cotizacion, app/(public)/cotizar
- Database contract: supabase/migrations/20261002231537_production_schema_baseline.sql

The existing database supports multiple documents per source but has no per-line delivery/invoicing allocation or remaining-quantity ledger. Older documents with only a note such as “Generado desde …” cannot be assigned to a source safely; this implementation does not infer links from names, totals, dates, or notes.

The accepted quotation and acceptance are append-only/versioned; each quotation can have only one acceptance and one canonical OT. The acceptance snapshot stores the accepted customer, amounts, currency, version, and items; the OT stores copied line items. RLS is tenant-scoped, and the new source lookups also filter by empresa_id because source_document_id is a plain self-FK. Project-certificate billing uses certificate_id and remains a separate flow.

## Implemented

- Added an OT post-sales panel with explicit “Preparar remisión” and “Preparar factura” choices.
- Prefilled the current SalesForm from the accepted customer snapshot, currency, accepted items, due date, and quotation/work-order references. Items remain editable so the user can prepare partial documents.
- Kept the result in BORRADOR; emission and collection remain separate existing actions.
- Persisted factual lineage through source_document_id for new documents prepared from a verified accepted quotation or remisión.
- Validated source tenant, allowed document-type transition, active source status, client, currency, exact quotation/OT/acceptance IDs, accepted quotation version, acceptance totals, and accepted line-item snapshot before creating or updating a linked draft.
- Listed linked documents on the OT by recursively following source_document_id, including their statuses and totals; added the direct source link on each sales document.
- Used the immutable accepted client-name snapshot in the OT list/detail when available.
- Kept NOTA_VENTA readable in the TypeScript model and labels while leaving it out of the current create form.
- Removed the direct conversion action that created a downstream document without structured provenance or user review.

## Preserved boundaries

- The original implementation had no migration; the external audit correction adds one provenance guard migration to Preview only.
- No changes to electronic quotation acceptance, the existing work-order creation RPC, cobro/reversal RPCs, treasury, inventory, purchasing, or the PREBID engine.
- No production database or production application mutation was performed.
- No production deployment or merge was performed.

## Original validation (superseded by BATCH-10-AUDIT-CORRECTION.md)

- Focused post-OT and quotation tests: passed.
- Full Vitest suite: one run passed with 1,546 passed and 16 skipped (160 files passed, 2 skipped). A final repeat had 1,545 passed, 16 skipped, and one timeout in the unrelated schedule-import PGlite test; that entire file passed 20/20 when run alone. Focused post-OT/quotation tests passed.
- TypeScript: passed with tsc --noEmit.
- Production build: passed with next build --webpack. The worktree has no local node_modules, so Turbopack could not resolve dependencies outside its filesystem root. Webpack compiled the app, completed TypeScript, and processed all 59 page entries using build-only placeholder Supabase public values; no service calls or deployment were made.
- Preview database: read-only ledger query returned 46 migrations (20261003212845 latest).
- Preview acceptance smoke: not verified. The first-tenant fixture lacked a profile; selecting a tenant with a profile then reached the RPC but the SQL runner had no auth.uid(), so work-order code generation denied the call. Both attempts were wrapped in a transaction. A follow-up read-only query found 0 clients, 0 sales documents, 0 sales counters, 0 OT counters, and ledger 46.
- Authenticated visual smoke: not run; no authenticated ERP session was available for safe verification.

## Known limits

- There is no DB-level allocation/idempotency contract for multiple partial deliveries or invoices. The UI lists factual linked documents but does not claim a remaining quantity or “fully invoiced/delivered” state.
- Historical note-only conversions remain unmapped until a human establishes their provenance.
- The correction adds a rollback-only Preview SQL smoke with explicit synthetic SQL auth context. This is a database test, not a browser login or visual smoke.
