# FINAL ERP HARDENING - BATCH 11

Status: discovery completed before fixes; external audit financial-link correction implemented in PR #32. READY FOR EXTERNAL RE-AUDIT. Final Preview ledger: 52; Production: 48. Original B11 snapshot below is retained; the external correction section supersedes its final counts/ledger.

Base: 3572a70375317e7a532faf9be0fea93a6d8e3120. Branch: batch/11-final-hardening. Production read-only. Starting Preview/Production ledgers: 48/48.

## System map completed before fixes

105 route/page/layout/handler entries; 148 candidate mutation/RPC files (554 named exports, including read actions/client wrappers); 183 test files; 48 migrations. Preview catalog: 168 public/storage tables (all RLS enabled), 211 public functions, 62 private functions, 237 user triggers, 984 constraints, 385 policies and 9 views.

Counts are discovery inventory, not a claim that every candidate is a factual write or that all paths have passed audit.

| Surface | Concrete implementation | Canonical authority / fact path |
|---|---|---|
| Auth / tenant / admin | lib/auth.ts, proxy.ts, lib/supabase/{server,admin}.ts; users/empresas/configuracion actions | Session cookies -> auth.getUser -> profile/empresa -> role/module/plan; session client RLS vs privileged admin client. profiles/empresas and current_empresa_id/current_profile_role/is_super_admin helpers are shared authority. |
| PREBID / tender / Cost Engine | licitaciones/[id]/prebid; lib/workspace, lib/costing, lib/cost-engine, lib/procurement/tender-to-project.ts | TENDER context -> frozen offer versions/outcome -> explicit GANADA -> project_contract_baselines -> human project creation. private.workspace_actor/rfq_actor and PREBID context/snapshot triggers. |
| Procurement / RFQ / OC | rfqs, orders/direct-purchase-actions, lib/rfq, lib/procurement/send-rfq-service | Human RFQ create/invite -> supplier bearer-token quote versions -> human review/allocation/authorization -> hash preview/confirm -> canonical authorized_orders/items. private permits, snapshot/closure guards and unique allocation/provider order identity. |
| Inventory / receipt / stock | inventario, inventory/actions, orders/oc-recepcion-actions, warehouse/recepcion portals; lib/inventory | Canonical receipts/warehouse submissions -> explicit confirm -> inventory_post_movement -> balances/costs; opening guards and idempotency keys. Legacy stock_movimientos retained; 71?2 never remediated. |
| Execution / climate / BIM / schedules | projects/[id], projects climate/progress-forecast/historical-weather/import-session/production-recipe actions; lib/bim/schedule | PROJECT context -> project observations, weather batches/log, execution entries, forecast snapshots and BIM decisions. private.execution_actor and provenance/version/immutability triggers prevent PREBID leakage. Climate and tender-monitoring cron handlers authenticate bearer secret. |
| Weekly plan / MRP / certificates | projects/weekly-plan-actions, weekly-plan-need-actions; lib/procurement/weekly-plan*; certificates/workbooks | Baseline+deltas -> project/weekly requirement sources -> canonical stock + timely committed inbound -> residual need snapshots -> explicit human RFQ/direct decision. private.weekly_mrp_actor/locks/need guards. Certificate staff/anexos/import/PDF separate from financial sales. |
| Cashflow / dashboard / treasury | lib/cashflow/{load,model}, lib/dashboard; flujo-caja, dashboard, tesoreria, pagos | cashflow_read_sources -> one canonical PLANNED/COMMITTED/ACTUAL fact model -> dashboard/cashflow. Invoice/OP/receipt/treasury financial identities and atomic financial RPCs determine actual settlement. |
| Sales / quotation / OT / collections | ventas/actions; ventas/[id]/quotation-actions; cotizacion token portal; lib/quotation*; ordenes-trabajo | DRAFT -> PENDING_ACCEPTANCE -> accepted version/evidence -> unique canonical OT. Human downstream remision/invoice/NC, source FK RESTRICT and immutable trigger. registrar_cobro_atomico/revertir_cobro_atomico connect treasury; historical NOTA_VENTA read only. |
| SIFEN / Goekua | ventas/sifen-actions, ventas/[id]/sifen-button, lib/goekua{,-payload}, tools/erp/manage-sifen-document | Auth/tenant/internal issued status/provenance/duplicate metadata/payload -> mocked-or-real provider -> provider ID separate from CDC. NC source CDC + human motive/source items; ID-only pending reconciliation; mandatory numbering/config fails closed. |
| Invoices / scanner / worker / documents | invoices creation/revision/detail, scanner token APIs; worker/index.ts; lib/scanner/documents/invoice-* | Token claim/upload -> scoped stored attachment/invoice_jobs -> service-role SKIP LOCKED claim -> OCR/provider lookup -> unique supplier invoice + item matching -> reconciliation -> human payment approval. Worker retry/requeue and storage signed URLs are separate privileged surfaces. |
| Agent / voice / email / auction sandbox | lib/agent, lib/tools/erp, scripts/agent-worker.ts, server/voice-ws-proxy.ts, API agent/voice/Gmail, auction-lab | Trusted actor/tool allowlist/Zod/role/state/risk/human approval/idempotency -> existing domain actions; agent tasks/events/timers and mail OAuth/send leases. Auction sandbox token-gated simulation has no real external tender submission. |
| Navigation / print / build | components/layout/sidebar, workspace section-actions, print/export routes, package.json, railway.json, Next/Vitest/Playwright configs | Internal/print/export boundaries use authenticated profile; public token pages have separate credentials. Next 16.3.1 Webpack build and Railway tsx worker; no mass dependency upgrade. |

