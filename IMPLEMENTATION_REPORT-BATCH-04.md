# Batch 04 — PREBID tender workspace

## Architecture and source

Base: `be1bd17cf82de5bb64f45e0f28a9a6bd1a18efb3`.
Branch: `batch/04-prebid-workspace`.
Exact diff allowlist: 27 files in `BATCH-04-MANIFEST.md`.

PREBID belongs to canonical `licitaciones`. Execution belongs to `projects`. Existing budget/APU/BIM/adopted-price tables now accept exactly one owner, with real FKs. No temporary project, new tender engine, parallel offer state machine or retrospective RFQ reparenting was introduced.

The tender detail links to `/licitaciones/[id]/prebid`, exposing Cómputo, BIM, APU, Costeo/evidence, offer composition and versions/outcomes.

## Integration delivered

- Cómputo imports actual tender items with source FK, measured units/quantities, idempotence and tenant checks. The existing planilla adapter and atomic `planilla_confirmar_computo` support both contexts and retain concurrency checks. Commercial users can use tender planillas; existing project RLS remains authoritative.
- BIM uses the existing browser IFC parser, quantity/unit policy and aggregation engine. Its shared registration RPC stores the model/elements atomically. Human mapping verifies owner, units, factual quantity, duplicates and item version; an element already confirmed elsewhere cannot be counted twice. Original tender IFC objects are retained and protected from mutation.
- APU writes the existing material/labor/equipment/subcontract tables. Costeo uses `computePartidaCosts`, `computeProjectCostTotals` and the existing price semantics, rather than a second calculation engine.
- Adopted price, last effective purchase, estimate and CPP retain existing selection semantics. Quotes remain market evidence until human adoption. Tender material needs use the existing explosion engine.
- COST_DISCOVERY creation uses the existing `rfq_create` and RFQ workspace. Tender provenance is explicit; `project_id` stays NULL. The database rejects PROCUREMENT for tender RFQs and the existing procurement RPCs reject discovery allocations/orders.
- Quote adoption verifies company, owner, RFQ item/product, quote/provider relation and current version in the database. The factual `precio_unitario` comes from DB; client quote price is not transmitted by the action and is ignored at the RPC boundary. MANUAL requires a finite positive price and clears quote provenance. Actor/time are server-owned.
- Direct cost is completed from measured leaf APUs. V2 supports explicit PERCENT/FIXED indirects, financing and risk, plus named general expense lines. All percentages use direct cost; fixed amounts use PYG. V1 remains reproducible. Margin is an explicit percentage of offered revenue. Missing APU, measurement or material evidence blocks the offer; grouping rows are not counted twice.
- The canonical `licitacion_ofertas.estado` remains BORRADOR → PRESENTADA → GANADA/PERDIDA. Draft versions are immutable historical copies without freezing current draft work. PRESENTAR captures DB facts atomically after a SHA-256 concurrency check and freezes workspace mutations.
- Submitted versions retain measured budget, APU, selected price facts, purchase observations/CPP, RFQs, supplier versions/reviews, BIM and competition. Invitation bearer tokens are excluded. Historical rendering recomputes from archived facts with the same engines, independently of later company price changes.
- GANADA/PERDIDA are human RPCs. GANADA requires a valid confirmed awarded amount and points to the original submitted winning version. Outcome/competition are retained separately. `prebid_handoff_snapshot` provides the winning baseline and confirmed award read-only; it creates no project. PERDIDA retains its submitted history and cannot produce a project handoff.
- Tenant RLS, real owner FKs, descendant/link checks, actor checks, private transaction permits, immutable versions and owner provenance guards protect direct API writes as well as Server Actions. Snapshot documents and IFC evidence are protected.

## Migrations and Preview

Eleven new migrations (eight original + three P1 corrections), enumerated in the manifest. No historical/applied migration was edited. Preview discoveries were addressed additively.

Preview: `batch-04-prebid-validation`.
Branch UUID: `d030820b-c2e1-4d52-b3cb-0e21ddacfbfb`.
Project ref: `xddlzgjwufskgasomval`.
Created without production data; initial replay reached ACTIVE_HEALTHY.
Final ledger: 20 entries = baseline + eight Batch03 + eight original Batch04 + three P1 corrective migrations.

The Preview lacked Storage buckets on fresh replay. New migrations create private `bim-models` and `quote-pdfs` only when absent, preserving existing environment settings. This was verified with an actual quote-file upload in the browser test.

Production was not linked for any push or written to. No merge, production deploy, seed, reset, repair, baseline rewrite or project creation occurred.

## Validation evidence

