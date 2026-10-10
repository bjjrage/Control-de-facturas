# Remediation 3 release and rollback

## Scope and compatibility

The application and bulk worker use the same PostgreSQL reconciliation boundary.
`20261010040051_invoice_item_match_integrity.sql` installs create, correct, delete,
and unmatch RPCs, source guards, and restricted table privileges. No historical
rows are repaired or removed by installation. The old pending SQL is historical
design material and must not be installed separately.

This is a coordinated application/worker/database release. The former application
at `a56c787` uses direct writes that the new database intentionally rejects. An
old worker or old app must not remain a writer after the migration. A rolling
deployment without first draining writers is unsupported.

## Approval boundary

The certification workflow creates only a disposable loopback Supabase stack in
GitHub Actions. It applies the complete versioned migration history, exercises
PostgreSQL 17 with independent sessions, runs the full unit suite, builds and
typechecks the app, then tests browser actions against that stack. It has no
production credentials, preview branches, paid service provisioning, or deploy
steps. Production migration, merge, and production deploy require separate human
authorization.

## Release gates

Use the latest successful `Remediation 3 Release Certification` run for the exact
PR head. Retain its `remediation-3-certification` artifact. It must include:

- PostgreSQL version and the final migration version;
- real contention and final database invariant assertions;
- full serial Vitest regression output, TypeScript and production build output;
- scoped lint output for changed financial code;
- the browser action test output and screenshot/trace evidence;
- independent reviews with all material findings resolved.

An earlier green run, a PGlite result, or an approval alone does not satisfy these
gates. After a code or SQL change, rerun the affected certification and the final
full workflow. Skipped external suites against other services are not represented
as executed tests.

## Deployment sequence (after approval)

1. Record the approved Git SHA, application artifact and worker artifact. Verify
   `main` has not changed in a way that alters the tested migration stack. Confirm
   an existing database recovery point is available; do not provision a paid
   backup service implicitly.
2. Put invoice mutation entry points into the deployment maintenance window and
   stop the old bulk worker. Drain in-flight jobs and requests. Retain the inbox
   objects, job rows and attachments; do not discard partially processed jobs.
3. Inspect the pending migration list against the authorized target. Apply only
   the reviewed versioned migrations using the normal release operator workflow.
   The migration's transactional preflight must pass. If it reports historical
   inconsistency, stop the release: the transaction aborts and requires a reviewed
   data-repair proposal. Do not disable guards or erase matches to get past it.
4. Deploy the matching app and worker artifacts while writers remain stopped.
   Confirm the six RPC signatures exist, anonymous EXECUTE is denied, and raw
   item-match writes and truncation remain denied. Refresh the PostgREST schema
   cache through the normal migration/reload mechanism if needed.
5. In an authorized QA tenant, verify a 2,500-unit invoice against a 3,000-unit OC
   reports 2,500 invoiced and 500 remaining. Repeat the same request and confirm
   no extra quantity or audit mutation. Correct without changing the line ID;
   a reduction below its allocations must fail with the original line and matches
   intact. Unmatch must remove both the header link and allocations together.
6. Verify APTO/PAGADO invoices reject line/match mutations. Check the RPC audit
   rows carry the correct empresa and actor; worker audit rows must also carry an
   empresa. Reopen invoice mutations and start the new worker only after this
   smoke check passes. Verify admin hard deletion is transactional and refuses
   approved/paid invoices or invoices attached to executed payment orders.
7. Monitor RPC errors, jobs in `needs_review`, duplicate invoice failures, and
   discrepancies between `quantity_invoiced` and the sum of stored matches.
   Existing partial jobs that already reference an invoice must be reviewed on
   that invoice; requeueing them as fresh invoices is blocked.

## Safe rollback

Rollback must preserve the new financial write boundary. Do **not** restore raw
table write grants, drop the guards, install the pending SQL, or deploy the old
worker as a writer. That would reopen the races this release closes.

- Before migration: cancel the release and resume the existing app/worker.
- If preflight fails: its transaction leaves no partial installation. Keep the
  existing version; inspect the reported historical data separately.
- After migration, before reopening writers: keep maintenance active and the
  worker stopped. Retain the installed schema and all rows. Redeploy the last
  certified artifact that uses these RPC adapters, or prepare a forward fix on
  top of this release. The old application can serve read-only pages only while
  invoice writes remain disabled.
- After reopening writers: stop and drain writers again before changing the app.
  Keep all committed invoices, matches, job references and audit rows. Revert an
  application/UI regression only to an artifact that retains the RPC adapters;
  otherwise remain in maintenance pending a forward fix. Never restore a database
  snapshot over newer financial transactions without explicit data-loss approval.

The disposable certification proves failed corrections roll back source data and
allocations, stale relationships cannot be removed, repeated matches do not
double-count, and forbidden old raw writes fail. The full workflow also exercises
the installed migration against the baseline schema. Production recovery itself
is an operator action and is not claimed as executed by this PR.
