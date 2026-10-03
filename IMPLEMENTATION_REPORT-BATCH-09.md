# Batch 09 — Cashflow + Dashboard

## Scope and frozen source
Branch: `batch/09-cashflow-dashboard`; base: `6db18552eab235933c55503d3d774775dbceea58`.
No merge, production deployment, reconciliation, UI redesign or Batch 10 implementation.
Production project `ezucivipgmbvamhugkbj` was inspected read-only. Its ledger remains 44 entries, latest `20261003195245`.

## Discovered Cashflow surfaces
- Six-month Flujo de Caja, project/currency filters, opening financial account balances, recurring expense actions and date buckets.
- Saved weekly-plan targets, contractual/executed quantities, BOM, labor/equipment/subcontract APU lines, adopted prices/purchase evidence/CPP, project and central confirmed physical stock, reservations and authorized supply.
- OC residual obligations, invoice/order links, payment-order/invoice links, executed payment orders and treasury movements.
- Sales documents, certificate provenance, actual sales receipts, approved project certificates and subcontract certificates/retentions.
- Project financial detail and portfolio financial queries: pagination and source error handling.

## Discovered Dashboard surfaces
Administrative billing trends, sales collections, CxC/CxP, account balances, OC commitments, monthly operational cash trend and net cash at 30 days; project/portfolio cards and operational stock/job/work-order counts.
The Licitaciones workspace and its tender KPIs remain separate from execution finance. No commercial funnel or handoff behavior was changed.

## Findings and fixes
- Cashflow read only twelve weekly plans; the new source RPC reads every saved plan intersecting the financial horizon, including a 30-day lookback for subcontract fallback.
- Independent Dashboard/Cashflow formulas diverged. Both now load `cashflow_read_sources` and call `buildCanonicalCashflow`; legacy dashboard API is a compatibility adapter.
- Silent query failures and truncated reads could become zero/partial KPIs. Checked pagination uses 500-row transport pages, exact counts and stable ordering; missing or failed facts throw. Page errors visibly report unavailable data.
- Speculative material cash ignored confirmed stock and could coexist with the same OC obligation. B07/B08 quantity, baseline and coverage engines are reused; coverage is consumed once across chronological plans and across projects sharing central stock.
- Cached OC invoiced totals could be stale. Residual commitments derive the linked invoice total from the read sources before using the existing reconciliation rule.
- Payments/treasury and receipts/treasury could duplicate actual events. Proven factual FKs determine supersession; RFQs alone and receipts of material add no financial obligation.
- Dates could be fabricated or drift at timezone/month boundaries. Missing factual due dates stay unknown; date-only arithmetic and buckets use UTC calendar operations, timestamp business dates use America/Asuncion.
- Recurring expense inputs now reject invalid amounts, dates, day values, currency and foreign account/project context.

## Canonical engine / sources
`lib/cashflow/{load,model,planning,dates,types}.ts` is the shared derived financial read model.
The guarded STABLE SQL RPC reads current tenant financial facts and calls the existing readonly canonical weekly-plan source helper. No new procurement, execution, stock or pricing engine was created.
The RPC is a live read, not a persisted financial decision. Nested canonical helpers retain their existing PostgreSQL volatility declarations; this batch does not claim cross-request snapshot consistency.
Rows retain company, project, source type/id, source read time, quantity where applicable, certainty and date basis. Missing BOM, price, invalid unit/context/amount or failed source prevents a fabricated complete projection.

## Planning rules
| Resource | Fallback cash date |
| --- | --- |
| Material uncovered demand | Plan START + 7 days |
| Labor | Plan END |
| Equipment | Plan END |
| Subcontract | Plan END + 30 days |

Factual invoice due dates supersede speculative timing. OC payment terms are free text: OC residual commitments retain an unknown date rather than parse or invent terms.
Financial OC supersession includes late or unknown delivery commitments; it does not promise physical on-time supply and does not change B08 MRP.

## PLANNED / COMMITTED / ACTUAL and precedence
- PLANNED: uncovered saved-plan resource demand and explicit recurring forecast templates.
- COMMITTED: residual authorized orders, unpaid invoices, outstanding sales documents, approved certificate/subcontract obligations.
- ACTUAL: recorded settlements, treasury and sales receipts. They are displayed separately and never deducted again from an account's current opening balance.
- Plan material → OC quantity → confirmed physical receipt → linked invoice → executed payment → treasury uses physical coverage and factual financial links, not description/provider/amount heuristics.
- Partial OC suppresses only its quantity. Central/project stock and supply are consumed once across plans.
- Sales document supersedes its certificate; treasury supersedes its linked receipt.
- Labor facts suppress only proven budget/period amounts. Subcontract contracts suppress linked speculative costs; approved net, retention and contractual remainder are separated.

