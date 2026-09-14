# Inventory P1 hardening — DEV evidence archive

Snapshot captured before deletion of the temporary Supabase DEV branch.

- Captured UTC: 2026-09-14T10:59:53Z
- Supabase branch: `inventory-p1-hardening`
- Project ref: `mjbvxyvpojnpyrkiyujk`
- Branch ID: `b5f68fd2-02ab-4f62-8e30-41edbdde4006`
- Parent/main project ref: `ezucivipgmbvamhugkbj`
- Branch cost observed/confirmed: `$0.01344/hour`

## Final disposition

The DEV branch is authorized for deletion after this archive is committed. The local worktree and Git branch remain intentionally preserved.

The Supabase control-plane flag `MIGRATIONS_FAILED` was not repairable from Postgres-only read access. Postgres showed no failed or incomplete inventory migration. The exact control-plane failure timestamp and message were not exposed by the available MCP; the dashboard session was not authenticated. See `logs-available.md`.

## Local Git backup

- Authoritative base: `7caa643a40585bd2ac453ee773572e44f49fe322`
- Code/migration commit before this evidence commit: `bc1456a14697db1ff1a348d1662fee09cf9dcee6`
- Local branch: `fix/inventory-p1-hardening`
- `0080_inventory_panol.sql` is unchanged from the authoritative base.
- The only code/migration changes relative to the base are the inventory actions guard, the forward-only hardening migration, the forward-only transfer correction, and the regression test.

## Evidence files

- `migration-history.md` — remote migration history, statement MD5s and hashes.
- `schema-snapshot.md` — read-only catalog/schema consistency checks.
- `smoke-fixtures.json` — fixture IDs, paths and preserved data references.
- `smoke-results.md` — real DEV Supabase smoke results A–K.
- `logs-available.md` — available/unavailable log sources and the historical-flag conclusion.
