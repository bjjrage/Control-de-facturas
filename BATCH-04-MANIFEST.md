# Batch 04 — PREBID tender workspace

Base: `be1bd17cf82de5bb64f45e0f28a9a6bd1a18efb3`
Branch: `batch/04-prebid-workspace`

Authorized: tender/project owner context in existing budget, APU, BIM and price tables; canonical tender offer versions and human outcomes; tender COST_DISCOVERY; immutable submitted and winning snapshots; tenant isolation. No synthetic project, second engine, production deploy, historical migration edits or merge.

Allowlist: this manifest; `BATCH-MANIFEST.md`; `IMPLEMENTATION_REPORT-BATCH-04.md`; new `supabase/migrations/*prebid*`; `lib/workspace/**`; `lib/costing/project-prices.ts`; `lib/planillas/adapters/computo-presupuesto.ts`; `lib/planillas/service.ts`; `app/(internal)/licitaciones/[id]/page.tsx`; `app/(internal)/licitaciones/[id]/prebid/**`; new tests under `lib/workspace/__tests__/**`.

Validation: focused tests, shared pricing/BIM/planilla regression, TypeScript, serial full Vitest, Webpack build; isolated Supabase Preview schema, RPC, permissions and lifecycle checks. Push and PR only after validation.

## Exact diff allowlist (24 files)

1. `BATCH-MANIFEST.md`
2. `BATCH-04-MANIFEST.md`
3. `IMPLEMENTATION_REPORT-BATCH-04.md`
4. `app/(internal)/licitaciones/[id]/page.tsx`
5. `app/(internal)/licitaciones/[id]/prebid/page.tsx`
6. `app/(internal)/licitaciones/[id]/prebid/workspace.tsx`
7. `lib/costing/project-prices.ts`
8. `lib/planillas/adapters/computo-presupuesto.ts`
9. `lib/planillas/service.ts`
10. `lib/workspace/context.ts`
11. `lib/workspace/costs.ts`
12. `lib/workspace/actions.ts`
13. `lib/workspace/__tests__/costs.spec.ts`
14. `lib/workspace/__tests__/actions.spec.ts`
15. `lib/workspace/__tests__/preview-lifecycle.sql`
16. `lib/workspace/__tests__/preview-browser.mjs`
17. `supabase/migrations/20261003045035_prebid_owner_context.sql`
18. `supabase/migrations/20261003045338_prebid_offer_lifecycle.sql`
19. `supabase/migrations/20261003045339_prebid_shared_rfq_and_computo.sql`
20. `supabase/migrations/20261003051352_prebid_tenant_and_history_hardening.sql`
21. `supabase/migrations/20261003052047_prebid_bim_storage.sql`
22. `supabase/migrations/20261003052234_prebid_boundary_completion.sql`
23. `supabase/migrations/20261003052903_prebid_rfq_document_storage.sql`
24. `supabase/migrations/20261003053910_prebid_actor_boundaries.sql`

No historical commit was rescued. All functional work is new on the audited main base. No applied migration file was edited; Preview discoveries were resolved by subsequent additive migrations.
