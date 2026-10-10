# Remediation 3 — transactional release handoff

Branch: `fix/qa-admin-remediation-3`. Base `main` verified unchanged at `a56c0e199deda4a35a658b290d19d7b17ee4efa3`.
PR: https://github.com/bjjrage/Control-de-facturas/pull/37.

The former pending SQL and check-then-insert runtime have been superseded. `supabase/migrations/20261010040051_invoice_item_match_integrity.sql` installs six RPCs for creation, correction, item/match deletion, header unmatch and invoice deletion. They validate actor, tenant, source ownership, editable state, documented quantity and order remainder under PostgreSQL locks. Corrections preserve line IDs. Raw financial match mutation and truncation are denied. The migration preflight aborts on inconsistent historical data without repairing it.

The app and worker share this boundary. `20261010043627_atomic_invoice_job_creation_and_attachment_cleanup.sql` adds the seventh RPC, `create_invoice_from_job`: invoice creation, the exact-attempt job checkpoint and tenant audit commit together. Expired workers cannot create or finish jobs using an old attempt. Line batches insert atomically; a failed batch retains its invoice/job for review and prevents automatic reconciliation. Jobs that already reference an invoice cannot be re-imported as new invoices. Physical cleanup requires confirmed metadata deletion and an owned object path.

Verified implementation certification: [run 38066922109](https://github.com/bjjrage/Control-de-facturas/actions/runs/38066922109) passed on `9a2b719809ed7849d87f8883d30dac97207e0195`: PostgreSQL 17.11 with **17 financial/security/concurrency checks**, full serial Vitest **2107 passed / 19 skipped / 0 failed**, sequential PGlite **26 passed**, scoped ESLint (zero errors, four warnings), TypeScript, production build and the authenticated Chromium workflow. The final documentation commit must also pass the exact-head workflow before the PR is marked ready. [Certification details and limits](docs/remediation-3-certification.md) identify the retained artifacts and skipped external coverage.

Independent SQL, runtime and test reviewers found defects in hard deletion, shared attachments, retry state transitions and partial-result reporting. Their fixes are included in the successful certification; the [review record](docs/remediation-3-review.md) records closure. No production database, merge or deployment has been performed. Two unrelated Vercel project checks have `MISSING_SERVICES` configuration failures; infrastructure outside this ERP was left unchanged and those checks are not represented as passing previews.

Use [the release and rollback runbook](docs/remediation-3-release.md) for the approved coordinated migration/app/worker cutover. Drain old writers first; rollback retains the new guards and RPCs. Restoring old write grants or an old worker would reopen the integrity defects.

Pre-existing audit artifacts, example spreadsheets, the Excel temporary file and all stashes were preserved and excluded from commits.
