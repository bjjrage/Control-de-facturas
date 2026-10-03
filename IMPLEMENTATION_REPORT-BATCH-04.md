# Batch 04 — PREBID tender workspace

## Architecture and source

Base: `be1bd17cf82de5bb64f45e0f28a9a6bd1a18efb3`.
Branch: `batch/04-prebid-workspace`.
Exact diff allowlist: 24 files in `BATCH-04-MANIFEST.md`.

PREBID belongs to canonical `licitaciones`. Execution belongs to `projects`. Existing budget/APU/BIM/adopted-price tables now accept exactly one owner, with real FKs. No temporary project, new tender engine, parallel offer state machine or retrospective RFQ reparenting was introduced.

The tender detail links to `/licitaciones/[id]/prebid`, exposing Cómputo, BIM, APU, Costeo/evidence, offer composition and versions/outcomes.

## Integration delivered

- Cómputo imports actual tender items with source FK, measured units/quantities, idempotence and tenant checks. The existing planilla adapter and atomic `planilla_confirmar_computo` support both contexts and retain concurrency checks. Commercial users can use tender planillas; existing project RLS remains authoritative.
- BIM uses the existing browser IFC parser, quantity/unit policy and aggregation engine. Its shared registration RPC stores the model/elements atomically. Human mapping verifies owner, units, factual quantity, duplicates and item version; an element already confirmed elsewhere cannot be counted twice. Original tender IFC objects are retained and protected from mutation.
- APU writes the existing material/labor/equipment/subcontract tables. Costeo uses `computePartidaCosts`, `computeProjectCostTotals` and the existing price semantics, rather than a second calculation engine.
- Adopted price, last effective purchase, estimate and CPP retain existing selection semantics. Quotes remain market evidence until human adoption. Tender material needs use the existing explosion engine.
- COST_DISCOVERY creation uses the existing `rfq_create` and RFQ workspace. Tender provenance is explicit; `project_id` stays NULL. The database rejects PROCUREMENT for tender RFQs and the existing procurement RPCs reject discovery allocations/orders.
- Quote adoption verifies company, owner, RFQ item/product, quote/provider relation and current version in the database. The factual `precio_unitario` comes from DB; client quote price is not transmitted by the action and is ignored at the RPC boundary. MANUAL requires a finite positive price and clears quote provenance. Actor/time are server-owned.
- Direct cost is completed from measured leaf APUs. Indirects, general expenses, financing and risk are explicit percentages of direct cost. Margin is an explicit percentage of offered revenue. Missing APU, measurement or material evidence blocks the offer; grouping rows are not counted twice.
- The canonical `licitacion_ofertas.estado` remains BORRADOR → PRESENTADA → GANADA/PERDIDA. Draft versions are immutable historical copies without freezing current draft work. PRESENTAR captures DB facts atomically after a SHA-256 concurrency check and freezes workspace mutations.
- Submitted versions retain measured budget, APU, selected price facts, purchase observations/CPP, RFQs, supplier versions/reviews, BIM and competition. Invitation bearer tokens are excluded. Historical rendering recomputes from archived facts with the same engines, independently of later company price changes.
- GANADA/PERDIDA are human RPCs. GANADA requires a valid confirmed awarded amount and points to the original submitted winning version. Outcome/competition are retained separately. `prebid_handoff_snapshot` provides the winning baseline and confirmed award read-only; it creates no project. PERDIDA retains its submitted history and cannot produce a project handoff.
- Tenant RLS, real owner FKs, descendant/link checks, actor checks, private transaction permits, immutable versions and owner provenance guards protect direct API writes as well as Server Actions. Snapshot documents and IFC evidence are protected.

## Migrations and Preview

Eight new migrations, enumerated in the manifest. No historical/applied migration was edited. Preview discoveries were addressed additively.

Preview: `batch-04-prebid-validation`.
Branch UUID: `d030820b-c2e1-4d52-b3cb-0e21ddacfbfb`.
Project ref: `xddlzgjwufskgasomval`.
Created without production data; initial replay reached ACTIVE_HEALTHY.
Final ledger: 17 entries = baseline + eight Batch03 + eight Batch04 migrations.

