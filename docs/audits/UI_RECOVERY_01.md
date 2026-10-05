# UI RECOVERY 01

## Calendar workflow guidance and visible recovery actions

Assigning a type now retains selected dates so users can immediately revise their type or explicitly clear the selection. Clear selection preserves the draft; discard restores saved classifications while retaining selected dates (or selecting affected dates if none were selected). Clear has a visible slate accent and pale text; discard uses a warm orange accent, distinct from blue save. Both enabled controls have strong border/hover contrast. A compact full-width sentence in the existing toolbar explains the current next step for idle, selected, pending-draft and saving states. Saved totals are visibly labeled; the single-day detail distinguishes its draft type from its saved classification. Calendar geometry, server actions, resident evidence and calculations remain unchanged. No new test run for this correction; Preview compilation is checked independently.

## Semantic calendar colors

Type buttons use the existing dark ERP surface, pale text, colored border and left inset accent rather than solid colored fills. Calendar drafts now carry the corresponding B green / LL blue / HH amber / O purple tint, border and pending label. A dashed border means unsaved; a white selection outline and checkmark indicate selection independently of the type color. Hover uses that date's accent only under the pointer. No layout, persistence, authorization or calculation changes. No new test run for these styling corrections; the Preview build validates compilation.

## Compact toolbar restored

User requested retaining the previous single compact toolbar rather than three panels. Restored the original order: selected count, B/LL/HH/O, multiple-selection toggle, clear selection, draft count and save/discard. Kept individual type colors and hovers, bordered selection controls and the persistent ACTIVA/INACTIVA mode badge. Removed the three group cards and expanded type labels. Draft/save behavior, calendar layout and server actions are unchanged. Previous verification below describes its corresponding commit; no new test run for this layout-only correction.

## Mixed calendar draft and explicit final save

Supersedes the earlier immediate-save toolbar below. Selecting dates and assigning B/LL/HH/O now makes a local draft only. Different groups can receive different types, and a later assignment replaces that date's draft type. Calendar cells show the draft code and “Sin guardar”; confirmed counters continue to represent saved human decisions. “Guardar cambios” submits the whole draft through one server action. Successful dates leave the draft; failed dates retain their codes and remain selected for retry. Discard clears local changes without writes. A browser close/reload warning protects a nonempty draft.

The administrative save wrapper validates authorization, project ownership, distinct dates, supported codes and project/date boundaries before writing. It reads each current day and delegates to existing canonical create/override actions, with at most three dates in flight. This remains explicitly non-atomic across dates and reports partial failures. Existing authority, MANUAL provenance for overrides, unchanged-proposal confirmation provenance, resident evidence and legacy read-only behavior remain intact. No schema, migration or resident backend changes.

Controls have three separate groups: selection, type assignment and final save. Multiple selection has a persistent pressed background, checkmark and ACTIVA/INACTIVA badge, independent of hover. Type buttons use green B, blue LL, amber HH and purple O with individual hover glows. The day hover has a small glow only under the pointer; selected cells remain distinct.

Actual local Firefox: **30 checks PASS**, no page errors, including zero action calls while staging mixed types, one explicit mixed save, partial failure/retry, discard, distinct type colors/hovers and persistent multiple-selection styling. Evidence is synthetic local verification, not authenticated deployed-data acceptance. Focused climate regressions: **93 PASS**. Full suite: **1,872 PASS / 16 skipped**; typecheck PASS; Webpack build PASS, 59 static pages; diff check PASS. Exact-SHA Preview evidence is saved separately after deployment so it does not change the deployed commit. No merge or Production/DB mutation.

## Hover correction

The Tailwind `enabled:hover:bg-blue-*` class introduced at `c03c80cc2703157c955d7d0adcc361650284bc60` unintentionally matched the global legacy `button[class*="bg-blue-"]` selector, which forces permanent background/border/inset shadow using `!important`. It also masked selection styles. The correction removes those utility names from day buttons and isolates idle/hover/selected styling in a CSS Module, leaving shared ERP CSS unchanged. Hover affects only the enabled day under the cursor; selection remains filled, bordered and checked after the cursor leaves. The toolbar is no longer sticky.

Actual local Firefox verification: **23 checks PASS**, including computed idle/hover/leave/disabled/selection styles, multi-selection, partial results and confirmation provenance. Focused climate suite: **84 PASS**. Captures remain explicitly synthetic, not authenticated deployed acceptance. No backend, domain, DB, migration or Production changes.

## Calendar selection update — current implementation