| Verification | Result |
| --- | --- |
| Focused PREBID Vitest tests | 56 PASS |
| PREBID + shared pricing/BIM focused regression | 86 PASS |
| Initial focused shared Costeo/planilla regression | 44 PASS |
| Final full serial Vitest | 1,401 PASS / 16 skipped; 152 passed files / 2 skipped |
| TypeScript (`npx tsc --noEmit`) | PASS |
| Next16.3.1 Webpack build | PASS; 58 static pages, new PREBID dynamic route |
| Real Preview SQL lifecycle/adversarial assertions | 85 PASS; all fixtures and temporary schema adjustments rolled back |
| Authenticated real browser journey | PASS; zero new page/console errors; optional legacy logo HTTP 400 recorded separately; zero projects created |
| Git whitespace check | PASS |

Preview SQL covers tenant isolation, no project owner fallback, same atomic Cómputo engine, IFC registration/mapping, compatible unit aliases, immutable original Storage objects, factual/manual price constraints including NaN/Infinity, mandatory/nonexistent/wrong product/wrong context quote IDs, superseded versions, no automatic adoption, discovery vs procurement, presentation CAS, frozen budget/APU/BIM/RFQ/prices, immutable versions, legacy outcome bypass, canonical outcomes and winning handoff. Direct tender budget writes without an active internal human are rejected; supplier submission without an ERP session remains valid through the existing private quote permit.

Browser verification used installed Playwright against the locally built application and this Preview only. It completed Cómputo → APU → tender COST_DISCOVERY → supplier DB quote → human adoption → offer composition → version → PRESENTADA → GANADA → immutable winning handoff. The initial test fixture needed an explicit profile row; after correcting that fixture, the full journey passed without an application error. Screenshot inspected.

Final synthetic browser audit tender: `c503b36f-15ad-4ac4-9c2a-b731c43e7520`.
Synthetic company: `0eded134-1df8-4dcf-8137-b66261f944c4`.
Its project count is 0. Synthetic data exists only in Preview. No application test data was created in production.

Credentials, local build/test logs and screenshot remain outside the Git diff (ignored local files). The committed browser harness refuses any project ref except the isolated Batch04 Preview.

## Security Advisor

No new anonymous-executable SECURITY DEFINER finding, mutable-search-path finding, insecure view or RLS-without-policy finding from Batch04.

Eight authenticated SECURITY DEFINER entries are expected API/RLS boundaries: `prebid_can_read`, `prebid_workspace`, `prebid_import_computo`, `prebid_record_outcome`, `prebid_handoff_snapshot`, `workspace_adopt_price`, `workspace_register_bim`, `workspace_apply_bim_quantity`. All are denied to anon and service_role, and runtime actor/tenant checks apply. Private helpers/permits are revoked from public API roles.

Legacy findings are unchanged: 4 RLS-no-policy, 2 definer views, 15 mutable search paths, 49 anon definer functions, leaked-password protection disabled. Authenticated-definer count is 87 (79 preexisting + 8 intended Batch04 boundaries). The unsafe `prebid_save_version` is no longer executable by API roles. `prebid_commit_version` is service-only; anon/authenticated ACL denial is verified in SQL and through the authenticated REST API. These legacy findings were not expanded into this batch.

## Boundaries for external audit

- PREBID currently requires PYG, matching the existing factual price engine; no currency conversion is inferred.
- BIM keeps the existing caterpillar plan gate. Missing/incompatible IFC quantities require correction rather than invented measurements.
- The project handoff is prepared as a read-only winning snapshot contract. Execution project/baseline creation is deliberately deferred to the subsequent human handoff flow.
- Eleven migrations are validated in Preview and remain unapplied to production pending separate authorization.
- Branch and Preview are retained. PR is for external audit; no merge is authorized here.

## Status

BATCH 04 EXTERNAL AUDIT P1 FIXES + READY FOR RE-AUDIT


## External audit P1 corrections

Audited HEAD before fixes: `7cbb430af3f5ed3bb15a73835a6054432dfb417c`. Same branch / PR #24. The previous implementation had three confirmed P1 findings; these sections supersede its earlier boundary/composition claims.

### P1-A: server-authoritative offer

The original finalizer signature has EXECUTE revoked from PUBLIC, anon, authenticated and service_role. Browser/API users cannot persist a supplied final amount. `savePrebidVersionAction` accepts only tender, presentation flag and factual hash, authenticates the actor/tenant, obtains factual DB input and calculates with the sole canonical `computeWorkspaceCosts` engine. Additional untrusted amount/actor arguments are ignored by construction and tested.

