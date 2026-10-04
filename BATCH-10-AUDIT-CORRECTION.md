# Batch 10 — external audit correction, PR #31

P1-A/P1-B were subsequently closed by external re-audit. See BATCH-10-REAUDIT-CORRECTION-2.md for the later P1-C correction and latest validation.

Branch: batch/10-sales-post-ot
Audited old HEAD: 04e1d57db8551db9fb0a8d12a213cc2f687fb186
Main/base: 4b7896025fa01d45a87b71fe132f331ee303ca89
Status: corrected and ready for external re-audit; do not merge or deploy production.

## P1-A: server editor authority

Root cause: updateSalesDocument cast untrusted doc_type to the read-model union without validating the editor allowlist. That union correctly includes historical NOTA_VENTA.

Both create and update now use isSalesEditorType backed by the same SALES_DOC_FORM_TYPES used by the editor. Crafted NOTA_VENTA, invalid types and lowercase variants are rejected before any mutation. NOTA_VENTA remains in the type, labels and B09 legacy reads.

Tests invoke the actual authenticated server actions with a controlled Supabase transport, assert returned errors and absence of writes, and cover all four valid editor types. Linked credit notes and existing standalone emitted invoice sources remain supported.

## P1-B: factual source lifecycle

Root cause: the source FK used ON DELETE SET NULL, source IDs were not authoritative immutable provenance, emission did not re-read the chain, and parent annulment ignored descendants.

Exactly one additive migration: 20261004041015_sales_provenance_guard.sql. No baseline or previously applied migration was edited.

- FK: ON DELETE SET NULL → ON DELETE RESTRICT. Even annulled children retain their factual reference.
- A SECURITY INVOKER trigger rejects clearing/repointing a non-null source, moving a document between tenants, cross-tenant or missing sources, incompatible type/client/currency, and circular chains.
- Parents cannot change type/client/currency with descendants, or become ANULADA while any descendant remains active. Cleanup is explicit, from descendants toward the origin; no cascade is introduced.
- The trigger locks source rows FOR SHARE, conflicting with parent update/delete, so parent invalidation cannot race past linked creation/issuance. Deadlocks may abort a competing transaction rather than destroy provenance. Real concurrent sessions were not separately exercised.
- Emission validates exact IDs through the full source chain. Accepted PROFORMA roots must match the canonical accepted version, acceptance, OT, customer, currency, amounts and item snapshot. Linked REMISION ancestry must reach that root. Standalone manual invoices remain valid NC sources; linked NC requires an emitted/partially collected/collected FACTURA.
- Application emission independently re-reads the chain; crafted source edits are rejected. Delete and void provide business errors, and the existing detail page displays those errors. FK errors in delete are translated to a provenance message.
- Existing RLS policies and grants on tables remain unchanged; the new trigger is invoker security and its function is not exposed as a public callable API.

## Supported domain paths

Accepted quote → canonical OT → REMISION draft and direct FACTURA draft retain the quote ID. REMISION → FACTURA retains the remision ID. FACTURA → NC retains the invoice ID. Multiple valid descendants remain supported; there is no new uniqueness or allocation contract.

Partial allocation remains P2, unchanged and documented in the existing OT panel. No remaining quantity engine, delivery/invoice allocation ledger or automatic fully-invoiced status was added.

## Preview and production evidence

Preview project: xddlzgjwufskgasomval. Dry run listed exactly the new migration. It was tested inside a transaction before applying, applied through db push with explicit Preview ref and skip-vault, then tested again against the installed migration.

Preview ledger: 46 → 47. The CLI reported successful application; its optional local Docker catalog cache failed because Docker was unavailable, which did not prevent migration application or verification.

scripts/sales-provenance-preview-smoke.sql executes real acceptance/idempotency, OT creation, Sales drafts, source protection, snapshot mismatch, tenant rejection, valid issuance, NC, atomic collection and idempotent reversal. Sales provenance operations run with the authenticated database role and RLS. The test uses synthetic SQL JWT context; the service-only acceptance RPC and bank fixture setup use the SQL runner role. This is not evidence of a browser login.

Preview fixtures have Sales disabled, so the smoke temporarily enables it inside the same rollback transaction. All synthetic data, counter updates and this setting are rolled back. Post-run counts: clients 0, Sales documents 0, receipts 0, Sales-enabled companies 0. The only durable Preview change is the migration and its ledger entry.

Production project: ezucivipgmbvamhugkbj. A read-only ledger query before and after returned 46. No production schema or data mutation, production deployment, main change or PR merge was performed. 71x2 remains untouched.

## B09 compatibility

No B09 implementation or migration was modified. The actual Preview cashflow RPC returns no receivable for accepted PROFORMA, REMISION or draft FACTURA; issuance adds exactly one FACTURA receivable; NC and delivery issuance add no duplicate future receivable. A synthetic historical NOTA_VENTA fixture remains readable exactly once by that RPC. Partial collection returns only the remaining 60 of 100. The atomic receipt creates exactly one receipt and one treasury movement with the factual receipt FK; reversal retry is idempotent. The existing canonical model tests prove treasury supersedes its receipt once.

## Validation

- Focused run: 131 passed across server authority, provenance migration, post-OT, quotation/acceptance and canonical cashflow tests. An additional crafted-source-clear case was subsequently added; the final full run includes it.
- Full Vitest: 162 files passed, 2 skipped; 1,582 tests passed, 16 skipped. Two workers, 15s test timeout and 30s hook timeout accommodate existing PGlite fixtures. No test failed.
- PostgreSQL local migration/domain tests: 13 passed. Tests execute the real new migration against a minimal domain schema; they do not substitute for Preview's full schema/RLS smoke, which also passed.
- Preview DB smoke: PASS before application and on the applied migration, with all fixtures rolled back.
- Acceptance/OT, Sales/NC, collections/reversal, B09: PASS in focused/full tests and the applicable Preview domain paths.
- Typecheck: PASS, tsc --noEmit.
- Webpack build: PASS; compiled, passed TypeScript and generated all 59 page entries. Build-only public Supabase placeholders were supplied without writing an env file or deploying.
- Diff check: PASS.
- Security advisors: inspected; 2 errors and 160 warnings concern existing objects/settings. None references the new provenance trigger or FK; no unrelated schema/security redesign was performed.
- Authenticated visual smoke: NOT VERIFIED. No safe authenticated ERP app session was used.

P0: none identified in this correction.
P1: both reported blockers corrected; external re-audit pending.
P2: per-item partial allocation remains unchanged/documented.
P3: authenticated visual smoke not verified.