## Cross-module regression matrix

| Boundary | Required adversarial evidence |
|---|---|
| Auth -> every domain | Inactive actor denial, role/module checks, foreign IDs, admin/super-admin separation |
| PREBID -> project | Lost tender denied; GANADA human; immutable won baseline; no pre-award operational facts |
| Need -> RFQ/direct -> OC -> receipt -> stock | Human transitions, preview/hash/idempotency, receipt exactly once, tenant products/locations |
| Execution -> plan/MRP -> cash | Baseline+deltas, provenance, timely inbound, partial shortage preserved; committed facts deduplicate |
| Supplier invoice -> OP -> treasury | Role/tenant/state gates, atomic settlement, canonical identities, no false paid fact |
| Accepted quote -> OT -> invoice/NC -> cobro/treasury | Version invalidation, OT unique, immutable provenance, amount/FX/receipt/reversal, B09 deduplication |
| Scanner/storage -> worker -> invoice | Credential/path/tenant checks, claim/retry isolation, uniqueness, no ignored factual persistence failure |
| SIFEN | No provider ID as CDC; internal lifecycle/source CDC/human motive; safe fail-closed; no real HTTP |
| Navigation/build/E2E | Existing paths and deployments, worker start, safe test target guard; unavailable browser smoke truthful |

## Audit findings and validation

The initial discovery checkpoint had no fixes. Final findings, corrections, evidence and verification limits follow.

## Findings and defensive corrections