User steering supersedes the compact click-cycle request: retain the month-card layout at HEAD `56b92fb7f18ae1ac8a50a8b3bc5323950acc11ce`. Plain click selects one date; Ctrl/Meta+click adds/removes dates across months. A touch-friendly selection toggle provides the same behavior without modifiers. The top toolbar applies B/LL/HH/O to selected dates; selection itself does not write.

Client orchestration invokes existing canonical create/override actions sequentially, once per distinct date. It reports success and failure by date, removes successful dates from selection and leaves failures selected for retry. The UI prevents duplicate submissions while saving. Refresh runs after all attempts, including transport errors, because a response can be lost after a commit. This is an explicit non-atomic sequence; no batch RPC, source change, database operation or migration was added.

Proposal confirmation stays separate from manual classification. Resident evidence, QR, evaluation, advanced details and read-only legacy remain intact. Single-date proposal/evidence details are collapsed so selection does not open a large panel.

Verification: focused suite 84 PASS; full suite 176 files passed/2 skipped, 1,863 tests passed/16 skipped; typecheck PASS; Webpack build PASS, 59 static pages; diff check PASS. Actual local Firefox: 18 checks PASS, no page errors, screenshots identify synthetic fixtures explicitly. Authenticated deployed-data acceptance remains NOT VERIFIED. Exact-SHA Preview evidence is saved separately after deployment so it does not change the deployed commit.

Architecture for the next delivery is documented in `docs/architecture/CONTRACT_CLIMATE_CALCULATION.md`: configurable rules, evidence eligibility, versioned evaluations, approval separation and certificate snapshots. It requires no real PBC to design; all examples are synthetic. This document is a proposal, not a released contractual calculation engine or DB schema.

## Final climate source semantics correction

Preceding audited HEAD: `511ee59862f6eb0d04aca12c3cc097ec8dee87a8`. The application delta is two provenance values: `overrideWeatherWorkday` and `createRainEffectWorkday` now persist `source: "MANUAL"` for authenticated administrative decisions. Authorization, classification, calendar architecture and other action behavior are unchanged. `confirmWeatherWorkday` is unchanged: confirming an unmodified AUTOMATIC or RESIDENT proposal preserves its origin and records the human in `confirmed_by`.

Thirteen new action regressions cover both proposal origins, confirmation, B/LL/HH/O overrides and rain-effect insertion/replacement. Each checks that resident `climate_evidence` remains identical and no evidence or `project_weather_log` writes occur. The former static RESIDENT assertion was corrected to MANUAL.

- Focused climate/resident suite: 5 files, **78 tests PASS**.
- Full suite: 175 files passed, 2 skipped; **1,857 tests passed, 16 skipped**.
- Typecheck: PASS. Webpack build: PASS, 59 static pages. Diff check: PASS; staged check is required before commit.
- No migration, UI redesign, merge, Production deployment or database mutation. The new Preview uses the published commit SHA; deployment evidence is saved separately so it does not change that SHA.

## Correction #3 + Climate Calendar Recovery — current implementation

This section supersedes the earlier remaining-native-select classification and manual-form-first climate UI. PR #33 remains on `fix/ui-surface-recovery-01`; preceding audited HEAD is `f98c3b51d00bb87c267464ff3291b05d20f5bca1`, base/main `87be09df1c1bf116564375b81c2884b2835ae425`.

### Resident evidence integrity

`registerResidentRain` now validates the existing token/project/date/mm/image, uploads immutable content-addressed storage, locates the canonical event, inserts/finds immutable `RAIN_GAUGE_PHOTO`, then writes local measurement and creates/preserves the workday proposal. An evidence-insert failure may leave an observation/storage object but cannot create a resident measurement or workday proposal. Storage failure creates no climate facts.

Evidence is not a completion flag. Retries with existing evidence resume measurement and workday operations; the old `measurement_saved` metadata flag cannot short-circuit a partial report. Evidence is never updated. A unique-conflict insert is accepted only after finding the expected project/path/event/photo evidence. Identical concurrent reports converge to **one event, one evidence and one workday** in regression tests. A preexisting confirmed human decision remains unchanged. Resident reports never confirm contractual days.

### Global Select completion

All **51** operational native selectors in the previous inventory were individually reviewed and migrated across **18 files** to the existing shared Radix Select. TypeScript AST contract snapshots compare every original prop, option, enum, default and callback after migration; the obsolete HTMLSelectElement cast in Auction Lab became the shared callback's string value. No action payloads or business calculations changed.

Disabled first empty placeholders remain empty without an explicit value/default; required browser validation blocks submission until selection. Reset restores the placeholder. Authored data attributes are retained, labels render in SSR, and the trigger's inner layout keeps text and arrow on one line on mobile even when callers retain native `block` classes. Installed Radix `unstable_Provider` remains the existing documented upgrade boundary; no package change.

