# IMPLEMENTATION REPORT — BATCH 08

## Scope and freeze

Branch: batch/08-weekly-plan-mrp. Base: 2ac7da742cacf67acd2fd1ffe1d43f08b45c023b.
Weekly Plan → canonical requirement/coverage → persisted Need-to-Buy → explicit human procurement.
No UI redesign, second MRP/recipe engine, automatic supplier selection, invitation, award, allocation or order.
No merge, main mutation, tags or production deployment. Production remained READ ONLY.
The accepted historic 71x2 initial-stock anomaly was neither changed nor hidden. Its physical totals remain authoritative pending the separately reviewed reconciliation.

## Discovered surfaces

- Weekly calculation, target capping, multi-front order, hierarchy/leaf budget items, APU/BOM, waste and units.
- Certificate baseline plus subsequent daily execution; manual and production-recipe targets.
- Weekly plan loader/preview/save; atomic commit, reservation release/recommit, agent preview/save consumers.
- Project physical stock, central confirmed physical stock, active reservations and central selection.
- Authorized orders, delivery dates, confirmed receipts, DRAFT receipts and net pending quantities.
- Existing coverage allocator, resource/weather panels, transient Need-to-Buy and manual stock references.
- RFQ dialog/actions/canonical engine; Direct Purchase preview/confirm and order dialog.
- Tenant and active-profile boundaries, RPC execution grants, RLS, source writes and concurrency.
- DB functions deployed in Preview, inventory B05 adversarial regression and whole application tests.

## Canonical semantics

calculateWeeklyPlanRequirements remains the sole target→physical quantities→APU/BOM requirement engine.
allocateMaterialCoverage remains the sole coverage allocator. Existing coverage orchestration is extracted into weekly-plan-coverage.ts so preview and server procurement share it.
Contractual parent rows are excluded by the existing schedule leaf helper. Persisted front positions preserve sequential capping order.
The source of physical stock is B05 inventory_stock_by_project / inventory_stock_by_location, based on confirmed movements; cost buckets are summed without double counting physical quantities.
Coverage consumes project stock once, then available central stock (physical minus other ACTIVE reservations), then timely authorized net supply, then shortage.
Only AUTORIZADO order lines with exact product identity and expected_delivery_date <= neededBy count. Net inbound subtracts CONFIRMED received quantity. A confirmed receipt becomes physical stock and no longer remains inbound.
DRAFT receipts, RFQs, quotes, allocations without confirmed orders, direct purchase previews, cancelled orders, unknown/late delivery dates are excluded from committed coverage.
Invalid numbers/units/periods, missing required BOM and failed DB reads reject procurement instead of silently becoming zero.
No purchase is inferred from pricing or from an APU price.

## P0/P1 discovery and resolutions

| Finding | Resolution / evidence |
| --- | --- |
| Transient browser shortage trusted by procurement | Saved plan is recalculated server-side using the canonical engine and allocator; only server role can refresh material needs. Browser coverage is retained as seen evidence only. |
| Stale sources between reads and writes | SHA-256 source facts rechecked inside tenant-serialized DB transactions; P0409 rejects changed targets/BOM/execution/stock/supply. Validated COMMITTED gateway captures sources before server recompute. |
| Random retries / concurrent procurement can duplicate intent | Unique plan/product need identity, immutable snapshot/decision records and exact request retries under lock. Concurrent refresh, RFQ and DP/confirm verified. |
| Receipt/stock/inbound double counting | Authorized pending quantity minus confirmed receipts; project physical stock applied once; DRAFT receipt excluded. |
| Own reservation deducted twice on recommit | Own plan excluded from available-central reads; release/replacement atomic. Recommit retains exactly one reservation quantity. |
| Cross-project edit within tenant and direct COMMITTED bypass | Explicit plan/project/tenant scope; active role/pro plan validation; table writes revoked; privileged commit server-only. |
| Malformed stock/units/central references and silent read failure | Finite physical input guards, product-unit compatibility, no duplicate central references, errors propagate. |
| Parent contractual totals counted with child leaves | Shared schedule leaf helper used by engine and DB save. |
| Saved target capping inconsistent with certificates / front order | Certificate baseline + later daily deltas mirrored by persistence boundary; stored positions; reordered fronts rejected as a different new-plan request. |
| Need procurement could become COST_DISCOVERY or generic stale bypass | RFQ gateway forces PROCUREMENT and actual project/product/quantity; no provider invitations. Direct Purchase gateway delegates canonical preview; generic confirm protected by order trigger. |
| Fulfilled purchase permanently blocked future residual | New factual snapshot updates same need identity, preserves immutable RFQ/OC history and clears confirmed purchase active pointer for new residual. |
| No installed protection for receipt/source interleaving | Source write triggers share tenant advisory lock with decisions; waiting transaction rereads committed facts. B05 concurrency regression remains PASS. |
| Invalid production-recipe quantity/unit silently ignored | Server action validates positive finite ratios and actual budget units; DB trigger enforces context and unit. |
| Invented weather location | Weather overlay requires real project coordinates. Existing climate algorithm preserved. |

No known unresolved in-scope P0/P1 after these fixes. This is the discovery result, not a guarantee against future findings.

## Need-to-Buy persistence and human boundaries