| ID | Priority | Exact prior boundary | Correction | Evidence |
|---|---|---|---|---|
| B11-01 | P0 | profiles_admin_write allows tenant admin ALL writes with no protection of is_super_admin or profile identity | Invoker trigger protects superadmin profiles/flag, profile ID and tenant; service provisioning and existing superadmin administration retained | Local PostgreSQL expected denials; enabled Preview trigger |
| B11-02 | P0 | SECURITY DEFINER claim_invoice_job/requeue_stale_invoice_jobs globally select/update jobs, with anon and authenticated EXECUTE; mark_invoice_pagado has no actor/tenant/OP authority | Worker/legacy settlement/counter functions service-only; existing atomic OP execution remains client payment authority | Preview has_function_privilege assertions; local PostgreSQL grant regression |
| B11-03 | P1 | mark_invoice_apto_para_pago/recompute_invoice_status/recompute_order_facturado/sync_order_payment_status accept arbitrary IDs with no caller/tenant check | Active financial actor and exact resource tenant checks; anon EXECUTE revoked; approval row locked | Own authorized local approval PASS; role/tenant/inactive expected DENIAL PASS |
| B11-04 | P1 | requireProfile and shared RLS helpers ignore profile.active; scanner uses getCurrentProfile with privileged session/status access | Active profile/company helpers, fail-closed missing company flags, scanner profile/company denial; optional token claim cannot use inactive ERP identity | Server module/plan/admin/scanner regressions and local DB actor denials |
| B11-05 | P1 | Cookie proxy redirects cron service requests before their bearer-authenticated handlers | Exact existing two cron paths reach handler; handler CRON_SECRET authority unchanged | Proxy -> mocked handler: valid secret PASS, absent/wrong/missing config DENIAL; unrelated routes still session-gated |
| B11-06 | P1 | log_audit_event is anonymous definer insert; audit_logs_insert only checks nonnull UID | Anonymous RPC revoked; exact active actor/tenant/reference checks; direct INSERT policy scoped to actor/tenant | Local PostgreSQL own audit PASS, foreign reference/provider attribution DENIAL; live ACL DENIAL |
| B11-07 | P1 | invoices/payment_orders have client UPDATE authority for settlement statuses; account INSERT/UPDATE permits raw balance writes outside authoritative RPCs | Raw invoice/OP state transitions denied; settled facts immutable; raw account creation/delete/balance edits revoked while metadata edits preserved | Canonical approved invoice -> OP PASS, replay/unapproved/raw states DENIAL, metadata PASS and direct balance/creation DENIAL |
| B11-08 | P1 | Invoice/OP supplier and invoice attachment FKs validate ID without tenant; invoice create/revision can use supplier input before privileged Storage work | Additive composite tenant FKs for future writes; supplier ownership checked before Storage; matching uses canonical reconciliation instead of unconditional MATCH | Local PostgreSQL foreign source DENIAL / own source PASS; scanner source denial before privileged writes; Preview constraints present |
| B11-09 | P1 release blocker | Runtime Next 16.3.1/Sharp 0.35.3 fall in current critical/high advisory ranges | Bounded Next 16.3.8 patch and its Sharp 0.35.5 transitive dependency/native packages; React and business APIs unchanged | npm audit before/after, installed versions, final patched-runtime tests/build |

The priority is ERP impact, not a direct copy of Advisor/npm severity. Findings were not expanded into exploit chains. The initial discovery transaction was rolled back; after the user's defensive-only instruction, live verification used read-only catalog assertions only. No escalation/credential-abuse demonstration was repeated or committed. Local regressions assert expected denials using isolated pre-existing test fixtures; they never connect to Production.

## Module outcome and evidence scope

| Module | Result |
|---|---|
| Auth / tenant | Shared authority and scanner fixes above; local denial tests + Preview ACL/trigger checks. Live signed-in RLS tests are NOT VERIFIED: no authorized test identities/session supplied. |
| PREBID / tender | Existing private workspace/rfq actor guards, frozen offer/outcome/baseline and human project handoff retained. Workspace/procurement regression suite covers provenance and rejected contexts; no tender created or DNCP imported. |
| Procurement | Existing human RFQ/allocation/order/direct-preview/confirm permits and locks retained; invoice matching authority corrected. No supplier email/RFQ/OC created. Direct Purchase MD5/recompute remains documented P2 debt. |
| Inventory | Existing actor/plan/source guards, receipt/warehouse confirmation, canonical posting and opening idempotency retained; no opening remediation or stock mutations. 71x2 INITIAL_STOCK unchanged. |
| Execution / BIM / climate | PROJECT provenance, budget/execution context guards and existing atomic BIM/forecast paths retained; cron reachability corrected without changing climate engine. |
| Weekly plan / MRP | Existing private weekly actor, baseline+deltas, source locks, timely inbound/residual shortage and explicit human need decisions retained; no auto RFQ/OC added. |
| Cashflow / dashboard | Existing canonical PLANNED/COMMITTED/ACTUAL loaders/model and sales actual deduplication retained; protected upstream financial facts. Historical stock is excluded as before; draft receipts not converted to ACTUAL. |
| Sales / OT / collections | B10 accepted version/evidence/provenance and unique OT contract retained. Receipt DML already has SELECT-only policy and authoritative atomic collection/reversal; no redundant receipt permission fix added. Canonical OP requires approved supplier invoices. |
| SIFEN | Existing provider ID != CDC separation, payload/source guards, missing numbering/config fail-closed retained; no provider request or fiscal document issued. Real fiscal numbering/config remains deferred. |
| Workers | Invoice claim/requeue service ACL corrected. Unique supplier invoice and lease lock behavior retained. Agent tool actor/allowlist/approval/tenant path and email OAuth one-time state retained. No real worker/provider side effect invoked. |
| Navigation / build | Source route inventory and Webpack route output checked. PREBID, project, sales/OT, treasury/cashflow paths exist. No redesign/TSX component change. No authenticated browser session was available. |