`correction-3/native-select-remaining.txt`: **0 operational native dropdowns; technical exceptions NONE** in app/components. The correction-2 list is retained as historical BEFORE evidence. Inventory, Stock, Warehouse, Licitaciones/Competidores/Auction Lab, Recepciones, SIFEN, BIM, imports, Pañol and Cobros are covered.

### Administrative Libro calendar

The old base `avance-fisico-panel.tsx` calendar interaction was the reference. The primary climate surface is now **JORNADAS CLIMÁTICAS / LIBRO DE OBRA**, followed by confirmed-day counters and monthly calendars with every date visible. Clicking a day opens a compact inline panel; B/LL/HH/O buttons save through existing human actions. The repetitive manual entry form was removed. Measurements, evidence uploads, rain-effect continuation and detailed overrides remain in a secondary collapsed advanced section.

| Libro code | Canonical classification | Reason |
| --- | --- | --- |
| B | WORKABLE | null |
| LL | NON_WORKABLE_RAIN | null |
| HH | NON_WORKABLE_OTHER | TERRAIN_SATURATED |
| O | NON_WORKABLE_OTHER | OTHER |

`createOtherWorkday` gains only an optional validated reason parameter, preserving its existing default and authorization/date/tenant checks. Existing rows use `overrideWeatherWorkday`; proposals can be explicitly confirmed with `confirmWeatherWorkday`. The calendar's "Ignorar sugerencia · marcar B" explicitly records a human WORKABLE decision without inventing an ignored status. Confirmed counts use canonical human decisions only.

Final human Libro state, pending meteorological suggestion and resident photo/mm evidence are projected independently. Resident photo metadata retains the reported mm snapshot; external DMH/DINAC values remain separate. Photos are retrieved using the existing short-lived signed URL flow. `evaluateProjectWeatherDayAction` and the existing DMH/DINAC system are reused; no second evaluator or automatic confirmation was added. Future/pre-start dates remain visible but cannot be marked through the calendar.

The calendar header reuses `ExecutionLinkDialog`, the existing `execution_token`, server-provided app origin and `/avance/[token]`. QR/copy link explain both daily progress and rain/photo evidence. No new token. `project_weather_log` stays read-only under **Histórico anterior**, collapsed by default. Existing Open-Meteo supporting-history access remains there. There is no legacy/canonical dual write or new authority.

### Current verification and evidence

- Focused final suite: **164 tests PASS** (resident 17, Select 13, all migration contracts 20, existing climate 28, manual actions 10, calendar projection 10, SIFEN 66).
- Full suite: **175 files passed, 2 skipped; 1,844 tests passed, 16 skipped**. Command: `vitest run --maxWorkers=2 --hookTimeout=60000 --testTimeout=30000`. A prior default-timeout run timed out during local PGlite initialization while building concurrently; final validation is sequential. No test implementation was weakened for that timeout.
- Typecheck: PASS, `tsc --noEmit`.
- Final Webpack build: PASS, `next build --webpack`, TypeScript and 59 static pages.
- Diff check: PASS before publication; staged check required before commit.
- Actual Windows Firefox: **25 checks PASS**, no page errors: 10 global module/placeholder checks plus 15 PREBID/RFQ/personnel/climate/calendar/resident checks. These exercise actual action/route/FormData payloads with local stubs.
- `audit-artifacts/ui-recovery-01/correction-3/` includes expanded Inventory/SIFEN/mobile Warehouse selectors, primary calendar with confirmed human HH + pending DMH proposal + resident mm/photo, existing QR, calendar marking controls, climate override, resident mobile and legacy collapse evidence.
- Screenshots are actual components with synthetic data; server actions, Supabase reads and fetch are intercepted locally. They are not authenticated deployed-data acceptance. No ERP production record was created or edited.
- Preview validation and Production migration ledgers: **52 / 52**, reconfirmed with SELECT COUNT only on 2026-10-05. **0 migrations / 0 database mutations**.
- No merge, main modification, Production deploy, financial formula, RFQ semantics, MRP or climate engine change.

Final Preview must use the published correction SHA in the existing `control-de-facturas` Vercel project and deployment-only ignored-build bypass. Exact SHA/READY/URL and root check are recorded separately after deployment so no follow-up report commit changes the deployed HEAD.

P0: none identified. P1: both external audit findings corrected; administrative calendar restored. P2: none newly identified. P3: authenticated acceptance on deployed data remains for Marcelo; Radix unstable API upgrade boundary remains documented. External/manual review readiness requires the READY Preview of the final published SHA.

## Correction #2 — current review evidence

