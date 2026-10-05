# UI RECOVERY 01

## Release boundary

- Branch: `fix/ui-surface-recovery-01`.
- Base: `87be09df1c1bf116564375b81c2884b2835ae425`; fetched and verified before work and again before publishing.
- UI recovery only. No business engine, financial formula, migration, RFQ semantics, MRP rule, inventory rule or certificate calculation changed.
- No main changes, merge, Production deployment or Production data mutations.
- Production and Preview migration ledgers: **52**, verified using SELECT only. Both already expose `projects.latitude` and `projects.longitude` as numeric columns.

## Discovery and implementation

The current authenticated ERP was inspected in the browser before edits. Its existing dark surfaces, shared Button/Input/Select/Dialog, compact tables and secondary action bars were the reference. Production navigation was read-only. Rendering of the changes used actual components and synthetic fixtures in a local browser, with server actions stubbed and Supabase unavailable.

| Reported surface | Existing behavior found | Recovery |
| --- | --- | --- |
| Global controls | PREBID used raw transparent, full-width controls. Native options had no explicit palette. The shared workspace CSS reset **all descendant** max-widths. | Shared opaque dark Select; native option/optgroup palette and visible keyboard focus; workspace width reset restricted to direct children. Existing native select props, keyboard interaction and form semantics retained. Numeric/code fields use proportional grids. |
| Buttons | Canonical primary/secondary/ghost variants already exist. Recipe import and several row actions used raw text controls. | Recipe import and personnel removal use shared Button. PREBID import/planilla/version actions are secondary; save/present remain primary. |
| PREBID Cómputo | Existing items, manual save, tender import and planilla action already implemented. | Captioned item table, honest empty state, separate toggleable compact add form, aligned action bar. Original action payloads retained. |
| PREBID APU | Material/labor/equipment/subcontract rows and save/delete handlers already implemented. | Bounded partida selector; Spanish segmented categories; selected-category table with consumption, waste and cost; grouped compact editor and save action. No APU engine change. |
| Costeo / evidencia | Cost/source evidence; COST_DISCOVERY RFQ; versioned supplier quotes; explicit human quote-price adoption; manual price adoption. | Visible cost → evidence → missing price → price request → quote → adopt explanation. Providers appear in the request step. Existing actions reused. RFQ code links to quotes/comparison without raw purpose/status jargon. Requesting a reference does not authorize a purchase. |
| Presupuesto / oferta | Existing direct-cost based percentage/fixed charges, arbitrary GG concepts, financing, risk, margin on sale, saved offer and frozen versions. | Direct cost baseline, ordered charge sections, GG table, compact margin, one incomplete warning and existing saved offer summary. Formula remains `totalCost / (1 - marginPct / 100)`. No invented live final amount. |
| KPI affordance | Six tender KPI cards linked to their own current workspace. Two document KPIs and Admin cards have real routes. | Six self-links are informational surfaces with default cursor and no hover-link behavior. Real links retain navigation, pointer/hover and visible focus, with destination title. No invented destination. Admin hrefs remain unchanged. |
| Project coordinates | Fields already exist in both databases and the Project type. Existing authorized project update scopes by company. | Coordinates exposed in the canonical EditProjectDialog. Optional validated patch added to the same update action; no other mutation path. Omitted fields preserve location, both explicitly blank clear it, partial/invalid submissions fail. Contextual climate buttons reuse this editor and focus latitude. |
| Climate Workdays | DMH/DINAC evaluation, evidence, proposed decisions, human confirmation/override and humidity continuation already exist. | Spanish title, coordinate explanation and contextual configuration. Evaluation unavailable until valid coordinates. Existing proposal/confirmation actions and contractual thresholds unchanged. |
| Weekly Plan climate | Existing Open-Meteo forecast, advisory operational assessment, productive factor, capacity/gap, weather-adjusted material-consumption value, coverage and fail-closed behavior. | Explicit OFF/ON explanation; missing-location resolution; provider/period/coverage; precipitation dates from the already-fetched response; per-partida/front factor, capacity and gap; existing material-consumption projection. |
| Historical weather / Libro | Cronograma used the canonical `climate_events`, `project_workday_status`, and `climate_evidence` flow; Avance showed an editable `project_weather_log` calendar and did not receive the canonical rows. | Avance now reuses the same `ClimateWorkdaysPanel` as Cronograma with the complete canonical event/workday/evidence reads. Daily historical evaluation calls the existing server action once per selected past date. Proposal rows show date, source/station, external and local precipitation, classification, decision, and evidence count; Confirm and Override call the existing actions. `project_weather_log` remains visible as LEGACY read-only history. Open-Meteo remains supporting evidence only, with ranges clipped at today. Existing explicit LDO import of legacy rows is retained; there is no synchronization or dual write. |
| Calendar | B/LL/HH/O meanings and manual cycle already exist. | One compact legend and readable LL/observed chips; manual state and observed precipitation remain distinct. Month grouping and contractual meanings retained. |
| Certificate tabs / print | Contractual certificate PDF includes rubros, liquidation and signatures. Workbook support is a separate existing sheet/file flow. Personal list has no independent printable report. Evidence tab is a placeholder. Project Informes already exposes general PDF and Excel. | Explicit contractual/support/personal/liquidation/annex labels and per-tab explanations. Existing PDF link labeled accurately. Evidence placeholder now states the implementation gap. No fake print button or PDF engine change. |
| Personnel | Existing certificate staff add/remove, daily labor entry, payments list/add/delete and assignment table. No staff-update operation in this surface. | List/table remains the working surface; existing create forms moved into canonical dialogs; row removal styled consistently. Action errors remain visible when dialogs are closed. Existing labor/payment calculations and backend operations retained. |