These are bounded source/catalog/regression conclusions, not a claim of live authenticated end-to-end certification for every discovered route.

## Migrations and deployment boundaries

1. 20261004200423_b11_authority_boundaries.sql: actor/activity/profile/worker/audit/financial status boundaries; no historical facts changed.
2. 20261004204346_b11_invoice_source_tenant.sql: composite source tenant constraints, canonical approved-invoice OP prerequisite and account column privileges. FKs are NOT VALID to preserve historical rows; they enforce future writes. Existing row validation/reconciliation is explicitly not performed.
3. 20261004210311_b11_invoice_reconciliation_lock.sql: resource row locks serialize tenant checks/reconciliation with human approval; existing calculations retained.

All three migrations were created through Supabase CLI and applied only with explicit Preview project ref and --skip-vault. No historical migration was edited. Preview ledger 48 -> 51. Production ledger remains 48 (read-only check). No migration repair, seed, Vault update, Production deploy or Production DML.

CLI db push completed; optional pg-delta catalog caching warned that local Docker is unavailable. Live Preview catalog assertions independently verify all migrations' authority boundaries, so this warning is not a migration failure.

### Reproducible defensive catalog check

Run scripts/batch11-verify-preview.sql via Supabase db query --linked --project-ref xddlzgjwufskgasomval. It uses BEGIN READ ONLY and ROLLBACK, checks ledger/ACL/column privileges/active guards/FKs/canonical approval predicate, and never impersonates an identity or mutates business rows. Result: PASS. Prior synthetic Preview company fixtures: 0 remaining.

## Advisor and dependency triage

Preview Security Advisor BEFORE: 162 = 2 ERROR + 160 WARN.
Preview Security Advisor AFTER: 149 = 2 ERROR + 147 WARN.
New findings: 0. Removed: 9 anonymous definer-execution warnings + 4 authenticated global/legacy RPC execution warnings. Stable comparison normalizes cache_key/cacheKey.

The two existing definer views cover global procurement competitor intelligence, not tenant ERP money/identity facts. Remaining trigger-function/default grant and legacy search_path warnings were assessed as legacy/non-standalone RPC surfaces; no blanket catalog rewrite. Auth leaked-password policy remains inherited configuration. Advisor != a zero-risk certification.

Runtime npm audit BEFORE: 5 package entries (1 critical, 2 high, 2 moderate).
Runtime npm audit AFTER bounded patch: 3 package entries (0 critical, 1 high, 2 moderate). Remaining brace-expansion/glob and ExcelJS/uuid are documented P2 dependency debt. No ERP path passing an untrusted brace glob was identified; ExcelJS uses uuid.v4(), not the affected buffered v3/v5/v6 path. No exploit was attempted.

Maintainer sources reviewed:
- https://github.com/vercel/next.js/security/advisories/GHSA-p293-qw3h-jr36 (Windows server; patched 16.3.3).
- https://github.com/vercel/next.js/security/advisories/GHSA-2xp9-vwfh-vxw4 (AVIF optimizer; patched 16.3.3).
- https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j (ImageResponse; patched 16.3.6; no ImageResponse import found in ERP).
- https://nextjs.org/docs/app/guides/upgrading/version-16 (already on 16; no major-version migration/codemod needed).

## Remaining post-roadmap debt (not silently certified or expanded)

P2, outside this release's bounded corrections:
- Historical 71x2 opening count reconciliation; Sales per-item downstream allocation; undocumented Goekua provider-ID -> CDC retrieval; fiscal numbering/config design; labor Batch 1B; certificate CAS/atomic follow-up; Direct Purchase MD5/recompute; accounting/IVA/new KPI/CRM/UI roadmap.
- Invoice OCR worker has best-effort Storage/attachment/item persistence and finish writes; unique supplier invoice prevents duplicate headers, but recovery/observability of partial failure needs a separate workflow design. No real worker failure was induced.
- Legacy standalone Deepgram WS prototype accepts query IDs. Current ERP STT uses authenticated /api/agent/voice/transcribe, no browser WS caller was found, and Railway starts invoice worker; prototype production deployment was not found. Treat as undeployed P2 debt; do not publish the prototype without authentication work.
- Agent best-effort audit uses actor_type='agent', which the inherited audit constraint does not accept. Persisted agent steps/events remain separate; broad audit model change deferred.
- Runtime transitive dependency debt above. Existing tenant-admin plan/module configuration UI remains as designed; no billing/entitlement redesign inferred from feature flags.

