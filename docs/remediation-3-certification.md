# Remediation 3 certification evidence

The implementation at `9a2b719809ed7849d87f8883d30dac97207e0195` passed the complete
[release certification run 38066922109](https://github.com/bjjrage/Control-de-facturas/actions/runs/38066922109)
on 2026-10-10. The final documentation commit must also pass the same workflow;
use the successful run whose SHA equals PR #37's current head as the merge gate.
No production migration, merge or deployment was executed.

| Gate | Verified result |
| --- | --- |
| Full migration history, initial startup and reset | Passed; latest migration `20261010045001` |
| Real PostgreSQL | 17.11 (`170011`), 17 financial/security/concurrency checks passed |
| Full serial Vitest | 2,107 passed, 19 skipped, zero failures; 192 files passed, two skipped |
| Sequential PGlite RPC regression | 26 passed, included in full Vitest |
| Scoped ESLint | Zero errors; four existing unused-variable warnings |
| Production Next.js build | Passed |
| TypeScript | Passed |
| Authenticated Chromium workflow | One passed; 11.1 seconds, screenshot retained |

The `remediation-3-certification` Actions artifact contains runtime versions,
`postgres-integrity.json`, regression/build/typecheck/lint logs, Playwright output,
HTML report and `unlinked-integrity.png`. Artifact retention is 14 days. Runtime
versions were Node `v22.23.3` and Supabase CLI `2.120.0`.

The PostgreSQL checks used independent sessions against the full disposable
Supabase schema. They proved tenant/role/anonymous and raw-write denial; finite
and exact-scale source values; one-winner atomic invoice/job creation; rollback
after forced checkpoint failure; monotonic attempts and stale-worker fencing;
atomic invoice graph deletion and safe attachment cleanup; concurrent allocation
caps and idempotency; source-edit contention; correction rollback; create versus
unmatch; approval versus create; and delete versus payment execution. Bounded
PostgreSQL `40P01` abort is an allowed contention outcome, with progress and final
counter invariants asserted. This is not a claim that every contention avoids an
abort or that production data was inspected.

The browser logged in through Supabase Auth and used the compiled application's
actions. It allocated 2,500 units against 3,000 ordered, removed/recreated the
allocation, rejected an overallocated correction without changing its source,
removed incompatible-unit matches, rematched a compatible correction, and
unlinked header and item matches atomically. Database assertions checked the
persisted quantities and tenant audit rows. A navigation-related Next.js
`destination stream closed early` message appears in the browser log; all
functional assertions passed. The log is retained without suppressing it.
This is one Chromium workflow, not a cross-browser matrix. The disposable
baseline has no branding fixture, and its screenshot shows the sidebar logo
missing; this certificate covers the financial flow rather than visual branding.

The 19 skipped tests belong to existing optional/conditional workbook, BIM,
certificate-store and agent-runtime suites. No financial certification case was
skipped. External OCR/model execution and paid services were not exercised.
Certificate parser regression now uses a generated XLSX with 53 extracted and
53 matched rows; it does not require a private file from a developer's Downloads.
Select migration contracts normalize line endings only, retaining exact content
comparison across Windows and Linux.

Independent SQL, runtime/worker and test-design reviews informed the fixes;
their closure is recorded in [the review record](remediation-3-review.md).
[The release/rollback runbook](remediation-3-release.md) was checked against the
final runtime and the tested failure paths. Production recovery remains an
authorized operator action. Two unrelated Vercel project checks remain red for
their `MISSING_SERVICES` configuration; the ERP Vercel build is skipped by its
existing ignore rule. These are disclosed, not counted as successful previews.