## Climate consequences and missing capabilities

Affected activities come from the existing operational analyst's assessment of planned item descriptions and meteorological evidence. This batch exposes the resulting per-item factor/capacity/gap; it adds no sensitivity taxonomy. Capacity scales by the existing factor and the engine reports capacity minus target as gap. Base target, procurement requirements and base cash remain unchanged. Weather-adjusted material consumption is already calculated; a new monetary rain-loss metric or weather-adjusted procurement/cash engine is **not** implemented here.

The climate preview action already persists append-only forecast batches/snapshots. It was **not called in Production**. Local visual preview uses a synthetic stub, not a database-backed financial validation.

Historical Open-Meteo weather is now visibly supporting evidence only. It does not create or confirm a contractual workday. The legacy `project_weather_log` calendar is labelled LEGACY and rendered without editing controls; old rows are retained and kept separate from the canonical registry. The existing explicit, accepted new-project LDO import into the legacy table is unchanged. It is not synchronized into the canonical table. Confirmed `project_workday_status` remains the downstream source; proposals do not become effective lost days until human confirmation.

The canonical daily DMH/DINAC evaluator remains a one-date action. The Libro date picker stops at today, and Open-Meteo ranges for the current month end at today; future dates are not shown as observed weather. No new provider or date-range request loop was added.
## Verification


- Focused UI/historical regressions: **4 files / 61 tests passed**.
- Climate and Weekly Plan regressions: **7 files / 113 tests passed**.
- Full suite: **170 files passed, 2 skipped; 1774 tests passed, 16 skipped**. Command: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --hookTimeout=60000 --testTimeout=30000`.
- Typecheck: **PASS**, `node node_modules/typescript/bin/tsc --noEmit`.
- Build: **PASS**, `node node_modules/next/dist/bin/next build --webpack` (Next.js 16.3.8; 59 static pages). Uses only placeholder public Supabase values in this local build; no database calls or credentials.
- Diff check: PASS (`git diff --check`; rerun after staging).
- Migrations: **0**; no Supabase schema or migration files changed.
- Preview and Production ledgers remain as previously recorded in the base report (**52 / 52**); this correction made no database requests or changes.
## Visual evidence and limits


Existing UI Recovery screenshots are under `audit-artifacts/ui-recovery-01/after/` and were rendered earlier from synthetic data with database mutations disabled. For this correction I inspected the existing PREBID desktop/Oferta, Plan Semanal, 420px PREBID and Personal screenshots. Those surfaces were not changed in this correction. They remain evidence for those unchanged views, not for the newly changed Libro.

The historical Libro screenshot from the prior report predates this correction and is not acceptance evidence for the canonical workflow. The local preview harness was updated with a synthetic automatic DMH/DINAC proposal and read-only legacy rows, but could not render in this worktree: esbuild reported `Cannot read directory "../../../../..": Access denied` while resolving the `node_modules` junction to a sibling worktree. No current historical-climate screenshot is claimed.

Windows Firefox was not returned by the available UI browser connector (only Chrome and the Codex in-app browser were available). The native expanded popup therefore was not opened or inspected. Existing dark native-select CSS is retained without a speculative dropdown rewrite. `Firefox Windows native/custom dropdown expanded = NOT VERIFIED`.

- PREBID desktop / Oferta: **PASS** from previously rendered unchanged views.
- 420px: **PASS** from previously rendered unchanged PREBID view.
- Weekly Plan: **PASS** from previously rendered unchanged view.
- Personnel: **PASS** from previously rendered unchanged view.
- Historical climate / Libro: **NOT VERIFIED** in a current render; code and regression checks passed.
- Firefox Windows expanded popup: **NOT VERIFIED**; P1-B remains an acceptance blocker.
- No authenticated branch Preview smoke was performed.
## Classification / review readiness
- P0: none identified.
- P1-A: canonical Libro integration is implemented and covered by focused regressions; the current visual render is still unverified.
- P1-B: native Windows Firefox expanded dropdown remains **NOT VERIFIED** because Firefox is unavailable through the UI connector. No popup pass is claimed.
- P2: existing missing capabilities remain as listed above; no financial weather-loss engine or personnel/certificate features were added.
- P3: current historical visual smoke and authenticated branch Preview smoke remain unverified.
- **Ready for external re-review: NO** until the current Libro view and expanded Firefox popup are visually inspected. PR #33 remains open; this correction must not be merged or deployed by this task.