Only its server credential invokes `prebid_commit_version`. DB revalidates the explicit active profile, active company, internal role and tender company, locks the tender/draft, then independently compares the current factual SHA-256 before recording amount, immutable version and authenticated actor. There is no browser-accessible amount finalizer and no second SQL cost calculation engine. The service credential is the trusted application boundary; its amount must originate from the authenticated Server Action.

Real SQL: authenticated direct RPC with canonical 1460 facts and manipulated 999999 amount returns 42501; invoking the new finalizer with the browser role also returns 42501. Trusted finalization of the exact 1460 amount passes. Wrong-tenant actor, unsupported/no-role actor and stale hash reject. Unit action test calculates 1460 despite extra malicious amount/actor parameters. Real browser finalization verifies both persisted `monto_total` and snapshot amount against 2208.50.

### P1-B: offer actor and canonical lifecycle

A new offer trigger checks real auth.uid, active profile/company, same tenant and comercial/administracion/admin role for direct INSERT/UPDATE/DELETE, plus authenticated creator identity on INSERT. Only the existing private lifecycle permit bypasses that guard; its owner validates the actor first. Existing tenant read policies remain unchanged.

Legacy writers were inspected: `setLicitacionDecision` writes the tender decision / private follow-up; Bid Engine writes analysis snapshots with COMPETIR/REVISAR/DESCARTAR dictaments. When a canonical offer exists, draft direct PRESENTADA/GANADA/PERDIDA transitions reject without the private permit. Nonfinal EN_PREPARACION analysis remains usable; submitted history still forbids reparenting and arbitrary decision changes.

The real DB enum has only the three allowed roles. The rollback-only SQL harness temporarily relaxes role nullability for a real active same-tenant profile with no authorized role, verifies 42501 for create/settings/delete/state/outcome, then rolls back the schema adjustment and every fixture. No fourth role was invented. The Server Action unit test additionally injects an unknown `deposito` role and rejects it. Inactive human and inactive company direct mutations also reject.

### P1-C: complete composition with V1 compatibility

Settings V2 explicitly contain `schemaVersion:2`, `indirect`, `financing`, `risk` (each mode PERCENT/FIXED and finite nonnegative value), named `generalItems` with stable unique IDs, and marginPct. General concepts are free text. Each line exposes its concept, direct-cost base when percentage, value and result. Fixed charges are never interpreted as rates. Margin remains on sale: offer = totalCost / (1 - marginPct / 100), margin = offer - totalCost; the UI displays the formula.

`normalizeCostSettings` reads five-field V1 percentages into the same engine without rewriting source settings or archived facts. The legacy general percentage becomes an explicitly named V1 line for display/editing. Existing immutable snapshots retain their original schema and hash. A new draft settings save writes V2 deliberately; no backfill runs.

Tests cover fixed/percent indirect, fixed/percent general, multiple general concepts, fixed/percent financing and risk, revenue margin, invalid values/duplicates/concepts and unchanged/reproducible V1 facts. Real SQL accepts valid V2 and rejects null modes, invalid percent, blank concept and duplicate IDs.

### Additive Preview corrections

1. `20261003055813_prebid_audit_actor_and_server_boundary.sql`
2. `20261003055843_prebid_audit_cost_composition_v2.sql`
3. `20261003060959_prebid_audit_v2_validation_alias.sql`

The third corrects a PL/pgSQL variable/table alias collision found by actual V2 SQL validation. The already-applied second migration was preserved. All original eight migrations are unchanged versus audited HEAD. Dry runs enumerated only these new versions; pushes were allowlisted to Preview ref `xddlzgjwufskgasomval`. Ledger count independently verified: 20.

### Browser and retained legacy findings

The browser harness verifies the built app using synthetic Preview data, a factual supplier quote, fixed indirect/financing, percent risk, three named general lines, revenue margin, server-only version/presentation, explicit human GANADA and immutable winning handoff. Persisted offer: 2208.50 PYG. No execution project, allocation or OC is created.

Console/network checks retain an exact exception for HTTP 400 / NoSuchBucket at `/storage/v1/object/public/branding/current-logo`: the baseline does not replay Storage bucket contents, and the unchanged legacy sidebar requests that optional logo. Other HTTP/page/console errors still fail the harness. No branding bucket or legacy code was changed. This Preview-only condition is recorded separately from the P1 fixes.

Security Advisor retains baseline findings: 4 RLS-no-policy, 2 definer views, 15 mutable search paths, 49 anon-definer functions, leaked-password protection disabled. Eight intended authenticated boundaries remain; the unsafe authenticated finalizer was removed. No new anon execution, mutable search path, insecure view or missing-policy finding was introduced. Reference: https://supabase.com/docs/guides/database/functions#function-privileges .

No production writes, merge, new project or applied-migration edits occurred. Branch and Preview are retained for external re-audit.