## Currency, dates and window
PYG/USD/EUR/BRL/ARS remain separate; no FX is invented. Account currency and invoice/order currency are validated.
Canonical APU/material pricing stays in its existing PYG domain. Foreign financial obligations retain their actual currency.
Dashboard uses today through +30 days. Cashflow uses the current month through the end of the sixth month. Parity is asserted for an identical window/project/currency.
Overdue COMMITTED amounts enter the first display bucket with original source date retained. Historical PLANNED and ACTUAL amounts do not inflate future net projection.
Unknown-date commitments remain visible outside dated net totals. Month/day 31 recurrences clamp correctly; ISO week/year boundaries are calendar-safe.

## Isolation and permissions
The RPC requires an active authenticated admin/administracion profile and active company, with tenant-scoped joins, a bounded valid horizon and pinned empty search_path.
Anon cannot execute it. The base implementation is not directly executable by authenticated clients.
Project and budget ownership, OC item tenant/order provenance and same-currency invoice links are checked before derivation.
Project cash filters do not allocate company bank balances: project opening balance is zero with an explicit explanation.
Project/provider execution tokens are excluded from the returned financial source projection.

## New migrations
1. `20261003211113_cashflow_read_sources.sql`
2. `20261003212845_cashflow_sales_actuals.sql`

Only new migrations; no applied historical migration SQL edited. Filenames match actual Preview ledger timestamps.
Preview: `xddlzgjwufskgasomval`, UUID `d030820b-c2e1-4d52-b3cb-0e21ddacfbfb`, ACTIVE_HEALTHY; ledger 44 → 46.
Production remains at 44. No production data or schema writes.

## Verification
- Focused Cashflow/Dashboard/separation: 114 PASS, including 55 canonical adversarial cases.
- Combined focused + procurement/weekly-plan regression: 210 PASS across 23 files (96 procurement cases).
- Preview SQL: 18/18 PASS; fixture transaction rolls back. Exact returned snapshot is committed as `preview-snapshot.json`.
- Full serial Vitest: 1,520 PASS / 16 skipped; procurement and weekly-plan regressions included.
- TypeScript noEmit: PASS.
- Next Webpack production build: PASS.
- Diff whitespace check: PASS.
- Compiled app with Preview-backed synthetic user: Dashboard 30-day net −400 PYG; Cashflow six-month plans 1,500 PYG (400/400/400/300); project filtering preserved attribution; removing planned forecast yielded zero. No production user/data was used.
- Temporary Preview smoke users/tenants and related fixtures removed; subsequent read-only counts show zero fixture users/tenants. SQL checks create no MRP requirement snapshots.
- Security Advisor reviewed: existing legacy definer views, mutable search paths, legacy callable functions and Auth warnings are outside this batch. The new authenticated SECURITY DEFINER RPC produces the generic exposure advisory intentionally: authorization guards and anon denial are tested; base RPC privilege is revoked.

Advisor remediation references:
[Security definer view](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view),
[Function search path](https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable).

## P0 / P1 / P2 / P3 and practical limits
No known unresolved P0/P1 in the implemented read model; external audit remains pending.
P2:
- OC free-text payment terms have no canonical due-date FK; commitments stay undated.
- Equipment APU rows and recurring templates lack settlement lineage. Their PLANNED facts cannot be automatically matched to invoices/treasury by guesses; unrelated company payables remain separate.
- Unlinked invoices remain company-scoped; no guessed project attribution.
- Existing B1B project historical labor summary adds daily entries and labor payments. This legacy cost metric is isolated from the canonical cash model, not redefined in this batch.
- Multi-query portfolio/project display reads are checked and complete, but no cross-request database snapshot guarantee is claimed.
P3: Legacy Security Advisor findings remain documented; no security refactor outside scope.
The accepted historical 71×2 stock anomaly is unchanged; no remediation executed.

## Not verified / not implemented
Production runtime of the new RPC is not verified because deployment is forbidden. External audit, CI/Vercel PR result and eventual production deployment are separate steps.
No full accounting reconciliation, automatic matching without provenance, FX conversion, Batch 10, or production stock cleanup.