P3 verification limits:
- Authenticated visual smoke and live signed-in RLS/E2E are NOT VERIFIED. Browser inventory contained no ERP session; no credentials requested/used after clarification. No screenshots or unrelated browser content inspected.
- Full suite's declared skipped/external cases are reported as skipped, never PASS. Docker unavailable; no ephemeral live stack was fabricated.

## Verification status

| Check | Result |
|---|---|
| Focused auth/financial/scanner tests | 89 PASS across 5 files |
| DB behavior | 32 PASS in isolated PostgreSQL; actual 3 migration files executed, including canonical approved invoice -> OP and replay denial |
| Live Preview defensive catalog | PASS, ledger 51; 3 guards/3 tenant FKs, expected ACL/column denials and row lock predicate |
| Cross-module regression | 528 PASS across 40 files (workspace, inventory, RFQ, weekly/MRP, cashflow, dashboard, Sales/SIFEN, B11 authority) |
| Full Vitest | 1700 PASS + 16 declared SKIP; 166 files PASS + 2 SKIP |
| Typecheck | PASS, tsc --noEmit |
| Webpack production build | PASS, Next 16.3.8; 59 static pages generated, dynamic route table emitted; only localhost build placeholders |
| Sharp native benign smoke | PASS, fixed local SVG -> 1px PNG; no untrusted/offensive input |
| Diff check | PASS |
| Authenticated E2E/visual | NOT VERIFIED (P3); no safe existing ERP session/test credentials; Docker unavailable |

Commands: vitest run --maxWorkers=2 --testTimeout=15000 --hookTimeout=30000; focused/cross-module path filters as described above; tsc --noEmit; next build --webpack; npm audit --omit=dev --json; scripts/batch11-verify-preview.sql through explicit Preview CLI target.

P0 before/fixed/open: 2 / 2 / 0 identified.
P1 before/fixed/open: 7 / 7 / 0 identified (concurrency lock included in B11-03). P2/P3 remain explicitly documented.

Release verdict: READY FOR EXTERNAL AUDIT of this branch, with stated P2/P3 limits. This is not merge authorization or Production certification. Production DB/data and ledger unchanged; no real fiscal/supplier message/stock fixture. Main unchanged. PR must remain OPEN/unmerged.

Final concurrency delta: 20261004210311_b11_invoice_reconciliation_lock.sql locks the invoice/order resource before the actor/tenant check and reconciliation. The calculations are unchanged; approved invoice cannot be reverted by a stale reconciliation read. Local PostgreSQL row-lock-definition/reconciliation regressions: 5 PASS. Preview ledger final: 51.

## Per-module discovery / verification / fix ledger

| Module | DISCOVERED | VERIFIED | FIXED |
|---|---|---|---|
| AUTH / TENANT | Session/server/privileged clients, profiles/empresas, shared helpers/RLS | Local authorized pass/expected-denial tests; live catalog; signed-in live checks not verified | Profile privilege boundaries, inactive/company gates, scanner authority |
| PREBID / TENDER | Workspace/outcome/handoff/snapshots, cost histories | Existing workspace/provenance regressions + catalog guard review | No engine change required |
| PROCUREMENT | RFQ/quote/allocation/order/direct purchase/portals | Human permits/scope and workflow regressions, FK/source review | Canonical invoice reconciliation; linked finance source scope |
| INVENTORY | Receipts, submissions, movement ledger/reservations/opening | Existing inventory posting/idempotency and canonical stock regressions | Worker public job authority only; no stock facts changed |
| EXECUTION / BIM / CLIMATE | Project sources, forecasts, BIM/computo, climate cron | Existing PROJECT provenance/atomic regressions, exact cron guard test | Cron proxy reachability |
| WEEKLY PLAN / MRP | Baseline+deltas, locked needs/sources and human decisions | Weekly/MRP/procurement and timely inbound regression | No MRP engine change required |
| CASHFLOW / DASHBOARD | Canonical source RPC/model, actual financial facts | Canonical cashflow/dashboard regression + authoritative OP/source DB tests | Upstream financial fact boundaries, account balance authority |
| SALES / OT / COLLECTIONS | Acceptance/version/unique OT/provenance; receipt/reversal RPC | Sales authority/provenance DB regressions; receipt writes already RLS denied | Shared active authority; no Sales allocation/acceptance redesign |
| SIFEN | Goekua contract/metadata/payload/provider-ID/CDC | Existing mock authority/contract cases and fail-closed source checks | Security runtime patch only; no fiscal engine/numbering change |
| WORKERS | Invoice queue/OCR, agent tasks/events/leases, email OAuth, unused voice prototype | Service ACL/catalog; existing agent/email/scanner regression; partial worker/prototype debt documented | Job RPC grants; no real worker/provider execution |

