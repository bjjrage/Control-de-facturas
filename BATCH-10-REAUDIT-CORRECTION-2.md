# Batch 10 — external re-audit correction #2, PR #31

Branch: batch/10-sales-post-ot
Audited old HEAD: 68a42e4849080b8900817d44a259ca8a7ccd8dd7
Main/base: 4b7896025fa01d45a87b71fe132f331ee303ca89
External re-audit closed P1-A and P1-B. This correction addresses P1-C only.

## Root cause and authority

The Sales detail page exposed SifenButton for any non-annulled FACTURA/NOTA_CREDITO, including BORRADOR. emitirFE and emitirNC checked type, CDC and annulment but not the internal issuance boundary or B10 lineage before calling Goekua. The provider could therefore issue a fiscal document while the ERP remained BORRADOR and B09 had no receivable.

The shared canIssueSalesFiscalDocument predicate permits only FACTURA/NOTA_CREDITO in EMITIDA, COBRADA_PARCIAL or COBRADA. The detail page and SifenButton use this gate. The component checks it after all hooks; no conditional hooks, additional state or redesign was introduced.

Both actual server actions independently load the document with the authorized profile's empresa_id, enforce the same status gate and reuse validateSalesEmission before any external request. Their item/customer reads and metadata writes are also tenant-filtered. NC issuance requires its canonical invoice source; the existing source-CDC payload behavior remains intact.

The common B10 validator rejects missing/annulled sources, tenant/type/client/currency mismatches, invalid accepted version/OT/amount/item snapshots and unissued NC invoice sources. Standalone internally issued invoices remain supported. No second provenance engine was added.

The flow remains two human actions:

1. Emitir the internal document through the existing authoritative boundary.
2. Emitir FE/NC only after internal issuance, revalidating current lineage before calling Goekua.

Neither fiscal action changes BORRADOR to EMITIDA or otherwise changes internal status, amounts, collections or treasury. After provider success it writes only the existing CDC/XML/KUDE fields.

## Provider/database race — P2

Local preconditions now precede the external side effect. A concurrent change after those reads, concurrent fiscal requests before CDC persistence, or provider success followed by a database/network failure remains a distributed integration race. This correction does not add an outbox, new idempotency contract, migration or automatic retry.

Both actions now detect metadata persistence failure and return an explicit reconciliation error containing the provider identifier/CDC rather than reporting successful ERP persistence. The test simulates provider success/database failure, verifies one provider call, no retry and unchanged local CDC. Durable reconciliation/idempotency remains P2; no assumption is made about provider idempotency guarantees.

Per-item delivery/invoice allocation remains P2, unchanged/documented.

## Tests and evidence

The new sifen-authority.spec.ts invokes the actual server actions, mocking only authorization/transport and external I/O. The real common lineage validator runs against exact fixture IDs. No real Goekua HTTP request or fiscal issuance was made.

38 SIFEN tests passed, including:

- BORRADOR FE and NC: rejected, external mock never called, no CDC or internal state change.
- ANULADA, duplicate CDC, wrong type and cross-tenant document: no provider call.
- Missing/annulled/foreign/incompatible source and invalid accepted version/OT totals/items: rejected before provider call.
- Invalid NC invoice source, including missing source or unissued invoice: rejected.
- Valid standalone EMITIDA/COBRADA_PARCIAL/COBRADA invoice, direct OT invoice and invoice via remision: one provider call; CDC/XML/KUDE persisted; status unchanged.
- Valid emitted NC from an emitted OT invoice: one HTTP mock call, referenced CDC preserved, NC metadata persisted.
- Rendered SifenButton: no control for BORRADOR/ANULADA, even with historical CDC; Emitir FE present for issued FACTURA, absent for REMISION.
- Actual B09 canonical model: fiscal metadata leaves zero receivable for BORRADOR/COBRADA, exactly one 100 receivable for EMITIDA and one remaining 60 receivable for COBRADA_PARCIAL.

Focused regression: 170 tests passed across SIFEN, B10 server authority, real PostgreSQL provenance migration lifecycle, post-OT, quotation/acceptance and canonical Cashflow.

Final full Vitest: 1,620 passed and 16 skipped; 163 files passed and 2 skipped. Two workers, 15s test timeout and 30s hook timeout for existing PostgreSQL fixtures. Typecheck: PASS (tsc --noEmit). Webpack build: PASS, including TypeScript and all 59 page entries, using build-only public Supabase placeholders without an env file or deployment. Diff check: PASS.

The existing rollback-only Preview domain smoke was rerun successfully: acceptance/idempotency and canonical OT, Sales/NC/provenance, collection/reversal and actual B09 RPC filtering (no accepted quote, delivery, draft invoice or NC positive receivable; historical NOTA_VENTA readable). Fiscal metadata changes neither doc_type nor status, which are that unchanged RPC's inclusion conditions. No B09 implementation was modified.

Database: no new migration or schema change. 20261004041015_sales_provenance_guard.sql remains unchanged. Preview ledger 47; Production ledger read-only verified 46. The Preview smoke rolled back all fixtures/configuration; no production data/schema mutation, main change, merge, deploy, Batch 11 or 71x2 modification was performed.

Authenticated visual smoke: NOT VERIFIED. Component rendering tests are automated markup checks, not a logged-in browser session.

P0: none identified in this correction.
P1: P1-C corrected, pending external re-audit; P1-A/P1-B previously closed by external re-audit.
P2: partial allocation and provider/database durability race remain documented.
P3: authenticated visual smoke not verified.
