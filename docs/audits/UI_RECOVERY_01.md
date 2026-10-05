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
| Historical weather / Libro | Observed weather retrieval already wired by month using Open-Meteo archive and recent-past endpoints. Separate DMH/DINAC workday proposal path and cron runner also exist. | Automatic evidence retrieval made discoverable. Existing precipitation suggestion now opens the human date/state editor; it cannot silently persist LL. Human may confirm or override using the existing `setWeatherDay` action. No new provider, scheduler or classifier. |
| Calendar | B/LL/HH/O meanings and manual cycle already exist. | One compact legend and readable LL/observed chips; manual state and observed precipitation remain distinct. Month grouping and contractual meanings retained. |
| Certificate tabs / print | Contractual certificate PDF includes rubros, liquidation and signatures. Workbook support is a separate existing sheet/file flow. Personal list has no independent printable report. Evidence tab is a placeholder. Project Informes already exposes general PDF and Excel. | Explicit contractual/support/personal/liquidation/annex labels and per-tab explanations. Existing PDF link labeled accurately. Evidence placeholder now states the implementation gap. No fake print button or PDF engine change. |
| Personnel | Existing certificate staff add/remove, daily labor entry, payments list/add/delete and assignment table. No staff-update operation in this surface. | List/table remains the working surface; existing create forms moved into canonical dialogs; row removal styled consistently. Action errors remain visible when dialogs are closed. Existing labor/payment calculations and backend operations retained. |

## Climate consequences and missing capabilities

Affected activities come from the existing operational analyst's assessment of planned item descriptions and meteorological evidence. This batch exposes the resulting per-item factor/capacity/gap; it adds no sensitivity taxonomy. Capacity scales by the existing factor and the engine reports capacity minus target as gap. Base target, procurement requirements and base cash remain unchanged. Weather-adjusted material consumption is already calculated; a new monetary rain-loss metric or weather-adjusted procurement/cash engine is **not** implemented here.

The climate preview action already persists append-only forecast batches/snapshots. It was **not called in Production**. Local visual preview uses a synthetic stub, not a database-backed financial validation.

Historical observed data is evidence. Neither fetching it nor opening its LL suggestion changes the Libro. The screenshot fixture retained two manual non-working records and an unrecorded suggested date until the explicit save action. Existing DMH/DINAC proposed-workday evaluation and human confirmation remain separate from historical calendar evidence.

Missing capabilities recorded without building features:

- Monetary rain loss and new adjusted cash/procurement economics.
- Independent Personal PDF and separate personnel liquidation report in certificate tabs.
- Certificate annex upload/view/print from the current placeholder tab.
- Staff update/edit backend operation in the certificate personnel surface; only existing add/remove are exposed.

## Verification

- Focused: **5 files / 98 tests passed**, including 22 new UI/location guard tests plus existing historical/weekly tests.
- Full suite: **169 files / 1767 tests passed; 2 files / 16 tests skipped** (1783 total), final repeat on this branch. Command: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --hookTimeout=60000 --testTimeout=30000`.
- Typecheck: **PASS**, `node node_modules/typescript/bin/tsc --noEmit`.
- Build: **PASS** (`npm run build`, Next 16.3.8, all 59 static pages plus dynamic routes).
- Build environment: worktree dependencies are a junction to a sibling checkout. Initial Turbopack run rejected its filesystem root; an uncommitted temporary root adjustment was restored in `finally`. Initial prerender lacked public Supabase config; successful build used noncredential placeholder public URL/key. No secrets copied, environment committed or Production calls made.
- The first concurrent build/full-suite runs hit PGlite startup timeouts. An isolated full run with two workers, 60s hook and 30s test budgets passed **169 files / 1765 tests**, with 16 existing skips. No assertions or test bodies were weakened. The final repeat includes the two added partial-coordinate cases.
- Diff check: **PASS**, `git diff --check`. Temporary Next configuration restored and verified identical to base.
- Migrations: **0**; no files under Supabase/schema/policies changed.

## Visual evidence and limits

Private baseline screenshots are stored locally under `audit-artifacts/ui-recovery-01/before/`. They were not committed or uploaded. Local synthetic screenshots are under `audit-artifacts/ui-recovery-01/after/`:

1. `01-prebid-computo.jpg`: table plus compact manual-entry form.
2. `02-prebid-apu.jpg`: bounded selector, categories, table and grouped editor.
3. `03-dark-select.jpg`: dark closed/focused select control.
4. `04-prebid-evidence.jpg`: explicit evidence workflow.
5. `05-prebid-offer.jpg`: financial sections and incomplete state.
6. `06-libro-clima.jpg`: calendar contrast and missing-location guidance.
7. `07-coordinates-dialog.jpg`: canonical project coordinate editor.
8. `08-personnel-list.jpg`, `09-jornal-dialog.jpg`: list and dialog hierarchy.
9. `10-weekly-climate-on.jpg`: OFF/ON and coordinate resolution.
10. `11-kpi-affordance.jpg`: info surface vs real link; DOM confirmed pointer and destination on real link.
11. `12-certificado-contractual.jpg`, `13-certificado-personal.jpg`, `14-certificado-liquidacion.jpg`: actual tab renderings and print scope.
12. `15-libro-human-review.jpg`: observed 18 mm → editable LL suggestion, no persisted date.
13. `16-weekly-climate-result.jpg`: synthetic dated precipitation and per-item 60% factor / 6 m² capacity / −4 m² gap, with unchanged base cash surface.
14. `17-computo-narrow.jpg`: 420px layout, wrapping actions and stacked controls; document width 405px, no page overflow.
15. `18-payment-dialog.jpg`: existing payment registration in the canonical dialog, closed without saving.

Reproduce the safe local view with `node scripts/ui-recovery-preview.cjs` and navigate to `http://127.0.0.1:3210/`. `#located` supplies synthetic coordinates. Mutations return a disabled error; no auth/DB connection. The workbook engine is intentionally stubbed in this harness: workbook operation and PDF bytes were inspected in existing code, not exercised against a live database. Source action payloads and existing rules are covered by the focused/full suite.

Visual smoke: **rendered and inspected locally**, plus authenticated Production baseline inspection read-only. This is not an authenticated branch Preview end-to-end pass. Native OS-expanded dropdown popup colors could not be captured in this browser; only closed/focused control, palette CSS and native option wiring are verified. Other browser/OS popup rendering remains P3.

## Classification / review readiness

- P0: none identified in this scoped recovery.
- P1: none identified in this scoped recovery.
- P2: existing missing capabilities listed above; explicitly disclosed and outside this authorized UI recovery.
- P3: authenticated Preview end-to-end smoke and expanded native popup cross-browser coverage not verified.
- **Ready for external UI review: YES**, with the explicit P2/P3 limitations above. No merge or Production release is authorized by this batch.