## Re-audit and operational limits

All changed actor/role/tenant/status/source/cron boundaries were rechecked through their actual migration/server implementations, authorized local operations and expected denials. Existing canonical money RPCs remain authoritative; default grants alone were not equated with write access where RLS already denies writes (e.g. sales_receipts).

Source review found no new release-blocking unbounded recursion/full-scan path introduced by B11. Legacy manual reconciliation scans pending tenant invoices and does sequential matching; this is P2 scale debt, not a claimed load-test pass. No speculative performance rewrite or accounting redesign was performed.

## External audit correction — immutable financial relationships

Audited prior HEAD: f8e542020287254720648c929332a844ad97410f. Same branch and PR #32; no merge or Production deployment.

**B11-10 / P1:** invoice_order_matches and payment_order_invoices retained INSERT/DELETE policies after financial approval/settlement. unmatchOrder ignored DELETE errors and reported/audited success. Deleting a settled link could remove invoice -> OC or OP -> invoice evidence while the invoice/OP/treasury facts survived; the OC reconciliation could regress.

Minimum correction: one new additive migration, 20261004213348_b11_settled_financial_relationships.sql. The prior three B11 migrations remain byte-for-byte unchanged.

- BEFORE INSERT/UPDATE/DELETE invoker guards freeze invoice -> OC when either OLD/NEW invoice is APTO_PARA_PAGO/PAGADO or OLD/NEW OC is APTO_PARA_PAGO/PAGADO. FACTURADO and normal unpaid reconciliation remain editable under existing RLS.
- BEFORE INSERT/UPDATE/DELETE invoker guards freeze OP -> invoice when either OLD/NEW OP is EJECUTADA or OLD/NEW invoice is PAGADO. EMITIDA membership INSERT/DELETE remains available; no UPDATE policy is added.
- No service/maintenance exemption. Parents are locked with FOR UPDATE in stable ID order: invoice -> OC, matching approval/reconciliation; OP -> invoices, matching canonical OP execution. No global locks or financial calculation changes.
- A BEFORE DELETE invoice-parent guard prevents APTO/PAGADO deletion from erasing links through FK cascade. The existing executed-OP parent guard remains authoritative. Unpaid OP deletion still cascades normally.
- unmatchOrder checks the actual DB result, scopes all three IDs, returns the canonical business error, and does not audit/revalidate a rejected or missing deletion. A small shared action-state button displays errors; both existing detail screens hide unlink for frozen invoice/OC states. No UI redesign.

### Correction evidence

The B11 local PostgreSQL harness now executes all four actual B11 migrations plus actual baseline relationship RLS, tenant triggers, reconciliation trigger, OP execution, treasury RPC and balance trigger. All synthetic local test changes use rollback transactions. No live unauthorized access/identity impersonation or remote business mutations were attempted.

25 new DB cases cover unpaid unlink and reconciliation; APTO/PAGADO deletion/INSERT/repoint denial; OLD and NEW terminal parents; EMITIDA membership under inherited policies; executed OP membership denial; paid invoice membership evidence; parent cascade denial; canonical approved OP execution and replay rejection; exactly one -100 treasury movement/balance effect; unchanged invoice/OC/OP/treasury source facts after rejected mutations. Four action tests cover canonical business errors, stale/missing links, successful audit/revalidation and role denial.

Lock ordering is verified against the actual PostgreSQL function definitions. No multi-connection live race test is claimed. B09 cashflow/dashboard regressions pass, with canonical facts preserved.

