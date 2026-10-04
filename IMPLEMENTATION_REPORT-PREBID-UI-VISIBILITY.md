# PREBID UI Visibility Fix

## Discovered entry surfaces

- The Licitaciones workspace sidebar contains Dashboard, Competidores, Documentos, Auction Bot, and Auction Lab. PREBID was absent.
- `/licitaciones` is the existing tender dashboard/list. Rows linked to tender detail and exposed a tracking selector, but no direct PREBID action.
- `/licitaciones/[id]` already links to `/licitaciones/{id}/prebid`.
- `/licitaciones/[id]/prebid` loads and renders the existing `PrebidWorkspace` through `loadPrebidWorkspaceAction`.
- The existing dashboard contains the Importar DNCP dialog and the historical-cost import dialog.
- The internal layout and sidebar already gate Licitaciones to Pro+ users with the comercial, administracion, or admin role. PREBID workspace actions also enforce these plan/role requirements and scope tender access by `empresa_id`.
- Tender listing data is loaded through the existing authenticated Supabase client, which retains its current RLS behavior. Responsive list tables already use horizontal overflow; the new index uses stacked cards on narrow screens.

## Changes

- **Existing PREBID route:** Reused `/licitaciones/[id]/prebid` and `PrebidWorkspace`; workflow code was not changed.
- **New visible entry:** Added PREBID to the Licitaciones sidebar with the existing Pro+ and role gates.
- **PREBID index:** Added `/licitaciones/prebid`. It reuses `getLicitacionesPageData(profile)` and presents existing tender title, DNCP number, entity, tender state, and offer deadline. It shows no inferred PREBID progress.
- **Dashboard direct action:** Added “Abrir PREBID” in each tender row, linking directly to `/licitaciones/{id}/prebid`; existing row links and tracking controls remain.
- **Detail action:** Preserved the existing PREBID entry link.
- **Empty state:** Shows “No hay licitaciones para preparar.” and reuses the existing Importar DNCP dialog/component.
- **Costos históricos wording:** Renamed the trigger to “Costos históricos”; modal title is “Base histórica del Cost Engine”. The description distinguishes historical APUs, computations, and actual costs from the current tender offer, with a visible warning. The import action and behavior remain unchanged.

## Scope and safeguards

- **Backend changed:** No.
- **DB changed:** No. No migration added.
- **Business logic changed:** No.
- **UI redesigned:** No; limited to navigation, direct links, landing list, empty state, and explanatory wording.
- **Permissions and tenant isolation:** Reused existing plan/role guards, tender listing query/RLS, and PREBID workspace company scoping.
- **Production DB/data:** Not accessed; no tenders or other production data created.

## Verification

- Focused Vitest regressions: 4 files passed, 64 tests passed (new PREBID visibility contract, Batch 7 tender surface contract, workspace costs, workspace actions).
- ESLint on changed TS/TSX files: no errors; one pre-existing `PackageCheck` unused-import warning in `components/layout/sidebar.tsx`.
- Typecheck (`tsc --noEmit`): passed.
- Next production build: passed with Next.js 16.3.1. The isolated worktree has no installed dependencies or Supabase credentials, so the build used the existing local Next installation, a temporary Turbopack root for verification, and dummy Supabase values pointing to `127.0.0.1`; the temporary config was restored and nothing points to production.
- `git diff --check`: passed.
- Visual smoke: not run. This authenticated area needs a tenant session, and the isolated worktree has no safe test account/session. Existing production data was not used.
- E2E import flow: not run because the existing test imports a real DNCP tender into the authenticated company, which would create production data.
