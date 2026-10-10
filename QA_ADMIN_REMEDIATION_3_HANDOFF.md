# Remediation 3 — transactional release handoff

Branch: `fix/qa-admin-remediation-3`. Base `main` verified unchanged at `a56c0e199deda4a35a658b290d19d7b17ee4efa3`.
PR: https://github.com/bjjrage/Control-de-facturas/pull/37.

The former pending SQL and check-then-insert runtime have been superseded. `supabase/migrations/20261010040051_invoice_item_match_integrity.sql` installs six RPCs for creation, correction, item/match deletion, header unmatch and invoice deletion. They validate actor, tenant, source ownership, editable state, documented quantity and order remainder under PostgreSQL locks. Corrections preserve line IDs. Raw financial match mutation and truncation are denied. The migration preflight aborts on inconsistent historical data without repairing it.

The app and worker share this boundary. `20261010043627_atomic_invoice_job_creation_and_attachment_cleanup.sql` adds the seventh RPC, `create_invoice_from_job`: invoice creation, the exact-attempt job checkpoint and tenant audit commit together. Expired workers cannot create or finish jobs using an old attempt. Line batches insert atomically; a failed batch retains its invoice/job for review and prevents automatic reconciliation. Jobs that already reference an invoice cannot be re-imported as new invoices. Physical cleanup requires confirmed metadata deletion and an owned object path.

Validation snapshot before final review closure: full local serial Vitest **2089 passed / 16 skipped / 0 failed**, sequential PGlite **23 passed**, TypeScript and scoped ESLint passed, and production build passed. PGlite is supplemental functional evidence, not independent-session lock evidence. Final exact-head CI is the release gate, including full-baseline Supabase/PostgreSQL 17 contention tests and authenticated browser workflow. Certification remains in progress; this snapshot is not a ready-to-merge verdict.

Independent SQL, runtime and test reviewers found further defects in hard deletion, shared attachments, retry state transitions and partial-result reporting. Their fixes and review closure must be included in final CI. No production database, merge or deployment has been performed.

Use [the release and rollback runbook](docs/remediation-3-release.md) for the approved coordinated migration/app/worker cutover. Drain old writers first; rollback retains the new guards and RPCs. Restoring old write grants or an old worker would reopen the integrity defects.

Pre-existing audit artifacts, example spreadsheets, the Excel temporary file and all stashes were preserved and excluded from commits.