| Final check | Result |
|---|---|
| Focused correction/B11 DB/action | 61 PASS across 2 files |
| Actual migration PostgreSQL suite | 57 PASS (32 existing + 25 correction) |
| Cross-module, including treasury/cashflow/dashboard/Sales/inventory/weekly/workspace | 506 PASS across 39 files |
| Full Vitest | 1729 PASS / 16 SKIP; 167 files PASS / 2 SKIP |
| Typecheck | PASS |
| Webpack build | PASS, Next 16.3.8; 59 static pages; localhost-only build placeholders |
| Diff check | PASS |
| Preview read-only catalog | PASS; ledger 52, all three new guards enabled, ordered parent locks and invoker security asserted |
| Production read-only ledger | 48 |
| Preview Advisor | Unchanged: 149 = 2 ERROR + 147 WARN; correction adds 0 findings |
| Authenticated live RLS/E2E/visual | NOT VERIFIED, inherited P3 |

Preview migration applied explicitly to xddlzgjwufskgasomval with --skip-vault; dry-run listed exactly this one migration. Docker catalog-cache warning does not affect the successful migration/catalog assertions. No historical data repair or persistent test fixtures. No SIFEN, Goekua, stock, certificate, labor, Direct Purchase or accounting scope expanded.

The prior primary Vercel Preview was CANCELED by Ignored Build Step despite a green GitHub check. Hosted Preview remains NOT VERIFIED; local build and Preview DB results are separate evidence. No Vercel settings or legacy projects modified.

P0 identified/open: 2/0. P1 identified/open: 8/0 (the seven initial corrections plus this external P1). Existing documented P2/P3 debt remains. Final verdict: READY FOR EXTERNAL RE-AUDIT; not authorization to merge or deploy Production.

## External re-audit correction #2 — hard-delete fail-fast

Audited prior HEAD: 0bbdfbdcf1b0330df895337fd47fb927150a37be. This correction changes application guards/tests/docs only: **no migration and no database mutation**.

**B11-11 / P1:** admin deleteInvoice() blocked PAGADO but allowed APTO_PARA_PAGO. The action then ignored failures from invoice_order_matches, invoice_exceptions, audit_logs and payment_order_invoices cleanup. The settled-link trigger could reject the first delete while later evidence cleanup continued.

- Both APTO_PARA_PAGO and PAGADO now return a clear error before any child query/mutation, audit deletion or Storage request.
- Every required destructive delete (invoice_order_matches, invoice_exceptions, audit_logs, payment_order_invoices, invoices) checks the database error and returns immediately. The first relationship-guard error during a concurrent approval/payment race stops all subsequent cleanup; no later evidence or Storage is touched and the action never reports success.
- Existing admin-only authority, tenant-scoped lookup, executed-OP protection and unpaid hard-delete capability remain.
- All three existing DeleteInvoiceButton surfaces now receive invoice status and hide the action for APTO_PARA_PAGO/PAGADO. Editable statuses remain deletable. The server action and database guard remain canonical.

### Correction #2 evidence

New targeted suite: lib/__tests__/b11-delete-invoice.spec.ts, 16 tests. Proves APTO/PAGADO early denial; simulated race guard denial followed by zero exception/audit/OP/invoice/Storage operations; fail-fast at every required cleanup delete; successful MATCH cleanup including attachment/storage; admin-only denial; hidden protected controls in all existing surfaces and preserved editable-state controls. No live identity was impersonated.

Final validation: focused 77 PASS (16 delete-action/UI + 57 actual PostgreSQL DB behavior + 4 unmatch action), cross-module 522 PASS / 40 files, full Vitest 1745 PASS / 16 declared SKIP (168 files PASS / 2 SKIP), Next 16.3.8 Webpack build PASS, isolated typecheck PASS, diff check PASS. Existing settled-link tests and canonical OP exactly-once/treasury/B09 assertions remain green.

No migration was created or applied. Preview ledger remains 52; Production ledger 48 (read-only). No Production/main/business data modification. Main remains 3572a70375317e7a532faf9be0fea93a6d8e3120; PR #32 remains open/unmerged. This completes the identified correction #2; remaining verification limits are inherited P3 (authenticated live session/hosted Preview/live multi-connection race).