This section supersedes the earlier correction's native-select approach, missing resident workflow, verification counts and review blockers below. Earlier sections retain the implementation history.

- Same PR #33 and branch `fix/ui-surface-recovery-01`; preceding HEAD `11d4b1f242b1068cf2582208df4c758676327c1b`.
- Manual workday entry reuses `createOtherWorkday` with the three canonical classifications. Dates are validated against project start and today; tenant authorization and human decision rules remain enforced. Concurrent confirmation prevents overwrite.
- Local precipitation reuses `updateLocalPrecipitation` and the existing local-measurement helper. External precipitation and external/local threshold flags remain separate. Event observations without a workday can also receive a local measurement and rain-gauge evidence.
- Existing `/avance/[token]`, project execution token and QR are reused. The mobile portal has Parte diario / Registrar lluvia tabs. Rain requires one validated image, date and nonnegative local millimetres; notes are optional. The server resolves the active project from the token, rejects browser project/company/event/decision authority, and validates historical dates and image bytes/dimensions.
- Resident rain uses `climate_events`, `project_workday_status` and immutable `climate_evidence` with `RAIN_GAUGE_PHOTO`. It only proposes a workday; it cannot confirm a contractual lost day. Existing human Confirmar / Override remain available. Existing human decisions are preserved.
- A synchronous submit guard plus content-addressed project storage path, no-upsert upload, project/date uniqueness and duplicate retry handling protect submissions. Evidence references its actual event without changing an existing workday's causal event.
- Legacy `project_weather_log` is subordinate and read-only: `HISTÓRICO LEGACY — SOLO LECTURA`. These new entry paths never write legacy rows.
- Shared Select uses installed Radix Select 2.3.7, portal rendering and dark ERP styling. Its exported `unstable_Provider` avoids the primitive's native bubble select; a single form input preserves successful-control semantics. This dependency boundary is regression-covered and must be rechecked on a Radix upgrade. No dependency/package changes.
- Required PREBID, RFQ, Personnel, climate, Weekly Plan and schedule selectors were migrated. There are **51 remaining raw native selectors outside these corrected flows**; exact locations are in `audit-artifacts/ui-recovery-01/correction-2/native-select-remaining.txt`. This is not a claim of repository-wide elimination.
- Read-only production schema inspection confirmed UUID execution tokens, nullable evidence uploader, project/date unique keys, immutable evidence/storage constraints, causal/tenant guards and required image bucket. No schema gap or migration. Production ledger **52**; existing validation Preview ledger **52**. No database mutations were performed.

### Correction #2 verification

| Check | Result |
| --- | --- |
| Focused climate tests | 47 PASS: existing climate suites 28, resident rain 13, internal actions 6 |
| Shared Select unit/contracts | 11 PASS |
| Actual components in Windows Firefox | 10 PASS, no page errors; keyboard, modal portal, actual PREBID/RFQ/personnel/climate/result payloads, mobile rain and disabled/read-only semantics |
| Full suite | 173 files passed, 2 skipped; 1,804 tests passed, 16 skipped |
| Typecheck | PASS (`tsc --noEmit`) |
| Build | PASS (`next build --webpack`, 59 static pages) |
| Default Turbopack local build | Environment limitation: node_modules junction resolves outside filesystem root. No build configuration change was made. |
| Build environment | Only existing public Preview Supabase URL/anon values were injected into the child process; no env file or remote configuration was changed. |
| Diff check | PASS before publication |
| Migrations / Production data mutations | 0 / 0 |

Firefox screenshots and `browser-results.json` in `audit-artifacts/ui-recovery-01/correction-2/` show the actual components with synthetic fixtures. All server actions are blocked/stubbed and no ERP records are created. Evidence includes PREBID and RFQ expanded selectors, climate classification, the manual/review panel, mobile resident rain and subordinate legacy history. These captures are local verification, not authenticated acceptance on deployed data.

The branch Preview will be created from the published correction SHA in the existing Vercel project, using a deployment-specific ignored-build override. Project and Production settings must remain unchanged. Its exact deployment SHA, READY state and URL are reported separately after deployment; the earlier Preview is not evidence for this correction.

### Correction #2 classification

- P0: none identified.
- P1: reported missing climate workflows and Firefox dropdown defects corrected and locally verified; external review remains required.
- P2: no new defect identified in the corrected scope; earlier missing capabilities remain outside this task.
- P3: 51 native selectors outside the corrected flows; authenticated deployed-data visual acceptance not performed. Radix unstable provider upgrade boundary documented and tested.
- No merge, main changes, Production deployment, database change, financial formula, MRP rule or RFQ semantic change. Review readiness requires a READY Preview of the published correction SHA.

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