Tables: weekly_plan_need_snapshots, weekly_plan_material_needs, weekly_plan_need_decisions.
Snapshots/decisions preserve source facts, shown facts, project/plan/product ownership and human procurement provenance. Material need has one plan/product identity and current factual quantity/snapshot; historical decisions are not rewritten on refresh.
User must save current targets and explicitly verify current need. UI shows current requirement, stock, central, inbound and shortage, including change from the shown calculation.
COTIZAR calls the guarded gateway, then canonical rfq_create. Purpose is forced PROCUREMENT. The gateway supplies validated material lines and empty providers. No invitation/award/allocation/order follows automatically.
COMPRA DIRECTA opens the existing order dialog only on human click. Human selects supplier, price, tax, freight and terms. Gateway calls canonical direct_purchase_preview; human confirmation calls canonical direct_purchase_confirm. Existing generic confirm cannot bypass stale Need-to-Buy provenance.
Pending/errors block duplicate UI submits; DB transactions and constraints remain authoritative across tabs/processes.

## Permissions and concurrency

Authenticated protected RPCs: save_weekly_plan_atomic (DRAFT only without reservation lifecycle), weekly_plan_need_sources, weekly_plan_project_sources, weekly_plan_need_rfq, weekly_plan_need_direct_preview.
Their actors must be active, allowed company/project roles and eligible plan. Foreign tenant sources/needs rejected/hidden in real DB tests.
Service-only RPCs: weekly_plan_refresh_needs, commit_weekly_plan_validated and existing commit_production_plan_atomic. Browser cannot author factual shortage or invoke validated commit. New public RPCs are not executable by anon.
Source mutation, refresh and decision transactions share an empresa advisory lock. Reservation lock order changed to avoid a tenant-lock versus balance-row-lock cycle; canonical inventory writes retain their own product safeguards.
This is deliberately conservative tenant serialization. Large tenants may experience lock contention; optimize lock granularity only with equivalent stale-data/concurrency tests (P2).

## Additive migrations

- 20261003172735_weekly_plan_need_provenance.sql
- 20261003173918_weekly_plan_atomic_boundaries.sql
- 20261003175511_weekly_need_boundary_hardening.sql
- 20261003185132_weekly_need_direct_retry_contract.sql
- 20261003185848_weekly_need_residual_and_read_permissions.sql
- 20261003191155_weekly_plan_commit_source_gate.sql
- 20261003193500_weekly_plan_retry_target_order.sql

All seven applied only to xddlzgjwufskgasomval. Baseline ledger 36 → final 43.
Corrective migrations are additive; already applied files were not edited. No historical migration was changed.

## Verification evidence (2026-10-03)

- Focused Vitest: 170/170 PASS across 10 files, including 38 new server/canonical coverage/procurement action cases.
- Full Vitest: 1465 PASS / 16 skipped, 157 passed files / 2 skipped; latest completed run 239.21 seconds. Skips are existing suite configuration; excluded live/e2e tests are not claimed tested.
- TypeScript noEmit: PASS (exit 0).
- Next.js 16.3.1 build --webpack: PASS (exit 0, Preview environment only).
- scripts/batch-08-preview.cjs: 37/37 PASS against actual Preview Postgres. Includes two separate connections racing refresh, RFQ, DP preview and human order confirmation; stale stock/receipt/BOM gates; RLS/ACL; partial receipt; need residual and reservation replacement. Script uses actual engine and allocator for main BOM case; tailored boundary cases explicitly supply controlled service-role quantities.
- Existing scripts/batch-05-adversarial.cjs: 29/29 PASS in Preview, including different-key logical initial stock retry and receipt concurrency.
- Preview project ACTIVE_HEALTHY verified. Final ledger 43; new RPC grants inspected READ ONLY.
- Production ledger rechecked READ ONLY: 36; Batch 08 migrations absent.
- Git remote main rechecked: frozen base above.
- git diff --check: PASS.

Synthetic fixtures were created only in Preview. A dedicated isolated tenant is retained for genuinely concurrent scenarios; transaction-only scenarios roll back. No product data remediation ran.
IMPLEMENTED: above TS/UI/schema changes. TESTED: unit, server action, canonical engine and full regression. PREVIEW VERIFIED: real DB gateways/concurrency/RLS/ledger. PRODUCTION VERIFIED: read-only unchanged ledger only. NOT VERIFIED: production B08 behavior, interactive browser end-to-end smoke, load/latency benchmarking. No production deployment is claimed.

## Security Advisor and remaining debt

Compared with the production reference findings, Preview adds five authenticated SECURITY DEFINER execution WARN notices for the deliberately protected RPCs listed above. Their execution is intentional; actor, tenant and human/server boundaries are checked inside functions. New anon-executable notices: none. New mutable-search-path notices: none. These warnings are disclosed rather than claimed absent.
Legacy Advisor findings remain: 2 competitor SECURITY DEFINER views (ERROR), 15 mutable search_path WARN, 47 anonymous executable SD WARN, 91 preexisting authenticated SD WARN, 4 RLS/no-policy INFO and leaked-password protection WARN. They are not new B08 regressions or silently repaired here.
P2: tenant lock contention/source snapshot size without production load benchmark; existing Direct Purchase MD5 fingerprint hardening remains separately scoped, while B08 source gating uses SHA-256.
P3: no UI redesign; saved plan/need inspection remains in the current workspace. Browser visual smoke not executed, not claimed.

## Handoff

Ready for external audit once the published PR matches this branch. Do not merge or deploy automatically. Next roadmap batch is Batch 09 — Cashflow + Dashboard.