The Preview lacked Storage buckets on fresh replay. New migrations create private `bim-models` and `quote-pdfs` only when absent, preserving existing environment settings. This was verified with an actual quote-file upload in the browser test.

Production was not linked for any push or written to. No merge, production deploy, seed, reset, repair, baseline rewrite or project creation occurred.

## Validation evidence

| Verification | Result |
| --- | --- |
| New focused Vitest tests | 35 PASS |
| Initial focused shared Costeo/planilla regression | 44 PASS |
| Final full serial Vitest | 1,380 PASS / 16 skipped; 152 passed files / 2 skipped |
| TypeScript (`npx tsc --noEmit`) | PASS |
| Next16.3.1 Webpack build | PASS; 58 static pages, new PREBID dynamic route |
| Real Preview SQL lifecycle/adversarial assertions | 62 PASS; all fixtures rolled back |
| Authenticated real browser journey | PASS; no page errors; zero projects created |
| Git whitespace check | PASS |

Preview SQL covers tenant isolation, no project owner fallback, same atomic Cómputo engine, IFC registration/mapping, compatible unit aliases, immutable original Storage objects, factual/manual price constraints including NaN/Infinity, mandatory/nonexistent/wrong product/wrong context quote IDs, superseded versions, no automatic adoption, discovery vs procurement, presentation CAS, frozen budget/APU/BIM/RFQ/prices, immutable versions, legacy outcome bypass, canonical outcomes and winning handoff. Direct tender budget writes without an active internal human are rejected; supplier submission without an ERP session remains valid through the existing private quote permit.

Browser verification used installed Playwright against the locally built application and this Preview only. It completed Cómputo → APU → tender COST_DISCOVERY → supplier DB quote → human adoption → offer composition → version → PRESENTADA → GANADA → immutable winning handoff. The initial test fixture needed an explicit profile row; after correcting that fixture, the full journey passed without an application error. Screenshot inspected.

Final synthetic browser audit tender: `1b6a54cf-bd90-42d8-b625-8a1345c765f7`.
Synthetic company: `37532da8-59c5-48cb-be37-68aac7d7787c`.
Its project count is 0. Synthetic data exists only in Preview. No application test data was created in production.

Credentials, local build/test logs and screenshot remain outside the Git diff (ignored local files). The committed browser harness refuses any project ref except the isolated Batch04 Preview.

## Security Advisor

No new anonymous-executable SECURITY DEFINER finding, mutable-search-path finding, insecure view or RLS-without-policy finding from Batch04.

Nine new authenticated SECURITY DEFINER entries are expected API/RLS boundaries: `prebid_can_read`, `prebid_workspace`, `prebid_import_computo`, `prebid_save_version`, `prebid_record_outcome`, `prebid_handoff_snapshot`, `workspace_adopt_price`, `workspace_register_bim`, `workspace_apply_bim_quantity`. All are denied to anon and service_role, and runtime actor/tenant checks apply. Private helpers/permits are revoked from public API roles.

Legacy findings are unchanged: 4 RLS-no-policy, 2 definer views, 15 mutable search paths, 49 anon definer functions, leaked-password protection disabled. Authenticated-definer count is 88 (79 preexisting + 9 intended Batch04 boundaries). These legacy findings were not expanded into this batch.

## Boundaries for external audit

- PREBID currently requires PYG, matching the existing factual price engine; no currency conversion is inferred.
- BIM keeps the existing caterpillar plan gate. Missing/incompatible IFC quantities require correction rather than invented measurements.
- The project handoff is prepared as a read-only winning snapshot contract. Execution project/baseline creation is deliberately deferred to the subsequent human handoff flow.
- Eight migrations are validated in Preview and remain unapplied to production pending separate authorization.
- Branch and Preview are retained. PR is for external audit; no merge is authorized here.

## Status

BATCH 04 COMPLETE + READY FOR EXTERNAL AUDIT
